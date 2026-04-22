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

## Execution preview

AI-E now exposes a boundary-safe execution preview layer through `lib/aie/executionBridge.ts`.

- reasoning still decides what to do
- the execution bridge only normalizes and classifies the proposed action
- no filesystem mutation, shell execution, Git action, or Unity interaction happens in this phase
- every execution preview is approval-gated and rendered as inspectable metadata in the result UI

Execution preview fields include:

- description
- type
- scope
- expected outcome
- approval-required status

This bridge now supports a narrow controlled execution phase for approved actions:

- safe inspections remain read-only
- safe validation checks still use bounded read-only evidence
- sandbox-scoped file writes may apply whole-file content inside approved roots such as `web/sandbox`
- test execution is limited to a fixed whitelist: `npm test`, `npm run test:trace`, and `npm run build`

Execution results can now surface additive metadata such as:

- changed paths
- diff summary
- command label and exit code
- rollback snapshot metadata for overwrite-style file writes

## Recovery intelligence

AI-E now adds bounded recovery logic on top of the same autonomous loop and execution bridge.

- failures are classified as `environment`, `logic`, `constraint`, `transient`, or `unknown`
- same-action retries are limited to a small bounded per-action budget
- blocked safety and path-policy failures are never retried
- logic-style failures prefer rerouting or validation before another write
- duplicate action and duplicate output detection stop useless loop churn

Current bounded recovery strategies:

- `retry-same-action`
- `reroute-analysis`
- `narrow-scope`
- `validate-before-write`
- `stop`

Autonomous sessions and traces can now preserve additive recovery metadata such as:

- failure class
- recovery strategy
- retry count
- repeated-action and repeated-output flags
- explicit autonomous stop reasons

## Deeper autonomous continuation

AI-E now distinguishes bounded progress from true goal completion and can continue a stored autonomous session across multiple rounds.

Goal status meanings:

- `incomplete`: not enough bounded evidence yet
- `progressing`: a step made progress, but the top-level outcome is still unconfirmed
- `needs-verification`: the latest result looks promising, but AI-E keeps a conservative verification step before claiming completion unless the safe bounded evidence already answers a small read-only goal strongly enough to stop
- `complete`: the expected bounded outcome is directly confirmed, including short safe read-only checks whose output already answers the goal
- `blocked`: the loop is paused at a bounded wall such as approval or a hard safety boundary

Completion confidence remains additive and conservative:

- `low`: indirect or ambiguous evidence only
- `medium`: useful progress or partial alignment, but not enough to close the goal
- `high`: direct alignment between the expected outcome and the latest bounded evidence

Phase 4E.1 small-goal closure rules:

- short read-only goals such as file existence checks, bounded summaries, and bounded test confirmations can close without forcing a broader follow-up when the latest safe output already answers the goal
- adapter-aware closure scoring stays additive and uses the same runner metadata instead of a separate headless-only heuristic
- ambiguous read-only output stays open and conservative
- AI-E suppresses approval drift when a broader next step is outside the original bounded goal and prior safe evidence already satisfied that goal

Autonomous session continuity now includes:

- persisted session states: `active`, `paused`, `awaiting-approval`, `blocked`, `completed`, `failed`, `max-step-limit`
- stored pending action metadata when a caution-scoped next step needs explicit approval
- resumable continuation through `POST /api/autonomous/resume/[id]`
- recent-session inspection through `GET /api/autonomous/sessions`

Approval flow:

- AI-E does not mark approval-gated next steps as a generic failure
- the session moves to `awaiting-approval`
- the pending action is visible in the autonomous UI and persisted in session storage
- when approval is granted, AI-E resumes from stored state and executes the pending bounded action before planning the next step

Long-horizon planning depth stays integrated into the current runner:

- recent diagnoses, action families, recoveries, changed paths, and validation outcomes are folded back into the next bounded reasoning step
- AI-E prefers validating recent writes before broadening again
- AI-E avoids repeating just-failed action families unless the evidence materially changed

## Phase 4E execution adapters

AI-E now routes bounded execution through adapter selection instead of a single hard-coded runtime switch.

