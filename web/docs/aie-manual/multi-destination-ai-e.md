# Multi-Destination AI-E

AI-E is evolving beyond workflow destination thinking. The product should not ask only whether a prompt becomes a workflow. It should choose the best interaction destination for the user's intent.

This direction follows the successful `CONVERSATIONAL_ONLY_MODE` phase. Conversation is now a legitimate completed interaction, not a temporary pre-workflow state.

## Core Principle

Workflows are one destination. They are not the default destination, the highest-value destination for every prompt, or the place every useful interaction should eventually land.

The product direction moves from:

```text
Prompt
  Workflow or Not
```

Toward:

```text
Prompt
  Best Interaction Destination
```

## Destination Taxonomy

### 1. Conversational Discussion Destination

Purpose:

- philosophy
- onboarding
- explanation
- discussion
- conceptual guidance
- product positioning
- AI safety discussion
- operational philosophy

Examples:

```text
what makes AI-E different?
why did AI-E move away from AGI framing?
should AI-E allow autonomous coding?
how do approvals work?
```

Behavior:

- pure conversational response
- no workflow object
- no runtime progression
- no operational state
- optional conversational paths when useful
- current progress or milestone context when the user asks where AI-E is headed
- bounded visible conversation stacking while the session is active
- Continuity Memory Card offer when the active conversation gets long

### 1A. Continuity Memory Card Destination

Purpose:

- preserve useful working state
- summarize long active conversations
- seed a fresh fast continuation
- review/edit session memory before carrying it forward

Examples:

```text
create a continuity memory card
review what will be saved
start fresh from this progress
```

Behavior:

- bounded session artifact
- human review/edit before use
- no claim of perfect transcript memory
- no new runtime authority

### 1B. Supervised System Improvement Request Destination

Purpose:

- formalize repeated friction
- draft UX, memory, workflow, documentation, testing, or safety proposals
- classify risk
- preserve human approval and implementation authority

Examples:

```text
should AI-E create a formal improvement request for this?
draft a system improvement request for stacked conversation history
```

Behavior:

- evidence-based proposal
- risk level: low, medium, high, or critical
- required human approval
- implementation authority remains human/dev only
- no self-upgrade or governance bypass

### 2. Learning And Tutorial Destination

Purpose:

- teach concepts
- onboarding walkthroughs
- explain workflows
- guided learning
- beginner education

Examples:

```text
teach me how workflows work
show me around
explain AI-E like I'm new
what should beginners understand first?
```

Behavior:

- tutorial-style conversational guidance
- optional suggested learning paths
- optional lightweight visual navigation
- workflow creation only when explicitly requested

### 3. YouTuber Translation Destination

Purpose:

- devlog language
- tutorial narration
- onboarding scripts
- release recap framing
- human-readable storytelling

Examples:

```text
turn this CR into a devlog
explain this update like a YouTube breakdown
summarize this handoff for a video
```

Behavior:

- narrative translation
- emotionally readable explanation
- simplified operational framing
- visually digestible formatting
- no workflow creation

This is a communication and presentation destination, not another runtime AI subsystem.

### 4. Testing Interpretation Destination

Purpose:

- UX review
- scaffold leakage detection
- escalation analysis
- operational readability review
- human-testing interpretation

Examples:

```text
review this test session
what still feels scaffoldy?
summarize this UX test
analyze these logs from a user perspective
```

Behavior:

- structured operational interpretation
- emotional/operator analysis
- escalation smoothness commentary
- next recommended tests
- no runtime workflow creation

### 5. Guided Exploration Destination

Purpose:

- safe read-only inspection of specific systems
- low-risk discovery tasks
- concrete operational learning

Examples:

```text
inspect the inventory system
help me inspect combat balance
review enemy AI behavior
```

Behavior:

- lightweight read-only workflow
- minimized operational details first
- optional workflow visibility
- low operational intensity

### 6. Supervised Operational Workflow Destination

Purpose:

- governed execution
- modification
- patch preparation
- validation
- resumable work
- rollback-sensitive operations

Examples:

```text
prepare a safe movement patch
generate a proposed combat fix
apply the patch automatically
prepare a rollback-safe patch
```

Behavior:

- full supervised workflow
- approvals
- governance visibility
- validation states
- operational continuity
- workflow progression
- resumability

### 7. Workspace And Drafting Destination

Purpose:

- manuals
- handoffs
- scripts
- checklists
- reports
- operational plans
- structured notes

Examples:

```text
create a handoff
draft onboarding documentation
make a tutorial outline
build a testing checklist
```

Behavior:

- drafting-focused interaction
- structured document output
- no implied execution

## Architecture Direction

All destinations should remain:

- centrally mediated
- intent-routed
- capability-shared
- composable
- operationally bounded

Avoid destination explosion. Do not create isolated subsystems for every destination, duplicate intelligence layers, multiple orchestration engines, fragmented routing systems, brittle keyword heuristics, giant conditional chains, or destination god routers.

The destination model should extend the existing mediation philosophy: choose the right interaction shape before creating runtime state.

## Visual Direction

Once conversation is legitimate, the UI should stop visually implying that workflow controls are the real destination.

Desired hierarchy:

1. Conversational response
2. Guidance/reasoning
3. Optional next paths
4. Optional workflow tooling
5. Runtime mechanics/governance details

Avoid default hierarchy:

1. Control Center
2. Runtime states
3. Workflow controls
4. Governance sections
5. Conversation embedded inside panels

`Next Recommended Action` belongs inside active workflow cards. Conceptual conversation should use labels such as `Optional Next Paths`, `Continue From Here`, or `Suggested Directions` so the operator feels invited to choose rather than pushed into progression.

## Truth Boundary

Multi-destination AI-E does not remove governed workflows. It does not add unrestricted autonomy, hidden execution, automatic validation, repo ownership, Unity control, shell authority, AGI behavior, or `autonomous_real` behavior.

It is a routing and product-experience direction: choose the destination that fits intent, and create workflow state only when the destination needs workflow state.