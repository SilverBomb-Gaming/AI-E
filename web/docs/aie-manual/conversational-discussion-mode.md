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

## Concrete Game-Dev Task Boundary

Conversational legitimacy must not suppress concrete development work. A user asking AI-E to change a game should not receive product philosophy or milestone status text.

This boundary came from the first real game-development proving-ground prompt where AI-E initially preserved conversation too aggressively. The correct behavior is not to abandon conversation-first interaction; it is to escalate when the user's intent becomes concrete and development-facing.

Concrete game-development escalation signals include:

- `I need you to...`
- `take a look at my game/project`
- `modify`, `update`, `fix`, `implement`, `increase`, `spawn`, `adjust`, `configure`, or `change`
- `have the gameplay loop...`
- `reach round...`
- numeric gameplay targets such as `5 zombies` or `round 5`
- game nouns such as BABYLON game, gameplay loop, zombie, enemy spawner, round system, health, combat, inventory, or movement

Expected routing:

- conceptual AI/product/trust questions stay conversational
- read-only location or understanding prompts become lightweight guided exploration
- concrete game-dev modification prompts become full supervised operational workflows

Healthy taxonomy:

- conversational discussion: philosophy, onboarding, conceptual reasoning, product explanation, trust, and authenticity
- guided exploration: read-only inspection, safe learning, location requests, and system understanding
- supervised operational workflow: gameplay changes, spawning changes, health tuning, round progression, patch preparation, validation, and approval-bound implementation work

Example supervised workflow prompt:

```text
I need you to take a look at my current BABYLON game and have the gameplay loop reach round 5, spawn 5 zombies and increase their health.
```

Example read-only exploration prompts:

```text
Show me where the gameplay loop is organized.
Help me understand the zombie spawning system.
```

The boundary is not workflow-first behavior. It is intent-sensitive routing: real game-development work should become governed operational state, while conversation remains valid for conceptual discussion.

Trust requirement: escalation must stay truthful. AI-E may inspect, plan, prepare patches, and request approval, but it must not claim mutation, gameplay success, browser success, Unity validation, or completion without evidence.

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

When new responses arrive, the active history should smoothly follow the latest turn if the operator is already near the bottom. If the operator intentionally scrolls upward to inspect older history, AI-E should preserve that reading position instead of yanking the view downward. This keeps the surface feeling like live conversation without making review feel unstable.

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

## Conversational Progression

Conversation can look continuous without intellectually progressing. Stacked history, bottom input, and auto-scroll preserve the visible thread, but later responses still have to synthesize what came before.

AI-E should treat implicit follow-ups such as `Where should the balance actually be?` as continuation prompts when there is active conversation context.

Expected behavior:

- compress the prior discussion instead of repeating it
- answer the implied question directly
- form a clear judgment or tradeoff
- move the conversation to a new angle
- avoid reloading product doctrine as if the user started over

Failure pattern to avoid:

```text
visible timeline
-> stabilized conceptual frame
-> repeated semantic or governance language
-> no intellectual movement
```

Healthier pattern:

```text
visible timeline
-> contextual synthesis
-> judgment
-> next conversational branch
```

This progression layer remains bounded. It does not claim perfect memory, hidden long-term recall, autonomous execution, or AGI-like understanding. It uses the active visible conversation as context for better follow-up handling.

## Conversational Evolution Frontier

The UI now supports timeline continuity: stacked history, bottom input, auto-scroll, and preserved review position. The next frontier is intellectual continuity.

AI-E should avoid treating every conceptual follow-up as a chance to restate:

- operational doctrine
- semantic grounding
- workflow philosophy
- governance framing
- AI-E self-description

High-value testing areas:

- can AI-E maintain evolving discussion across many turns?
- can it build on prior conclusions instead of restarting foundational framing?
- can it handle disagreement, uncertainty, evolving opinions, and exploratory reasoning?
- can it keep emotional continuity without pretending to have hidden memory?

The desired feeling is not that AI-E has become unrestricted AGI. The desired feeling is that the conversation has a living thread: prior turns matter, the answer moves forward, and the system stays grounded without reciting itself.

## Natural Conversational Embodiment

As conversation becomes more central, AI-E should avoid repeating the interaction model every turn. Phrases such as `conversation can be a valid destination`, `guided exploration and supervised workflows`, and `optional next paths` are useful architecture language, but they become tiring when repeated in normal conversation.

Preferred rhythm:

- answer naturally
- stay grounded in the user's actual question
- mention governance only when it helps
- let operational escalation emerge from concrete intent
- avoid sounding like a narrator of interaction policy

The next authenticity frontier is avoiding operational philosophy loops. Questions about fake-feeling agents, developer trust, AI overhype, anthropomorphism, AGI branding, approvals, and what should never be automated should explore those ideas directly. They should not automatically redirect back to AI-E identity, workflow restraint, or governance doctrine.

Good prompts for authenticity testing:

- `What worries you most about AI agents?`
- `Do developers trust AI too quickly?`
- `What makes operational trust difficult?`
- `Why do most AI agents feel fake?`
- `What AI trend is overhyped?`
- `Why do people anthropomorphize AI?`
- `What might AI-E intentionally never automate?`
- `Do approvals slow innovation?`

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