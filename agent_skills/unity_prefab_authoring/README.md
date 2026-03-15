# Unity Prefab Authoring Skill

## Problem Statement
Design-time automation that inspects imported 3D model assets, validates that geometry + rigs are usable, creates a prefab scaffold, and emits auditable artifacts so gameplay teams can integrate enemies without guesswork.

## Responsibilities
- Normalize and verify source + animation asset paths coming from Meshy, Blender, or DCC exports.
- Run workload 0024 to instantiate the prefab shell, attach required components (Animator, Health, metadata scripts), and save the prefab to the target path.
- Record mesh, clip, and rig diagnostics inside `zombie_prefab_creation.json` (or equivalent artifact) so CI can prove what was detected.
- Handoff to preview probes (0025) and downstream gameplay validation once prefab creation succeeds.
