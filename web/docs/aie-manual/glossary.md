# AI-E Glossary and Translation Layer

This glossary translates AI-E engineering language into language that creators and operators can understand without losing accuracy.

| Engineering Term | YouTuber Translation | End-User Meaning |
|---|---|---|
| governed operational workflow runtime | A controlled work pipeline AI-E can follow step by step | AI-E tracks a task through approved stages instead of improvising freely |
| validation lifecycle | The proof-checking part of the workflow | The system marks whether a stage still needs proof, passed proof, failed proof, or is blocked |
| rollback preparation | A planned undo path, not an automatic undo | AI-E can record that rollback is available or prepared, but it does not undo changes by itself in this phase |
| bounded mutation | Limited file changes inside a declared safe area | AI-E can only change files inside approved paths and only when the task allows it |
| approval-aware execution | Work that knows when a human must approve it | AI-E stops before sensitive action until approval exists |
| execution routes | The lane AI-E chooses for a request | A prompt may become read-only inspection, patch preparation, validation, build verification, or a blocked request |
| workflow stages | Named steps in an operational workflow | Operators can see exactly which step AI-E is on |
| supervised execution | Execution under explicit operator limits | AI-E runs within a governed contract rather than acting alone |
| deterministic workflow chains | Predictable workflow selection from request type | Similar requests produce the same stage sequence so the operator can audit behavior |
| workflow session ID | A stable label for one workflow run | Operators can refer to a specific workflow instance |
| stage lifecycle state | The current status of a workflow stage | A stage can be pending, approved, running, validating, completed, failed, rollback available, or blocked |
| approval checkpoint | A stop point before sensitive work | The operator must approve before the workflow can continue |
| validation checkpoint | A proof point after or during work | The workflow waits for evidence before it can complete the stage |
| blocked workflow | A workflow that correctly stopped | AI-E refused to continue because approval, validation, path scope, or external dependency was missing |
| blocked workflow recovery | The guided path after a workflow correctly stops | AI-E shows why it stopped, what safe alternative exists, and which recovery action to choose |
| Safe Recovery Path | The blocked-card section that turns a stop into a safe next step | Read this section when AI-E blocks a workflow and you need to know what to do next |
| safe workflow conversion | Turning an unsafe request into a governed planning or patch-preparation workflow | AI-E can prepare a safe patch workflow while keeping automatic application blocked |
| Prepare Safe Patch Instead | The recovery action for unsafe automatic patch application | AI-E creates a reviewable patch-preparation workflow and does not apply the patch |
| approval-first continuation | Continuing only after the required approval is recorded | Sensitive mutation or runtime work waits for operator approval before proceeding |
| external dependency | Something outside AI-E's current authority | AI-E may need a human, a build system, Unity, credentials, or another approved route |
| reasoning visibility | The operator-facing explanation of why AI-E routed a request | Operators can inspect the thinking category, route, approval need, and runtime boundary |
| runtime ownership level | The degree of real runtime authority available | Shows whether AI-E is only planning, supervising, validating, or executing in a bounded way |
| supervised_real boundary | The honest line around current real capabilities | AI-E has governed workflow architecture but not unrestricted autonomy |
| file-safety enforcement | Path checks before reading or writing | AI-E blocks unsafe paths and does not widen agent scope from a task contract |
| rollbackAvailable | A marker that rollback could be prepared for review | The system knows rollback is relevant for this stage |
| rollbackPrepared | A marker that rollback planning metadata exists | The system recorded the undo rationale, but did not run an undo action |
| rollbackReason | The reason rollback is relevant | Operators can see why rollback was prepared or made available |
| partial workflow completion | Some stages completed before the workflow stopped | Operators can see progress even if later stages are blocked |
| operational dashboard | A product surface for inspecting runtime state | The UI shows workflow sessions, stages, approvals, validation, and blockers |
| workflow history | A recorded timeline of workflow sessions and outcomes | Operators can see recent, failed, paused, interrupted, and resumable workflows |
| resumable workflow | A paused or reviewed workflow that can continue from a known stage | AI-E can continue from the recorded stage while preserving approval and validation rules |
| paused workflow | A workflow intentionally stopped by the operator | The job is not lost; it can become resumable from the paused stage |
| interrupted workflow | A workflow stopped by runtime interruption or incomplete execution | The operator must review it before it becomes resumable |
| execution outcome | The recorded result of a workflow run | Shows whether the workflow completed, blocked, failed, paused, interrupted, or became resumable |
| continuation eligibility | The rule that decides whether resume is allowed | AI-E checks history, current stage, approvals, validation, and blockers before continuing |
| next recommended action | The guidance line that tells the operator what to do next | AI-E explains whether to run, resume, validate, request approval, inspect, or resolve a blocker |
| AI-E Agent Summary | A plain-language summary of workflow purpose and safety posture | Operators can quickly see what the workflow is doing and whether approval or validation matters |
| guided operational interaction | A workflow UI that behaves like an assistant instead of a passive status board | AI-E explains what is happening, why it matters, and which action is most useful next |
| disabled action guidance | Explanation attached to an unavailable action | If a button cannot be used, AI-E explains what has to happen first |
| primary action emphasis | Visual emphasis on the most likely next safe action | Operators can quickly identify whether to run, resume, validate, approve, inspect, or review a blocker |
| beginner operational explanation | Plain-English translation beside technical state | AI-E explains terms like read context, validation pending, rollback available, and blocked without hiding the technical details |

