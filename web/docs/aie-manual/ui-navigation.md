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
2. Use the field labeled "Ask an AI-E Agent to help with a workflow".
3. Enter a plain-language request or choose an example prompt chip.
4. Select `Start Workflow` to let AI-E decide whether to answer conversationally, create a lightweight exploration, or create a full supervised workflow.
5. If AI-E answers conversationally, read the orientation or discussion response first; no workflow card is created for pure onboarding, conceptual, product-explanation, or AI ethics prompts.
6. If a workflow card appears, read the `AI-E Agent Summary` to understand what the workflow is doing and whether approval is needed.
7. Read `Current Workflow Step` to see the active step, status, what just happened, and the exact next action when full workflow detail is visible.
8. Read `Next Recommended Action`; treat it as the primary guidance layer.
9. Use the emphasized action button first when it matches the operator's intent.
10. Use `Show Workflow Details` when a lightweight exploration hides runtime mechanics by default.
11. Use other workflow card action buttons such as `Run Current Step`, `Run Approved Step`, `Resume Workflow`, `Run Validation`, `Inspect Summary`, `Explain Blocker`, `Request Approval`, or `Save for Resume` when available.
12. Open `Show Technical Details` only when lifecycle states, approval checkpoints, validation checkpoints, blocked reasons, path scope, or rollback markers need deeper review.
13. Review recent workflow history after a workflow has been created or updated.
14. For blocked workflows, read `Safe Recovery Path` before opening technical details.
15. For approval-gated workflows, read `Approval Required` before approving or denying a stage.

Screenshot TODO: `/operator/agents` workflow selection and active workflow cards.

Screenshot TODO: `/operator/agents` workflow history panel with recent and resumable workflows.

### Human Testing Experience

The Agents page is intended to feel like asking an AI operations agent for help, not like reading a static engineering dashboard.

Beginner-facing controls appear first:

- a plain-language workflow input
- example prompt chips
- conversational orientation for onboarding prompts
- minimized workflow visibility for safe exploration
- compact workflow cards
- AI-E Agent Summary panels
- Current Workflow Step panels
- Next Recommended Action panels
- current step labels
- completed, active, and locked stage hierarchy
- action buttons for the next operator decision
- post-click feedback messages
- disabled action explanations
- an empty state when no workflows exist

Operator and engineering details remain available through expandable technical panels instead of being the default reading path.

### Conversational Visual Hierarchy

The desired page hierarchy is conversation first, workflow capability second. AI-E should visually feel like an intelligent operational assistant that can reveal governed workflows, not a workflow dashboard that contains an assistant.

The latest embodiment target is stronger: the operator should feel they are talking with AI-E first, and that workflow capability can surface from that conversation when needed. The successful onboarding state should preserve the message `No workflows yet.` and the trust-building line `I will introduce workflow controls only when they help the task.`

Visual review should check whether:

- the conversation is the primary anchor on first impression
- counters, workflow history, governance reference, and current-step panels stay visually quiet until useful
- lightweight exploration has breathing room
- buttons such as `Run Current Step`, `Resume Workflow`, and `Save for Resume` appear only when the interaction mode warrants operational controls
- full panel density is reserved for full supervised operational mode
- governance remains available without overwhelming onboarding or exploration prompts
- the page feels conversation-native rather than panel-native
- the operational framework emerges from the conversation instead of containing it

This direction does not remove governed workflows. It changes when and how strongly workflow mechanics visually appear.

### Conversation-To-Workflow Mediation

The Agents page should not turn every message into a workflow card. It uses three interaction levels:

- `Conversational discussion/guidance`: for onboarding, capability help, confusion, clarification, philosophy, AI ethics, product explanation, or conceptual understanding. AI-E explains naturally and does not create a workflow card.
- `Lightweight guided workflow`: for safe read-only exploration where a workflow may help, but runtime mechanics are minimized.
- `Full supervised operational mode`: for implementation, repo work, patch preparation, approvals, validation, rollback, blocked recovery, or execution-boundary prompts.

This mediation reuses the existing conversational routing layer. It is not a duplicate chatbot.

