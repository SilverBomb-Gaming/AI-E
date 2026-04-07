# Windows OpenClaw Operator Console v1.5 - Controlled Capability Layer

This checkpoint introduces the first explicit capability-control architecture for the Windows OpenClaw operator console. It does not broaden the system into new execution domains; it makes existing command behavior governable, inspectable, and safer to extend.

## Verified

- a central capability registry now declares the current operator-console actions in one place instead of leaving execution rules scattered across Telegram handlers
- capability evaluation now returns deterministic `allowed`, `blocked`, `degraded`, `confirmation_required`, or `unavailable` state with stable reason codes and short operator-facing messages
- `/status`, `/mode`, `/models`, `/ask <prompt>`, and `/askd <prompt>` now flow through capability evaluation before provider-aware work runs
- `/capabilities` now returns a concise Telegram-friendly summary of key current capabilities and their gate state
- the desktop status panel now shows the most recent evaluated capability id, state, and summary note
- existing trust guarantees remain intact: offline-first behavior, no silent provider fallback, no hidden mode escalation, duplicate-safe polling, and trusted diagnostics

## Capability Guarantees

- A capability in this project is a named action with explicit metadata for provider dependency, network requirement, readiness requirement, mode constraints, and policy sensitivity.
- Capability evaluation consumes current mode, current policy, readiness, runtime state, and provider validation before execution proceeds.
- Read-only commands remain explicitly declared capabilities even when they are broadly available.
- Provider-backed asks still fail clearly when runtime, readiness, policy, or provider state blocks them; v1.5 centralizes those decisions instead of changing their trust model.
- `/capabilities` is introspection only. It reports current state and does not grant or mutate permissions.

## Future Work Enabled Safely

- clearer desktop and Telegram approval UX for online-sensitive actions
- future capability-backed extensions such as repo inspection, bounded file reads, or remote fetch only after they are explicitly registered and evaluated
- a single deterministic control seam for future operator-surface features instead of ad hoc conditional growth

## Not Implemented Yet

- new execution powers such as file mutation, repo commands, web fetch, scraping, or scheduling
- automation, RAG, orchestration, or AI-E autonomous behavior
- a large permissions dashboard or policy editor
- implicit natural-language action routing or hidden approval flows
