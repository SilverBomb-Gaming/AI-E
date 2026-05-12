# AI-E Operational Manual

Phase: AIE_MANUAL_AND_TRANSLATION_SYSTEM_PHASE1

This manual is product comprehension infrastructure for AI-E. It explains the runtime, the operator surfaces, the agent workflow model, and the truth boundaries in language that supports engineers, creators, and end users.

This is not marketing copy, lore, or a placeholder README expansion. It is the first navigable knowledge layer for operating AI-E as a governed runtime product.

## Manual Map

- [Glossary](./glossary.md): translates engineering terms into creator-friendly and end-user language.
- [UI Navigation](./ui-navigation.md): explains where operators go in the product and what they are looking at.
- [Runtime Workflows](./runtime-workflows.md): explains workflow sessions, stage progression, validation, approvals, and rollback preparation.
- [AI-E Agents](./ai-e-agents.md): explains what AI-E agents are and how they differ from chatbots.
- [REAL vs NOT REAL](./real-vs-not-real.md): defines official truthfulness doctrine for the product.

## Who This Manual Serves

### Engineers

Engineers use this manual to keep implementation language aligned with product behavior. Runtime concepts such as execution routes, bounded mutation, validation checkpoints, and workflow stages must remain understandable and auditable.

### YouTubers and Product Explainers

Creators use this manual to describe AI-E without overclaiming. The translation layer gives accurate phrases for explaining what the system does in plain language.

### End Users and Operators

Operators use this manual to understand where to click, what each state means, why a workflow is blocked, and what approval or validation step comes next.

## Current Manual Scope

This Phase 1 manual covers:

- AI-E operator chat and agents surfaces
- reasoning visibility
- supervised workflow sessions
- validation and approval indicators
- blocked workflow states
- rollback preparation markers
- official real vs not-real boundaries

## Manual Rules

- Do not claim AI-E is AGI.
- Do not claim unrestricted execution or autonomous repo ownership.
- Do not fake screenshots.
- Do not treat blocked states as failures of the product; blocked states are part of governance.
- Prefer plain operational language over internal shorthand when writing operator-facing docs.

## Screenshot Policy

Screenshots are intentionally marked as TODO in this phase. They should be added only after the relevant UI state is captured from the running product.

Screenshot TODO index:

- TODO: `/operator/chat` reasoning visibility panel
- TODO: `/operator/agents` workflow sessions panel
- TODO: `/operator/agents` validation and approval checkpoint view
- TODO: `/operator/agents` blocked workflow state
- TODO: `/operator/agents` rollback marker view