Discussion prompts such as `What makes AI-E different?` or `do you think AI-E should allow autonomous coding?` should remain conversation unless the operator asks for concrete inspection or implementation.

### Human Testing Interpretation

Long testing sessions should be reviewed with interpretation, not only raw transcript reading. A useful test review should summarize:

- what improved
- what still feels scaffoldy
- emotional and operator perception
- best discovery
- biggest remaining risk
- recommended next tests

This review framing helps testers evaluate operational readability, conversational guidance quality, escalation smoothness, and trust signals. It does not add a new runtime subsystem or prove that external execution happened.

### Action Buttons

Workflow cards may show these actions:

- `Start Workflow`: creates a workflow from the prompt at the top of the page.
- `Run Current Step`: starts the active pending stage when previous stages are complete.
- `Run Approved Step`: starts the active approved stage without claiming file application or validation.
- `Current Step Running`: disabled label showing the active step is already running.
- `Validation In Progress`: disabled label showing the active step is waiting for validation evidence.
- `Workflow Blocked`: disabled label showing the workflow stopped on a governance boundary.
- `Workflow Complete`: disabled label showing the workflow has no runnable stages left.
- `Show Workflow Details`: expands minimized read-only exploration into the full runtime view.
- `Hide Workflow Details`: returns a lightweight exploration card to the simpler view.
- `Resume Workflow`: continues a workflow only when resume state is eligible.
- `Run Validation`: opens a validation checkpoint for a running validation-required step.
- `Record Validation Pass`: records operator-provided validation success for a validating step.
- `Inspect`: highlights the selected workflow card for review.
- `Inspect Summary`: opens a human-readable workflow summary.
- `Explain Blocker`: repeats the recorded blocked reason in the agent response area.
- `Request Approval`: records approval for an approval-gated step when the workflow exposes one.
- `Save for Resume`: pauses a workflow and marks it resumable under the same governance rules.
- `Prepare Safe Patch Instead`: creates a safe patch-preparation workflow from an unsafe automatic-application request; it does not apply the patch.
- `Show Required Runtime`: explains which runtime or approved route is missing.
- `Convert to Safe Planning Workflow`: creates a planning-only recovery workflow while the original blocked workflow remains visible.
- `Review Scope`: shows allowed paths, blocked paths, and mutation boundaries before approval.
- `Approve This Step`: records operator approval for the displayed supervised stage only.
- `Deny Approval`: records denial and keeps the workflow safely stopped.
- `Explain Risk`: explains why approval is required, what can go wrong, what AI-E may do, what AI-E may not do, and what validation should follow.
- `Mark Current Step Complete`: records that the current supervised step finished; it does not mean the whole workflow is complete.

These buttons do not grant new backend authority. They use the existing supervised workflow runtime and preserve approval, validation, path-scope, and blocked-state rules.

Unavailable buttons are intentionally disabled. For example, `Resume Workflow` stays disabled until the workflow is saved for resume or otherwise becomes resume eligible. The card explains why the action is unavailable.

### Current Workflow Step

The `Current Workflow Step` panel is the active-stage focus area. It shows:

- current step
- status
- what just happened
- next action

Example after approval:

```text
Current Step: Prepare safe patch
Status: Approved and ready to run
What just happened: Approval recorded. The next action is to run the approved step.
Next: Run the approved step.
```

This panel prevents the operator from confusing approval, execution, completion, and validation.

### Stage Hierarchy

Workflow timelines visually separate:

- `Complete`: the step was recorded as finished
- `Active`: the current step that needs attention
- `Locked`: planned future steps that are not ready yet

Operators should follow the `Active` marker instead of treating all stages as equally important.

### Post-Click Feedback and Focus

After important actions, the changed workflow card scrolls into focus and updates `What just happened`.

Examples:

- `Approval recorded. The next action is to run the approved step.`
- `Read project context completed. Next step: prepare safe patch.`
- `Prepare safe patch is waiting for validation evidence.`
- `Workflow completed. You can inspect results or start another workflow.`

### Workflow Completion

