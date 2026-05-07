---
project_key: babylon-2026
updated_at: 2026-05-07T19:44:01.932Z
session_id: phase7c-skip-task-session
status: generated_local_vs_cloud_routing
tags:
  - second-brain
  - routing
  - local-cloud
  - obsidian-export
---

# Local-vs-Cloud Routing

> Generated read-only from AI-E second-brain memory. Do not edit here expecting machine memory to change.

## Local Routing Rules
- Prefer LocalFutureProvider only when runtime, model, and hardware checks pass for the requested shot profile.
- Fall back to offline-planning-mode or cloud provider comparison when local readiness is incomplete.
- High continuity or long-duration shots should prefer cloud review until local model support is explicitly profiled.

## Existing Global Routing Rules
- Offline planning and future local inference modes must remain provider-agnostic and avoid real API calls.
- Balanced comparison mode can use Veo or Runway stubs to compare provider-ready payloads without execution lock-in.

## Related
- [[Local Runtime Readiness]]
- [[Provider Routing Rules]]
- [[Provider Comparison Notes]]
