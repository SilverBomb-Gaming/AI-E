---
project_key: babylon-2026
updated_at: 2026-05-07T20:53:04.268Z
session_id: phase7c-skip-task-session
status: generated_local_runtime_readiness
tags:
  - second-brain
  - local-runtime
  - cinematic
  - obsidian-export
---

# Local Runtime Readiness

> Generated read-only from AI-E second-brain memory. Do not edit here expecting machine memory to change.

## Runtime Registry
- ComfyUI Local Video Lane: status=configured | family=comfyui | backends=cuda,directml | cache=yes
- Diffusers Python Pipeline: status=candidate | family=diffusers | backends=cuda,cpu | cache=yes

## Readiness Rules
- Local runtime detection remains advisory and must not launch external runtimes automatically.
- At least one configured or detected runtime, one profiled hardware target, and one candidate model must exist before local bridge review.
- Readiness reports must preserve sandbox-only mode until an operator explicitly authorizes a future local execution bridge.

## Related
- [[Local Model Registry]]
- [[Hardware Capability Planning]]
- [[Local-vs-Cloud Routing]]
