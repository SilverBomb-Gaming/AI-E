# Windows OpenClaw Operator Console v1.4 - Interaction Reliability & Control Layer

This checkpoint hardens Telegram interaction behavior so the operator console stays predictable under ordinary use and light stress without broadening into automation, orchestration, or broader platform behavior.

## Verified

- Telegram command parsing now handles extra whitespace deterministically and accepts supported command casing consistently
- malformed Telegram slash commands now return a short correction instead of failing silently
- provider-backed asks now reject overlapping asks for the same Telegram chat instead of starting a second hidden provider call
- provider-backed asks now time out cleanly and return one bounded failure reply instead of hanging indefinitely
- provider-backed asks now use a narrow per-chat cooldown so rapid repeats do not flood replies or create confusing state drift
- `/status` now reports loop activity state in addition to runtime, diagnostics, readiness, mode, policy, and provider
- duplicate suppression, offset persistence, prompt-hidden activity summaries, and no-fallback behavior remain intact

## Reliability And Control Guarantees

- `/ask` and `/askd` remain explicit; plain text is still not auto-routed into provider-backed execution.
- Provider-backed asks use bounded execution windows and do not auto-retry in the background.
- Only one provider-backed ask is allowed at a time per Telegram chat under the current loop behavior.
- Rapid repeated provider-backed asks are rate-limited with a short clear user-facing message.
- Loop activity is visible as `Idle`, `Polling`, `Processing Command`, `Waiting On Provider`, `Timed Out`, `Provider Failed`, or `Sent Reply`.

## Not Implemented Yet

- streaming replies
- transcript-style chat UI
- automatic plain-text routing into `/ask`
- automation, scheduling, scraping, RAG, or repo-mutation commands
- Discord, Slack, WhatsApp, or any other channel expansion
- remote approval workflows or broader task orchestration
