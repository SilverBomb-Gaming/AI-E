# AI-E Agents

AI-E Agents are bounded operational runtime participants. They are not generic chatbots and they are not unrestricted autonomous developers.

## What AI-E Agents Are

### Engineering Explanation

An AI-E Agent is a typed runtime participant with a role, allowed paths, blocked paths, command limits, task contracts, workflow sessions, lifecycle state, approval boundaries, validation checkpoints, and structured logs.

### YouTuber Explanation

Think of an AI-E Agent as a controlled specialist inside the product. It can follow a governed workflow and show its work, but it does not get free rein over the project.

### User Explanation

An AI-E Agent helps move a task through visible steps. You can see what it is allowed to do, what step it is on, and why it stops.

## How Agents Differ From Chatbots

### Engineering Explanation

A chatbot produces conversation. An AI-E Agent carries runtime metadata: workflow IDs, stage order, path scope, mutation permission, approval state, validation state, rollback markers, and logs.

### YouTuber Explanation

A chatbot answers. An AI-E Agent operates inside a dashboard where its steps, rules, and blockers are visible.

### User Explanation

Chat gives advice. Agents show operational progress and boundaries.

## Human Workflow Interaction

### Engineering Explanation

The `/operator/agents` surface now treats agent work as an interaction loop: prompt intake, workflow creation, card-level actions, history recording, and optional technical expansion. The UI still uses the existing workflow runtime and does not add new backend execution authority.

### YouTuber Explanation

The agent page should feel more like asking an operations assistant to handle a job. You type the job, get a workflow card, and press clear action buttons instead of reading a wall of diagnostics first.

### User Explanation

Start by typing what you want help with. AI-E creates a workflow card and shows the next step. More technical details are available only when you open them.

## Workflow Cards and Actions

### Engineering Explanation

Workflow cards expose bounded state transitions through actions such as `Run`, `Resume`, `Inspect`, `Show Summary`, `Explain Blocker`, and `Request Approval`. These actions preserve workflow ordering, approval gates, validation requirements, path scope, and blocked-state reporting.

### YouTuber Explanation

The card is the control surface. It tells you what the agent is doing and gives you buttons for safe next moves.

### User Explanation

Use the buttons on a workflow card to run, resume, inspect, or understand the workflow. If approval is required, the card shows that as an action.

## Next-Step Guidance

### Engineering Explanation

Each workflow card now computes an operator-facing next recommended action from workflow status, current stage, approval checkpoints, validation checkpoints, blocked reason, completion state, and resume eligibility. This is a UI guidance layer over the existing workflow engine.

### YouTuber Explanation

AI-E should not just show a status badge. It should say what is happening, why it matters, and what the operator should click or review next.

### User Explanation

Look for `Next Recommended Action` first. It tells you whether to run the workflow, request approval, run validation, resume, inspect results, or resolve a blocker.

## Blocked Workflow Recovery

### Engineering Explanation

Blocked workflows now expose recovery guidance derived from the workflow state. The card identifies the blocker, the safety rule, a safe alternative, context-aware recovery actions, and the condition required before continuation. This is guidance and workflow conversion only; it does not add automatic patch application, unrestricted repo mutation, shell execution, Unity execution, or unattended operation.

### YouTuber Explanation

The upgrade is simple: AI-E stops unsafe work and then immediately points to the safe way forward.

### User Explanation

If AI-E blocks a request, use `Safe Recovery Path`. It shows why the workflow stopped and offers buttons such as `Prepare Safe Patch Instead`, `Request Approval`, or `Explain Blocker`.

## Safe Workflow Conversion

### Engineering Explanation

Unsafe automatic mutation requests can be converted into a safe patch-preparation workflow. The original blocked workflow remains visible, the new workflow starts as a supervised `READ_REPO_CONTEXT` -> `PREPARE_PATCH` -> `REQUEST_APPROVAL` chain, and no patch is applied during conversion.

### YouTuber Explanation

Instead of pretending it can auto-apply code, AI-E can turn the request into: make the patch plan first, then wait for approval.

### User Explanation

Click `Prepare Safe Patch Instead` when automatic application is blocked. AI-E creates a safe patch workflow you can review before any approval-gated application step.

## Improved Blocker Explanations

### Engineering Explanation

`Explain Blocker` now answers four questions: why the workflow blocked, which safety rule triggered, what safe alternative exists, and what must happen before proceeding.

### YouTuber Explanation

The blocker explanation is no longer a dead end. It tells the operator the reason, the rule, the safer path, and the approval requirement.

### User Explanation

Use `Explain Blocker` when you need the plain-language reason and the next safe step.

## Workflow Assistant Summaries

### Engineering Explanation

The `AI-E Agent Summary` panel summarizes the workflow intent, safety posture, approval requirement, blocked state, completion state, or resumable state without requiring the operator to inspect lifecycle fields first.

### YouTuber Explanation

The card now behaves more like an assistant: it explains the job in normal language before showing the diagnostics.

### User Explanation

Read the summary to quickly understand what AI-E is doing and whether it needs approval or validation.

## Disabled Action Guidance

### Engineering Explanation

Unavailable actions remain disabled and are paired with explanations. For example, resume remains disabled until the workflow has a resumable state. The disabled state does not bypass workflow history, approval, validation, or path-scope rules.

