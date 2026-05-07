---
project_key: babylon-2026
updated_at: 2026-05-07T18:27:21.457Z
session_id: phase7c-skip-task-session
status: generated_generation_budget_rules
tags:
  - second-brain
  - generation-budget
  - cinematic
  - obsidian-export
---

# Generation Budget Rules

> Generated read-only from AI-E second-brain memory. Do not edit here expecting machine memory to change.

## Budget Rules
- Max shots per batch remains a hard gate before provider handoff.
- Retry counts stay bounded to avoid hidden spend loops.
- Estimated sequence cost caps block overspend before approval is considered.
- Provider cooldowns apply only to explicit provider execution handoff attempts.

## Active Policy
- Max shots per batch: 8
- Max retries per job: 2
- Estimated budget cap: 220
- Provider cooldown minutes: 10
- Sandbox-only mode: enabled
- Manual approval required: yes

## Related
- [[Manual Approval Workflow]]
- [[Cost Forecast Examples]]
- [[Provider Payload Examples]]
