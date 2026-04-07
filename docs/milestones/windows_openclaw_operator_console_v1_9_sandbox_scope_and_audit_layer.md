# Windows OpenClaw Operator Console v1.9 - Sandbox, Scope & Audit Layer

This checkpoint turns trust boundaries into enforceable execution controls. The goal is not broader power. The goal is to ensure each capability runs only inside an explicit scope and leaves a bounded, reviewable audit trail.

## Scope Model Overview

Each execution request now carries a structured scope that can describe:

- scope type: `internal`, `filesystem`, `repository`, or `network`
- access mode: `read`, `write`, or `execute`
- bounded targets such as `allowed_paths`, `repo_root`, or `domain_allowlist`
- the specific requested target such as `target_path` or `target_domain`

Current capability use is intentionally narrow:

- `help.read`, `status.read`, `mode.read`, `audit.read`, and `capabilities.read` are `internal/read`
- `models.read` remains an operator-safe local read path and is not treated as arbitrary filesystem access
- `ask.provider_query` is `network/execute` and constrained to expected provider targets rather than arbitrary hosts

## Enforcement Rules

- capability manifests now declare scope expectations directly through manifest-backed scope fields
- the execution pipeline now runs: evaluation -> confirmation -> scope validation -> execution
- scope validation occurs before provider or action execution, so out-of-scope requests fail closed with a structured `out_of_scope` result
- manifest allowlists are authoritative; request-level scope data cannot widen a capability's allowed domains, paths, or repository root
- confirmation does not override scope restrictions

## Audit Model Overview

Every structured execution attempt now emits one bounded audit record. That includes:

- success
- blocked
- confirmation_required
- denied
- expired
- unavailable
- degraded
- failed
- timed_out
- invalid_request
- out_of_scope

Each audit record includes:

- `audit_id`
- `request_id`
- `capability_id`
- start/end timestamps
- outcome and reason code
- user/chat identity
- confirmation usage
- sanitized scope summary
- provider used when relevant
- duration
- high-level action summary

## What Is Logged vs Not Logged

Logged:

- capability id
- outcome and reason code
- short sanitized action summary
- scope classification summary
- provider used and duration when relevant

Intentionally not logged:

- secrets
- full prompts for provider asks
- raw provider payloads
- raw update JSON or stack-heavy dumps in user-facing summaries

Provider-backed asks are recorded with hidden-prompt summaries instead of the original prompt text.

## Telegram and UI Visibility

- `/audit` now returns a concise recent summary of capability executions and outcomes
- recent audit state is visible in the desktop shell through a compact status field
- recent execution summaries now also carry scope classification so the operator can see the last execution trust + scope context at a glance

## Allowed vs Denied Scope Examples

Allowed:

- `status.read` running as `internal/read`
- `ask.provider_query` targeting local Ollama on `127.0.0.1` or `localhost`
- `ask.provider_query` targeting the expected remote OpenAI host when online use is otherwise allowed

Denied:

- a provider query retargeted to an unrelated host outside the manifest allowlist
- any future repository or filesystem capability trying to run outside its declared root or allowed paths
- any action attempting to rely on confirmation to bypass scope restrictions

## Verified

- manifest-backed scope validation is enforced before capability execution
- out-of-scope provider requests are rejected before the provider adapter is called
- every execution result now produces an audit record, including blocked and out-of-scope outcomes
- `/audit` returns concise recent entries without exposing sensitive content
- desktop recent-result visibility now includes scope and recent-audit summaries
- bounded audit behavior, scope validation, out-of-scope blocking, and confirmation/scope preservation are covered by the controller test suite

## What This Enables Safely

- future file, repository, and web-read capabilities can be introduced with explicit scope boundaries instead of hidden assumptions
- stronger capabilities can be reviewed not only for trust boundary and confirmation sensitivity, but also for where they are allowed to act
- audit visibility now gives the operator a bounded trail of what the console attempted and why it succeeded or failed

## Not Added Yet

- persistent audit storage or export
- repository execution, file mutation, or arbitrary web-fetch powers
- large audit dashboards or permission-management UI
- any workflow, scheduling, scraping, RAG, or orchestration expansion
