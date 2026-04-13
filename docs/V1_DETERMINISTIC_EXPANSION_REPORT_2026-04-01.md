# AI-E V1 Deterministic Expansion Report

Date: 2026-04-01

## Scope

This report combines the two most recent deterministic expansion handoffs:

1. bounded zombie movement speed adjustment
2. bounded predefined multi-step plan execution

Both changes stay inside the existing AI-E execution model:

- deterministic capability routing
- confirmation before generalized requests continue
- sandbox-first mutation execution
- proof-backed result review

## Completed In The Speed Expansion

Added deterministic zombie speed capabilities:

- `make zombie faster`
- `make zombie slower`

Added conversational normalization and controlled entity mapping support for:

- `make enemy faster`
- `speed up the zombie`
- `slow the enemy down`

Validated behavior:

- direct supported prompts go to `Sandbox first`
- generalized supported prompts go to `Needs confirmation`
- unsupported entity variants block honestly

Result coverage now includes:

- speed change summary
- before/after speed values when available
- validation outcome

## Completed In The Plan Expansion

Added one predefined bounded multi-step plan:

- `make zombie more aggressive`
- `make zombie more dangerous`

Plan title:

- `Increase zombie aggression`

Plan steps:

1. `Increase zombie movement speed`
2. `Move zombie forward to validate the aggression change`

Generalized supported conversational prompt:

- `make enemy more aggressive`

Behavior:

- recognized as a supported predefined plan
- shown as `Needs confirmation`
- requires explicit confirmation to the supported zombie target
- after confirmation, stages as `Sandbox first`
- executes sequentially through the existing queue + approval + supervisor path

Unsupported generalized example:

- `make boss more aggressive`

Behavior:

- remains blocked
- now explains that the aggression plan is only supported for the zombie system in BABYLON

## Current Supported Demo-Friendly Prompt Set

Direct deterministic prompts:

- `move zombie forward`
- `make zombie faster`
- `make zombie slower`
- `make zombie more aggressive`

Generalized conversational prompts that require confirmation:

- `move enemy forward`
- `make enemy faster`
- `slow the enemy down`
- `make enemy more aggressive`

Explicit unsupported deterministic examples:

- `move zombie backward`
- `move boss forward`
- `make boss faster`
- `make boss more aggressive`

## Result Surface Coverage

Single-step results now show:

- movement change summaries
- speed change summaries
- validation outcome

Multi-step plan sessions now open as one combined reviewed result instead of only showing the last step. The combined result includes:

- original request
- detected plan title
- all performed plan steps
- combined outcome summary
- validation summary across the full plan
- supporting artifacts as secondary detail

## Validation Notes

Validated against the real current product preview:

- `make zombie more aggressive` -> `Sandbox first`
- `make enemy more aggressive` -> `Needs confirmation`
- `make boss more aggressive` -> `Blocked`

Validated with focused tests:

- planner plan selection
- task-graph operator prompt preservation
- intake queue creation for predefined plans
- home-surface confirmation preview for generalized plans
- combined proof/result loading for multi-step sessions
- sequential supervisor execution for the aggression plan

## Deferred

Still intentionally deferred:

- arbitrary autonomous planning
- new agent systems
- broader gameplay tuning beyond the bounded zombie capabilities
- user-defined multi-step plans
- broader entity support beyond the explicit zombie mapping
