# Windows OpenClaw Operator Console v2.7 - Workflow Reliability, Resume & Operator Transparency

## Checkpoint

This milestone hardens the bounded workflow layer from v2.6 so workflows behave predictably under pause, resume, cancellation, retention, and expiry.

The workflow surface remains explicit and bounded:

- `/explainrepo [path]`
- `/explainfile <path>`
- `/summarizeweb <url>`
- `/workflows`
- `/workflowstatus [id]`
- `/cancelworkflow [id]`

No new autonomy or mutation powers were added.

## Reliability Changes

Workflow lifecycle is now more explicit:

- active workflows move through `pending`, `running`, or `paused`
- terminal workflows end in `completed`, `blocked`, `failed`, `cancelled`, or `expired`
- paused workflows retain the pending confirmation id that blocked them
- resume is allowed only from the paused workflow tied to `/confirm <id>` in the same chat

Retention is now bounded in two ways:

- each chat keeps only a small bounded recent workflow history
- active workflows carry a bounded lifetime and expire deterministically instead of remaining resumable forever

When retention pressure exists, expired workflows are discarded before newer terminal workflows.

## Operator Transparency

Operators can now inspect workflow state directly from Telegram:

- `/workflows` lists recent workflow ids, types, states, and current steps for the chat
- `/workflowstatus [id]` shows one workflow id, type, state, current step, timestamps, pending confirmation id when present, and a compact summary
- `/cancelworkflow [id]` cancels the current active workflow or a specified active workflow in the same chat

The desktop shell continues to show last workflow type, state, step, and summary, but those fields now carry richer labels so workflow id and pause/confirmation state are visible there too.

## Confirmation and Resume Rules

Workflow confirmation behavior is now explicit:

- confirmation-required steps move the workflow into `paused`
- the blocking confirmation id is attached to both the pending confirmation metadata and the workflow summary
- `/confirm <id>` resumes only that workflow from the paused step
- `/deny <id>` cancels the workflow at that paused step
- expired confirmations mark the workflow `expired`
- `/cancelworkflow [id]` rejects the pending confirmation when one exists so later `/confirm` does not revive a cancelled workflow

This keeps resume deterministic and prevents hidden fallthrough into a raw confirmed capability execution when the workflow itself is no longer resumable.

## Audit and Summary Changes

Workflow telemetry now carries:

- workflow id
- workflow type
- workflow state
- current step id and description
- total step count
- workflow expiry timestamp
- pending confirmation id when relevant

Audit summaries and user-facing replies now include workflow id and state, so operators can correlate Telegram replies, desktop status, and audit entries without inferring which workflow ran.

## What Was Verified

Verified in focused controller tests:

- help output stays compact while listing the new workflow commands
- `/workflows` lists recent paused workflows with workflow ids
- `/workflowstatus [id]` reports paused and expired workflows clearly
- `/cancelworkflow` cancels paused workflows and prevents later `/confirm` from resuming them
- forced workflow expiry blocks resume and reports `expired` state cleanly
- existing context-bridging workflow grounding still passes with the richer workflow summaries
- existing execution-contract and confirmation tests continue to pass

## Intentionally Not Added

Still out of scope in v2.7:

- branching workflows
- hidden retries
- background workflow execution
- automatic rehydration after restart
- repo mutation or file writes
- generalized agent planning beyond the explicit workflow commands