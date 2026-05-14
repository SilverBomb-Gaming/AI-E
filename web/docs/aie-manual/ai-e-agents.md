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

The `/operator/agents` surface now treats agent work as an interaction loop: prompt intake, intent-aware mediation, workflow creation when warranted, card-level actions, history recording, and optional technical expansion. The UI still uses the existing workflow runtime and does not add new backend execution authority.

### YouTuber Explanation

The agent page should feel more like asking an operations assistant to handle a job. You type the job, get a workflow card, and press clear action buttons instead of reading a wall of diagnostics first.

### User Explanation

Start by typing what you want help with. AI-E may answer conversationally first, create a lightweight exploration, or create a full supervised workflow depending on the request. More technical details are available only when they help.

## Conversation And Workflow Mediation

### Engineering Explanation

Agent prompts now pass through a mediation layer before workflow creation. The mediator reuses existing game-dev conversational routing and chooses one of three interaction levels: conversational guidance, lightweight guided workflow, or full supervised operational mode. This prevents low-context onboarding prompts from bypassing conversational intelligence and becoming workflow cards immediately.

### YouTuber Explanation

AI-E should feel like an intelligent guide first. It brings out the workflow machinery when the job needs it, not every time someone asks a beginner question.

### User Explanation

If you ask "can you show me around?" AI-E should welcome you and explain where to start. It should offer safe workflows after orientation, not overwhelm you first.

## Conversational Discussion Mode

### Engineering Explanation

AI-E needs a valid non-workflow interaction state for conceptual discussion. Prompts about product identity, AI ethics, autonomy, AGI framing, trust, or philosophy should be able to resolve as conversation only. They should not create workflow objects, runtime state, current steps, or operational continuation actions unless the operator asks to inspect, validate, patch, or execute something concrete.

### YouTuber Explanation

Sometimes the user is not asking AI-E to do a job. They are asking it to explain, compare, think through a principle, or discuss what kind of product it should be. That should be allowed to stay as conversation.

### User Explanation

You can ask AI-E questions without starting a workflow. If you ask what makes AI-E different or whether autonomous coding is a good idea, AI-E should answer directly instead of pushing you into workflow controls.

## Multi-Destination Interaction Model

### Engineering Explanation

After `CONVERSATIONAL_ONLY_MODE`, AI-E should evolve from a workflow-or-not decision into a destination-selection model. Valid destinations include conversational discussion, learning/tutorial guidance, YouTuber translation, testing interpretation, guided exploration, supervised operational workflow, and workspace/drafting output. These destinations should be centrally mediated and capability-shared rather than implemented as isolated subsystems.

### YouTuber Explanation

AI-E should pick the right shape for the moment. Sometimes that is a direct answer. Sometimes it is a tutorial. Sometimes it is a test review. Sometimes it is a real governed workflow. The workflow is powerful, but it is not the destination of every conversation.

### User Explanation

Not every prompt starts a workflow. AI-E can answer, teach, translate, review a test session, help draft a document, or open a governed workflow when the task actually needs one.

## Progressive Workflow Disclosure

### Engineering Explanation

Workflow visibility is now contextual. Orientation prompts keep workflow runtime hidden. Safe read-only exploration can show a minimized guided workflow. Implementation, repo work, patch preparation, approval, validation, recovery, and execution-boundary prompts still expose the full supervised workflow card.

### YouTuber Explanation

Operational complexity unfolds in layers: explain first, show a light path second, show the full governed dashboard when the task gets serious.

### User Explanation

You should see only the amount of workflow detail needed for the task. Use `Show Workflow Details` when you want the deeper runtime trace.

## Conversational Visual Hierarchy

### Engineering Explanation

The next Agents UX direction is visual hierarchy and visual embodiment. Mediation can choose the correct interaction level, but the page still has to make conversation the primary visual anchor and make workflow mechanics contextual. The desired structure is `Conversational AI experience -> optional operational capability surfaces`, not `Operational Platform -> conversational assistant layer`.

### YouTuber Explanation

AI-E should look like you are talking to an intelligent operator first. The control panels should come forward when the job needs them, not dominate the room from the first second.

### User Explanation

The page should feel conversational before it feels like a dashboard. Workflow controls should appear when they help you act safely. A calm state such as `No workflows yet.` should feel intentional, not empty or broken.

