# AI-E Explosive Barrel Foundation

## Milestone

AI-E now supports the first bounded destructible / interactable-object family action in BABYLON:

- `place an explosive barrel`
- `add an explosive barrel`
- `enable the explosive barrel`

All three normalize to one deterministic reviewed action:

- `enable explosive barrel`

## Scope Proven

This pass is intentionally narrow.

AI-E can now:

- review one bounded explosive-barrel foundation action
- require explicit approval before execution
- route the request through the deterministic Babylon translator / router / Unity probe lane
- mark one fixed approved scene barrel target as the explosive barrel foundation
- save proof and result artifacts for that reviewed scene mutation

This pass does not yet support:

- leak state
- hit progression
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
- foundation stage: `foundation_only`
- designation id: `level2_explosive_barrel_a`
- approved point id: `level2_barrel_point_a`

The Babylon-side mutation adds a serialized `ExplosiveBarrelFoundationMarker` component to that fixed target only.

## Review Semantics

The approval surface now states that:

- the action is a bounded explosive-barrel foundation mutation
- approval authorizes only the reviewed single-barrel foundation change
- no leak, explosion, blast-radius, chain-reaction, or extra combat behavior is included

## Proof Status

The milestone is proven through both:

1. direct Babylon-side mutation proof
2. approval-reviewed AI-E execution proof

Direct Babylon proof confirmed:

- the Unity route succeeded
- the scene serialized the marker onto `barrel0`
- the resulting artifact reported `mutate_explosive_barrel_foundation`

Approval-reviewed AI-E proof confirmed:

- prepare -> `Needs approval`
- review surface opened with bounded barrel-foundation wording
- `approve_once` moved the task to pending
- supervisor completed the reviewed run
- proof/result surface reported:
  - detected action: `Enable explosive barrel foundation`
  - verdict: `barrel0 is now the approved explosive barrel foundation target and the recorded checks passed.`

## Negative Control

Unsupported richer prompts still fail closed.

Example blocked prompt:

- `Add leaking explosive barrels that damage zombies and the player in a blast radius`

This remains blocked at prepare and does not start review or execution.

## Architectural Fit

This milestone reuses the existing bounded experimentation architecture:

- deterministic capability routing
- explicit review / approval
- state-aware execution
- saved proof/result surfaces
- fail-closed unsupported scope handling

It establishes the safe first layer for later barrel-family passes without pretending the full destructible combat vision already exists.
