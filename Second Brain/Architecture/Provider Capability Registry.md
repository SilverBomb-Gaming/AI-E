---
project_key: babylon-2026
updated_at: 2026-05-07T19:44:01.932Z
session_id: phase7c-skip-task-session
status: generated_provider_capability_registry
tags:
  - second-brain
  - provider-capabilities
  - cinematic
  - obsidian-export
---

# Provider Capability Registry

> Generated read-only from AI-E second-brain memory. Do not edit here expecting machine memory to change.

## Provider Capabilities
- Sora: duration<=20s | prompt<=4000 chars | refs<=4 | continuity=full | queue=Premium queue with slower turnaround but higher fidelity.
- Seedance: duration<=8s | prompt<=1800 chars | refs<=2 | continuity=partial | queue=Fast draft queue optimized for storyboard-grade passes.
- Runway: duration<=10s | prompt<=2200 chars | refs<=3 | continuity=partial | queue=Shared queue with balanced latency and comparison-friendly payloads.
- Veo: duration<=12s | prompt<=3200 chars | refs<=5 | continuity=full | queue=Balanced premium queue for comparison-grade cinematic passes.
- LocalFutureProvider: duration<=16s | prompt<=5000 chars | refs<=4 | continuity=limited | queue=Offline local queue reserved for future generator-agnostic bridge validation.

## Retry Guidance
- Sora: Prefer one targeted retry after continuity simplification.
- Seedance: Use one cheap retry before escalating to a premium provider.
- Runway: Retry once with fewer references if validation pressure is high.
- Veo: Allow up to two targeted retries when continuity context remains stable.
- LocalFutureProvider: Use only after provider payloads are validated and manual approval is explicit.

## Related
- [[Provider Routing Rules]]
- [[Prompt Normalization Rules]]
- [[Provider Payload Examples]]
