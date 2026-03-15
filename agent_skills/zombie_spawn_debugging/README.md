# Zombie Spawn Debugging Skill

## Problem Statement
Provide deterministic validation of zombie spawn systems, including prefab hookup, spawn volumes, death fades, and CI proof so regressions are caught before gameplay drops.

## Responsibilities
- Consume prefabs emitted by unity_prefab_authoring and wire them into spawn manifests or probe scenes.
- Execute spawn probes (DropZone routes, custom CI runners, or Unity test scenes) that walk spawn, aggro, death, and cleanup flows.
- Capture structured evidence (logs, JSON, screenshots) whenever a spawn mismatch or missing hook is detected.
- Feed issues back into AI-E orchestrator tasks so fixes can be prioritized.
