---
project_key: babylon-2026
updated_at: 2026-05-07T20:26:31.842Z
session_id: phase7c-skip-task-session
status: generated_controlled_runtime_profiles
tags:
  - second-brain
  - runtime-profiles
  - bootstrap
  - cinematic
  - obsidian-export
---

# Controlled Runtime Profiles

> Generated read-only from AI-E second-brain memory. Do not edit here expecting machine memory to change.

## Profiles
- Low VRAM Safe: viable=yes | mode=offline-planning-mode
- Offline Safe: viable=yes | mode=offline-planning-mode
- Continuity Priority: viable=yes | mode=future-local-inference-mode
- Cloud Hybrid Safe: viable=yes | mode=balanced-comparison-mode
- CPU Fallback Safe: viable=yes | mode=offline-planning-mode

## Profile Notes
- low_vram_safe: Keep VRAM reservation dry only.
- low_vram_safe: Do not promote beyond dry initialization while VRAM blockers remain.
- offline_safe: No network dependency should be introduced.
- offline_safe: Execution remains blocked even if bootstrap checks pass.
- continuity_priority: Continuity blockers override speed optimizations.
- continuity_priority: Rendering remains disabled until continuity-safe activation is reviewed.
- cloud_hybrid_safe: Hybrid planning must remain advisory only.
- cloud_hybrid_safe: Do not bypass local governance or approval flow.
- cpu_fallback_safe: CPU fallback is planning-only for this layer.
- cpu_fallback_safe: No inference or rendering may start from the fallback profile.

## Related
- [[Activation Readiness Scoring]]
- [[Runtime Integrity Validation]]
- [[Execution Boundary Status]]
