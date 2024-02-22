import * as core from '@actions/core'
import { context, getOctokit } from '@actions/github'
import type { GraphQlQueryResponseData } from '@octokit/graphql'

export async function run(): Promise<void> {
  try {
    const accessToken = core.getInput('github-token')
    const milestone = parseInt(core.getInput('milestone'))
    const issuesCount = parseInt(core.getInput('issues-count'))
    const owner = context.payload.repository?.owner.login!
    const name = context.payload.repository?.name!

    const client = getOctokit(accessToken)

    const { check } = await client.graphql<GraphQlQueryResponseData>({
      query: `query checkMilestoneExists($owner: String!, $name: String!, $milestone: Int) {
        repository(owner: $owner, name: $name) {
          milestone(number: $milestone) {
            title
          }
        }
      }`,
      owner: owner,
      name: name,
      milestone: milestone + 1
    })
    const nextMilestoneExists = check.repository.milestone != null

    const { repository } = await client.graphql<GraphQlQueryResponseData>({
      query: `query issues($owner: String!, $name: String!, $milestone: Int!, $first: Int) {
        repository(owner: $owner, name: $name) {
          milestone(number: $milestone) {
            title
            issues(first: $first, states: OPEN) {
              nodes {
                labels(first: 20) {
                    nodes {
                        name
                    }
                }
                number
              }
            }
          }
        }
      }`,
      owner: owner,
      name: name,
      milestone: milestone,
      first: issuesCount
    })

    type Issue = {
      number: number
      labels: {
        nodes: {
          name: string
        }[]
      }
    }
    const issues: Issue[] = repository.milestone.issues.nodes
    const milestoneTitle: String = repository.milestone.title
    const missedLabel = 'missed: v' + milestoneTitle

    if (issues.length != 0) {
      await client.request('POST /repos/{owner}/{repo}/labels', {
        owner: owner,
        repo: name,
        name: missedLabel,
        color: '497E76',
        headers: {
          'X-GitHub-Api-Version': '2022-11-28'
        }
      })
    }

    for (const issue of issues) {
      const issueNumber = issue.number
      const issueHasMissedLabel = issue.labels.nodes.some(label =>
        label.name.includes('missed: v')
      )
      if (!issueHasMissedLabel) {
        await client.rest.issues.addLabels({
          owner,
          repo: name,
          issue_number: issueNumber,
          labels: [missedLabel]
        })
      }
      const updateMilestone = nextMilestoneExists ? milestone + 1 : null
      await client.rest.issues.update({
        owner,
        repo: name,
        issue_number: issueNumber,
        milestone: updateMilestone
      })
    }
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
