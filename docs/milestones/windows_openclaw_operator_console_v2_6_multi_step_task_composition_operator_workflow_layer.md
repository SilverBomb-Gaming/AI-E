# Windows OpenClaw Operator Console v2.6 - Multi-Step Task Composition (Operator Workflow Layer)

## Checkpoint

This milestone adds a bounded workflow layer on top of the verified controller stack so operators can run a few explicit multi-step tasks without turning the console into an autonomous agent.

The shipped workflow surface is:

- `/explainrepo [path]`
- `/explainfile <path>`
- `/summarizeweb <url>`

Each workflow is deterministic and sequential:

- no branching graphs
- no retries
- no hidden planning
- no background execution
- no new mutation capability

## Workflow Model

The workflow layer is explicit in memory and visible in the desktop shell.

Workflow state now records:

- workflow id
- workflow type
- current state
- current step index
- per-step outcomes
- confirmation state
- compact audit summary
- final user-facing summary

The desktop snapshot now exposes:

- last workflow type
- last workflow state
- last workflow step
- last workflow summary

## Execution Rules

Workflows are composition only.

They reuse the existing safe capability surfaces:

- `repo.status.read`
- `file.read`
- `web.fetch.read`
- `ask.provider_query`
- context buffering and reuse

Every workflow step still goes through the same control path as a direct command:

- capability evaluation
- readiness and policy checks
- scope validation
- one-shot confirmation when required
- structured execution request/result contracts
- bounded audit recording

This preserves the original trust boundary instead of adding a second execution plane.

## Current Workflows

### `/explainrepo [path]`

Behavior:

- runs `/repo`
- optionally runs `/file <path>` when a path is provided
- runs one grounded `/ask` using the context created by the earlier step or steps

Purpose:

- explain current repository state
- optionally relate one file preview back to that state

### `/explainfile <path>`

Behavior:

- runs `/file <path>`
- runs one grounded `/ask`

Purpose:

- explain a single file preview using the same bounded file-read surface already supported directly

### `/summarizeweb <url>`

Behavior:

- runs `/web <url>`
- runs one grounded `/ask`

Purpose:

- summarize one allowlisted web preview without broadening beyond the existing bounded fetch model

## Context Handling

Workflows make context reuse explicit rather than hidden.

Rules:

- successful read steps create normal context entries
- later ask steps consume those created context entries explicitly
- multi-step grounding may use more than one context entry
- multi-context prompts remain bounded by the existing prompt character limit
- audit summaries record which context ids were used without logging raw content bodies

## Confirmation Behavior

Workflow steps preserve the existing confirmation model.

If a step needs approval:

- the workflow pauses in `waiting_confirmation`
- the pending confirmation is annotated with workflow metadata
- `/confirm <id>` resumes that workflow from the blocked step
- `/deny <id>` cancels the workflow at that step
- expired confirmations mark the workflow failed rather than silently continuing

Confirmation still does not override:

- out-of-scope file paths
- out-of-scope web domains
- readiness failures
- invalid provider state
- `always_offline`

## Audit and Trust Model

Audit remains bounded and step-oriented.

Recorded behavior includes:

- intermediate read-step results
- final ask-step result
- workflow id/type telemetry on the wrapped final result
- context ids used by grounded ask steps

Not added:

- hidden thought traces
- large prompt dumps
- background plan logs
- raw file or web bodies in audit summaries

Trust properties remain unchanged:

- read steps stay read-only
- ask stays online-sensitive and policy-aware
- workflow composition does not grant broader scope than the wrapped capabilities already had

## What Was Verified

Verified in focused controller tests:

- help output lists the new workflow commands while staying compact
- `/explainrepo [path]` executes as one bounded workflow
- repo and file contexts are both passed into the final grounded ask step when applicable
- workflow snapshot fields update to completed state after successful execution
- existing ask, confirmation, context, and execution-contract tests continue to pass

## Intentionally Not Added

Still out of scope in v2.6:

- autonomous planning
- tool invention
- workflow branching or conditionals
- scheduled workflows
- repo mutation or file writes
- background task queues
- generalized natural-language orchestration beyond the explicit workflow commands