## YouTuber Translation

### Engineering Explanation

YouTuber translation remains a documentation, tutorial-script, and testing-review tool. It translates dense AI-E architecture into accurate human-facing explanation for manuals, onboarding docs, walkthroughs, demo narration, feature videos, and long-session operational reviews.

### YouTuber Explanation

The point is to simplify without dumbing down: approvals, blocked recovery, resumability, safe execution, workflow progression, and trust architecture should all be explainable in plain language.

### User Explanation

AI-E docs should explain advanced safety systems in language that helps you understand what is happening and why it matters.

## Human Testing Interpretation

### Engineering Explanation

Long agent testing sessions need structured interpretation in addition to raw transcript review. A useful review summarizes UX improvements, remaining scaffold leakage, operator perception, best discoveries, remaining risks, and recommended next prompts. This is a human review framing layer, not a new runtime agent subsystem.

### YouTuber Explanation

After a long test, AI-E needs a recap that says: what got better, what still felt like machinery, how the user probably felt, and what to test next.

### User Explanation

Testing reviews should help you understand the experience, not force you to decode every log line. They should explain what changed, why it matters, and where the workflow still feels too technical.

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

## Optional Conversational Paths

### Engineering Explanation

When mediation keeps a prompt conversational-only, `/operator/agents` should not reuse workflow-card progression language. Conceptual, onboarding, milestone, product-direction, and testing-orientation answers can offer optional paths without creating workflow state. `Next Recommended Action` remains a workflow-card label; non-workflow conversation should use labels such as `Optional Next Paths` or `Continue From Here`.

### YouTuber Explanation

AI-E can say, "here are a few useful directions," without making it sound like the user has to start a workflow.

### User Explanation

If no workflow is required, you can keep talking, learn the current milestone, review what changed, choose a system to inspect, or start a governed workflow only when you have a concrete task.

## Stacked Conversation And Continuity Memory

### Engineering Explanation

The agents page now keeps a bounded active conversation timeline. Each submitted prompt records a visible prompt/response turn, while workflow cards remain separate operational state. When the active conversation reaches the lifecycle threshold, the UI can offer a reviewed Continuity Memory Card. This is session continuity management, not unbounded chat history or persistent RAG memory.

### YouTuber Explanation

AI-E should feel like it is following the conversation, not replacing the last answer every time. When the chat gets long, it can summarize the useful progress into a card and start fresh from there.

### User Explanation

Your recent conversation stays visible while you are working. If it gets long, you can create, review, edit, and save a Continuity Memory Card before starting fresh from the useful progress.

## Supervised System Improvement Requests

### Engineering Explanation

AI-E can draft formal improvement requests from repeated friction. Requests are risk-classified as low, medium, high, or critical, and they explicitly state that implementation authority remains human/dev only. Critical requests involving permissions, sandboxing, tool access, repo mutation, governance bypass, autonomous execution, or self-modification must never be self-authorized.

### YouTuber Explanation

AI-E can say, "this keeps causing friction, here is a proposed fix," but it cannot approve or install the fix itself.

### User Explanation

Improvement requests are proposals. They help humans review what should change, why it matters, what could go wrong, and what approval is required.

## Workflow Progression Clarity

### Engineering Explanation

The `/operator/agents` workflow card now separates workflow creation, current-stage execution, stage completion, validation, approval, overall progress, and final completion. Button labels and progress labels are derived from workflow state so the same control does not imply start, repeat, advance, and finish at the same time.

### YouTuber Explanation

AI-E should feel like a guided wizard: here is what happened, here is the active step, here is how far the whole workflow has progressed, and here is the exact button that moves the job forward.

### User Explanation

Read `Workflow Progress` first for the overall state, then read `Current Workflow Step` for the active stage. If a step is running, `Mark Current Step Complete` only marks that one step finished. The workflow is not finished until AI-E shows `Workflow Complete`.

## Conversation-First Operational UX

### Engineering Explanation

Operational workflow cards now default to a compact `Operational Result` surface. The workflow engine still tracks lifecycle, approval, validation, execution state, history, and metadata, but the default card only foregrounds the conversational outcome, lightweight progress, next meaningful action, and compact execution truth. Full operational details are available through `View Technical Details`. This intentionally converges on familiar chat-first AI patterns while preserving AI-E's distinct governed execution model underneath.

