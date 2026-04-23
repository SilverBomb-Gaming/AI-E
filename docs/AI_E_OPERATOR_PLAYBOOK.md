# AI-E Operator Playbook

This playbook defines the repeatable human workflow for operating AI-E as a bounded autonomous development system. It covers how to start sessions, how to let the system run, how to interpret the oversight output, and when to intervene.

## Section 1 - How To Start A Session

### Step 1: Define a clear objective

Good examples:

- `Add Map_006 with new enemy variation`
- `Improve enemy AI behavior for patrol and detection`
- `Add basic save/load system`

Bad examples:

- `Make the game better`
- `Fix stuff`
- `Improve everything`

Rule:

AI-E works best with clear, bounded goals.

### Step 2: Start the session

- Trigger an AI-E session through the supported CLI, UI, or API surface.
- Provide the objective.
- Let AI-E inspect the project, generate tasks, and prioritize the work.

Do not immediately micromanage the task breakdown.

### Step 3: Let AI-E propose work

AI-E will:

- generate a task backlog
- prioritize tasks
- recommend the next task

Operator action:

- review the proposed direction briefly
- approve the direction if it is reasonable

## Section 2 - How To Let AI-E Run

AI-E session loop:

1. selects a task
2. executes the task
3. validates the output
4. generates repo actions if needed
5. pauses if required
6. continues if safe

Operator role:

### Do

- monitor summaries
- watch for pause reasons
- approve repo actions
- intervene when necessary

### Do Not

- interrupt every task
- override unnecessarily
- micromanage execution steps

Golden rule:

Let AI-E run unless it gives you a reason to intervene.

## Section 3 - Understanding Session Output

Every session provides three operator-critical views.

### 1. Session summary

This summarizes:

- tasks completed
- tasks failed
- tasks blocked
- approvals requested
- pause reason
- recommended next step

### 2. Current state

This shows:

- current task
- next task
- queue size

### 3. Operator attention

This is the highest-priority part of the output.

AI-E will explicitly signal when it needs:

- approval
- a missing dependency
- failure review
- a decision after reaching a session limit

Operator priority:

Always check the needs-operator-attention section first.

## Section 4 - Approval Workflow

When AI-E generates repo actions, the operator should see:

- which files changed
- what was added or modified
- why the changes were made
- the expected impact

Operator choices:

### Approve

- applies the changes
- lets AI-E continue if the session is otherwise safe to resume

### Reject

- prevents the repo action from applying
- leaves AI-E to re-evaluate, pause, or halt according to the current session state

Rule:

Never approve blindly, but do not overthink small safe changes.

## Section 5 - When To Intervene

Intervene only when one of these conditions is true.

### 1. The task is clearly the wrong direction

Use:

- skip current task
- operator override

### 2. The task failed repeatedly

Decide whether to:

- retry
- skip
- adjust the goal

### 3. The system is blocked

Provide:

- missing assets
- missing dependencies
- clarification the task needs

### 4. You want to change direction

Pause the session, adjust the steering, then resume.

## Section 6 - Session Controls

Available controls:

### Pause

Stops after the current safe point.

### Resume

Continues from the last persisted state.

### Skip current task

Moves to the next valid task.

### Force stop

Ends the session immediately.

Use these controls sparingly.

## Section 7 - How To Know A Task Is Done

A task is complete when:

- real outputs exist
- validation passed
- repo actions were applied when needed
- the system marks the task complete

If AI-E says a task is complete but there are no files changed and no meaningful outputs, something is wrong. That should be rare under the current trust layer.

## Section 8 - Failure Handling

If a task fails, AI-E should:

- mark the failure
- provide the reason
- suggest the next step

Operator choices:

- retry if the issue looks fixable
- skip if it is low priority or not worth the current session budget
- intervene if the issue is critical or the system lacks required context

Rule:

Failure is normal. Silent failure is not.

## Section 9 - Best Practices

### 1. Think in tasks, not ideas

Convert broad ideas into bounded tasks.

Example:

`I want better combat`

becomes:

`Add enemy dodge behavior`

### 2. Let sessions run multiple tasks

Do not restart the system constantly when the current session is still making bounded progress.

### 3. Trust the loop

AI-E is designed to:

- correct itself
- validate outputs
- stop when unsafe

### 4. Use summaries, not raw logs

The oversight layer already condenses the important information.

### 5. Only intervene when needed

More intervention does not mean better results.

## Section 10 - Common Mistakes

- over-micromanaging
- giving vague goals
- interrupting constantly
- ignoring pause reasons
- blindly approving everything

## Section 11 - Success Definition

You are using AI-E correctly when:

- sessions run multiple tasks without interruption
- you only step in when needed
- outputs are real and usable
- progress happens continuously
- you feel like you are supervising, not doing the work yourself

## Final Mental Model

AI-E is your autonomous developer.

You are the director.

Your job is not to do the work.

Your job is to:

- guide
- approve
- intervene when necessary

That is the correct operating model for the system.