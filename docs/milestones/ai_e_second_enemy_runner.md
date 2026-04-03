# AI-E Second Supported Enemy Archetype

## Selected Enemy

Runner

## Why Runner Was Chosen

Runner is the best second bounded archetype for AI-E in BABYLON because it already fits the existing deterministic experimentation architecture with the least implementation friction.

- BABYLON already contains a deterministic runner bootstrap path through `DeterministicEnemyProfileBootstrap`.
- The runner reuses the existing zombie prefab and enemy AI surface instead of requiring a new prefab, controller, or mutation lane.
- The archetype is gameplay-distinct from zombie: it is a faster chase-oriented profile with a tighter baseline attack cooldown.
- The existing mutation probes for speed and aggression already map cleanly onto the runner profile with explicit bounded tiers.
- Restore-to-standard flows remain deterministic because the runner has a defined baseline profile.

## Supported Tier Model

- Speed tiers:
  - `slow` = `3.5`
  - `standard` = `4.5`
  - `fast` = `5.0`
- Aggression tiers:
  - `standard` = `0.8`
  - `aggressive` = `0.5`

## Supported Direct Prompts

- `make runner faster`
- `make runner slower`
- `restore runner speed to standard`
- `make runner more aggressive`
- `restore runner aggression to standard`

## Supported Goal Prompts

- `make runner more dangerous`
- `make runner more intense`
- `make runner easier`
- `make runner less dangerous`

## Supported Plan Flows

- `make runner faster and more aggressive`
- `restore runner danger to standard`

These resolve through the existing bounded predefined-plan path with sandbox-first execution, ordered steps, proof, deterministic evaluation, and current-session experiment tracking.

## Current Safety Boundary

- Runner support is explicit and named. Once both `zombie` and `runner` are supported, generic `enemy` and `character` prompts are blocked until the user names the supported target explicitly so AI-E does not guess between two bounded archetypes.
- Runner currently participates in:
  - deterministic speed/aggression capabilities
  - bounded goal-intent mapping
  - session-aware follow-up and revert
  - deterministic evaluation
  - experiment tracking
  - experiment decision tracking
- Runner does not yet have a separate bounded movement-variation plan because BABYLON currently exposes a clean runner combat-profile surface, not a distinct runner transform-variation route.