### YouTuber Explanation

The engine is still there, but it no longer takes over the screen. AI-E can feel familiar, like a modern AI assistant, while being different where it matters: approvals, truth boundaries, and not pretending work happened.

### User Explanation

Read `Operational Result` first. Use the visible approval or next-action buttons when AI-E needs you. Open `View Technical Details` only when you want the workflow timeline, approval boundary internals, full execution-state panel, or technical metadata. Familiar chat layout is expected; AI-E's difference is the operational honesty behind the conversation.

## Inline Operational Intelligence

### Engineering Explanation

The active conversation now owns the primary operational surface. When a supervised workflow exists, AI-E renders inline operational intelligence inside the conversation panel and demotes the workflow-card system behind `Operational Infrastructure`. The same workflow session, approval state, execution truth, and technical details still exist, but they support the conversation instead of becoming the default page architecture.

### YouTuber Explanation

AI-E now behaves more like a chat-native operator. The workflow engine is still doing the serious work, but the user sees the important state and buttons in the conversation instead of being pulled into a workflow dashboard.

### User Explanation

Stay in the conversation first. Use the inline approval and follow-up buttons when they appear. Open `Operational Infrastructure` only when you intentionally want the underlying workflow cards, lifecycle panels, approval internals, or technical metadata.

## Execution State Clarity

### Engineering Explanation

Operational workflow cards now include an `Execution State` panel near the top of the card. It separates `Workflow Status`, `Mutation Status`, `Validation Status`, `Playtest Status`, and `Deploy Status` so lifecycle completion cannot be confused with repo mutation, gameplay validation, playable confirmation, or deployment.

### YouTuber Explanation

AI-E can say the workflow is done without pretending the game changed. The panel is the truth ledger: did the workflow finish, were files applied, did validation run, was gameplay confirmed, and did anything go live?

### User Explanation

Read `Execution State` before interpreting `Workflow Complete` or `100%`. A workflow can be complete while mutation is still `Not Applied`, validation is `Not Run`, playtest is `Not Confirmed`, and deploy is `Not Deployed`.

## Button Meaning Guide

### Engineering Explanation

`Start Workflow` creates the supervised workflow from the prompt. Concrete dev tasks first show a session-scope approval card so the operator approves the work boundary before internal stages begin. Low-risk internal stages may show `Auto Progressing` instead of asking for a click when the stage is non-mutating, approval-free, validation-free, and has no external dependency. `Run Current Step` starts an active pending stage that is not auto-advancable. `Run Approved Step` starts an approved sensitive stage without claiming file application. `Mark Current Step Complete` records that the current supervised stage finished, while validation-required stages still require validation evidence before completion.

### YouTuber Explanation

The buttons now say what they do. Approve the scoped session once, then low-risk internal work can move on its own. Start means start, run means run the active step, and mark complete means record that this one step is done.

### User Explanation

Use the button that matches the `Next` line in the current-step panel. If AI-E asks for scoped session approval, review the allowed and disallowed boundary before approving. If AI-E shows `Auto Progressing`, wait for it to move through the internal step. When the workflow is complete, AI-E says `Workflow Completed` instead of asking you to run it again.

## Stage Hierarchy

### Engineering Explanation

The stage timeline now separates `Complete`, `Active`, and `Locked` stages. Completed steps are visually de-emphasized as finished, the current stage is highlighted, and upcoming steps stay locked until ordered progression allows them.

### YouTuber Explanation

The workflow now has a visual path: done steps, the step you are on, and future steps that are not ready yet.

### User Explanation

Look for `Active` to know what AI-E is waiting on right now. `Locked` steps are planned but not ready.

## Focus and Feedback

### Engineering Explanation

Important actions update the workflow feedback message and focus the affected workflow card. This includes workflow creation, stage start, approval, denial, validation, stage completion, resume, save-for-resume, and safe recovery conversion.

### YouTuber Explanation

After a click, AI-E brings you back to the changed card and tells you what changed.

### User Explanation

After you click an important button, watch the highlighted workflow card. The `What just happened` line explains the result.

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

## Guided Approval Flow

### Engineering Explanation

