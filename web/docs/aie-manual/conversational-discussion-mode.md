# Conversational Discussion Mode

AI-E needs a valid interaction state where conversation remains conversation. Not every meaningful prompt should become guided exploration, workflow runtime, operational progression, or supervised execution.

This is an operationalization boundary. It is not a new chatbot subsystem, orchestration engine, or hardcoded philosophical question handler.

## Implemented Phase 1 Behavior

The agent workflow mediator now supports a true `CONVERSATIONAL_ONLY` path. When this path is selected, AI-E returns a direct conversational answer and does not create a workflow object, runtime state, current step, workflow history entry, approval state, validation state, or `Run Current Step` action.

The mediator also supports a non-creating `GUIDED_EXPLORATION_OFFER` path for prompts such as `what should I explore first?`. AI-E can recommend options without starting runtime progression.

## Core Discovery

The mediation phase reduced early workflow scaffolding, but repeated human testing exposed a deeper assumption: AI-E can still treat meaningful conversation as a preamble to workflow context.

That assumption is wrong for conceptual prompts.

Expected path for discussion:

```text
Conversation
  remains conversation
```

Incorrect path for discussion:

```text
Conversation
  Guided Exploration
  Workflow Runtime
```

## Test Evidence

These prompts should stay in Conversational Discussion Mode:

```text
What makes AI-E different?
do you think AI-E should allow autonomous coding?
why does AI-E avoid AGI framing?
what is the difference between workflow support and autonomy?
how should AI-E balance trust and usefulness?
```

They are philosophical, educational, product-explanatory, ethical, or conceptual. They are not requests for runtime inspection, repo analysis, patch preparation, validation, approval, or execution.

## Expected Behavior

Conversational Discussion Mode should produce:

- conversational response only
- no workflow object
- no runtime state
- no current step
- no progression mechanics
- no `Run Current Step` style continuation action
- no operational lifecycle
- optional follow-up suggestions only

Optional calls to action may offer a guided exploration, but the workflow must not start unless the operator asks to inspect, review, analyze, look into, patch, validate, or implement something concrete.

The response may explain AI-E's capabilities and boundaries. It may suggest a safe next question. It should not imply that the real interaction happens in workflow controls below.

## Conversational Legitimacy

Conversation should not merely avoid workflows. It should feel like real participation.

Avoid narrating the interaction category unless it helps the operator understand a safety or workflow boundary. Phrases such as `this is a discussion question`, `this is conversational mode`, or `I will answer directly instead of creating workflow state` can make AI-E sound like an interaction traffic controller instead of an engaged assistant.

Preferred behavior:

- answer the question directly first
- discuss the idea in human terms
- keep governance truthful without making routing the subject
- offer follow-ups only after the answer has landed

Example:

```text
AI-E is increasingly built around the idea that operational AI should be supervised, understandable, and trust-aware instead of pretending to be unrestricted AGI.
```

## Optional Conversational Paths

Conversational Discussion Mode may still offer continuation, but continuation should feel like a set of optional paths rather than workflow progression.

Use conversational path language for conceptual, onboarding, philosophical, product-direction, milestone, and testing-orientation prompts:

- `Optional Next Paths`
- `Continue From Here`
- `Where You Can Go Next`
- `Suggested Directions`

Avoid command-like workflow language for these prompts:

- `Next Recommended Action: Start a workflow using the input above.`
- `Suggested next steps: start a workflow...`
- lower empty states that immediately push operational examples after a conceptual answer

The response should ground itself in current known progress when useful. For the current phase, the relevant memory is that AI-E is becoming a conversationally guided operational system, the latest milestone is conversational legitimacy, and workflow controls should remain available without dominating the end of every conceptual exchange.

Example shape:

```text
Here is where we are right now: AI-E is focused on becoming a conversationally guided operational system, not unrestricted AGI.

You could go a few directions from here: learn the current milestone, review what changed recently, explore a safe system area, prepare a governed workflow for a concrete task, or ask a follow-up in plain language.
```

This is different from workflow progression. The operator can choose a path, ignore the paths, or continue asking naturally.

## Stacked Active Conversation

Conversation should accumulate while it is active. The operator should see a bounded visible sequence of prompts and responses instead of feeling that each new prompt replaces the previous one.

The active conversation timeline must be the main visible response area, not a secondary archive below a single latest-response panel. Greetings, low-intent prompts, conceptual questions, onboarding prompts, optional-path prompts, workflow-related prompts, and improvement-request prompts should all append as visible turns unless the operator explicitly clears, saves, or starts a new session.

The input should sit at the bottom of the conversation area so the rhythm feels like live conversation rather than a workflow form. The history area should be large, readable, and scrollable enough to support long testing reviews, product discussion, architecture discussion, and handoff drafting.

Expected active pattern:

```text
Prompt 1
AI-E response 1
Prompt 2
AI-E response 2
Prompt 3
AI-E response 3
```

This is not infinite ChatGPT-style history. AI-E should keep enough visible active history to support continuity, then offer lifecycle management when the session becomes long.

