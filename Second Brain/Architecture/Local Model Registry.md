---
project_key: babylon-2026
updated_at: 2026-05-07T20:05:21.785Z
session_id: phase7c-skip-task-session
status: generated_local_model_registry
tags:
  - second-brain
  - local-models
  - cinematic
  - obsidian-export
---

# Local Model Registry

> Generated read-only from AI-E second-brain memory. Do not edit here expecting machine memory to change.

## Registered Local Candidates
- Wan 2.1 Text-to-Video Q8: status=candidate | mode=text-to-video | resolutions=720p,1080p | duration<=6s | continuity=partial | vram>=12GB
- LTX Video Image-to-Video INT8: status=candidate | mode=image-to-video | resolutions=720p,1080p | duration<=8s | continuity=limited | vram>=10GB
- Hunyuan Video 13B Planned Slot: status=download-planned | mode=text-to-video | resolutions=720p | duration<=5s | continuity=partial | vram>=16GB

## Quantization And Storage
- wan-2.1-t2v-q8: quantization=q8,q6 | storage>=28GB
- ltx-video-img2vid-int8: quantization=int8,fp16 | storage>=24GB
- hunyuan-video-13b-planned: quantization=fp16 | storage>=42GB

## Related
- [[Local Runtime Readiness]]
- [[Hardware Capability Planning]]
- [[Future Local Inference Notes]]
