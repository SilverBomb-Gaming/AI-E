# Windows OpenClaw Operator Console v1.2 - First Useful Commands Layer

This checkpoint turns the verified Telegram loop into a small practical command surface without broadening the operator console into automation or orchestration.

## Verified

- `/help` returns the supported command list
- `/status` returns runtime, diagnostics, readiness, mode, policy, provider, and Telegram loop state
- `/mode` returns selected mode, current mode, policy, active provider, and whether online use is blocked, allowed, or confirmation-gated
- `/models` reports local Ollama model availability clearly
- `/ask <prompt>` executes through the active provider path only when current mode, policy, readiness, and provider state allow it
- duplicate update suppression still holds with command handling enabled
- the controller UI shows the last Telegram command handled and the last `/ask` outcome

## Safety And Diagnostic Guarantees Preserved

- Offline Mode remains first-class.
- No silent provider or mode fallback is allowed.
- Generic plain text does not auto-route into provider-backed queries.
- Health and security diagnostics remain trusted and user-visible.
- Secret redaction remains active for logs and Telegram activity summaries.
- Runtime liveness remains multi-signal and no longer relies on a false HTTP assumption for the websocket gateway port.

## Intentionally Not Implemented Yet

- autonomous workflows
- repo mutation commands
- scraping
- RAG
- scheduled jobs
- background automation
- Discord, Slack, or WhatsApp channels
- transcript-style chat UI
- generic plain text auto-routing into `/ask`
