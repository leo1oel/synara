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
