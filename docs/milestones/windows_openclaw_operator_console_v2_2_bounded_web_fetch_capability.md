# Windows OpenClaw Operator Console v2.2 - Bounded Web Fetch Capability

## Checkpoint

This milestone adds the first bounded network-read capability to the Windows OpenClaw Operator Console stack:

- capability: `web.fetch.read`
- Telegram command: `/web <url>`
- trust model: read-only, allowlisted, audited, confirmation-aware, no browser automation

The capability now runs through the existing control stack:

- manifest-backed registration and startup validation
- evaluator-driven gating and policy checks
- one-shot confirmation when online use requires approval
- structured execution request/result contracts
- scope validation before execution
- bounded in-memory audit recording

## Capability Definition

Manifest summary:

- capability id: `web.fetch.read`
- access kind: `read_only`
- locality: `networked`
- data scope: `web`
- offline safety: `requires_online`
- confirmation sensitivity: `policy_based`
- Telegram exposure: `allowed`
- scope type: `network`
- access mode: `read`
- configured scope binding: `web_allowed_domains`

Operational constraints:

- GET only
- no POST/PUT/PATCH/DELETE
- no browser automation
- no crawling
- no login/session handling
- no file downloads
- no script execution

## Web Scope Model

Configured web scope is now explicit and deterministic:

- config field: `web_allowed_domains`
- exact-domain and simple `*.subdomain` matching supported
- request URL must use `https://` or `http://`
- target hostname must match the configured allowlist
- redirects are allowed only if the final target remains inside the allowlist

Examples:

Allowed:

- `https://docs.openclaw.ai/`
- `https://platform.openai.com/docs`
- `https://ollama.com/library`

Denied:

- `https://evil.example/`
- `ftp://platform.openai.com/spec`
- redirect chains that leave the configured allowlist

## Confirmation and Policy Behavior

`web.fetch.read` is online-sensitive and respects the existing mode/policy rules:

- `always_offline`: blocked
- `ask_before_online`: returns a one-shot confirmation prompt when network use needs approval
- `always_online`: allowed when readiness is good and scope is valid

Confirmation does not override:

- out-of-scope domains
- readiness failures
- invalid web-scope configuration

## Response and Sanitization Rules

Bounded fetch limits are now enforced:

- fixed request timeout
- bounded response-body size
- bounded Telegram preview length
- supported preview types only:
  - `text/*`
  - `application/json`
- unsupported/binary content is rejected cleanly
- query strings and fragments are stripped from display/audit summaries
- HTML is reduced to readable text; JSON is compacted into a short safe preview

## Audit Behavior

Every `web.fetch.read` attempt now creates an audit record, including:

- capability id
- outcome
- reason code
- scope summary
- sanitized domain/url summary
- content type
- bounded size summary
- duration

Audit intentionally excludes:

- full page bodies
- query-string leakage
- cookies/session data
- raw HTML dumps

## What Was Verified

Verified in repo-local tests and smoke runs:

- allowlisted URL success path
- malformed URL rejection
- unsupported scheme rejection
- out-of-scope domain rejection before fetch execution
- timeout normalization
- bounded HTML and JSON preview formatting
- confirmation flow for online-sensitive `/web`
- audit creation without response-body leakage
- desktop status visibility for recent web fetch result

## Intentionally Not Added

Still out of scope in v2.2:

- web scraping workflows
- browser automation
- search engine integration
- multi-page crawl
- session/login handling
- file downloads
- DOM querying tools
- mutation or automation behavior
