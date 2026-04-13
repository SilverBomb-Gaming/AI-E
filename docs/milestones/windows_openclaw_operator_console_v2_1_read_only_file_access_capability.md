# Windows OpenClaw Operator Console v2.1 - Read-Only File Access Capability

This checkpoint extends the verified repo-insight baseline with the second real external capability. The goal is not broader filesystem tooling. The goal is to prove that scoped file inspection can enter through the same manifest, evaluator, confirmation, execution-contract, scope, and audit layers without weakening trust.

## Capability Definition

New capability:

- `file.read`

Manifest trust boundary:

- access kind: `read_only`
- locality: `local_only`
- data scope: `file_system`
- offline safety: `safe_offline`
- confirmation sensitivity: `never`
- Telegram exposure: `allowed`
- scope type: `filesystem`
- access mode: `read`
- runtime requirement: `false`
- readiness requirement: `true`

## Scope Model

- the capability is bound to one or more configured absolute `file_allowed_roots`
- v2.1 defaults those roots to the configured repo root unless the config explicitly overrides them
- execution scope is `filesystem/read`
- Telegram accepts only `/file <relative_path>` and does not accept arbitrary absolute paths
- scope validation normalizes candidate paths, rejects traversal attempts, and blocks anything outside the configured roots before execution

Examples:

- allowed root: `E:\AI projects 2025\AI-E`
- allowed request: `/file app/controller/app_service.py`
- denied request: `/file ../secret.txt`
- denied request: `/file C:\Windows\system32\drivers\etc\hosts`

## Safe File Reader

`file_reader.py` now performs bounded, read-only text preview loading only:

- supported text-oriented file types such as `.py`, `.md`, `.txt`, `.json`, `.toml`, `.yaml`, `.ps1`, `.ts`, `.tsx`, `.css`, `.html`, and similar safe text extensions
- UTF-8 text decoding with a safe preview head read
- bounded preview size and line count
- large text files return a truncated preview instead of a full dump

Explicitly not supported:

- write, delete, rename, or execute operations
- directory listing or recursive browsing
- binary dumping
- shell passthrough
- arbitrary absolute path access

## Telegram UX

New command:

- `/file <relative_path>`

Telegram-friendly response shape:

- file path
- compact size label
- bounded preview text
- truncation note when the preview is capped for safety

User-facing failures remain short and actionable:

- `File not found in allowed scope`
- `File is outside allowed directories`
- `File type not supported for safe display`
- `Use /file <relative_path> inside the allowed directories`

## Audit Behavior

Every `file.read` attempt now creates an audit record, including:

- `capability_id`
- outcome
- reason code
- confirmation usage flag
- sanitized scope summary such as `filesystem/read target=path`
- compact action summary such as `app/controller/app_service.py | 18.4 KB`
- duration

Intentionally not logged:

- full file contents
- raw file bytes
- arbitrary prompt payloads
- secrets

## Desktop Observability

The desktop shell now shows compact file-access state:

- configured allowed file roots
- last file preview target
- last file preview status
- last file preview timestamp

This reuses the existing status panel instead of adding a new file browser surface.

## Verified

- `file.read` is registry-backed and trust-classified as read-only local filesystem access
- file scope validation runs before file reading
- traversal and absolute-path requests are rejected cleanly
- unsupported/binary files are rejected with safe failure messages
- large text files return truncated previews instead of full dumps
- `/file` returns a concise Telegram-safe preview
- every file execution attempt produces an audit record without content leakage
- controller config now persists `file_allowed_roots`
- file access is covered by dedicated file-reader and file-capability tests

## What This Enables Safely

- repo-level status can now be followed by tightly bounded file inspection without widening the trust model
- future scoped search, line-oriented preview, or repo/file detail capabilities can reuse the same filesystem scope vocabulary
- audit and desktop visibility now cover repository state plus bounded file preview activity

## Not Added Yet

- file mutation
- directory browsing
- recursive search
- full file dumps
- repo mutation
- arbitrary shell or git execution
- automation, workflows, scraping, RAG, or orchestration expansion
