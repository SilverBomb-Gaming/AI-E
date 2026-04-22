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

## Post-4M bounded autonomy layering: supervised loop steering handoff

AI-E now lets operators steer repeated supervised production loops with explicit bounded next-step overrides, while keeping the existing queue, lease, trust, and continuity guarantees intact.

- the persisted `workflowContinuity` block now carries an operator steering state with the requested next-phase override, stop or restart rationale, operator note for the next loop step, and whether the override is pending, applied, or blocked
- loop-health derivation now preserves both the system recommendation and the effective recommended next phase, so operators can see when a manual override changed the next-step guidance and when the system recommendation still wins
- bounded steering rules only apply when they do not bypass approval, trust, or safe-boundary requirements, and blocked overrides now explain why they could not be honored
- the existing resume surface now accepts bounded steering payloads, a dedicated steering API can persist pause, stop, restart, validation, or fix preferences without launching a new run, and the operator page exposes those controls directly
- both CLI entrypoints now surface the operator override state, blocked reason, operator note, and system-vs-effective next-phase recommendation so the loop remains inspectable outside the web UI too

This slice still does not add a second workflow engine, parallel autonomous execution, or any way around the existing `TaskEnvelope` lease and dispatch path. Steering is a bounded operator influence layer on top of the same persisted session spine.

## Post-4M bounded autonomy layering: operator-guided loop refinement handoff

AI-E now carries forward bounded operator guidance across repeated supervised loops, so recent overrides can refine later next-step recommendations without hiding the underlying system recommendation or weakening queue, lease, trust, or continuity guarantees.

- `workflowContinuity` now persists bounded refinement history for recent operator overrides, including the requested preference, the system recommendation at the time, the operator note, the override rationale, and whether later bounded steps showed useful progress
- the loop recommendation layer now derives a refinement influence signal from recent in-session operator history, so later repeated loops can prefer the same operator-guided phase in similar bounded cases while still exposing the unchanged system recommendation separately
- steering transparency remains explicit: the current session now shows the system recommendation, current override, override rationale, blocked or applied status, whether recent overrides improved progress, whether the current recommendation was influenced by prior guidance, and a bounded refinement summary
- session APIs inherit the richer continuity block automatically, while the autonomous page and both CLI entrypoints now surface refinement note, progress-improvement signal, similar-future preference, recommendation influence, and refinement summary alongside the existing steering and loop-health state

This slice still does not add unconstrained adaptive planning, hidden operator-learning behavior, multi-agent orchestration, or any bypass around the existing `TaskEnvelope` and trusted dispatch path. Refinement remains session-local, deterministic, and inspectable.

## Post-4M bounded autonomy layering: bounded recommendation improvement handoff

AI-E now improves bounded next-step recommendations across repeated supervised loops by combining recent loop outcomes with recent operator-guided refinement signals, while still making the underlying rationale explicit and preserving system-vs-operator distinction.

- `workflowContinuity.loopHealth` now carries additive recommendation rationale fields including top contributing signals, rationale summary, confidence, and whether the current state likely needs operator input
- the deterministic recommendation layer now weights repeated validation failures, recent implementation changes, blocker persistence, stalled-loop evidence, safe restart value, and helpful prior operator overrides instead of exposing only a single opaque next-phase recommendation
- hard bounded cases remain explicit rather than hidden in scoring noise: active blockers still recommend waiting on operator input, stalled loops recommend restart-or-wait with low confidence, and completed safe boundaries recommend stopping cleanly
- operator-guided refinement now augments the visible recommendation rationale instead of silently replacing it, so the session can show both the unchanged system recommendation and the final influenced recommendation with a concrete refinement reason
- session context blocks, the autonomous page, and both CLI entrypoints now expose recommendation confidence, rationale summary, top contributing signals, and likely-needs-operator status alongside the prior steering and refinement fields

This slice still does not introduce a second planner, hidden learning state, cross-session adaptation, or any bypass around the existing `TaskEnvelope`, lease, approval, and trusted dispatch boundaries. Recommendation improvement remains session-local, deterministic, and inspectable.

## Post-4M bounded autonomy layering: bounded operator-assisted recommendation review handoff

AI-E now makes bounded next-step recommendations easier for operators to review, confirm, or redirect without adding a second planner or weakening the existing queue, lease, approval, trust, or continuity guarantees.

