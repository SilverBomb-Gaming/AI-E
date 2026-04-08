# Windows OpenClaw Operator Console v2.5 - Bounded Web Fetch Capability

## Checkpoint

This milestone advances the bounded public-web read surface on top of the verified controller stack so the read-only information triangle is explicit across:

- repository
- file
- web

The shipped capability is:

- capability: `web.fetch.read`
- Telegram command: `/web <url>`
- trust model: read-only, allowlisted, confirmation-aware, bounded, auditable, no browser automation

The capability still runs through the full control stack:

- manifest-backed registration and validation
- evaluator-driven readiness, mode, and policy gating
- one-shot confirmation where policy requires it
- structured execution request/result contracts
- network scope enforcement before execution
- bounded audit recording
- explicit context bridging with Option A semantics

## Capability Definition

Manifest definition:

- capability id: `web.fetch.read`
- access kind: `read_only`
- locality: `networked`
- data scope: `web`
- offline safety: `requires_online`
- confirmation sensitivity: `policy_based`
- Telegram exposure: `allowed`
- requires runtime: `false`
- requires readiness: `true`
- scope type: `network`
- access mode: `read`
- configured scope binding: `web_allowed_domains`

Operational constraints:

- GET only
- no POST, PUT, PATCH, or DELETE
- no browser automation
- no login or session handling
- no cookie persistence
- no file downloads
- no script execution
- no open-ended crawling

## Allowlist and Domain Scope Model

Configured web scope is explicit and deterministic.

Configuration:

- config field: `web_allowed_domains`
- normalized hostname matching
- exact host support such as `docs.openclaw.ai`
- optional wildcard-subdomain support such as `*.ollama.com`

Behavior:

- only configured allowlisted domains may be fetched
- malformed URLs fail clearly before execution
- unsupported schemes fail clearly before execution
- `https://` is preferred; `http://` remains explicit and conservative rather than silently upgraded or expanded
- Telegram cannot use arbitrary domains outside the configured allowlist

Allowed examples:

- `https://docs.openclaw.ai/`
- `https://platform.openai.com/docs`
- `https://ollama.com/library`

Denied examples:

- `https://evil.example/`
- `ftp://platform.openai.com/spec`
- malformed URLs such as missing hosts or unsupported schemes
- redirect chains that leave the configured allowlist

## Scope Enforcement

The network scope validator preserves the trust boundary for web reads.

It enforces:

- `scope_type: network`
- normalized target-domain matching against the configured allowlist
- structured out-of-scope results when the target is not allowed

The execution path also preserves URL-level validation ahead of the scope check, so unsupported schemes and malformed targets fail clearly before any outbound read is attempted.

Redirect handling remains bounded:

- short redirect chains only
- redirects may continue only when the destination remains inside the allowlist
- redirect escape attempts are blocked and audited

## Timeout, Size, and Content Rules

Fetch execution remains bounded.

Limits enforced in this milestone:

- fixed request timeout
- max response-body size
- max preview character budget
- max preview line budget

Supported content types:

- `text/plain`
- `text/html`
- `text/markdown`
- `application/json`

Rejected content types:

- binary payloads
- images
- archives
- downloads
- large unknown content
- unsupported text formats outside the narrow allowlist

Preview behavior:

- HTML is reduced to readable text
- JSON is compacted into a key-aware summary
- markdown is treated as bounded plain text
- unsupported content types return a short safe error
- oversized responses are truncated clearly
- giant body dumps are never sent to Telegram or audit output

## Confirmation and Policy Behavior

`web.fetch.read` remains online-sensitive and preserves the existing policy model.

Behavior by policy:

- `always_offline`: blocked
- `ask_before_online`: confirmation required when remote execution needs approval
- `always_online`: allowed when readiness and scope are valid

Confirmation rules remain strict:

- confirmation is one-shot
- confirmation is auditable
- confirmation does not override out-of-scope domains
- confirmation does not override invalid URL parsing, readiness failures, or `always_offline`

## Execution Contract and Reply Shape

Successful web execution returns a compact user-visible preview including:

- fetched domain
- content type
- sanitized URL
- concise preview text
- truncation note when needed
- allowed-redirect note when applicable

Internal result telemetry remains bounded and includes:

- sanitized URL and domain summary
- content type
- size bytes, size label, and size category
- duration through the execution result contract
- scope and trust metadata

## Context Bridging

Web previews participate in the explicit context buffer layer.

Successful `/web` requests create `web_preview` context entries that are:

- visible through `/contexts`
- reusable through `/asklast` and `/askctx`
- bounded per chat
- stored in memory only
- visible after they become stale or expired
- blocked from reuse once expired

Option A semantics remain unchanged:

- active contexts are reusable normally
- stale contexts remain reusable with warning state
- expired contexts remain visible but are blocked from reuse
- truncation state and web source type remain visible in metadata

## Audit Behavior

Each `web.fetch.read` execution creates a bounded audit record.

Recorded audit data includes:

- capability id
- outcome
- reason code
- scope summary
- sanitized domain and URL summary
- content type
- size category
- duration

Audit intentionally excludes:

- full page bodies
- raw HTML dumps
- sensitive query-string values
- cookies or session data

## Allowed vs Not Allowed

Allowed:

- public bounded preview of allowlisted documentation or JSON endpoints
- same-domain or allowlisted redirect handling within limits
- explicit creation of reusable web context from a successful bounded preview

Not allowed:

- browser automation
- scraping workflows
- DOM querying tools
- multi-page crawl
- file downloads
- login or cookies
- session persistence
- posting data to remote services

## What Was Verified

Verified in focused repo-local tests:

- valid allowlisted URL success path
- malformed URL rejection
- unsupported scheme rejection
- disallowed domain rejection before fetch
- redirect escape blocking
- supported HTML, markdown, plain-text, and JSON previews
- unsupported content-type rejection
- oversized response truncation
- structured success, timeout, invalid-request, and out-of-scope outcomes
- policy-aware confirmation behavior for `/web`
- confirmation cannot override web scope restrictions
- audit summaries remain sanitized and bounded
- successful `/web` creates explicit web context entries

## Intentionally Not Added

Still out of scope in v2.5:

- scraping workflows
- browser rendering or screenshots
- login/session handling
- file downloads
- form submission
- search engine integration
- open-ended browsing
- workflow automation