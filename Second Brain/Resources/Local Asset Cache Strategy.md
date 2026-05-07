---
project_key: babylon-2026
updated_at: 2026-05-07T20:38:37.338Z
session_id: phase7c-skip-task-session
status: generated_local_asset_cache_strategy
tags:
  - second-brain
  - local-cache
  - cinematic
  - obsidian-export
---

# Local Asset Cache Strategy

> Generated read-only from AI-E second-brain memory. Do not edit here expecting machine memory to change.

## Cache Strategy
- Cache model weights and VAE assets separately from generated outputs.
- Store reusable reference frames and conditioning assets with deterministic fingerprints.
- Treat local cache eviction as an operator-reviewed storage decision, not an automatic background process.

## Runtime Support
- ComfyUI Local Video Lane: asset cache supported
- Diffusers Python Pipeline: asset cache supported

## Related
- [[Hardware Capability Planning]]
- [[Future Local Inference Notes]]
- [[Asset Reuse Decisions]]
