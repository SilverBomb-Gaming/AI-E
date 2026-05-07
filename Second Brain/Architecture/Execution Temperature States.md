---
project_key: babylon-2026
updated_at: 2026-05-07T20:53:04.268Z
session_id: phase7c-skip-task-session
status: generated_execution_temperature_states
tags:
  - second-brain
  - execution-temperature
  - warmup
  - cinematic
  - obsidian-export
---

# Execution Temperature States

> Generated read-only from AI-E second-brain memory. Do not edit here expecting machine memory to change.

## Temperature Summary
- Current state: simulated_only
- Transition count: 6

## Transitions
- cold: authority=authority-manual-operator-gate | reason=Execution begins from a cold non-executing state with inference and rendering disabled. | next=Runtime integrity sufficiency remains required even for dry warmup and frame-stage planning.
- warming: authority=authority-runtime-integrity-review | reason=Dry scheduler and pipeline warmup planning is simulated without loading a model or launching a runtime. | next=Frame-stage readiness must pass before any future reviewed warmup bridge is considered.
- staged: authority=authority-continuity-governor | reason=Frame-stage preparation and continuity state are staged for future reviewed single-frame preparation only. | next=Runtime integrity sufficiency remains required even for dry warmup and frame-stage planning.
- gated: authority=authority-manual-operator-gate | reason=Single-frame execution remains gated behind explicit approval and frame-stage readiness. | next=Runtime integrity sufficiency remains required even for dry warmup and frame-stage planning.
- blocked: authority=authority-manual-operator-gate | reason=Unsafe transitions remain blocked because frame-stage readiness and pre-inference gates are not fully satisfied. | next=Runtime integrity sufficiency remains required even for dry warmup and frame-stage planning.
- simulated_only: authority=authority-render-output-governor | reason=Execution temperature resolves to simulated_only while boundary partially_activated preserves hard non-executing limits. | next=reviewed-single-frame-execution-bridge

## Related
- [[Dry Inference Warmup]]
- [[Frame-Stage Readiness]]
- [[Future Bounded Execution Rules]]