Current adapters:

- `web-sandbox`: browser-driven inspection and validation steps
- `repo-filesystem`: bounded repo-local file writes under the existing path policy
- `repo-tests`: whitelisted repo-local test and build commands
- `headless-local`: headless inspection and validation runs that still use the same runner/session contracts

Adapter behavior remains bounded:

- no arbitrary shell strings from model output
- file writes stay policy-bound and approval-aware
- test execution stays on the whitelist
- adapter identity is stored in autonomous session metadata and rendered in the autonomous UI

## Phase 4E headless mode

AI-E can now run the same bounded autonomous session loop without the browser UI.

Example:

- `npx tsx headless_autonomy.ts --goal "Confirm the safe validation path can reach a healthy bounded result." --maxSteps 4`

Headless mode uses:

- the same autonomous session store
- the same `runAutonomousSession(...)` runner
- the same adapter-backed execution runtime
- the same approval and safety boundaries

This means the same small safe-goal closure behavior applies in both headless and browser/API flows.

## Phase 4E sequencing depth

The autonomous loop now records and surfaces deeper sequencing metadata:

- action family lane per step (`write`, `test`, `validate`, `inspect`)
- selected execution adapter per step
- adapter context summary
- recent planning hint summary derived from prior steps

This keeps broader bounded work inspectable without creating a second planner or a separate headless autonomy stack.

## Phase 4M-D complete: trust boundaries and continuation hardening

AI-E now layers deterministic distributed continuation on top of the 4M-A liveness work and the 4M-B lease foundation in `lib/aie/taskEnvelope.ts`, `lib/aie/queueOrchestrator.ts`, `lib/aie/dispatchMessages.ts`, `lib/aie/dispatchReceiver.ts`, and the shared-runner path.

- task records now persist explicit continuation lineage, including continuation generation, source node, target node, continuation reason, resumed-from token/checkpoint references, and prior-lease linkage
- queue-mediated recovery remains the only handoff path: stale, offline, timeout, or supersession recovery first invalidates the prior lease, persists continuation lineage, moves the task through deterministic `retrying`, and only then activates a new lease on the next selected node
- the same logical task and session ids survive node changes, so continuation does not create a brand-new unrelated task/session identity during recovery
- controlled dispatch requests now carry explicit continuation metadata plus deterministic lease/checkpoint/token authenticity bindings, and the receiver rejects mismatched lineage or forged bindings before execution starts
- node eligibility and final dispatch acceptance now enforce trusted-only dispatch targets plus explicit protocol compatibility, with `restricted` and `blocked` nodes refused at the dispatch boundary
- retryable trust/protocol receiver rejections stay non-terminal so the queue can reselect another healthy node deterministically without duplicate execution
- shared-runner startup now detects continued tasks, preserves the original session id, and surfaces resumed-start context through task/session summaries instead of treating the handoff as a fresh queue session
- the autonomous task API plus both CLI entrypoints now expose current node, prior node, prior lease id, current lease id, continuation generation, continuation reason, resumed-from checkpoint/token state, dispatch protocol, and derived hardening state for trusted/retryable/terminal outcomes
- bounded queue execution still keeps a single authoritative active lease and does not introduce peer-to-peer migration, duplicate execution, or a parallel scheduler path

4M-D is complete for trusted dispatch-target enforcement, protocol compatibility checks, continuation/checkpoint authenticity binding, deterministic retry after retryable boundary rejection, and API/CLI observability of dispatch hardening state.

## Post-4M bounded autonomy layering: recovery-aware continuation chains

AI-E now adds a bounded recovery-planning layer on top of the hardened 4M coordination spine instead of introducing a second orchestration model.

