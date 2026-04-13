# Windows OpenClaw Operator Console v2.0 - Read-Only Repo Insight Capability

This checkpoint introduces the first real external capability on top of the verified control stack. The goal is not broader repo tooling. The goal is to prove that filesystem and git-backed insight can enter through the manifest, evaluator, confirmation, execution-contract, scope, and audit layers without weakening trust.

## Capability Definition

New capability:

- `repo.status.read`

Manifest trust boundary:

- access kind: `read_only`
- locality: `local_only`
- data scope: `repository`
- offline safety: `safe_offline`
- confirmation sensitivity: `never`
- Telegram exposure: `allowed`
- scope type: `repository`
- access mode: `read`
- runtime requirement: `false`
- readiness requirement: `true`

## Scope Rules

- the capability is bound to one configured absolute `repo_root`
- v2.0 uses the current controller config repo root, which defaults to the current workspace root
- the execution scope is `repository/read` and targets only that configured root
- Telegram does not accept arbitrary path input; `/repo` and `/repo status` are the only supported entry points
- scope validation rejects traversal or any target outside the configured repository root before execution

Example:

- allowed root: `E:\AI projects 2025\AI-E`
- denied target: any parent or sibling path outside that configured repository root

## Read-Only Repo Inspector

`repo_inspector.py` now performs fixed, read-only inspection through bounded git calls only:

- `git --version`
- `git rev-parse --is-inside-work-tree`
- `git branch --show-current`
- `git status --short --untracked-files=all`
- `git log --oneline --no-decorate -n <limit>`

Explicitly not supported:

- `git add`
- `git commit`
- `git push`
- `git pull`
- diff browsing
- arbitrary shell passthrough
- arbitrary file reads outside the configured repo scope

## Telegram UX

New command:

- `/repo`

Optional alias:

- `/repo status`

Telegram-friendly response shape:

- repo name
- current branch
- clean/dirty state with a compact change count
- recent commit list capped to a short bounded set

User-facing failures remain short and actionable:

- `Repository not found at configured path`
- `Not a valid git repository`
- `Repo access is outside allowed scope`
- `Git is not installed or not available on PATH`

## Audit Behavior

Every `repo.status.read` attempt now creates an audit record, including:

- `capability_id`
- outcome
- reason code
- confirmation usage flag
- sanitized scope summary such as `repository/read repo=AI-E`
- compact action summary such as `AI-E | codex/home-screen-v1 | Dirty (3 changes)`
- duration

Intentionally not logged:

- raw git output
- full file lists
- arbitrary file names beyond the compact summary
- secrets or provider payloads

## Desktop Observability

The desktop shell now shows compact repo insight state:

- configured repo root
- last repo branch
- last repo status
- last repo check timestamp

This stays lightweight and reuses the existing status panel instead of adding a new repo dashboard.

## Verified

- `repo.status.read` is registry-backed and trust-classified as read-only local repository access
- repo scope validation runs before repo inspection
- out-of-scope repo requests are rejected before the inspector runs
- `/repo` returns a concise Telegram summary
- repo inspection failures map to structured `unavailable`, `failed`, or `timed_out` execution results
- every repo execution attempt produces an audit record
- controller config now persists `repo_root`
- read-only repo inspection is covered by dedicated repo-inspector and repo-capability tests

## What This Enables Safely

- future read-only file and repository detail capabilities can reuse the same repo scope vocabulary instead of introducing ad hoc path logic
- future repo/file/web read pilots now have a concrete example of manifest-driven trust boundaries plus pre-execution scope enforcement
- audit and desktop visibility now extend beyond internal/provider actions into real external inspection

## Not Added Yet

- repository mutation
- file browsing
- diff output
- file content reads
- arbitrary git command execution
- automation, workflows, scraping, RAG, or orchestration expansion
