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
