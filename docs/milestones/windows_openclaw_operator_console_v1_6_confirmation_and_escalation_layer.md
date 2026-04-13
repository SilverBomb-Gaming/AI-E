# Windows OpenClaw Operator Console v1.6 - Confirmation & Escalation Layer

This checkpoint adds the first explicit one-shot approval path for capabilities that are not directly allowed but can run with operator confirmation. The goal is not to add broader powers; it is to make online-sensitive execution explicit, reviewable, and single-use.

## Verified

- capability evaluation now supports `confirmation_required` as a first-class outcome instead of forcing online-sensitive asks into ad hoc blocking logic
- online-sensitive `/ask` and `/askd` requests under `ask_before_online` now create a pending confirmation instead of executing immediately
- Telegram now supports `/confirm <id>` and `/deny <id>` for the same chat that requested the action
- pending confirmations are short-lived, expire automatically, and cannot be reused once approved or rejected
- confirmation execution remains gated by current runtime state, readiness, provider validity, and policy; it does not bypass existing guardrails
- the desktop shell now shows pending confirmation count plus the most recent confirmation request/result summary

## Pending Action Lifecycle

- a pending confirmation records the capability id, original command, safe argument summary, requester/chat identity, creation time, expiry time, and a small evaluation-context snapshot
- pending confirmations live only in runtime memory for v1.6; they are cleaned up lazily as new snapshots or confirmation commands are processed
- `/confirm <id>` marks the confirmation approved, re-evaluates the capability with confirmation context, and executes at most once
- `/deny <id>` marks the confirmation rejected and returns a short acknowledgement without executing anything
- expired confirmations return a clear failure message and must be recreated by sending the original command again

## Telegram UX Examples

- `/ask hello` while `selected_mode=online`, `current_mode=offline`, and `policy=ask_before_online` now returns a short confirmation prompt with an id and `Reply with: /confirm <id> or /deny <id>`
- `/confirm <id>` executes the original provider-backed ask only if runtime, readiness, policy, and provider state are still valid
- `/deny <id>` rejects the pending action cleanly
- invalid, expired, wrong-chat, or already-used confirmation ids return short deterministic guidance instead of silent failure

## Safety Guarantees

- no silent escalation from offline to online execution
- no hidden policy override for `always_offline`
- no confirmation replay or duplicate execution
- no provider fallback or mode switching during confirmation execution
- no secret leakage in confirmation prompts, loop summaries, or logs

## Not Included Yet

- persistent confirmation storage across process restarts
- bulk approval, role systems, saved approval rules, or policy editors
- broader capability expansion such as file access, repo execution, fetch, scraping, or orchestration
- a full approval dashboard; v1.6 keeps observability lightweight on purpose