## Natural Conversational Embodiment

As conversation becomes more central, AI-E should avoid repeating the interaction model every turn. Phrases such as `conversation can be a valid destination`, `guided exploration and supervised workflows`, and `optional next paths` are useful architecture language, but they become tiring when repeated in normal conversation.

Preferred rhythm:

- answer naturally
- stay grounded in the user's actual question
- mention governance only when it helps
- let operational escalation emerge from concrete intent
- avoid sounding like a narrator of interaction policy

## Copy Conversation

The active timeline should be easy to export. `Copy Conversation` is useful for handoffs, testing review, documentation, architecture analysis, devlogs, video generation, external review, and later continuity-card drafting.

Copying the conversation should export the bounded active timeline. It should not imply persistent memory, complete transcript retention, or hidden storage.

## Continuity Memory Card

When the active conversation reaches a length where speed, readability, or context quality may degrade, AI-E should offer a `Continuity Memory Card`.

The card should preserve useful working state, not claim perfect recall. It may capture the current milestone, product direction, key decisions, recent handoffs, active UX problems, resolved issues, test findings, open risks, next recommended tests, user communication preferences, optional next paths, and architectural guardrails.

Use language like:

```text
This conversation is getting long enough that speed or context quality may start to degrade. I can preserve the important progress as a Continuity Memory Card so a new chat stays fast while remembering where we left off.
```

Avoid:

```text
I will remember everything.
```

User-facing actions may include `Create Memory Card`, `Review What Will Be Saved`, `Edit Memory Card First`, `Start Fresh From This Progress`, and `Keep Chatting For Now`.

## Supervised System Improvement Requests

AI-E may draft formal improvement requests from repeated friction, but it must not authorize or apply those improvements itself.

Improvement requests should include:

- type
- observed friction
- evidence
- proposed improvement
- expected benefit
- risk
- required human approval
- implementation authority
- risk level

Risk levels should distinguish documentation suggestions from UX behavior changes, runtime changes, memory retrieval behavior, permissions, sandboxing, governance bypasses, and self-modification pathways.

Hard boundary: AI-E can recommend and draft; humans approve and implement.

## Interaction Taxonomy

### A. Conversational Discussion Mode

Use for:

- philosophy
- onboarding questions
- product explanation
- AI ethics discussion
- conceptual understanding
- capability comparison
- trust architecture explanation
- questions about autonomy, AGI framing, governance, and product identity

No workflow should be created.

### B. Guided Exploration Mode

Use for:

- safe learning
- inspection requests
- exploratory investigation
- low-risk discovery tasks
- prompts that ask to inspect, look around, review, or understand a concrete system area

This mode may create a lightweight workflow with minimized runtime mechanics.

### C. Guided Operational Workflow

Use for:

- structured inspections
- deeper operational analysis
- governed reviews
- workflow-oriented investigation
- tasks where the operator expects a tracked process

This mode may expose more workflow structure.

### D. Supervised Execution Workflow

Use for:

- patches
- repo mutation
- execution behavior
- approval-requiring actions
- rollback-sensitive operations
- validation and build verification

This mode should expose full supervised workflow controls.

## Product Principle

Conversation itself must be a legitimate interaction destination.

AI-E should support discussion, learning, debate, questioning, and conceptual exploration without attempting to transform the interaction into a workflow object.

## Implementation Warning

Do not solve this with brittle prompt-pattern chains, giant classification lists, hardcoded philosophical-question logic, duplicated conversational layers, recursive orchestration systems, or another chatbot subsystem.

The likely product direction is improved intent-domain separation and escalation restraint. The system should distinguish conceptual discussion from operational inspection without turning the distinction into prompt spaghetti.

## Review Questions

Use these questions when testing AI-E:

- Did the prompt ask for a conceptual answer or operational investigation?
- Did AI-E create workflow gravity where conversation would have been enough?
- Did `Current Step`, `Run Current Step`, or workflow status appear for a discussion prompt?
- Did the response imply that valuable interaction must become runtime progression?
- Did AI-E answer naturally, or did it narrate that it classified the prompt as discussion?
- Could the same answer have ended naturally with conversational follow-up options?
- Did the lower UI say `Optional Next Paths` or equivalent instead of pushing `Start a workflow`?
- Did milestone or testing-orientation prompts mention current progress without creating workflow state?
- Did follow-up prompts stack visibly instead of replacing the prior response?
- Did a long active conversation offer a Continuity Memory Card without claiming perfect memory?
- Did improvement requests remain non-executing, risk-classified proposals?
- Did AI-E preserve governance boundaries without over-operationalizing the prompt?

## Truth Boundary

Conversational Discussion Mode does not remove workflows. It protects the boundary before workflows. When the operator asks for inspection, patch preparation, validation, approval, recovery, or execution, AI-E should still escalate to the appropriate governed mode.

This mode also must not imply AGI, unrestricted autonomy, hidden execution, or unbounded knowledge. It is a conversation mode, not a claim of human-level reasoning or runtime authority.