- queued tasks now derive an explicit supervised recovery plan: `resume-continuation`, `restart-safe-boundary`, or `fail-non-retryable`
- retryable `restart-required` work now clears continuation lineage and restarts from the last persisted safe-stop boundary instead of masquerading as a continuation resume
- retryable `resumable` work keeps deterministic continuation lineage, resumed-from token/checkpoint references, and continuation generation for the next dispatch attempt
- task summaries now derive bounded continuation-chain state such as `fresh`, `safe-stop`, `restart-pending`, and `terminal`, along with chain depth
- autonomous task API responses and both CLI entrypoints now expose recovery plan, recovery reason, safe-stop point, chain state, and chain depth alongside the existing dispatch hardening metadata
- dispatch planning hints now include the derived recovery plan so longer-running supervised sessions surface clearer resume-vs-restart context without bypassing queue, lease, or trust controls

This slice keeps the same single authoritative queue/lease/receiver path. It does not add peer-to-peer migration, a secondary scheduler, or unsupervised multi-step execution.

## Post-4M bounded autonomy layering: bounded loop optimization handoff

AI-E now turns supervised production-loop continuity into bounded loop optimization, so repeated implementation, validation, fix, and retry cycles get deterministic next-step guidance and loop-health signals without weakening queue, lease, or trust guarantees.

- the existing `workflowContinuity` block now derives bounded loop-health state such as current phase repeat count, recent phase outcomes, stalled-loop detection, operator-intervention preference, recommended next phase, recommended next action summary, and the reason behind that recommendation
- bounded prioritization heuristics now explicitly prefer validation after a successful bounded implementation step, prefer a fix after a failed validation with an actionable failure, wait on operator input when blocker state is present, and stop or restart when repeated loops stop producing new information
- the pending next-step summary now reflects those heuristics, so loop continuity carries guidance such as validate next, retry a fix with an updated approach, restart from the last safe boundary, or wait for operator input
- session lifecycle recomputation keeps the optimization state deterministic and persisted across append, pause, approval wait, resume, completion, and normalization, so repeated loops remain inspectable rather than stateless
- task inspection APIs inherit the richer session continuity block, session APIs expose it through the persisted session object, and both CLI entrypoints now surface repeat count, stalled-loop state, recommended next phase, recommended next action, and loop-health reason during session and queued-task reporting

What remains for later autonomy layers:

- broader supervised loop optimization such as smarter cross-loop prioritization and richer bounded planning heuristics across multiple candidate work paths
- any multi-agent workflow orchestration, peer scheduling, or unbounded autonomous coding behavior

This slice is intentionally derived from `TaskEnvelope` and `AutonomousSession` rather than replacing them. Queue truth, lease ownership, and trusted dispatch remain authoritative; workflow continuity is a persisted planning and observability layer on top of that spine.

Still deferred beyond 4M-D:

- autonomous peer-to-peer replication or any direct node-to-node handoff channel
- distributed handoff arbitration, multi-task lease election, or broader scheduler coordination beyond the current queue model
- any separate heartbeat daemon, lease coordinator, or secondary scheduler layer

### Phase 4L — Multi-Node Execution

AI-E now supports bounded multi-node execution routing on top of the same shared runner and controlled dispatch boundary.

- task selection can target among multiple registered nodes instead of assuming a single receiver
- routing prefers capable active non-busy nodes and keeps a deterministic local fallback when available
- dispatch attempts carry bounded retry metadata, timeout metadata, and explicit failure reasons
- queue lifecycle stages now distinguish queued, dispatching, awaiting-ack, executing, retrying, completed, failed, and rejected states
- CLI and API inspection surfaces expose selected node, selection reason, retry count, last attempt, timeout, and failure reason

Safety constraints remain unchanged:

- no uncontrolled workers
- no public internet transport
- no auth bypass or capability bypass
- no second execution stack outside the shared runner

## Approval model

The execution bridge remains approval-gated and bounded.

- AI-E may suggest a bounded action
- AI-E may classify the action as safe, caution, or dangerous
- AI-E only auto-executes safe bounded actions inside the existing autonomous loop
- manual execution still requires explicit approval from the result surface
- broader file writes outside safe sandbox roots still pause autonomous execution
- arbitrary shell commands, Git operations, unrestricted filesystem writes, and repo-wide edits remain blocked

Execution history is carried forward only through the existing context string and session storage flow. The `AnalysisInput` shape and trace schema remain unchanged.

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
