# AI-E Design Doctrine

## Purpose

AI-E exists to turn bounded user intent into governed, reviewable system behavior without overwhelming the operator or pretending to understand more than the system can safely support.

## Foundational Belief

Useful agentic systems do not begin with autonomy. They begin with bounded interpretation, explicit execution boundaries, truthful blocking, and artifacts a human can inspect.

## Core Design Principles

- Bounded first: AI-E only acts within explicit supported capabilities, supported plans, and supported review flows.
- Deterministic where possible: supported requests should resolve through known mappings, known plans, known tiers, and known outcomes.
- Explain before acting: every meaningful resolution step should be inspectable by the operator.
- Reviewable by default: execution is not the product unless proof, logs, and results are visible afterward.
- Non-autonomous by default: AI-E does not invent work, infer hidden goals, or escalate scope on its own.
- Honest failure over fake support: unsupported requests must block clearly instead of being guessed.
- Cognitive relief is a product feature: AI-E should reduce operator overload, not increase it.

## Cognitive Load Doctrine

AI-E is designed to reduce "brain fry."

- The system should translate supported intent into a small number of understandable choices.
- It should surface what it understood, what it can actually do, and what it needs from the user next.
- It should prefer guided confirmation, compact summaries, and explicit next steps over ambiguous agent behavior.
- It should never require the user to mentally reconstruct hidden state from scattered logs or silent assumptions.

## Architectural Doctrine

AI-E should remain:

- deterministic for supported flows
- bounded in scope and execution
- explainable at intake, execution, and review time
- reviewable through artifacts and structured summaries
- non-autonomous by default unless a future system explicitly proves otherwise

The current architecture reflects this doctrine through:

- normalization before execution
- explicit entity mapping
- explicit goal-intent mapping
- bounded goal composition
- predefined plans instead of freeform planning
- state-aware mutation guards
- session-aware but bounded follow-up resolution
- deterministic evaluation
- current-session experiment tracking
- explicit user-driven experiment decisions

## Blocking Doctrine

Blocking is a safety feature, not a product failure.

- If AI-E does not support a request safely, it must block.
- If the entity is unsupported, AI-E must say so explicitly.
- If the goal is unsupported, AI-E must say so explicitly.
- If follow-up context is ambiguous, AI-E must require clarification or block.
- If a request conflicts internally, AI-E must block rather than guess.

Every blocked response should help the operator recover by showing a supported example or supported path where possible.

## Evaluation Doctrine

Evaluation must stay rule-based and bounded.

- AI-E may compare recent results only within defined deterministic families.
- Comparisons must be based on known state, known tiers, and known artifacts.
- Suggestions must come from predefined rules, not open-ended interpretation.
- Evaluation is for clarity and iteration support, not autonomous judgment.

## Experiment Doctrine

Experiments exist to structure bounded iteration.

- Variants should be grouped within the current session using deterministic ids.
- Variant lineage should remain visible.
- The original baseline must remain preserved.
- Preferred baselines may be set explicitly by the user, not inferred by the system.
- Rejected variants remain part of history; they are not erased.

AI-E should help the user compare variants, not decide the winner on their behalf.

## Learning Doctrine

Learning must remain governed.

- AI-E should not blindly learn from outcomes.
- Future learning should only use reviewed, artifact-backed, policy-safe results.
- Session memory is not the same as long-term learning.
- Experiment history is for bounded iteration support, not autonomous model evolution.

Until a stricter learning pipeline exists, bounded session state and reviewed artifacts are the only acceptable basis for iterative guidance.

## Policy / Governance Doctrine

- Sandbox-first behavior is the default for impactful execution.
- Approval boundaries must remain visible and enforceable.
- Unsupported capability claims are prohibited.
- Hidden execution pathways are prohibited.
- The system must preserve inspectable proof for supported actions.
- Governance is part of product quality, not an afterthought.

## Expansion Doctrine

AI-E should expand by adding explicit bounded support, not by loosening constraints globally.

- New capabilities should be added as concrete contracts.
- New plans should be predefined before they are executable.
- New conversational support should come from explicit mappings, not broad inference.
- New evaluation or experiment behavior should remain rule-based until stronger governance exists.
- Scope should grow only when the system can remain explainable and reviewable at that new scope.

## Repository Doctrine

The repository should make the system's boundaries legible.

- Docs should explain supported behavior, blocked behavior, and architectural intent.
- Runtime contracts, tests, and UI wording should agree.
- Bounded experimentation changes should ship with validation coverage.
- Session-state evolution should preserve compatibility where reasonable and fail honestly where not.
- Runtime debris, generated artifacts, and local environment noise should not obscure repository truth.

## Non-Negotiables

- No fake capability support
- No silent execution escalation
- No autonomous planning hidden behind conversational language
- No open-ended memory disguised as bounded state
- No subjective "best variant" ranking without an explicit future design change
- No removal of review surfaces in favor of opaque automation
- No architecture drift away from bounded, governable, reviewable behavior

## Success Criteria

AI-E is aligned with this doctrine when:

- supported requests resolve predictably
- unsupported requests fail clearly
- execution remains bounded and governed
- results are inspectable and reviewable
- comparisons remain deterministic
- experiments remain current-session and user-driven
- documentation, tests, and runtime behavior agree
- the system reduces operator cognitive load instead of amplifying it
