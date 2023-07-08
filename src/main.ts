import * as core from '@actions/core'
import * as github from '@actions/github'
import {GitHub} from '@actions/github/lib/utils'

async function run(): Promise<void> {
  try {
    core.debug('Started run')
    const githubToken = core.getInput('GITHUB_TOKEN')
    const minEpochString = core.getInput('minEpoch')
    const minEpoch = minEpochString ? parseInt(minEpochString) : 0
    if (githubToken) {
      await processPR(githubToken, minEpoch)
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    }
  }
}

async function processPR(githubToken: string, minEpoch: number): Promise<void> {
  const context = github.context
  const octokit = github.getOctokit(githubToken)
  function replaceEpochTimes(match: string): string {
    const epoch = parseInt(match)
    if (epoch >= minEpoch) {
      const date = new Date(0)
      date.setUTCSeconds(epoch)
      return date.toUTCString()
    }
    return match
  }

  if (context.payload.pull_request) {
    const commits = await octokit.paginate(
      octokit.rest.pulls.listCommits,
      {
        owner: context.repo.owner,
        repo: context.repo.repo,
        pull_number: context.payload.pull_request.number
      },
      response => response.data
    )

    for await (const commit of commits) {
      core.debug(`Processing ${commit.sha}`)
      const fullCommit = await octokit.rest.repos.getCommit({
        owner: context.repo.owner,
        repo: context.repo.repo,
        ref: commit.sha
      })
      if (fullCommit.data.files) {
        for (const file of fullCommit.data.files) {
          core.debug(`Processing ${file.filename}`)
          const lines = file.patch?.split(/\r\n|\r|\n/)
          if (lines) {
            let rightLineNumber = 0
            for (const line of lines) {
              core.debug(`Processing ${line}`)
              const lineNumbers = line.match(/@@ -(\d+),\d+ \+(\d+),\d+ @@/)
              if (lineNumbers) {
                rightLineNumber = parseInt(lineNumbers[2])
              } else if (line.startsWith('+')) {
                let comment = line.replace(/\d+/g, replaceEpochTimes)
                if (comment !== line) {
                  comment = comment.substring(1)
                  core.debug(
                    `Posting review comment to ${file.filename} - RIGHT - ${rightLineNumber}`
                  )
                  await octokit.rest.pulls.createReviewComment({
                    owner: context.repo.owner,
                    repo: context.repo.repo,
                    pull_number: context.payload.pull_request.number,
                    body: comment,
                    path: file.filename,
                    line: rightLineNumber,
                    side: 'RIGHT',
                    commit_id: commit.sha
                  })
                }
                rightLineNumber++
              } else if (!line.startsWith('-')) {
                rightLineNumber++
              }
            }
          }
        }
      }
    }

    const reviewThreads = await getAllReviewThreadList(
      octokit,
      context.payload.pull_request.number
    )
    core.debug(JSON.stringify(reviewThreads))
    const threadsToDelete = reviewThreads.filter(reviewThread => {
      const allCommentsAreActionBot = reviewThread.node.comments.edges.every(
        edge => edge.node.author.login === 'github-actions'
      )
      return reviewThread.node.isOutdated && allCommentsAreActionBot
    })
    core.debug(JSON.stringify(threadsToDelete))

    for (const thread of threadsToDelete) {
      for (const comment of thread.node.comments.edges) {
        core.debug(`Deleting review comment ${comment.node.databaseId}`)
        await octokit.rest.pulls.deleteReviewComment({
          owner: context.repo.owner,
          repo: context.repo.repo,
          comment_id: comment.node.databaseId
        })
      }
    }
  }
}

async function getAllReviewThreadList(
  octokit: InstanceType<typeof GitHub>,
  pullNumber: number
): Promise<ReviewThreadEdge[]> {
  const {edges: reviewThreads, page_info} = await getReviewThreadList(
    octokit,
    pullNumber,
    null
  )
  if (page_info.hasNextPage) {
    const res = await getReviewThreadList(
      octokit,
      pullNumber,
      page_info.endCursor
    )
    return [...reviewThreads, ...res.edges]
  }

  return reviewThreads
}

type PageInfo = {
  endCursor: string
  hasNextPage: boolean
}

type ReviewThreadEdge = {
  node: {
    comments: {
      edges: [
        {
          node: {
            databaseId: number
            author: {
              login: string
            }
          }
        }
      ]
    }
    isOutdated: boolean
  }
}

async function getReviewThreadList(
  octokit: InstanceType<typeof GitHub>,
  pullNumber: number,
  cursor: string | null
): Promise<{edges: ReviewThreadEdge[]; page_info: PageInfo}> {
  const query = `
    query GetReviewThreadList($repo_owner:String!, $repo_name:String!, $pull_request_number:Int!, $next_cursor:String){
      repository(owner:$repo_owner, name:$repo_name) {
        id
        pullRequest(number:$pull_request_number) {
          id
          reviewThreads(first:100, after: $next_cursor) {
            pageInfo{
              hasNextPage
              endCursor
            }
            edges {
              node {
                comments(first:2){
                  edges{
                    node{
                      databaseId
                      author{
                        login
                      }
                    }
                  }
                }
                isOutdated
              }
            }
          }
        }
      }
    }
  `

  type ReviewThreadsResponse = {
    repository: {
      pullRequest: {
        reviewThreads: {
          pageInfo: PageInfo
          edges: ReviewThreadEdge[]
        }
      }
    }
  }

  const parameter = {
    repo_owner: github.context.repo.owner,
    repo_name: github.context.repo.repo,
    pull_request_number: pullNumber,
    next_cursor: cursor
  }

  const result: ReviewThreadsResponse = await octokit.graphql(query, parameter)
  return {
    edges: result.repository.pullRequest.reviewThreads.edges,
    page_info: result.repository.pullRequest.reviewThreads.pageInfo
  }
}

run()
