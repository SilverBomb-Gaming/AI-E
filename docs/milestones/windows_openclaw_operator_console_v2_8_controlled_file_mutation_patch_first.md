# Windows OpenClaw Operator Console v2.8 - Controlled File Mutation (Patch-First)

v2.8 adds two narrow Telegram mutation surfaces without changing the controller architecture:

- `/patchfile <path>` applies bounded `@@ FIND` / `@@ REPLACE` text replacements to one existing UTF-8 text file inside configured file roots.
- `/writefile <path>` replaces one existing UTF-8 text file from an explicit `@@ CONTENT` block.

Guardrails preserved in this milestone:

- capability manifests define `file.patch.write` and `file.write.replace`
- evaluator requires explicit confirmation before Telegram mutation runs
- filesystem scope validation still enforces configured allowed roots
- direct shell editing is not exposed
- protected control directories and unsupported file types are rejected
- stale base hashes fail closed instead of silently overwriting newer content
- confirmation remains one-shot and exact-once
- audit summaries stay compact and path-focused

This milestone is intentionally patch-first and bounded. It does not introduce open-ended repo mutation, autonomous editing, retries, or bypass paths around confirmation, scope, or audit.