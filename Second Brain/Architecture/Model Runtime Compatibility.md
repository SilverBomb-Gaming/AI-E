---
project_key: babylon-2026
updated_at: 2026-05-07T19:44:01.932Z
session_id: phase7c-skip-task-session
status: generated_model_runtime_compatibility
tags:
  - second-brain
  - compatibility
  - runtime
  - cinematic
  - obsidian-export
---

# Model Runtime Compatibility

> Generated read-only from AI-E second-brain memory. Do not edit here expecting machine memory to change.

## Compatibility Summary
- Valid: no
- Preferred loader: loader-wan-2.1-t2v-q8
- Fallback runtime: diffusers-python-pipeline

## Compatibility Issues
- loader-wan-2.1-t2v-q8: missing-dependencies | Wan 2.1 Text-to-Video Q8 is missing at least one dependency signal.
- loader-ltx-video-img2vid-int8: model-runtime-mismatch | LTX Video Image-to-Video INT8 does not match the preferred runtime backend.
- loader-ltx-video-img2vid-int8: missing-dependencies | LTX Video Image-to-Video INT8 is missing at least one dependency signal.
- loader-ltx-video-img2vid-int8: unsupported-continuity-mode | LTX Video Image-to-Video INT8 is not suitable for high continuity planning.
- loader-hunyuan-video-13b-planned: insufficient-vram | Hunyuan Video 13B Planned Slot needs 16GB VRAM but only 12GB is profiled.
- loader-hunyuan-video-13b-planned: missing-dependencies | Hunyuan Video 13B Planned Slot is missing at least one dependency signal.
- loader-hunyuan-video-13b-planned: unsupported-duration | Hunyuan Video 13B Planned Slot only supports 5s.
- loader-hunyuan-video-13b-planned: unsupported-resolution | Hunyuan Video 13B Planned Slot does not support 1080p.

## Related
- [[Local Model Loader Registry]]
- [[Runtime Activation Simulation]]
- [[Activation Failure Recovery]]
