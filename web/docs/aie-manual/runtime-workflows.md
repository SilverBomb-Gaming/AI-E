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
- workflow history record
- resume eligibility
- last event timestamp

Example:

```text
Workflow: elite-workflow-lite-elite-repo-maintainer-01-20260512120000
Prompt: prepare a safe movement patch
Stages: READ_REPO_CONTEXT -> PREPARE_PATCH -> REQUEST_APPROVAL
Status: PENDING
```

## Stage Progression

Stages advance in order. A later stage cannot run until the prior stage completes.

The operator UI should make progression explicit:

- `Complete` means a stage has been recorded as finished.
- `Active` means this is the current stage that needs attention.
- `Locked` means the stage is planned but cannot run yet.
- `Mark Current Step Complete` records that one supervised stage finished; it does not complete the entire workflow unless it was the final stage.
- `Run Approved Step` means approval exists for that stage, but AI-E still has not claimed patch application, Unity execution, shell execution, or validation.

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

Continuity lifecycle:

```text
RUNNING -> PAUSED -> RESUMABLE -> RUNNING
```

Interrupted lifecycle:

```text
RUNNING -> INTERRUPTED -> RESUMABLE -> RUNNING
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

Blocked workflows can be recorded in workflow history. Recording the history does not make the workflow safe to resume by itself; the blocker still has to be resolved.

## Workflow History

Workflow history records what happened over time.

It tracks:

- workflow purpose
- stages completed
- blocked stages
- validation results
- approvals received
- rollback availability
- remaining steps
- current execution state
- timestamps
- resumable state

### Engineering Explanation

History entries are structured summaries of workflow sessions. They preserve lifecycle state, approval checkpoints, validation checkpoints, blocked reasons, rollback fields, and the stage that can be resumed if eligibility is true.

### YouTuber Explanation

AI-E can now show a job history: what it tried, where it stopped, why it stopped, and whether it can continue.

### End-User Explanation

You can review previous workflow runs and continue eligible ones instead of starting from scratch.

## Resumable Workflows

A resumable workflow is a recorded workflow that can continue from a known stage.

Examples:

```text
Request: resume the movement patch workflow
History result: found PREPARE_PATCH
Resume result: blocked until operator approval is recorded
```

```text
Request: resume inventory inspection
History result: found READ_REPO_CONTEXT
Resume result: workflow continues from READ_REPO_CONTEXT
```

Resume rules:

- paused workflows can become resumable
- interrupted workflows require operator review before resumability
- mutation stages still require approval
- validation stages still require validation evidence
- blocked workflows remain blocked until the blocker is resolved
- resume never grants unrestricted execution

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
3. The card shows `Current Workflow Step` so the operator can see the active stage and next action.
4. `READ_REPO_CONTEXT` can run as read-only.
5. `Mark Current Step Complete` records only that the read-context stage finished.
6. `PREPARE_PATCH` requires approval before mutation-capable activity.
7. After approval, the card should say that approval was recorded and the next action is to run the approved step.
8. If approval is missing, the workflow blocks with a reason.
9. If validation is required, the stage cannot complete until validation succeeds.
10. If rollback is relevant, rollback preparation metadata can be recorded.
11. Operator reviews the summary and decides the next step.

## Operational Walkthrough: Resume a Workflow

1. Operator asks to resume a prior workflow.
2. AI-E searches workflow history for a matching recorded session.
3. AI-E explains the current state and remaining steps.
4. If resume is allowed, AI-E continues from the recorded stage.
5. If approval is missing, the workflow remains blocked.
6. If validation is pending, the workflow resumes into the validation-aware path.
7. The updated outcome is recorded back into history.

## Workflow Progression Clarity

### Engineering Explanation

Workflow progression clarity is a UX layer over the existing workflow engine. It derives visible button labels, current-stage status, what-just-happened feedback, and timeline hierarchy from session state. It does not change the underlying approval, validation, path-scope, or blocked-state rules.

### YouTuber Explanation

The workflow should feel like a guided wizard. The user should not wonder whether a click repeated the job, advanced the job, or finished everything.

### End-User Explanation

Follow the active step. The card tells you what just happened and what button moves the workflow forward.

## Trust Architecture Seed

Production-ready AI-E should use a layered trust stack:

- base LLM
- RAG retrieval
- source ranking and citations
- freshness handling
- evidence-only answer mode
- fallback when evidence is missing
- hallucination verification
- scoped tool use
- scoped memory
- guardrails
- prompt-injection detection
- retrieval sanitization
- permissions
- sandboxing
- output safety checks
- audit logs
- red-team tests
- evaluation metrics

### Prompt-Injection Doctrine

Retrieved content is data, not instructions. Risky retrieved sources include webpages, PDFs, Slack messages, GitHub repos, emails, docs, user uploads, and database records. These sources must not override system instructions, developer instructions, tool permissions, policy checks, or execution boundaries.

### Evaluation Metrics

Trust architecture should be measured with hallucination rate, citation accuracy, retrieval precision, jailbreak resistance, tool-call success rate, response latency, and user satisfaction.