### YouTuber Explanation

If a button is unavailable, AI-E explains why instead of leaving the operator guessing.

### User Explanation

If `Resume Workflow` is disabled, read the note below the buttons. It explains what must happen before resume is available.

## Beginner Operational Explanations

### Engineering Explanation

Abstract stage and lifecycle terms are translated into operational explanations on the card. `READ_REPO_CONTEXT` becomes a note that AI-E is reviewing project information. Validation pending becomes a note that AI-E is waiting to verify the result. Rollback available becomes a note that an undo path is prepared for operator review.

### YouTuber Explanation

AI-E still keeps the technical state, but it now translates that state into plain language at the point of use.

### User Explanation

You should not need to understand every lifecycle word to know what to do next.

## Technical Details Panels

### Engineering Explanation

Lifecycle states, workflow IDs, mutation permission, approval state, validation state, allowed paths, blocked reasons, and rollback markers remain available in expandable technical panels.

### YouTuber Explanation

The engineering data is still there, but it is no longer the first thing a tester has to read.

### User Explanation

Open technical details when you need to audit exactly why a workflow can or cannot continue.

## Bounded Workflows

### Engineering Explanation

Agent workflows are deterministic chains of typed stages such as `READ_REPO_CONTEXT`, `PREPARE_PATCH`, `REQUEST_APPROVAL`, `VERIFY_BUILD`, `VALIDATE_PATCH`, and `GENERATE_REPORT`.

### YouTuber Explanation

The agent does not wander. It follows a predictable sequence that can be explained and audited.

### User Explanation

You can see the planned steps and where the agent currently is.

## Approvals

### Engineering Explanation

Mutation-capable stages use approval checkpoints. A `PREPARE_PATCH` stage can be blocked if approval is missing.

### YouTuber Explanation

AI-E knows when to stop and ask for permission before changing something sensitive.

### User Explanation

If the task needs approval, AI-E stops and tells you why.

## Lifecycle Stages

### Engineering Explanation

Workflow stages can move through `PENDING`, `APPROVED`, `RUNNING`, `VALIDATING`, `COMPLETED`, `FAILED`, `ROLLBACK_AVAILABLE`, or `BLOCKED`.

### YouTuber Explanation

Every step has a status, so the operator can see whether the agent is waiting, working, validating, done, or blocked.

### User Explanation

The dashboard shows whether the workflow is ready, running, waiting for proof, finished, or stopped.

## Validation

### Engineering Explanation

Validation-required stages cannot complete until validation succeeds. Validation can be pending, successful, failed, blocked, or not required.

### YouTuber Explanation

AI-E separates doing a step from proving the step is safe or correct.

### User Explanation

Some steps need evidence before they count as complete.

## Rollback Preparation

### Engineering Explanation

Rollback fields record `rollbackAvailable`, `rollbackPrepared`, and `rollbackReason`. Phase 1 manual coverage treats rollback as preparation metadata, not automatic rollback execution.

### YouTuber Explanation

AI-E can mark that an undo path matters and explain why, but it is not silently undoing work by itself.

### User Explanation

If rollback is relevant, the dashboard can show that. You still review what happens next.

## Supervised Runtime Behavior

### Engineering Explanation

The supervised runtime model enforces bounded path scope, stage ordering, approval-aware mutation, validation requirements, blocked-state explanations, and auditable summaries.

### YouTuber Explanation

AI-E is becoming an operational system, but it is still governed. The important leap is visible workflow control, not fantasy autonomy.

### User Explanation

AI-E can help guide and track work, while keeping the operator in control of sensitive steps.

## Workflow History

### Engineering Explanation

Agent workflow history records session IDs, prompts, outcomes, stage completion, blocked reasons, validation results, approval checkpoints, rollback preparation, timestamps, remaining steps, and resumable state.

### YouTuber Explanation

AI-E Agents can begin remembering operational jobs in a governed way: what happened, where the job stopped, and whether it can continue.

### User Explanation

The Agents page can show recent workflows, failed workflows, paused workflows, interrupted workflows, and workflows that can be resumed.

## Paused and Interrupted Workflows

### Engineering Explanation

`PAUSED`, `INTERRUPTED`, and `RESUMABLE` states describe continuity without granting new execution authority. Interrupted workflows require review before resumability. Paused workflows can be marked resumable from the recorded stage.

### YouTuber Explanation

AI-E does not have to forget every job. It can show a stopped job and continue it only if the rules still allow it.

### User Explanation

If a workflow stops, check whether it is paused, interrupted, blocked, or resumable. The reason tells you what can happen next.

## Resume Behavior

### Engineering Explanation

Resume logic locates a history entry, checks resume eligibility, resumes from the recorded stage, and preserves mutation approval and validation requirements.

### YouTuber Explanation

Resume is not a shortcut around safety. It is a controlled continuation from the last known workflow state.

### User Explanation

When you resume a workflow, AI-E continues from the right stage if allowed. If approval is still missing, it stays blocked.

## Current Agent Roles

- `repo-maintainer`: scoped repo maintenance and patch preparation.
- `test-runner`: validation and test-focused workflows.
- `unity-task-planner`: Unity task planning without direct editor control in this phase.
- `documentation-updater`: manual and documentation workflow support.
- `qa-verifier`: validation and evidence review.
