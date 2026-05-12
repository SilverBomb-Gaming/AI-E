# Runtime Workflows

Runtime workflows are supervised, stage-based operational chains. They help AI-E move from one bounded task to a visible lifecycle that operators can inspect.

## Workflow Sessions

A workflow session is one tracked operational run. It has:

- workflow session ID
- agent ID
- prompt or task goal
- current status
- current stage
- ordered stages
- allowed path scope
- forbidden paths
- completed stage count
- blocked reason if present
- rollback markers
- structured logs

Example:

```text
Workflow: elite-workflow-lite-elite-repo-maintainer-01-20260512120000
Prompt: prepare a safe movement patch
Stages: READ_REPO_CONTEXT -> PREPARE_PATCH -> REQUEST_APPROVAL
Status: PENDING
```

## Stage Progression

Stages advance in order. A later stage cannot run until the prior stage completes.

Basic lifecycle:

```text
PENDING -> APPROVED -> RUNNING -> VALIDATING -> COMPLETED
```

Blocked lifecycle:

```text
RUNNING -> FAILED -> ROLLBACK_AVAILABLE
```

Approval-blocked lifecycle:

```text
PENDING -> BLOCKED
Reason: Mutation-capable stage cannot start until explicit operator approval is recorded.
```

## Deterministic Workflow Chains

AI-E maps common requests to predictable stage sequences.

### Inspect an Inventory System

```text
Prompt: inspect the inventory system
Workflow: READ_REPO_CONTEXT -> GENERATE_REPORT
```

Operational walkthrough:

1. Read allowed repo context.
2. Generate a report for the operator.
3. Do not mutate files.

### Prepare a Safe Movement Patch

```text
Prompt: prepare a safe movement patch
Workflow: READ_REPO_CONTEXT -> PREPARE_PATCH -> REQUEST_APPROVAL
```

Operational walkthrough:

1. Read allowed repo context.
2. Prepare patch metadata or a scoped patch plan.
3. Request approval before mutation-sensitive work proceeds.

### Apply a Patch Automatically

```text
Prompt: apply the patch automatically
Workflow: BLOCKED_EXTERNAL_DEPENDENCY
```

Operational walkthrough:

1. Detect a mutation request that exceeds the current supervised route.
2. Block the workflow.
3. Explain that an approval or runtime route is required.

### Verify the Latest Gameplay Patch

```text
Prompt: verify the latest gameplay patch
Workflow: VERIFY_BUILD -> VALIDATE_PATCH -> GENERATE_REPORT
```

Operational walkthrough:

1. Run or represent build verification inside allowed validation policy.
2. Validate patch evidence.
3. Generate an operator report.

## Blocked Workflows

A blocked workflow means AI-E stopped correctly.

Common blocked causes:

- approval missing
- validation missing or failed
- unsafe path scope
- external dependency required
- automatic mutation requested without a supervised route
- stage order violated

Operators should read the blocked reason before deciding the next action.

## Validation Stages

Validation-required stages use validation state:

- `PENDING`: waiting for validation evidence
- `SUCCESS`: validation passed
- `FAILED`: validation failed
- `BLOCKED`: validation prevented completion
- `NOT_REQUIRED`: validation is not required for this stage

Validation-required stages cannot complete until validation succeeds.

## Approval Checkpoints

Approval checkpoints prevent mutation-capable stages from running silently.

Approval state can be:

- `NOT_REQUIRED`
- `PENDING`
- `APPROVED`
- `REJECTED`
- `BLOCKED`

A mutation-capable stage with missing approval becomes blocked instead of running.

## Rollback Preparation

Rollback preparation is architecture for operator review.

Fields:

- `rollbackAvailable`: rollback is relevant to the stage.
- `rollbackPrepared`: rollback planning metadata was recorded.
- `rollbackReason`: why rollback matters.

No automatic rollback execution is claimed in this phase.

## Operational Walkthrough: Patch Preparation

1. Operator asks for a safe patch.
2. AI-E selects `READ_REPO_CONTEXT -> PREPARE_PATCH -> REQUEST_APPROVAL`.
3. `READ_REPO_CONTEXT` can run as read-only.
4. `PREPARE_PATCH` requires approval before mutation-capable activity.
5. If approval is missing, the workflow blocks with a reason.
6. If validation is required, the stage cannot complete until validation succeeds.
7. If rollback is relevant, rollback preparation metadata can be recorded.
8. Operator reviews the summary and decides the next step.
