# Windows OpenClaw Operator Console v1.7 - Capability Execution Contracts

This checkpoint standardizes how capabilities execute after they have already been identified and gated. The goal is not to add broader powers; it is to make execution itself predictable, structured, and reusable for future operator-console capabilities.

## Contract Overview

- every Telegram capability execution now creates a structured execution request with a request id, source, requester/chat identity, original command, parsed arguments, invocation timestamp, mode/policy snapshot, provider snapshot, readiness snapshot, and optional confirmation context
- every execution now returns one structured execution result with an outcome, reason code, user-facing message, sanitized internal summary, timestamps, duration, confirmation usage, provider/mode usage, retryability, degraded state, and a small telemetry bag
- Telegram replies, desktop result visibility, and loop summaries now derive from that structured execution result instead of being assembled independently in scattered command branches

## Standardized Outcomes

The execution layer now normalizes current operator-console capability results into a small shared outcome set:

- `success`
- `blocked`
- `confirmation_required`
- `denied`
- `expired`
- `unavailable`
- `degraded`
- `failed`
- `timed_out`
- `invalid_request`

These outcomes are used across read commands, provider-backed asks, and confirmation flows so the operator console can surface clearer, more predictable behavior in both success and failure states.

## Verified

- `status.read`, `mode.read`, `models.read`, `capabilities.read`, and `ask.provider_query` now execute through one contract-driven executor layer
- provider-backed asks now return structured success, blocked, unavailable, failed, timed-out, or confirmation-required results instead of relying on ad hoc reply strings alone
- `/confirm <id>` and `/deny <id>` now produce structured approval, denial, expiry, and invalid-request results while preserving one-shot confirmation guarantees
- the desktop shell now exposes recent execution outcome, reason code, summary, duration, and finish time from the structured execution result
- Telegram replies remain concise, mobile-readable, and duplicate-safe because the loop still emits one final reply derived from one structured result

## What This Enables Safely

- future capabilities can plug into one execution seam after evaluation and confirmation instead of rebuilding request/result handling from scratch
- structured result fields now provide a clean foundation for later desktop polish, richer operator history, or safer diagnostics without changing the trust model
- standardized failure mapping now makes provider, policy, timeout, and invalid-request behavior easier to extend without drifting into inconsistent reply wording

## Not Added Yet

- new broad capabilities such as file access, repo execution, fetch, scraping, or orchestration
- a large execution dashboard, analytics pipeline, or persistent job queue
- workflow engines, agent routing, or automation systems
- persistent confirmation or execution history beyond the current operator-console state surfaces
