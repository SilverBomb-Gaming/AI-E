# AI-E Web Front Door

Public-facing AI-E product surface built with Next.js, TypeScript, and Tailwind.

## Local run

1. Install dependencies:

   `npm install`

2. Start the app from the `web/` directory:

   `npm run dev`

3. Open `http://127.0.0.1:3000`

## Analysis routing

The web route `app/api/analyze/route.ts` supports two modes:

- Local fallback: spawns `../analysis_service/run_free_analysis.py`
- Hosted backend: sends requests to `AIE_ANALYSIS_BACKEND_URL`

Optional environment variables:

- `AIE_ANALYSIS_BACKEND_URL`
- `AIE_PYTHON_BIN`

## Model routing

AI-E now routes model calls through `lib/aie/modelRouter.ts` instead of binding the analysis path directly to one provider implementation.

Supported providers:

- `openai`
- `local-openai`
- `ollama`

Routing behavior:

- reasoning requests stay on the standard reasoning model by default
- light mode requests use the lower-cost light model path
- rewrite-oriented calls can be pointed at a separate rewrite model

Relevant environment variables:

- `AIE_REASONING_PROVIDER`
- `AIE_REASONING_MODEL`
- `AIE_LIGHT_PROVIDER`
- `AIE_LIGHT_MODEL`
- `AIE_REWRITE_PROVIDER`
- `AIE_REWRITE_MODEL`
- `AIE_LOCAL_OPENAI_BASE_URL`
- `OLLAMA_BASE_URL`

## Caching

AI-E now keeps a small in-memory cache for routed model completions in `lib/aie/modelCache.ts`.

- cache keys are derived from the system prompt, user prompt, selected model, and routing mode
- reasoning calls use `AIE_REASONING_CACHE_TTL_MS`
- rewrite calls use `AIE_REWRITE_CACHE_TTL_MS`
- cache hits are surfaced in router logging so repeat requests can be verified during playtesting

## Light mode

The analysis form exposes a `Use light mode` toggle.

- it does not change the `AnalysisInput` shape
- it injects routing hints into the existing `context` field
- it keeps the guided debugging loop and trace system intact
- it allows cheaper, faster first-pass analysis without touching the stored trace schema

## Readiness environments

The readiness probe now reads its base URL from `BASE_URL` first, then `AIE_BASE_URL`, and falls back to `http://localhost:3000`.

Examples:

- `npm run readiness`
- `BASE_URL=http://localhost:3001 npm run readiness`

## Debugging mode recommendation

The analysis result view now renders a small `Recommended mode` label next to the diagnosis metadata. This is a renderer-only interpretive aid meant to clarify how the user should approach the next debugging move, not to change the underlying diagnosis loop.

How it is derived:

- from the rendered diagnosis text
- from the current or first recommended step text
- from the current loop status and suggested escalation path
- from confidence only as a light fallback when the loop is stuck or underspecified

Current mode labels:

- `Isolate one subsystem`
- `Instrument with logging`
- `Check initialization order`
- `Reproduce in a clean scene`
- `Check for duplicate writers`
- `Validate ownership / references`

The classifier is local to `web/components/AnalysisResult.tsx`. It does not add a new model field, change stored state, or alter API/schema behavior.

Validation run for this pass:

- `npm run lint`
- `npm run build` (currently blocked by an existing unrelated type error in `web/components/AnalysisForm.tsx`, where `form.context` is possibly undefined)
- representative heuristic checks for:
  - isolation / toggle flow
  - logging / state inspection flow
  - scene startup / lifecycle ordering
  - duplicate-writer or duplicate-listener diagnosis
  - stuck flow leaning toward minimal reproduction / clean-scene recovery

## Vercel

Recommended Vercel project root:

`web`

For Vercel deployment, set `AIE_ANALYSIS_BACKEND_URL` to a reachable Python-backed analysis endpoint. The local Python spawn fallback is intended for local development on the repo machine.
