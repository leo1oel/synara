# Lattice Git embed surfaces

The fork's `/source-control` and `/pull-requests/` routes use the existing embed
query parameters: `embed=1`, `workspaceRoot`, `hostOrigin`, and optional `theme`,
`surface`, and `locale`. They post `{ type: "synara:embed-ready" }` to the configured
`hostOrigin` after their first React commit. This means the surface can display its
own loading placeholders; it does not mean repository reads or GitHub requests
have finished. No workspace path or other payload fields accompany the signal.
The parent should validate the message's origin and source iframe.

`git.status` returns repository state without GitHub PR metadata. Consumers that
need the current branch's PR fetch `git.branchPullRequest` separately, returning
`{ branch, pr }`, and join the results on the client only when the checkout branch
identities match. Local status, staged and unstaged
diffs start alongside branch discovery. Changed files and the clean state do not
wait for GitHub; PR-dependent actions update when the separate lookup completes.

Branch PR head selectors run concurrently, with deterministic result selection.
The server caches successful branch lookups for 30 seconds using branch/upstream
identity and invalidates them after git mutations. Missing, signed-out, or failing
`gh` returns `{ pr: null }` without breaking local status or caching the failure.
Manual Refresh invalidates both client queries. Loading file rows reuse the
review tree's skeleton component.

## Lattice's Changes view

With `showActions` (the `/source-control` embed), `GitPanel` hands its reads and index
mutations to `LatticeGitChanges`, which lays them out for a writer:

- One line holds the branch picker, where the branch stands against its upstream (a
  "Push 2", "Pull 3" or "Publish" button, or a quiet "Up to date"), the Git actions menu
  and Refresh. `git.status` names the upstream's branch, not its remote, so the copy says
  `origin`.
- The commit message is written in the panel. Commit takes the staged files, or every
  change when none are staged; "Push after committing" (remembered per browser) makes it
  Commit & push. "Write the message for me" calls `git.generateCommitMessage`, which runs
  the same generation an empty-message commit runs, from a copy of the index
  (`GitCore.previewCommitContext`), so drafting a message never moves staged files.
- A file's checkbox stages or unstages it. Opening a LaTeX, Markdown or text file reads its
  change as sentences with words struck and inserted (`lib/proseDiff.ts`); other files keep
  the code diff.
- Nothing to commit shows the dated-drafts drawing, what is still left (commits to push or
  pull, or a branch to publish) and the last commit (`git.listRecentCommits` now carries an
  optional `authorName`).

Every action goes through `GitActionsControl`'s `lattice` variant, so confirmations,
progress toasts and dialogs are the ones the other surfaces use.

## Lattice's Pull requests list

With `workspaceRoot` (the `/pull-requests/` embed), the list column is
`LatticePullRequestList`: the project's open pull requests grouped as Needs your review,
Yours and Also open, then up to five pull requests merged in the last 30 days from the
project's closed list. Rows carry `checksState`, the head commit's combined check state,
which the inbox query now reads with the row. An empty list says why:

| Cause                            | How it is known                                                                                 | What it offers                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| GitHub CLI missing or signed out | the list fails with `PullRequestsUnavailableError` (`gh-not-installed`, `gh-not-authenticated`) | the command to run, Check again                                                        |
| Not on GitHub                    | the list answers with no repository batches and no errors (no GitHub remote)                    | Publish to GitHub when there is no `origin`; otherwise it says the remote is elsewhere |
| No pull requests                 | the list is empty                                                                               | "Open a pull request from <branch>" when Create PR can run from the current branch     |

Repositories GitHub could not read stay listed as notes under the list.

## Reading a pull request in Lattice

The embedded detail (`PullRequestDetailPanel` with `lattice`) opens on "In the paper"
(`LatticePullRequestPaper`), with Files and Conversation beside it. The tab reads the pull
request's diff as a red-pen proof: the serif title, its branches, author and how many
changes in how many sections, each reviewer's latest verdict, then the changed sentences of
LaTeX, Markdown and text files grouped by section in the reading font. A review comment sits
under the sentence on its line (review threads now carry `line`, falling back to the line an
outdated thread was left on); comments that match no changed sentence follow the sections.
Other changed files are counted with a link to Files. The foot holds Comment…, Approve (the
new `approve` pull request action, `gh pr review --approve`) and Merge, which goes through
the panel's own merge confirmation; a draft offers Ready for review instead.