## Status Explanation Translation

### Engineering Explanation

Workflow states remain lifecycle metadata, but the UI adds action-oriented explanations derived from current stage, validation state, approval state, blocked reason, completion state, and resume eligibility.

### YouTuber Explanation

AI-E is moving from "here is the status" to "here is the status, why it matters, and what to do next."

### End-User Explanation

When a card says waiting, blocked, running, resumable, or complete, read the sentence below it. That sentence explains the practical meaning.

| Status | Plain-English Explanation |
|---|---|
| `PENDING` | This workflow is ready, but the current step has not started yet. |
| `RUNNING` | AI-E is working through a supervised step and has not claimed completion yet. |
| `BLOCKED` | AI-E stopped because approval, validation, scope, or an external dependency is missing. |
| `RESUMABLE` | This workflow can safely continue from the previous recorded step. |
| `VALIDATING` | AI-E is waiting to verify the workflow result. |
| `ROLLBACK_AVAILABLE` | AI-E prepared an undo path for operator review; it did not run rollback automatically. |
| `COMPLETED` | All planned workflow steps completed inside the supervised workflow model. |

## Translation Principles

- Translate capability without inflating capability.
- Treat blocked states as safety signals.
- Keep approval language explicit.
- Keep validation language evidence-based.
- Avoid phrases that imply unsupervised operation.

## Recommended Phrases

Use these:

- "AI-E is tracking a supervised workflow."
- "This stage is blocked until approval is recorded."
- "Validation is pending."
- "Rollback preparation metadata is available for operator review."
- "This request routed to read-only inspection."
- "This workflow can be resumed from the validation stage."
- "The previous execution stopped because approval was missing."
- "The workflow remains blocked pending operator approval."
- "Next recommended action: run validation to verify the workflow result."
- "Resume Workflow is disabled until the workflow is saved for resume or marked resumable."
- "AI-E Agent Summary: this workflow is using read-only analysis steps."
- "Safe Recovery Path: prepare the patch first, then request approval before applying it."
- "This was blocked because automatic file mutation requires approval. AI-E can safely prepare the patch first, then wait for operator approval before application."
- "The original blocked workflow remains visible, and no patch was applied."

Avoid these:

- "AI-E does everything by itself."
- "AI-E owns the repo."
- "AI-E can run forever unattended."
- "AI-E is general intelligence."
- "AI-E has unrestricted shell access."
- "AI-E remembers everything forever."
- "AI-E will continue unattended until the job is done."

## Resumable Workflow Translation

### Engineering Explanation

Resumability is derived from recorded workflow state: current stage, lifecycle state, approval checkpoints, validation checkpoints, blocked reasons, rollback markers, and timestamps.

### YouTuber Explanation

AI-E can now pick up certain governed jobs from where they stopped, but only when the dashboard says the workflow is eligible to resume.

### End-User Explanation

If a workflow was paused or reviewed, AI-E can show where it stopped and whether it can continue. Blocked workflows stay blocked until the reason is fixed.

## Blocked Recovery Translation

### Engineering Explanation

Blocked recovery guidance is a product UX layer over existing governance. It can create a safe planning or patch-preparation workflow, but it cannot auto-apply patches, widen repo scope, bypass approval, run shell commands, execute Unity, or continue unattended.

### YouTuber Explanation

AI-E does not just stop unsafe actions. It shows the safe route forward.

### End-User Explanation

When blocked, look for `Safe Recovery Path`. Use it to prepare a safe patch, request approval, review scope, or understand the blocker.