When every stage is complete, the card shows `Workflow Completed` with next options to inspect results, start another workflow, or review technical details. It should not re-emphasize a run action after completion.

### Next-Step Guidance

Every workflow card should answer three operator questions before showing technical diagnostics:

- What is happening?
- Why does this state matter?
- What should I do next?

The `Next Recommended Action` panel is the most important guidance layer inside actual workflow cards. Example guidance:

- waiting workflow: "Run the workflow to continue execution."
- running workflow: "Wait for report generation to complete."
- blocked workflow: "Approval is required before execution can continue."
- resumable workflow: "Resume the workflow from the validation stage."
- validation pending: "Run validation to verify the workflow result."

For conceptual conversations with no workflow, use optional path language instead:

- no workflow required: "Ask a follow-up or choose an optional path."
- milestone question: "Learn the current milestone or review what changed recently."
- testing orientation: "Continue the conversation or choose a concrete system to inspect."
- operational readiness: "Prepare a governed workflow when you have a concrete task."

### Active Conversation Timeline

For conversational use, `/operator/agents` should show stacked active conversation turns. This prevents the page from feeling like a single-state form where the newest answer replaces the prior one.

This timeline is the primary visible response area under the input. It should not be treated as a lower archive while a separate latest-response panel dominates the page.

The input now belongs below the active conversation history. The intended rhythm is:

```text
Conversation history
	scrollable active turns
Input field
```

This makes `/operator/agents` feel like a conversation that can reveal tools, not a form that occasionally displays chat output.

Look for:

- `Active Conversation`
- `Stacked Conversation History`
- visible `User:` and `AI-E:` turns in order
- kind labels such as conversational, guided exploration, supervised workflow, or system improvement request
- `Copy Conversation`

The timeline is bounded active history. It is not infinite permanent chat memory.

Use `Copy Conversation` when the active session needs to become a handoff, testing review, documentation artifact, architecture note, devlog source, or external review prompt.

### Continuity Memory Card Panel

When the active conversation gets long, AI-E may offer a `Continuity Memory Card` with actions such as `Create Memory Card`, `Review What Will Be Saved`, `Edit Memory Card First`, `Start Fresh From This Progress`, and `Keep Chatting For Now`.

Use this when the session has enough accumulated progress that a fresh chat would be faster or easier to read. The card preserves useful working state, not every word perfectly.

### Status Explanations

Status labels must not stand alone. The card adds plain-English explanations beneath abstract lifecycle words.

Examples:

- `RESUMABLE`: "This workflow can safely continue from the previous recorded step."
- `PENDING`: "This workflow is ready, but the current step has not started yet."
- `BLOCKED`: "AI-E stopped because approval, validation, scope, or an external dependency is missing."
- `ROLLBACK_AVAILABLE`: "AI-E prepared an undo path for operator review; it did not run rollback automatically."

### Beginner vs Operator Detail

The default view uses beginner-readable language such as "step-by-step workflow", "current step", "needs attention", and "requires approval before execution".

Technical labels such as lifecycle state, mutation permission, validation state, approval state, workflow ID, and allowed paths are still visible in `Show Technical Details` panels.

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

### Approval Required Panel

Approval-gated workflow cards show `Approval Required` before the operator approves or denies a stage.

Fields shown:

- action being approved
- workflow stage
- allowed path scope
- mutation permission
- validation requirement
- rollback availability
- risk level
- what happens after approval

### Engineering Explanation

The approval panel is a supervised action gate over the workflow engine. `Approve This Step` records approval for one stage. `Deny Approval` records a rejected approval state and blocks the workflow. Neither action applies patches, runs Unity, expands shell access, or bypasses validation.

### YouTuber Explanation

AI-E now shows the operator exactly what the approval means before they click yes or no.

### End-User Explanation

Use `Approval Required` to review the action, scope, risk, and next step. Approve only when the displayed stage and path scope match what you intend.

Approval states:

