# AI-E Generic Capability Model

## Purpose

AI-E now uses a portable internal capability schema so bounded tuning can be described in reusable system terms while preserving current user-facing prompts and deterministic execution behavior.

This layer is additive. Zombie, runner, encounter, racer, and future platformer prompts remain supported through the same bounded runtime paths.

## Schema Fields

- `target_context`: current bounded gameplay context such as `zombie`, `runner`, `encounter`, `racer`, or `platformer`
- `target_system`: reusable gameplay system such as `movement`, `combat`, `encounter`, or `physics`
- `parameter_family`: grouped family name such as `speed`, `aggression`, `spawn_count`, `spawn_interval`, `jump_height`, or `gravity`
- `parameter_name`: canonical parameter key used in deterministic comparison and evaluation output
- `bounded_tiers`: allowed bounded symbolic states in order
- `deterministic_values`: exact numeric values for each bounded tier
- `restore_standard_behavior`: the direct bounded prompt that restores the standard tier
- `evaluation_dimension`: stable internal label for deterministic evaluation
- `source_family`: current domain-family field used by existing runtime contracts

## Current Mapped Domains

### Enemy Tuning

- `zombie` + `speed` -> `movement / speed / speed`
- `zombie` + `aggression` -> `combat / aggression / aggression`
- `runner` + `speed` -> `movement / speed / speed`
- `runner` + `aggression` -> `combat / aggression / aggression`

### Encounter Tuning

- `encounter` + `encounter_count` -> `encounter / spawn_count / spawn_count`
- `encounter` + `spawn_pressure` -> `encounter / spawn_interval / spawn_interval`

### Racing

- `racer` + `acceleration` -> `movement / acceleration / acceleration`
- `racer` + `max_speed` -> `movement / max_speed / max_speed`

### Platformer

- `platformer` + `jump_height` -> `movement / jump_height / jump_height`
- `platformer` + `gravity` -> `physics / gravity / gravity`
- `platformer` + `speed` -> `movement / speed / speed`

## Consistency Rules For Current Domains

- Enemy movement speed must stay represented as `target_system=movement`, `parameter_family=speed`, `parameter_name=speed`.
- Enemy aggression must stay represented as `target_system=combat`, `parameter_family=aggression`, `parameter_name=aggression`.
- Encounter count must stay represented as `target_system=encounter`, `parameter_family=spawn_count`, `parameter_name=spawn_count`.
- Encounter spawn pressure must stay represented as `target_system=encounter`, `parameter_family=spawn_interval`, `parameter_name=spawn_interval`.
- Racer acceleration and max speed must stay represented as movement capabilities.
- Platformer jump height and speed must stay represented as movement capabilities.
- Platformer gravity must stay represented as a physics capability.

## Adding A New Domain

1. Add a bounded context profile module with:
   - context detection
   - tier values
   - direct restore prompts
2. Add capability contracts for each bounded family.
3. Register the context in `tuning_contexts.py`.
4. Add generic mappings in `generic_capabilities.py`.
5. Extend session/evaluation/experiment metadata only where needed to persist deterministic state.
6. Reuse existing review, decision, navigation, and comparison surfaces.
7. Add direct prompt, evaluation, experiment, and backward-compatibility tests.

## Backward Compatibility Rules

- Do not remove or rename existing user-facing prompts unless all call sites and contracts migrate together.
- Do not broaden ambiguity inference.
- Do not add recommendation or ranking behavior.
- Keep evaluation output deterministic and bounded.
- New domains must use the same experiment tracking, decision flow, navigation, and comparison stack.
- Prefer additive metadata over payload shape redesign.

## Explicit Migration Boundaries

The following must not change without an explicit migration plan that updates contracts, stored session state assumptions, evaluation consumers, and tests together:

- schema field names in the generic capability payload
- current mapped domain-to-family assignments
- restore-standard prompt strings used by bounded follow-up/revert flows
- deterministic tier ordering for existing domains
- evaluation-dimension labels consumed by deterministic comparison logic
- persisted experiment variant keys that store generic capability state

## Portability Rule

The generic capability layer exists to normalize bounded gameplay changes, not to make AI-E infer new domains automatically. Explicit prompts and explicit capability contracts remain the source of truth.