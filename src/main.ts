import * as core from '@actions/core'
import * as github from '@actions/github'
import {Context} from '@actions/github/lib/context'
import {GitHub} from '@actions/github/lib/utils'
import gitdiffParser from 'gitdiff-parser'
import {ReplaceEpochTimes} from './util'

async function run(): Promise<void> {
  try {
    core.debug('Started run')
    const githubToken = core.getInput('GITHUB_TOKEN')
    const minEpochString = core.getInput('minEpoch')
    const minEpoch = minEpochString ? parseInt(minEpochString) : 0
    const maxLineLengthString = core.getInput('maxLineLength')
    const maxLineLength = maxLineLengthString
      ? parseInt(maxLineLengthString)
      : 0
    if (githubToken) {
      await processPR(githubToken, minEpoch, maxLineLength)
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    }
  }
}

async function processPR(
  githubToken: string,
  minEpoch: number,
  maxLineLength: number
): Promise<void> {
  const context = github.context
  const octokit = github.getOctokit(githubToken)
  await commentCommits(octokit, context, minEpoch, maxLineLength)
}

type Comment = {
  /** @description The relative path to the file that necessitates a review comment. */
  path: string
  /** @description The position in the diff where you want to add a review comment. Note this value is not the same as the line number in the file. For help finding the position value, read the note below. */
  position?: number
  /** @description Text of the review comment. */
  body: string
  /** @example 28 */
  line?: number
  /** @example RIGHT */
  side?: string
  /** @example 26 */
  start_line?: number
  /** @example LEFT */
  start_side?: string
}

async function commentCommits(
  octokit: InstanceType<typeof GitHub>,
  context: Context,
  minEpoch: number,
  maxLineLength: number
): Promise<void> {
  if (context.payload.pull_request) {
    const reviews = await octokit.paginate(
      octokit.rest.pulls.listReviews,
      {
        owner: context.repo.owner,
        repo: context.repo.repo,
        pull_number: context.payload.pull_request.number
      },
      response => response.data
    )

    const reviewIdsToClean = reviews
      .filter(
        review =>
          review.user?.login === 'github-actions' &&
          review.state === 'COMMENT' &&
          review.body.startsWith('Commenting epoch timers')
      )
      .map(review => review.id)
    const reviewComments = await octokit.paginate(
      octokit.rest.pulls.listReviewComments,
      {
        owner: context.repo.owner,
        repo: context.repo.repo,
        pull_number: context.payload.pull_request.number
      },
      response => response.data
    )
    const commentsToDelete = reviewComments
      .filter(
        reviewComment =>
          reviewComment.pull_request_review_id != null &&
          reviewIdsToClean.includes(reviewComment.pull_request_review_id)
      )
      .map(reviewComment => reviewComment.id)
    const commentDeletePromises = commentsToDelete.map(async commentId =>
      octokit.rest.pulls.deleteReviewComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        comment_id: commentId
      })
    )

    const diffResponse = await octokit.rest.pulls.get({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: context.payload.pull_request?.number,
      headers: {
        accept: 'application/vnd.github.diff'
      }
    })

    const diff = diffResponse.data as unknown
    if (typeof diff !== 'string') {
      throw new Error('Unexpected type for diff')
    }
    const files = gitdiffParser.parse(diff)

    const comments: Comment[] = []
    for (const file of files) {
      if (file.isBinary) {
        continue
      }
      if (file.type === 'add' || file.type === 'modify') {
        for (const hunk of file.hunks) {
          for (const change of hunk.changes) {
            if (change.type === 'insert') {
              const commentBody = ReplaceEpochTimes(
                change.content,
                minEpoch,
                maxLineLength
              )
              if (commentBody !== change.content) {
                const comment = {
                  path: file.newPath,
                  body: commentBody,
                  line: change.lineNumber,
                  side: 'RIGHT'
                }
                comments.push(comment)
              }
            }
          }
        }
      }
    }

    if (comments.length > 0) {
      core.debug('Posting review')
      await octokit.rest.pulls.createReview({
        owner: context.repo.owner,
        repo: context.repo.repo,
        pull_number: context.payload.pull_request.number,
        body: 'Commenting epoch timers',
        event: 'COMMENT',
        comments
      })
    }

    core.debug('Deleting old comments')
    await Promise.all(commentDeletePromises)
  }
}

run()