- `workflowContinuity` now persists bounded recommendation-review history alongside steering and refinement state, including the recommendation that was shown, the operator response, the visible rationale snapshot, and whether later bounded progress showed that the recommendation helped or needed correction
- operator review stays explicit rather than hidden inside steering metadata: the current session now exposes review summary, last reviewed recommendation, last operator response, last review outcome, whether the review improved progress, whether correction was needed, and whether recent recommendations are being frequently overridden
- the existing steering path now supports an explicit `accept-current-recommendation` action so operators can confirm the current bounded recommendation directly instead of only redirecting it
- the autonomous page, headless CLI, local-node CLI, and session context block now surface the same review-oriented fields, making recommendation confirmation or redirection inspectable across browser and non-browser workflows

This slice still does not add hidden adaptation, cross-session operator learning, a secondary orchestration path, or any bypass around the existing `TaskEnvelope` and `AutonomousSession` spine. Recommendation review remains session-local, deterministic, and inspectable.

## Post-4M bounded autonomy layering: bounded recommendation follow-through handoff

AI-E now tracks what happened after a reviewed recommendation was accepted, redirected, or corrected, so the current supervised loop can show not just the recommendation and review response but the bounded follow-through that came after it.

- `workflowContinuity.review` now derives bounded follow-through fields including last follow-through status and summary, last accepted recommendation outcome, last redirected recommendation outcome, whether the follow-through helped, whether it required correction, whether the loop returned to the same recommendation again, and whether review cycles are repeating without useful progress
- this follow-through layer builds directly on the prior recommendation-review history instead of creating a second planner: AI-E evaluates later bounded steps against the reviewed recommendation and keeps the result session-local, deterministic, and inspectable
- the autonomous page, session context block, headless CLI, and local-node CLI now surface follow-through state alongside recommendation review state so operators can see whether an accepted recommendation succeeded cleanly, needed later correction, or kept cycling without progress

This slice still does not add hidden adaptation, cross-session learning, alternate orchestration, or any bypass around the existing queue, lease, approval, and trusted dispatch controls. Recommendation follow-through remains a bounded observability layer on top of the same `AutonomousSession` continuity spine.

## Post-4M bounded autonomy layering: bounded escalation and recommendation recovery handoff

AI-E now turns poor recommendation follow-through into explicit bounded escalation and recovery guidance, so the supervised loop can react deterministically when reviewed recommendations keep failing, require correction, or return to the same ineffective state.

- `workflowContinuity.escalation` now derives bounded escalation fields including escalation status, recovery recommendation, likely-needs-operator-intervention state, repeated ineffective review-cycle detection, repeated accepted-recommendation correction detection, redirected-recommendation outperformance detection, and same-ineffective-state return detection
- this escalation layer builds directly on the prior recommendation follow-through history instead of creating a second planner: AI-E evaluates recent reviewed outcomes and converts them into bounded recovery guidance such as operator intervention, safe-boundary restart, alternate validation-first or fix-first guidance, or stopping the current loop
- the autonomous page, session context block, headless CLI, and local-node CLI now surface escalation summaries and recovery summaries alongside the existing review and follow-through state so operators can see when the supervised loop is no longer progressing well

This slice still does not add hidden adaptive learning, alternate orchestration, multi-agent behavior, or any bypass around the existing queue, lease, approval, and trusted dispatch boundaries. Escalation and recommendation recovery remain session-local, deterministic, and inspectable.

## Post-4M bounded autonomy layering: bounded operator handoff and supervised recovery execution handoff

AI-E now turns escalation into an explicit bounded handoff state, so operators can see when the loop is waiting on a recovery choice, which supervised recovery path was selected, and whether that recovery execution improved progress or triggered another escalation.

- `workflowContinuity.handoff` now persists bounded operator-handoff history alongside the existing escalation state, including the selected recovery action, the derived recovery mode, the operator rationale, whether the system is still waiting on a decision, whether supervised recovery execution is in progress or completed, and whether another escalation became necessary
- the existing steering update path records supervised recovery choices only when escalation is already active, keeping operator-vs-system distinction explicit and preserving the same bounded continuity spine rather than introducing a second planner or hidden controller
- the session context block, autonomous page, headless CLI, and local-node CLI now surface handoff and recovery-execution summaries alongside escalation guidance so operators can move from "this loop is stuck" to "this is the supervised recovery path currently being executed"

This slice still does not add hidden adaptation, cross-session learning, alternate orchestration, multi-agent recovery logic, or any bypass around the existing queue, lease, approval, and trusted dispatch boundaries. Operator handoff and supervised recovery execution remain session-local, deterministic, and inspectable.

