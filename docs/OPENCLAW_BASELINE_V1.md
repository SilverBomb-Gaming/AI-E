# Windows OpenClaw Operator Console v1

## Status

- Health: Healthy
- Security: Safe
- Readiness: Ready

This baseline was verified on 2026-04-06 from the current controller/runtime state.

## Runtime

- OpenClaw runtime state: running
- Gateway port: `18789`
- Bind mode: `loopback`
- Bind address: `127.0.0.1`
- Node version: `v24.12.0`
- OpenClaw version: `2026.2.26`

## Provider

- Selected mode: `offline`
- Selected policy: `ask_before_online`
- Active provider: `ollama`
- Preferred Ollama model: not configured
- Current validated Ollama model: `kimi-k2.5:cloud`
- Local models detected: `4`
- Detected local models:
  - `kimi-k2.5:cloud`
  - `dolphin-llama3:8b`
  - `nomic-embed-text:latest`
  - `llama3.1:latest`

## Telegram

- Validation status: `valid`
- Bot identity: `@silverbomb_ai_boT`
- Last successful test result: `passed`
- Last successful test timestamp: `2026-04-06T21:57:23-04:00`

## Safety And Diagnostics Notes

- Health check result: `Healthy: 0 error(s), 0 warning(s).`
- Security check result: `Safe: 0 error(s), 0 warning(s).`
- Readiness result: `Runtime, provider, diagnostics, and Telegram are ready for daily use.`
- Ownership-aware port conflict detection is in place, so the controller no longer reports a false conflict when the configured gateway port is owned by the active OpenClaw runtime or its descendant process.
- Runtime log redaction is active for secret-like values, including OpenAI keys and Telegram bot tokens.
- Health and security diagnostics are considered stable and trusted for this baseline.

## Launch Command

```powershell
python -m app.main
```

## Verified Workflow

1. Start Runtime
2. Check Status
3. Run Health Check -> Healthy
4. Run Security Check -> Safe
5. Confirm Telegram validated

## Definition Of Done

The Windows OpenClaw Operator Console v1 baseline is safe, operational, and usable as a daily AI control layer.