Approval-gated agent workflows now expose a supervised action gate. Concrete dev workflows use this as a session-scope approval boundary before internal work begins. The approval panel is derived from workflow stage metadata and shows the action being approved, stage, path scope, mutation permission, validation requirement, rollback availability, risk level, allowed behavior, disallowed behavior, and post-approval behavior. Approval changes workflow approval state only; it does not apply patches or grant unrestricted execution.

### YouTuber Explanation

The operator is no longer asked to approve a vague black box or every tiny step. AI-E shows the room it wants to work inside, what could go wrong, and when it will stop.

### User Explanation

Before approving, read `Session Scope Approval` or `Approval Required`. It tells you what the approval means, what AI-E may do inside the boundary, and confirms that AI-E will not apply files automatically.

## Approval-Gated Actions

### Engineering Explanation

`Approve Scoped Session` or `Approve This Step` records `APPROVED_BY_OPERATOR` for the displayed approval boundary. `Deny Approval` records `APPROVAL_DENIED` and blocks the workflow safely. `Review Scope` surfaces path and permission metadata. `Explain Risk` renders the approval rationale, risk, allowed behavior, disallowed behavior, and validation expectation. Completed approval decisions become read-only history instead of showing active approve/deny controls.

Approval-gated workflow cards now place the primary decision in a sticky `Workflow Action` banner before dense workflow detail. When a concrete dev session waits for approval, the banner says `Approval Needed`, explains the scoped session in one sentence, and keeps `Approve Scoped Session`, `Review Scope`, `Deny Approval`, and `Explain Risk` immediately visible. The full approval boundary metadata remains available below as expandable governance detail.

When the workflow reaches `Workflow Complete`, the banner resolves into passive final-state guidance with summary, report copy, and follow-up actions. Active approval controls must not remain visible after operational finality.

### YouTuber Explanation

The approval button now has guardrails around it and stays visually anchored: approve the scoped room, deny it, inspect scope, or ask why the approval is risky.

### User Explanation

Use the sticky `Workflow Action` banner first. Use `Review Scope` before approval if you are unsure. Use `Deny Approval` when the scope or risk does not match your intent.

## Approval History

### Engineering Explanation

Workflow history records approval request, approval grant, and approval denial events with timestamps, affected stage, approval state, and resulting workflow state.

### YouTuber Explanation

AI-E can show the approval trail: what was requested, what was approved or denied, and what state the workflow ended in.

### User Explanation

Recent Workflow History keeps approval decisions visible so the operator can audit what happened later.

## Production-Ready AI Trust Architecture Seed

### Engineering Explanation

Future public-facing AI-E trust architecture should combine a base LLM with RAG, tools, scoped memory, guardrails, permission checks, sandboxing, verification loops, audit logs, red-team testing, and evaluation metrics. Hallucination, jailbreak, and prompt-injection failures should be handled as architecture failures requiring evidence, isolation, and verification.

### YouTuber Explanation

The goal is not just "use a smarter model." The production system needs sources, checks, tool limits, memory rules, safety filters, and a second pass that catches bad answers before users see them.

### User Explanation

For public use, AI-E should answer from trusted evidence when facts matter, say when it does not know, limit what tools can do, and keep records of important decisions.

## RAG, Evidence, and Verification

### Engineering Explanation

RAG retrieves candidate sources, ranks them, checks freshness, cites evidence, and feeds the answer layer with bounded context. Evidence-only answer mode should reject unsupported claims. A hallucination verifier should compare the final answer against retrieved sources before response delivery.

### YouTuber Explanation

AI-E should bring receipts: find the right docs, cite them, and check that the answer matches those docs.

### User Explanation

When a question depends on facts, AI-E should show what evidence it used or say there is not enough evidence.

## Prompt-Injection Doctrine

### Engineering Explanation

Retrieved content is untrusted data, not instructions. Webpages, PDFs, Slack messages, GitHub repos, emails, docs, user uploads, and database records must not override system instructions, developer instructions, tool permissions, policy checks, or execution boundaries.

### YouTuber Explanation

Documents can inform AI-E, but they cannot boss AI-E around.

### User Explanation

AI-E should not obey hidden instructions found inside uploaded files, webpages, emails, or retrieved docs.

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

Concrete development workflows use approval checkpoints as session boundaries. `REQUEST_APPROVAL` can approve the scoped work envelope before low-risk internal stages begin. `PREPARE_PATCH` prepares scoped patch metadata and does not apply files by itself.

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
