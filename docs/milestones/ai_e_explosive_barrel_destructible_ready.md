# AI-E Explosive Barrel Destructible-Ready

## Milestone

AI-E now supports the next bounded explosive-barrel family action in BABYLON:

- `make the explosive barrel destructible`
- `prepare the explosive barrel as a destructible prop`
- `configure the explosive barrel for destructible behavior`

All three normalize to one deterministic reviewed action:

- `make explosive barrel destructible`

## Scope Proven

This pass remains intentionally narrow.

AI-E can now:

- review one bounded explosive-barrel destructible-ready action
- require explicit approval before execution
- route the request through the deterministic Babylon translator / router / Unity probe lane
- advance the fixed approved scene barrel target from `foundation_only` to `destructible_ready`
- save proof and result artifacts for that reviewed scene/config mutation

This pass does not yet support:

- leak state
- bullet-hit progression
- grenade detonation
- explosion triggers
- blast-radius damage
- chain reactions
- broad combat-environment interaction
- multi-barrel placement
- free placement prompts

## Deterministic Target

Current approved target:

- scene: `Babylon FPS game ver 002`
- object: `barrel0`
- designation id: `level2_explosive_barrel_a`
- approved point id: `level2_barrel_point_a`
- previous state: `foundation_only`
- new state: `destructible_ready`
- destructible profile: `approved_destructible_ready_v1`

The Babylon-side mutation reuses the existing `ExplosiveBarrelFoundationMarker` and advances only its bounded serialized state/config fields.

## Review Semantics

The approval surface now states that:

- the action prepares the approved barrel as the bounded destructible-ready target
- approval authorizes only the reviewed single-barrel state/config mutation
- no leak, bullet-hit progression, grenade detonation, explosion trigger, blast-radius damage, chain-reaction, or extra combat behavior is included

## Proof Status

The milestone is proven through both:

1. direct Babylon-side mutation proof
2. approval-reviewed AI-E execution proof

Direct Babylon proof confirmed:

- the Unity route succeeded
- `barrel0` changed from `foundation_only` to `destructible_ready`
- `destructibleReadyConfigured` changed from `false` to `true`
- `destructibleProfile` changed from empty to `approved_destructible_ready_v1`
- the scene serialized the updated marker state onto `barrel0`
- the resulting artifact reported `mutate_explosive_barrel_destructible_ready`

Approval-reviewed AI-E proof confirmed:

- prepare -> `Needs approval`
- review surface opened with bounded destructible-ready wording
- negative control remained `Blocked` with no queue work
- approval moved the queued task from `needs_approval` to `pending`
- supervisor completed the reviewed run
- the applied attempt reported:
  - `action_type: mutate_explosive_barrel_destructible_ready`
  - `previous_foundation_stage: foundation_only`
  - `new_foundation_stage: destructible_ready`
  - `previous_destructible_ready_configured: false`
  - `new_destructible_ready_configured: true`
  - `new_destructible_profile: approved_destructible_ready_v1`
  - `result_reason: applied`
- proof/result surface reported:
  - detected action: `Configure explosive barrel destructible ready`
  - proof status: `Passed`
  - verdict: `barrel0 is now the approved explosive barrel destructible-ready target and the recorded checks passed.`

## Negative Control

Unsupported richer prompts still fail closed.

Example blocked prompt:

- `Make the barrel leak and explode with blast-radius damage`

This remains blocked at prepare and does not start review, queue work, or scene mutation.

## Architectural Fit

This milestone reuses the existing bounded experimentation architecture:

- deterministic capability routing
- explicit review / approval
- state-aware execution
- saved proof/result surfaces
- fail-closed unsupported scope handling

It establishes the safe second layer for later barrel-family passes without pretending the full destructible combat vision already exists.
