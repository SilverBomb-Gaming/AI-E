# Windows OpenClaw Operator Console v2.3 - Context Bridging Layer

## Checkpoint

This milestone adds an explicit, temporary context buffer layer to the Windows OpenClaw Operator Console stack so recent read-only results can be reused safely by later provider asks.

- context sources: `repo.status.read`, `file.read`, `web.fetch.read`
- context inspection: `/contexts`
- context-backed asks: `/asklast <prompt>`, `/askctx <id> <prompt>`
- context reset: `/clearcontext`
- trust model: explicit, bounded, per-chat, auditable, no hidden carryover

The capability stack still runs through the same control layers:

- manifest-backed capability registration and startup validation
- evaluator-driven gating and policy checks
- one-shot confirmation when online use requires approval
- structured execution request/result contracts
- scope validation before execution
- bounded in-memory audit recording

## Buffer Model

Context entries are lightweight, normalized, and intentionally bounded.

Each buffered context records:

- short context id such as `C1`
- source capability id
- source command
- creation and expiry timestamps
- scope type
- short source summary
- content kind and size class
- compact preview plus normalized bounded content
- per-chat and per-user ownership
- originating execution/request reference for auditability

The buffer does not store:

- secrets
- unbounded raw provider output
- full fetched page bodies
- full file contents when the source had to be trimmed

## How Context Is Created and Used

Successful or useful degraded reads now create context automatically:

- `/repo` creates a repo-summary context
- `/file <path>` creates a file-preview context
- `/web <url>` creates a web-preview context

Those contexts stay visible and explicit:

- `/contexts` lists recent context entries for the current chat
- `/asklast <prompt>` uses the most recent context in that chat
- `/askctx <id> <prompt>` uses a specific listed context
- `/clearcontext` removes the current chat buffer

Plain `/ask <prompt>` and `/askd <prompt>` remain unchanged and context-free.

## Prompt Construction Rules

Context-backed asks use a safe bounded formatter:

- source labels are included, such as `Source: file README.md`
- whitespace is normalized
- large prior results are trimmed before reuse
- context is capped to a safe prompt budget
- the user is told when prior context had to be trimmed to fit

This keeps reuse useful without introducing hidden memory, large prompt growth, or ambiguous carryover.

## Expiry and Clear Behavior

Context buffers are intentionally temporary:

- stored in memory only
- bounded to a small recent set per chat
- expired automatically after a short lifetime
- cleared explicitly with `/clearcontext`
- not shared across Telegram chats
- not persisted across app restarts

## Audit Behavior

Context operations are now auditable.

The audit layer records compact entries for:

- context creation
- context-backed ask execution
- invalid context references
- context buffer clearing

Audit summaries stay compact and do not include large raw context bodies.

## What Was Verified

Verified in repo-local tests and smoke runs:

- `/repo`, `/file`, and `/web` success paths create context entries
- failed commands do not create misleading context
- context store retention is bounded and separated per chat
- `/contexts` returns concise readable listings
- `/asklast` uses the newest context while plain `/ask` stays context-free
- `/askctx` resolves specific ids and fails clearly for invalid ids
- `/clearcontext` removes only the intended chat buffer
- audit summaries record create/use/clear behavior without leaking file contents or oversized payloads
- duplicate-safe Telegram loop behavior remains intact with the new commands

## Intentionally Not Added

Still out of scope in v2.3:

- hidden persistent memory
- autonomous context chaining
- cross-chat shared context
- background summarization jobs
- file or repo mutation
- web scraping workflows
- automatic plain-text-to-context ask routing
- multi-step workflow execution
