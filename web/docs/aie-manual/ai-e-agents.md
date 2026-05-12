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