- `APPROVAL_REQUIRED`: an approval gate exists for the workflow.
- `WAITING_FOR_APPROVAL`: the operator can approve or deny the stage.
- `APPROVED_BY_OPERATOR`: the operator approved this stage only.
- `APPROVAL_DENIED`: the operator denied this stage and the workflow stayed stopped.

`Explain Risk` should answer why approval is needed, what could go wrong, what AI-E is allowed to do, what AI-E is not allowed to do, and what validation should happen afterward.

## Production Trust Architecture Seed

Future AI-E public-facing systems should be designed as trust architecture, not just a model prompt. The target stack is base LLM plus RAG, tools, memory, guardrails, permissions, sandboxing, verification loops, audit logs, red-team tests, and evaluation metrics.

### Engineering Explanation

RAG sources should be ranked, cited, freshness-checked, and treated as untrusted data. Evidence-only answer mode should answer only from retrieved support for factual, company, user-data, and support questions. A verifier should check the final response against retrieved sources before delivery.

### YouTuber Explanation

AI-E needs receipts and safety rails: find sources, cite them, verify the answer, restrict tools, and block poisoned instructions.

### End-User Explanation

For important factual answers, AI-E should show evidence or admit when it does not know. Uploaded files, webpages, emails, or docs should not be able to secretly change AI-E's rules.

## Blocked States

Blocked states are intentional. They tell the operator that AI-E respected a governance boundary.

Blocked examples:

- automatic patch application requested before approval
- mutation-capable stage started without approval
- validation-required stage completed without successful validation
- unsafe path scope requested
- external dependency required

Screenshot TODO: blocked workflow card with visible blocked-stage reason.

### Safe Recovery Path

Blocked workflow cards now show `Safe Recovery Path` before technical details.

### Engineering Explanation

The recovery path is a UI and workflow-guidance layer over the existing blocked state. It derives why the workflow blocked, the safety rule that triggered, the safe alternative, the next recovery action, and the approval or runtime condition that must exist before continuation. It does not unblock automatic mutation, run shell commands, execute Unity, or apply patches.

### YouTuber Explanation

AI-E no longer just says no. It stops the unsafe action and immediately shows the safe lane: prepare the patch first, request approval, or convert the task into planning.

### End-User Explanation

When a workflow is blocked, read `Safe Recovery Path`. It tells you why it stopped, what safe option exists, and which button to press next.

For automatic patch application, expected actions are:

- `Prepare Safe Patch Instead`
- `Request Approval`
- `Explain Blocker`

For an external runtime dependency, expected actions are:

- `Show Required Runtime`
- `Convert to Safe Planning Workflow`
- `Explain Blocker`

For missing approval, expected actions are:

- `Request Approval`
- `Review Scope`
- `Explain Blocker`

The safe conversion behavior creates a new patch-preparation workflow and keeps the original blocked workflow visible. The conversion explains that automatic application remains blocked and does not claim that files were changed.

## Rollback Markers

Rollback markers are preparation metadata, not automatic rollback execution.

Look for:

- `rollbackAvailable`: rollback is relevant to this stage.
- `rollbackPrepared`: rollback planning metadata was recorded.
- `rollbackReason`: why rollback is relevant.

Screenshot TODO: rollback marker visible on a patch-preparation workflow.

## Operator Navigation Checklist

When reviewing an AI-E operational workflow:

1. Start with the plain-language request in the agent input.
2. Confirm the workflow card matches the intended task.
3. Confirm the current step and status label.
4. Read the plain-English status explanation.
5. Follow the `Next Recommended Action` unless there is a reason to inspect first.
6. Choose the emphasized action button.
7. Open `Inspect Summary` if the human explanation is enough.
8. Open `Show Technical Details` if approval, validation, mutation, rollback, path scope, or blocked reason must be audited.
9. If a workflow is resumable, confirm that approval and validation rules still make sense before continuing.
10. If a workflow is blocked, use `Explain Blocker` and resolve the missing approval, validation, dependency, or scope issue before continuing.
11. If `Safe Recovery Path` is visible, choose the safe recovery action before inspecting lifecycle details.
12. If `Approval Required` is visible, review scope and risk before choosing `Approve This Step` or `Deny Approval`.
