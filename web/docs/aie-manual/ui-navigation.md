# UI Navigation Manual

This page explains where operators go in AI-E and what each major operational surface means.

No screenshots are included in Phase 1. Screenshot placeholders are marked as TODO and should be filled only with real product captures.

## Navigate to Operator Chat

Route: `/operator/chat`

1. Open `/operator/chat`.
2. Enter a game-development, runtime, or repo-work prompt.
3. Inspect the reasoning visibility area.
4. Review the selected execution route.
5. Check whether approval, validation, or blocked capability indicators are present.

Screenshot TODO: `/operator/chat` full page with reasoning visibility expanded.

### Reasoning Visibility

Reasoning visibility is the operator-readable explanation layer. It shows why AI-E treated a prompt as a chat answer, repo workflow, patch preparation, validation request, blocked capability, or supervised route.

Look for:

- reasoning category
- execution owner
- workflow type
- execution route
- approval status
- mutation permission
- validation requirement
- rollback availability
- runtime ownership level

Screenshot TODO: reasoning visibility fields after a supervised repo-work prompt.

## Navigate to AI-E Agents

Route: `/operator/agents`

1. Open `/operator/agents`.
2. Review the workflow selection panel.
3. Generate or inspect a deterministic workflow chain.
4. Open the active workflow cards.
5. Inspect stage lifecycle states, approval checkpoints, validation checkpoints, blocked reasons, and rollback markers.
6. Review the workflow history panel for recent, resumable, paused, interrupted, failed, or blocked workflows.

Screenshot TODO: `/operator/agents` workflow selection and active workflow cards.

Screenshot TODO: `/operator/agents` workflow history panel with recent and resumable workflows.

## Workflow States

Workflow states tell the operator where a workflow session currently stands.

Common states:

- `PENDING`: the workflow exists but the current stage has not started.
- `RUNNING`: a stage is active inside supervised ordering.
- `PARTIALLY_COMPLETED`: at least one stage completed but later stages remain.
- `COMPLETED`: every stage completed.
- `BLOCKED`: the workflow stopped because a boundary or dependency is missing.
- `FAILED`: validation or execution failed.
- `ROLLBACK_AVAILABLE`: a rollback-relevant stage has rollback preparation available.
- `PAUSED`: the workflow was intentionally paused and may become resumable.
- `INTERRUPTED`: execution stopped before completion and needs operator review before resume.
- `RESUMABLE`: the workflow can continue from a recorded stage while preserving governance rules.

Screenshot TODO: workflow cards showing `PENDING`, `BLOCKED`, and `PARTIALLY_COMPLETED` states.

## Workflow History Panel

The workflow history panel turns temporary workflow sessions into operational continuity.

Look for:

- recent workflows
- failed or blocked workflows
- resumable workflows
- paused workflows
- interrupted workflows
- workflow summaries
- timestamps
- current execution state
- remaining steps

### Engineering Explanation

The panel reads recorded workflow history entries and summarizes execution outcomes, validation results, approval checkpoints, blocked reasons, rollback preparation, and resume eligibility.

### YouTuber Explanation

AI-E starts acting less like every job is brand new. The dashboard can show what happened last time and whether the job can continue.

### End-User Explanation

Use this panel to see what stopped, what passed, what is still blocked, and whether a workflow can be resumed.

Screenshot TODO: workflow history entry showing paused, interrupted, and resumable states.

## Validation Indicators

Validation indicators show whether evidence is required before a stage can complete.

Look for:

- `NOT_REQUIRED`: this stage does not need validation.
- `PENDING`: validation is expected but has not succeeded yet.
- `SUCCESS`: validation passed.
- `FAILED`: validation failed.
- `BLOCKED`: validation could not proceed or prevented completion.

Screenshot TODO: validation checkpoint view for a `VERIFY_BUILD` or `VALIDATE_PATCH` workflow.

## Approval Indicators

Approval indicators show whether a human approval gate is needed.

Look for:

- `NOT_REQUIRED`: stage is read-only or otherwise safe to proceed without approval.
- `PENDING`: stage is waiting for approval.
- `APPROVED`: approval was recorded.
- `REJECTED`: approval was denied.
- `BLOCKED`: approval was required but absent or invalid for the attempted transition.

Screenshot TODO: approval checkpoint view for a `PREPARE_PATCH` workflow.

## Blocked States

Blocked states are intentional. They tell the operator that AI-E respected a governance boundary.

Blocked examples:

- automatic patch application requested before approval
- mutation-capable stage started without approval
- validation-required stage completed without successful validation
- unsafe path scope requested
- external dependency required

Screenshot TODO: blocked workflow card with visible blocked-stage reason.

## Rollback Markers

Rollback markers are preparation metadata, not automatic rollback execution.

Look for:

- `rollbackAvailable`: rollback is relevant to this stage.
- `rollbackPrepared`: rollback planning metadata was recorded.
- `rollbackReason`: why rollback is relevant.

Screenshot TODO: rollback marker visible on a patch-preparation workflow.

## Operator Navigation Checklist

When reviewing an AI-E operational workflow:

1. Confirm the route: chat, read-only, patch preparation, validation, build verification, or blocked.
2. Confirm the workflow ID.
3. Confirm the current stage.
4. Confirm whether mutation is allowed.
5. Confirm approval status.
6. Confirm validation status.
7. Confirm blocked reason if present.
8. Confirm rollback markers if present.
9. Decide the next operator action.
10. If a workflow is resumable, confirm that approval and validation rules still make sense before continuing.