## Phase 5A: bounded repo coding loop continuity

AI-E now treats repo coding work as an explicit bounded loop mode built on the completed autonomy spine, so the same supervised session can carry implementation, validation, correction, review, escalation, and supervised recovery through a real repo workflow without adding another coordinator or planner.

- `AutonomousSession` now supports explicit `repo-coding` mode, and `workflowContinuity.coding` derives repo-work state from the existing bounded steps, validation outcomes, correction signals, escalation state, and supervised recovery state already carried by the session spine
- repo-oriented coding context now persists in-session rather than in a second memory system: target scope, current coding objective, validation target, last code-change summary, last validation result summary, current correction target, repeated validation outcome, and next intended coding action remain deterministic and inspectable across the loop
- the shared runner and queued-task session builder now create repo-coding sessions for real repo execution, which means Phase 5A builds directly on the existing queue, lease, trust, approval, continuity, escalation, and recovery controls instead of bypassing them
- the autonomous page, session context block, headless CLI, local-node CLI, and task list views now expose coding-loop mode and repo-work summaries so operators can see what the supervised coding loop is doing in repo terms

Phase 5A is complete when these coding-loop fields continue to validate under focused owner tests and the broader regression gate. Later production-capability slices can build on this by tightening repo-task intake, linking concrete edits more directly to validation targets, and expanding operator review around real coding deliverables.

## Phase 5B: validation-first repo coding loop behavior

AI-E now makes the repo-coding loop more practically useful by treating validation-first behavior as an explicit bounded coding mode on top of the Phase 5A continuity layer rather than as an implicit side effect of generic loop state.

- `workflowContinuity.coding` now distinguishes validation-first coding states such as `validation-pending`, `validation-failed`, `correction-pending`, `validation-recovered`, `escalation`, and `supervised-recovery`, so implementation, validation, correction, and bounded recovery stay visible in repo-work terms
- validation-oriented repo summaries now persist in the same session-local continuity block instead of a second memory system: current validation target, last implementation summary, last validation summary, last correction summary, validation-first-active state, and repeated-validation-failure escalation state all remain deterministic and inspectable across the loop
- the existing escalation and supervised recovery handoff spine now drives repo-coding visibility more clearly: repeated validation failure can surface as an explicit coding escalation, while selected and executing supervised recovery paths surface separately from ordinary validation failure
- the autonomous page, session context block, headless CLI, local-node CLI, and queue-run reports now expose validation-first coding fields directly so operators can see whether the loop is waiting to validate, failed validation, is correcting toward a target, recovered after validation, or is escalating because repeated validation failure is still driving the loop

Phase 5B is complete when these validation-first coding states continue to validate under focused owner tests, the widened regression slice, and the broader web test gate. Later production-capability slices can build on this by tightening repo-task intake, connecting validation targets more directly to concrete deliverables, and surfacing stronger operator review around code-change acceptance.

## Phase 5C: deliverable-linked repo coding loop targets

AI-E now carries repo-coding work in clearer deliverable terms on top of the Phase 5B validation-first loop, so the supervised coding session can state not just what phase it is in but what concrete output it is trying to produce, what validation is supposed to prove, and whether the loop is still working toward the same bounded target.

- `workflowContinuity.coding` now derives deliverable-linked target fields such as current deliverable target, expected output form, validation success target, current acceptance target, current target status, validation proof summary, validation-failure impact, correction-maintains-deliverable state, and whether correction or escalation changed the active deliverable target
- this slice builds directly on Phase 5B rather than replacing it: the same implementation, validation, correction, escalation, and supervised-recovery signals now feed a more concrete repo-work target model instead of introducing another planner, memory system, or orchestration layer
- validation linkage is now more explicit inside repo-coding continuity: AI-E can show whether the current validation target still matches the active deliverable, what success is expected to prove for that deliverable, and whether a correction path is still working toward the same bounded acceptance goal
- the autonomous page, session context block, headless CLI, local-node CLI, and queue-run reports now expose deliverable-linked coding target state directly so operators can inspect the current deliverable, expected validation outcome, acceptance target, target status, deliverable alignment, and retargeting risk across browser and non-browser workflows

Phase 5C is complete when these deliverable-linked coding targets continue to validate under focused owner tests, the widened regression slice, and the broader web test gate. Later production-capability slices can build on this by tightening repo-task intake further, linking deliverable targets to more concrete approval and acceptance checkpoints, and expanding operator review around code-change acceptance decisions.

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
