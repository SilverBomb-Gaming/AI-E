# Conversational Visual Hierarchy

AI-E Agents should visually feel like a conversational operational intelligence system that can reveal governed workflows. They should not first feel like a workflow operations console that happens to contain an assistant.

This is a visual hierarchy direction. It is not a request to remove governed workflows, approvals, resumability, runtime visibility, or operational safety mechanics.

## Conversational Visual Embodiment Phase

Recent human testing shows the mediation behavior is working: onboarding prompts can stay conversational, active workflows are not forced immediately, governance can be introduced progressively, and safe exploration can be offered without overwhelming the operator.

The remaining issue is embodiment. AI-E must visually feel like the primary intelligent entity on the screen. The conversation should not feel inserted into the operational framework; the operational framework should feel like it emerges from the conversation.

Strong tested language to preserve:

```text
No workflows yet.
I will introduce workflow controls only when they help the task.
```

This phrasing improves trust, escalation clarity, and operator comfort because it explains both the current calm state and the future path to governed controls.

## Core Transition

Current perceived structure:

```text
Workflow App
  contains AI assistant
```

Desired perceived structure:

```text
AI Assistant
  can reveal workflow capabilities
```

Latest embodiment target:

```text
Conversational AI experience
  optional operational capability surfaces
```

The mediation phase improved escalation behavior. The next problem is visual dominance: panels, counters, cards, workflow sections, runtime states, and operational controls can still outweigh the conversation.

## Conversational Discussion Boundary

Visual hierarchy also depends on interaction legitimacy. Some prompts should not reveal workflow capability at all. Questions such as `What makes AI-E different?` or `do you think AI-E should allow autonomous coding?` are discussion prompts, not exploration workflows.

For these prompts, the correct visual result is conversation only: no workflow object, no current step, no runtime lifecycle, no operational continuation action, and no visual suggestion that the real interaction happens below.

## What Is Working

- onboarding prompts can stay conversational
- `No workflows yet.` communicates calm, truthful non-escalation
- `I will introduce workflow controls only when they help the task.` improves trust and escalation clarity
- lightweight guided exploration can minimize runtime mechanics
- escalation behavior can route more appropriately
- orchestration exposure can be reduced
- supervised operational workflows can still appear correctly for patch, approval, validation, recovery, and execution-boundary prompts

## What Still Feels Operationally Dominant

Look for these signals during UI review:

- `Control Center` visually anchors the page before the conversation does
- `Active`, `Resumable`, and `Blocked` counters immediately communicate dashboard semantics
- `Current Step`, waiting states, workflow history, and governance reference panels compete with the assistant response
- buttons such as `Run Current Step`, `Resume Workflow`, and `Save for Resume` feel execution-engine centric in lightweight contexts
- conversation lacks visual breathing room
- workflow buttons visually outweigh conversational guidance
- the page rhythm feels segmented and utility-driven instead of message-flow centered
- the conversation feels embedded inside the operational shell instead of visually leading it
- the page feels panel-native rather than conversation-native

## Design Principle

Conversational behavior alone is not enough. The interface should visually prioritize intelligence, center the dialogue, subordinate orchestration, and make workflow mechanics feel contextual.

Do not interpret this as cloning a generic chat product. AI-E still needs governed workflows, approvals, resumability, runtime mechanics, and operational visibility. The point is sequencing and hierarchy, not hiding the truth.

The goal is not to mask governance with friendlier styling. The goal is to make governance feel like capability that appears at the right moment.

## Interaction Intensity Levels

### Conversational Guidance Mode

This mode should feel mostly conversational.

Use when the operator asks for onboarding, orientation, capability help, confusion recovery, or learning guidance.

Discussion prompts belong here when they are conceptual, philosophical, educational, ethical, or product-explanatory.

Visual direction:

- AI presence and guidance lead the composition
- message flow is the primary anchor
- workflow counters and history are absent or visually quiet
- suggestions are lightweight and conversational
- advanced details are optional
- no workflow card appears unless the user moves toward a concrete operational task
- conversation can end as conversation without becoming a workflow

### Guided Exploration Mode

This mode should mix conversation with light operational support.

Use when the operator asks for safe read-only inspection, orientation around a system, or exploratory review.

Visual direction:

- conversation remains dominant
- exploration framing appears as a contextual companion, not a dashboard takeover
- workflow mechanics stay minimized by default
- `Show Workflow Details` remains available
- controls are contextual and sparse
- panel emphasis is soft enough that the operator still feels they are talking with AI-E

### Full Supervised Operational Mode

This mode may expose the full workflow surface.

Use when the operator asks for implementation, patch preparation, validation, approval-gated work, recovery, execution-boundary actions, or resumable operational work.

Visual direction:

- workflow cards, current step, approval, validation, history, and governance controls can become prominent
- operational density is acceptable because the task has become operationally serious
- labels should still explain what they mean in human terms

## Review Questions

Use these questions when reviewing `/operator/agents` screenshots, PDFs, or testing videos:

- Does the conversation visually lead the page?
- Is conversation allowed to be complete without workflow escalation?
- Does AI-E feel like the primary entity on screen?
- Do workflow mechanics appear only when the prompt warrants them?
- Are operational controls contextual, or do they dominate the initial composition?
- Does the page feel like guided intelligence or workflow tooling?
- Is governance visible without making the first impression feel like a diagnostics dashboard?
- Does lightweight exploration have enough breathing room?
- Do button labels feel like assistant actions or engine controls?
- Does the screen say "I am talking with AI-E" before it says "I am operating tooling"?
- Does the operational framework emerge from the conversation, or does the conversation sit inside the framework?
- Is `No workflows yet.` treated as a calm state rather than an empty dashboard failure?
- Is the phrase `I will introduce workflow controls only when they help the task.` visible or reflected in the visual hierarchy?

## Truth Boundary

Conversational visual dominance must not hide important safety information. Approval, validation, blocked states, rollback preparation, path scope, and workflow history must remain available when relevant.

The design goal is progressive visual disclosure: conversation first, contextual workflow support second, full operational panels when the work truly needs supervised runtime control.

## Future Direction

Future UI work may introduce different density levels for the same workflow capability:

- a conversation-first composition for orientation
- a hybrid exploration composition for safe inspection
- a full operational composition for governed execution workflows

This should be treated as a design-system and layout problem before adding more routing or orchestration logic.

Highest-leverage exploration areas:

- larger conversational response area
- stronger AI message presence
- chat-style flow rhythm without copying a generic chat UI
- reduced operational density during onboarding
- progressive workflow surfacing
- softer panel emphasis
- contextual runtime reveal
- optional expandable operational sections