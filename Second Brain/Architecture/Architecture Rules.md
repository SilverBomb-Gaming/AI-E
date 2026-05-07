---
project_key: multi-project
updated_at: 2026-05-07T13:43:39.456Z
session_id: phase7c-skip-task-session
status: generated_read_only_rules
tags:
  - second-brain
  - architecture
  - rules
  - obsidian-export
---

# Architecture Rules

> Generated read-only from AI-E second-brain memory. Do not edit here expecting machine memory to change.

## Ownership Rules
- SimpleWaveController owns timing, wave progression, and countdown/recovery pacing only.
- SimpleEnemySpawner owns enemy creation and alive-count tracking only.
- SimpleEnemy owns enemy health, death, and visuals only.
- SimpleEnemyPursuit owns movement, obstacle steering, and crowd separation only.
- SimpleEnemyAttack owns enemy attack timing and damage only.
- PlayerHealth owns player health, death, HUD, and restart only.
- WeaponPrototype owns firing, hit detection, and weapon HUD only.
- ControlBaselineController owns controls, camera, pause, and runtime player setup only.

## Project Constraints
- Keep BABYLON 2026 deterministic, local, and bounded; no endless loops, navmesh, giant managers, or fake intelligence layers.
- For AI-E autonomy work, preserve approval gates and avoid unvalidated autonomous mutation loops.

## BABYLON 2026 Clean Architecture Rules
- Make the smallest possible owner-local change and validate immediately.
- Prefer deterministic spawn/layout and bounded wave logic over generalized systems.
- Keep runtime fixes reversible and tied to a known owner.

## Related
- [[BABYLON 2026]]
- [[AI-E]]
- [[Old BABYLON Anti-Patterns]]
