import * as core from '@actions/core'
import * as github from '@actions/github'

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
  }
}

run()
