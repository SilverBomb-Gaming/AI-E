# AI-E v1

Controlled execution surface for supported projects. AI-E turns a bounded request into a real, reviewable result with guardrails, live status, proof summaries, and saved history.

## Autonomous Session Loop

The web surface now includes a bounded autonomous session loop for safe multi-step runs. This keeps the existing AnalysisInput contract intact, reuses the same dry-run action proposal and bounded execution bridge, and only auto-executes safe supported actions.

Operator workflow reference:

- `docs/AI_E_OPERATOR_PLAYBOOK.md` defines the repeatable human workflow for starting sessions, letting AI-E run, interpreting oversight output, approving repo actions, and intervening correctly.

What the bounded autonomous loop does:

- accepts one top-level goal and turns it into a persisted autonomous session
- runs `analyze -> choose bounded action -> execute -> observe -> decide next step` until a stop condition fires
- persists session state under `runner_artifacts/autonomous_sessions` so runs can be inspected or resumed by session id
- carries the latest execution output back into the next analysis call through the existing supported fields: `goal`, `sessionId`, `stepIndex`, `context`, and `actionResult`
- adds optional autonomous metadata to trace records without changing the required trace contract

Boundaries and stop conditions:

- only safe bounded execution actions continue automatically today; risky or destructive steps pause and require manual approval
- the loop is capped to a hard max of 5 steps per run
- the loop stops on goal completion, blocked execution, repeated failures, repeated identical actions or outputs, or missing actionable next steps
- arbitrary shell execution remains out of scope for this loop

The intended operating model is: define a bounded goal, start a session, watch the session summary and operator-attention output, approve gated repo actions when appropriate, and intervene only when the system gives you a concrete reason to do so.

## Failure Recovery Intelligence

AI-E now also includes a deterministic failure recovery intelligence layer that explains what likely failed and recommends the safest next recovery step without taking that step automatically.

What the failure recovery layer does:

- classifies bounded failure outcomes into deterministic recovery categories
- explains why the classification was chosen
- estimates recovery severity and confidence
- recommends the safest next action: retry once, retry after refresh, rollback, operator review, dependency block, conflict block, or fixed blocking
- preserves blocker details and validation context inside the recovery decision
- annotates paused or blocked validation/runtime results with a structured `recovery_report`

Current contract:

- module path: `web/lib/aie/failureRecoveryIntelligence.ts`
- main entry points: `classifyFailure()`, `evaluateRecoveryDecision()`, `buildRecoveryReport()`, `summarizeRecoveryReport()`, `isRetrySafe()`, and `requiresOperatorReview()`
- failure categories: `validation_failure`, `test_failure`, `execution_error`, `stale_context`, `stale_approval`, `dependency_blocked`, `conflict_blocked`, `unsafe_mutation`, `missing_file`, `unexpected_file_change`, `rollback_recommended`, and `unknown`
- recovery actions: `retry_once`, `retry_after_refresh`, `rollback`, `request_operator_review`, `block_until_fixed`, `mark_dependency_blocked`, `mark_conflict_blocked`, and `no_action_needed`

Example:

```text
Validation failed because an expected file was missing.

AI-E recovery report:
- category: missing_file
- severity: high
- recommendation: request_operator_review
- retry_safe: false
- reason: missing output file suggests the task did not complete correctly
```

Why this improves operator visibility:

- AI-E no longer stops with only a pause or block state
- the runtime can now explain what kind of failure occurred and why that interpretation was chosen
- retryable and non-retryable failures are separated deterministically
- rollback stays explicit and review-gated instead of becoming automatic behavior

Important limitation:

- this layer does not recover automatically yet
- it does not auto-retry, auto-rollback, auto-approve, mutate files, or bypass validation
- it only classifies and recommends so the operator can choose the actual recovery action

## Operator Dashboard State

AI-E now also includes a deterministic operator dashboard state layer that produces one structured snapshot of what the system is doing, what is blocked, and what needs operator attention.

What the dashboard state layer does:

- gathers goal state from orchestration, dependency scheduling, background queueing, runtime state, and failure recovery reports
- exposes one unified operator-facing snapshot instead of forcing the operator to inspect separate internal modules
- explains why goals are blocked, why one goal is selected, and what the recommended next action is
- groups work into active, queued, blocked, paused, and completed slices
- surfaces approvals, validation issues, recent failures, and recovery recommendations in the same structure

Current contract:

- module path: `web/lib/aie/operatorDashboardState.ts`
- main entry points: `buildOperatorDashboardState()`, `summarizeOperatorDashboardState()`, `extractActionableItems()`, and `groupGoalsByStatus()`
- core output fields: `active_goal`, `queued_goals`, `blocked_goals`, `completed_goals`, `paused_goals`, `dependency_blockers`, `conflict_blockers`, `recent_failures`, `recovery_recommendations`, `approvals_required`, `validation_issues`, `runtime_status`, `session_status`, `queue_status`, `scheduler_status`, and `last_updated_at`

Example:

```text
Active goal: Fix KBM input
Blocked goal: Test grenade feature
Reason: depends_on Fix KBM input
Recommended action: complete KBM fix before testing grenade
```

Why this improves usability:

- AI-E can now explain its entire current state in one snapshot
- blocked work and operator-needed actions are explicit instead of hidden inside internal results
- this creates the structured foundation for a later UI or operator dashboard without changing execution behavior

Important limitation:

- this is not a UI yet
- it does not execute, mutate state, bypass gates, or auto-resolve blockers
- it is a read-only operator-facing state layer for visibility and control

## Operator Dashboard Runtime Provider

The operator dashboard UI can now distinguish between seeded demo state and live runtime-backed state.

Current source modes:

- `live_runtime`: the dashboard is reading persisted AI-E runtime state through `web/lib/aie/operatorRuntimeStateProvider.ts`
- `demo_seed`: no live runtime state was available, so the dashboard falls back to seeded demo data for safe UI testing
- `unavailable`: a live runtime source was attempted but could not be read safely

Current behavior:

- `/operator` loads provider state on the server
- if a live runtime state store and runtime id are available, the UI shows live runtime metadata and labels it clearly
- if no live runtime state exists, the UI falls back to the seeded dashboard demo state and labels it clearly
- unsupported live actions are rejected safely with the reason `live runtime mutation not enabled for this action`

Current safety boundary:

- live mode reads persisted runtime state and applies only bounded approved mutations through the runtime mutation executor
- demo mode still allows local UI state transitions for approve, pause, resume, and retry
- seeded demo data is never presented as live runtime state

## Meta-Intelligence / Self-Improvement Layer

AI-E now also includes a bounded meta-intelligence layer that evaluates how the autonomous studio is operating without allowing the system to rewrite itself, weaken safety, or silently broaden autonomy.

What the meta-intelligence layer does:

- preserves deterministic performance memory in the operator dashboard state
- detects recurring operational patterns from persisted runtime evidence
- produces bounded advisory policy recommendations with explicit safety rationale
- tracks operator decisions over those recommendations and patterns
- generates an operator-readable meta summary package on request
- renders this state in the `/operator` Meta-Intelligence panel and routes actions through the same safe live mutation path

Current contract:

- state contract: `web/lib/aie/metaIntelligenceState.ts`
- pattern detector: `web/lib/aie/metaPatternDetector.ts`
- policy recommender: `web/lib/aie/metaPolicyRecommender.ts`
- summary package generator: `web/lib/aie/metaIntelligenceSummary.ts`
- proof: `npm run proof:meta-intelligence:safe`

Important safety boundary:

- recommendations remain advisory until an operator explicitly approves them
- approved changes update persisted policy state only; they do not modify code or auto-edit prompts
- the layer cannot weaken safety gates, expand autonomy scope, auto-mutate policy silently, or self-modify the system
- all live actions remain bounded to acknowledgement, approval, rejection, deferral, and summary generation through the existing safe runtime bridge and runtime mutation executor

## Strategy Engine / Goal Portfolio Management Layer

AI-E now also includes a bounded strategy engine layer that keeps a deterministic portfolio of strategic studio objectives without allowing the system to auto-approve, auto-activate, or silently broaden execution scope.

What the strategy engine layer does:

- preserves a persisted portfolio of strategic goals with impact, effort, risk, confidence, horizon, dependencies, ownership, and linked work context
- deterministically ranks the strategy portfolio and recommends the next operator-safe action for each goal
- produces bounded advisory decompositions into proposed work items only
- tracks operator decisions over strategic goals and records them in persisted runtime state
- generates an operator-readable strategy summary package on request
- renders this state in the `/operator` Strategy Portfolio panel and routes actions through the same safe live mutation path

Current contract:

- strategic goal contract: `web/lib/aie/strategyGoalPortfolio.ts`
- portfolio scorer: `web/lib/aie/strategyPortfolioScorer.ts`
- bounded decomposer: `web/lib/aie/strategyGoalDecomposer.ts`
- summary package generator: `web/lib/aie/strategySummary.ts`
- proof: `npm run proof:strategy-engine:safe`

Important safety boundary:

- strategic goals remain operator-gated and do not auto-approve or auto-activate
- decomposition produces advisory proposed work items only and never starts runtime execution automatically
- linked work still flows through the existing work-item approval, review, and delivery controls
- all live actions remain bounded to approval, rejection, deferral, activation, pausing, archival, decomposition, and summary generation through the existing safe runtime bridge and runtime mutation executor

## Conversational Command Layer

AI-E now also includes a bounded conversational command layer that lets the operator talk to AI-E through the `/operator` surface without turning chat into a side-channel executor.

What the conversational command layer does:

- preserves a persisted conversational session on the operator dashboard
- classifies incoming chat requests into clarification, review, planning, or blocked routes using existing conversational readiness logic
- produces bounded advisory proposals, follow-up options, and chat summaries only
- records operator option selections, summary requests, and session archival in persisted runtime state
- renders this state in the `/operator` AI-E Chat panel and routes actions through the same safe live mutation path

Current contract:

- conversational session contract: `web/lib/aie/conversationalSessionState.ts`
- intent router: `web/lib/aie/conversationalIntentRouter.ts`
- response builder: `web/lib/aie/conversationalResponseBuilder.ts`
- pipeline adapter: `web/lib/aie/conversationalPipelineAdapter.ts`
- proof: `npm run proof:conversational-command:safe`

Important safety boundary:

- the chat layer is a receptionist, not the CEO
- chat does not execute work, approve plans, bypass review, or start runtime loops
- conversational output remains advisory until the operator explicitly moves work into the existing strategy, planning, execution, review, delivery, or studio-control pipeline
- all live actions remain bounded to chat submission, option selection, summary generation, and session archival through the existing safe runtime bridge and runtime mutation executor

## Layer 14 / Production Pipeline Expansion Foundation

Layer 14 expanded AI-E toward production-support capability for game development without weakening the Layer 13 conversational guardrails or introducing direct execution from chat.

Current Layer 14 status:

- foundation planning contracts: complete
- Unity-first planning packet and adapter-interface design: complete
- first reviewed Unity validation execution path: complete
- Unity read-only bridge interface: complete with configurable endpoint and command-probe client paths
- Unity validation evidence handoff into review and delivery packages: complete for read-only bridge and unavailable-bridge results
- Unity validation evidence visibility in the operator dashboard review and delivery surfaces: complete
- live Unity endpoint verification through the reviewed path: complete
- playtest-ready: yes for reviewed read-only validation only

Layer 14 roadmap:

- phase 1: planning-only contracts for production pipeline requests covering assets, art, audio, and Unity integration - complete
- phase 2: bounded planning packets and review artifacts for those domains, starting with Unity integration - complete for planning and review artifacts
- phase 3: execution adapters only after reviewable contracts, validation rules, and delivery gates exist - in progress with Unity validation preview, live read-only endpoint integration, evidence handoff, and operator UI evidence visibility
- phase 4: studio-control observability for production pipeline throughput, blockers, and operator attention

Production pipeline capability map:

- assets: intake, import validation, packaging, naming, and delivery planning for production assets
- art: briefs, review packets, style guardrails, and handoff checkpoints for concept, UI, VFX, and gameplay art
- audio: request packets, mix review structure, implementation checklists, and engine hookup review for SFX, music, voice, and ambience
- Unity integration: bounded planning for scenes, prefabs, ScriptableObjects, editor-side setup, and runtime validation handoff

Safe interface design for future production actions:

- production pipeline requests are represented as planning-only envelopes with explicit domain, objective, next safe stage, review focus, and future interface hooks
- mutation policy remains `planning_only` until a later layer adds reviewed execution adapters
- execution path remains explicit: `Strategy -> Planning -> Execution -> Review -> Delivery -> Studio Control`
- conversational requests may propose production pipeline planning metadata, but they do not execute imports, edits, scene changes, package updates, or engine mutations directly
- any future production action must still flow through the existing strategy, planning, execution, review, delivery, and studio-control boundaries

Unity-first planning adapter design:

- Unity planning packets now classify bounded request shapes for scenes, prefabs, component or script changes, validation/playtest asks, and asset imports
- Unity adapter design remains interface-only: it defines planning input, review metadata, approval metadata, and readiness results without executing any Unity or project mutation
- missing review or missing operator approval must block the Unity adapter from future execution

First reviewed Unity validation execution path:

- the first reviewed Unity execution slice is `validation_playtest_request` only
- execution remains read-only and validation-only, producing evidence and delivery-summary artifacts rather than project mutation
- current execution can now distinguish three states: adapter preview, real bridge unavailable, and real read-only bridge result
- review approval and operator approval are both required before the preview execution path can return an executed result
- non-validation Unity request types are still refused by the execution adapter

Unity read-only runtime bridge:

- the Unity bridge interface supports validation probes only and returns structured read-only observations rather than mutations
- the bridge now supports a configurable HTTP endpoint or command-probe source with timeout protection and strict read-only probe payloads
- the default local bridge still returns `bridge_unavailable` with a clear reason when no verified Unity endpoint is present
- the reviewed validation adapter calls the bridge only after review approval and operator approval are both present
- unavailable or malformed bridge results remain structured `real_bridge_unavailable` artifacts; they do not silently fall back to fake real execution
- successful bridge results are marked as `real_bridge_read_only` and include evidence such as scene validation status, missing script count, console error count, object count, checked scene name, evidence timestamp, and raw evidence summary
- read-only and unavailable bridge results now attach evidence to the existing review and delivery package model for operator-facing handoff
- the operator dashboard now renders those review and delivery packages with explicit Unity validation evidence, clearly distinguishing adapter preview, bridge unavailable, and real read-only bridge states
- chat still cannot invoke the Unity bridge directly; conversational intake remains planning-only with `safe_to_execute: false`
- Layer 14 is complete for reviewed read-only Unity validation through the gated path; chat still cannot invoke Unity directly and no mutation path was added in this layer

## Layer 15 / Controlled Unity Mutation Path

Layer 15 starts with architecture only for the first controlled Unity mutation lane. This step does not mutate Unity scenes, assets, prefabs, or scripts. It establishes the reviewed dry-run preview contract for a future mutation path while preserving the existing receptionist-only chat boundary.

Current Layer 15 status:

- first mutation domain: scene object creation preview
- planning packet classification for `scene_object_creation_request`: implemented
- dry-run mutation preview adapter foundation: implemented
- operator-visible review and delivery rendering for Unity mutation preview: implemented
- final execution authorization gate model for the Unity mutation lane: implemented
- execution preflight simulation for Unity mutation requests: implemented
- reviewed Unity live read-only bridge cold-start regression check: verified from a fully closed Unity/Hub state for `EnemyAIDemo`
- first controlled Unity mutation execution plan: implemented as disabled plan-only architecture
- final mutation execution switch: implemented and disabled by default
- first real controlled Unity mutation: executed successfully for `AIE_ControlledMutationProbe` in `EnemyAIDemo`
- separately approved rollback path for the first controlled Unity mutation: executed successfully for `AIE_ControlledMutationProbe` in `EnemyAIDemo`
- repeatability and idempotency verification for the controlled Unity mutation lane: verified live for mutation, duplicate mutation, rollback, and missing-target rollback
- required gates modeled: production planning packet, review approval, operator approval, dry-run preview, preflight simulation, explicit final execute gate, live read-only Unity validation, explicit mutation execution mode enablement, final mutation switch enablement, separate rollback review approval, separate rollback operator approval, explicit final rollback authorization, and explicit rollback switch enablement
- mutation-ready: yes for the single controlled scene object creation lane
- rollback-ready: yes for the single controlled scene object creation lane
- playtest-ready: yes for the single controlled scene object creation lane

Current Layer 15 boundary:

- the new preview path returns deterministic dry-run metadata only
- the operator UI renders the preview through existing review and delivery package surfaces with explicit `DRY RUN ONLY` and `NOT EXECUTED` labeling
- the mutation preview now also shows `FINAL EXECUTION NOT AUTHORIZED` until a separate final authorization record matches the reviewed request scope and expiry window
- the preview adapter refuses missing review approval, missing operator approval, non-mutation packets, and requests without `dry_run: true`
- final execution authorization is modeled separately from planning, review, and operator approval, but it still does not enable any real Unity mutation in this layer
- the mutation lane now also supports a simulation-only execution preflight that predicts affected objects, created objects, risks, conflicts, and final authorization validity without mutating Unity
- the existing approval-gated Unity read-only bridge has been verified to launch cleanly from a cold closed-app state, but it remains validation-only and does not authorize mutation
- the first controlled Unity mutation execution plan now exists as a fully gated plan artifact, but it always returns `execution_mode: disabled_plan_only`, `mutation_enabled: false`, and `executed: false`
- the final mutation execution switch now exists as a separate explicit gate, but the default output still reports `final_mutation_switch_enabled: false` and does not execute mutation in this step
- the first real Unity mutation created exactly one empty GameObject named `AIE_ControlledMutationProbe` in `EnemyAIDemo`, saved the scene, and preserved clean post-mutation validation with missing scripts `0`, console errors `0`, and object count `14`
- the separately approved rollback path removed exactly `AIE_ControlledMutationProbe` from `EnemyAIDemo`, saved the scene, and preserved clean post-rollback validation with missing scripts `0`, console errors `0`, and object count `13`
- rollback remains tightly bounded to the single reviewed target `AIE_ControlledMutationProbe` in `EnemyAIDemo`; missing targets return safe explicit results and broader scene edits remain out of scope
- repeatability is now verified live for the same lane: clean baseline `13`, repeat mutation `13 -> 14`, duplicate mutation idempotent with object count held at `14` and a single target object, repeat rollback `14 -> 13`, and missing-target rollback idempotent with object count held at `13`
- no broad Unity mutation path exists beyond the single reviewed scene object creation lane and its separately approved rollback lane
- additional mutation types remain future work
- chat remains advisory only with `safe_to_execute: false` and cannot invoke any mutation path directly

## Layer 16 / Multi-Action Execution Chains

Layer 16 now includes a first bounded multi-action Unity execution chain. It stays pinned to the verified Layer 15 single-object lane and exposes ordering, rollback, readiness, and controlled execution evidence through the existing operator-visible evidence surfaces.

Current Layer 16 status:

- Step 1 planning-only multi-action chain model: implemented
- Step 2 chain execution-readiness evaluation: implemented
- Step 3 first controlled multi-action chain execution: implemented for one exact sequential `create -> rollback` pair
- Step 4 partial failure handling and rollback planning: implemented without automatic rollback execution
- supported chain action types: `unity_scene_object_creation` and `unity_scene_object_rollback` only
- dependency ordering and cycle refusal: implemented
- rollback order preview: implemented
- rollback planning for already executed successful actions after a later failure: implemented
- unsupported action type refusal: implemented
- per-action gate scoring for review approval, operator approval, dry-run preview, preflight simulation, final authorization, live validation, execution plan, and final switch: implemented
- dependency-blocked downstream action evaluation: implemented
- operator-visible chain preview, readiness, and execution rendering: implemented
- chain execution: implemented only for the exact two-action bounded sequential lane
- chat execution: still refused with `safe_to_execute: false`

Current Layer 16 boundary:

- every chain action must stay inside the verified Layer 15 lane for `AIE_ControlledMutationProbe` in `EnemyAIDemo`
- the planning artifact returns `execution_mode: multi_action_chain_plan_only`, `chain_ready: false`, `dry_run: true`, and `executed: false`
- the readiness artifact returns `execution_mode: multi_action_chain_readiness_only`, `executed: false`, and never mutates Unity
- the execution artifact returns `execution_mode: controlled_multi_action_chain_runtime_bridge` and uses only the existing Layer 15 creation and rollback executors
- ordering is resolved from declared dependencies and cyclic graphs are blocked explicitly
- rollback preview is rendered in reverse action order as an operator-visible artifact only
- readiness can report `not_ready`, `partially_ready`, or `ready_for_operator_execution`; only `ready_for_operator_execution` can enter the bounded Step 3 execution path
- execution is limited to one exact sequential `unity_scene_object_creation` action followed by one dependent `unity_scene_object_rollback` action
- execution stops on the first failure, classifies the failure, preserves the execution trace, and can produce a rollback plan only for already executed successful actions
- rollback planning remains advisory only: rollback requires separate operator approval, `auto_execute: false`, and `executed: false`
- rollback is never auto-executed in Layer 16 Step 4 and still uses the separately approved Layer 15 rollback executor when explicitly requested later
- chain execution never bypasses Layer 15 gates or calls Unity outside the existing reviewed bridge lanes
- unsupported mutation types and out-of-lane targets are refused explicitly
- broader multi-action Unity execution paths, branching chains, parallel chains, and new mutation types remain out of scope

## Layer 17 / Controlled Rollback Execution

Layer 17 now starts the controlled recovery loop by allowing a reviewed chain rollback plan to execute, but only through a separately approved manual trigger that stays pinned to the existing Layer 15 rollback lane.

Current Layer 17 status:

- Step 1 controlled rollback execution from chain plans: implemented
- Step 2 controlled chain failure simulation: implemented
- Step 3 failure classification hardening and evidence integrity: implemented
- Step 4 controlled recovery loop under simulated failure: implemented for the bounded `create -> simulated failure -> reviewed rollback plan -> manual rollback` path
- Step 5 recovery repeatability and manual rollback idempotency: implemented for repeated bounded recovery loops and explicit missing-target rollback evidence
- supported rollback type: `unity_scene_object_removal` only
- rollback execution entrypoint: `executePlannedUnityRollbackFromChain`
- rollback plan source: reviewed Layer 16 Step 4 rollback-plan artifact only
- rollback execution path: sequential only, stop on first failure, no retry, no parallel rollback
- controlled failure simulation: explicit operator-enabled test control only for the bounded chain execution lane
- rollback execution evidence: implemented in the operator-visible evidence surfaces
- bounded recovery-loop proof: explicit evidence now calls out `SIMULATED FAILURE`, `ROLLBACK PLAN GENERATED`, `ROLLBACK NOT AUTO-EXECUTED`, and `MANUAL ROLLBACK EXECUTED`
- repeatability proof: bounded recovery loop stays `13 -> 14 -> 13` on consecutive runs, and manual rollback on an already-absent target stays safely at `13`
- final live stress validation: passed `10` consecutive live `13 -> 14 -> 13` recovery cycles against `AIE_ControlledMutationProbe` in `EnemyAIDemo` with `missing scripts = 0` and `console errors = 0` on every cycle
- final rollback idempotency closeout: passed with `controlled_rollback_idempotent` / `already_missing_idempotent`, object count held at `13`, and final live validation remained `checked_clean`
- final regression closeout: `npm run test:trace:safe` passed with `962` tests and `0` failures after the live stress run
- chat execution: still refused with `safe_to_execute: false`

Current Layer 17 boundary:

- rollback remains manual only and is never auto-executed
- controlled failure simulation is explicit test/recovery tooling only and never masquerades as a real Unity runtime failure
- failure evidence now distinguishes simulated failures, gate failures, dependency failures, real runtime failures, rollback failures, and unknown failures without introducing auto-recovery
- the bounded recovery loop is now proven as repeatable `13 -> 14 -> 13` for `AIE_ControlledMutationProbe` in `EnemyAIDemo` when a simulated second-action failure is followed by separate manual rollback execution
- rollback requires separate rollback review approval and separate rollback operator approval; mutation approvals cannot be reused
- simulated failures can stop chain execution and generate rollback planning for prior successful actions, but rollback remains manual and separately gated
- rollback still requires explicit final rollback authorization and explicit final rollback switch per action
- rollback execution validates scene and object scope before using the existing Layer 15 rollback executor
- rollback execution never bypasses Layer 15 gates and never calls Unity directly outside the reviewed rollback bridge lane
- missing-target rollback behavior is surfaced explicitly as idempotent evidence and is never hidden as a silent success
- only the verified `AIE_ControlledMutationProbe` removal in `EnemyAIDemo` is supported
- broader rollback types, auto-recovery, self-healing behavior, chat-triggered rollback, and parallel recovery remain out of scope

## Layer 18 / State-Aware Chain Execution

Layer 18 extends the bounded Unity chain lane with truthful pre-action state gates and post-action verification, while keeping the Layer 17 manual rollback boundary intact.

Current Layer 18 status:

- Step 1 tracked-object read-only state bridge: implemented
- Step 2 pre-action state gating: implemented
- Step 3 post-action state verification: implemented
- Step 4 chain state snapshot capture: implemented
- Step 5 bounded multi-action state-aware chain execution: implemented for reviewed two-step `create -> create` and `create -> rollback` chains
- Layer 18 Step 3 - Multi-Action Rollback Planning: implemented for reviewed two-step `create -> create` rollback recovery
- Layer 18 Step 4 - Multi-Action Repeatability: implemented for reviewed two-step `create -> create` repeatability proof
- added rollback planning for multiple executed chain actions
- rollback plans now preserve reverse execution order across executed chain targets
- manual rollback can restore `15 -> 13` after two successful creates
- repeated rollback remains idempotent
- verified repeated multi-action chain execution
- confirmed rollback stability across cycles
- confirmed no state drift
- confirmed full system repeatability
- Layer 17 manual recovery guarantees preserved
- supported scope: the reviewed bounded chain lane for `AIE_ControlledMutationProbe` and `AIE_ControlledMutationProbe_Companion` in `EnemyAIDemo`
- read-only truth source: `UnityValidationProbe.cs` plus `unityReadOnlyRuntimeBridge.ts`
- new failure classifications surfaced in chain execution: `state_gate_failed`, `state_verification_failed`, and `dependency_failed`
- blocked execution evidence now calls out `PRE-ACTION STATE GATE FAILED` and `CHAIN STOPPED BEFORE MUTATION` when a truthful state gate blocks before mutation
- focused chain tests: `48/48` passing
- bridge plus evidence tests: `25/25` passing
- broader regression closeout: `npm run test:trace:safe` passed after Layer 18 changes
- live Unity validation closeout: passed against the real `EnemyAIDemo` scene with clean baseline `13`
- live repeatability validation: repeated 5 reviewed `create -> create` cycles returned `13 -> 15 -> 13` every time with zero missing scripts and zero console errors
- live repeatability validation: rollback plan fingerprint and rollback execution evidence stayed identical across all cycles
- live repeatability validation: final reviewed rollback rerun stayed idempotent with `controlled_rollback_idempotent` evidence and final scene count remained `13`

Current Layer 18 boundary:

- state gates use read-only Unity truth and do not infer object existence from synthetic count deltas alone
- verification remains bounded to the existing reviewed Layer 15 and Layer 17 Unity bridge lanes
- chain execution still stops on first failure, preserves evidence, and never auto-executes rollback
- rollback approval remains separate from mutation approval and cannot reuse the original chain execution approval
- only the verified bounded two-step `AIE_ControlledMutationProbe` and `AIE_ControlledMutationProbe_Companion` chain lane in `EnemyAIDemo` is supported
- broader branching chains, parallel chains, new mutation types, auto-recovery, and chat-triggered execution remain out of scope

## Layer 19 / Node Boundary Contract

Layer 19 starts with a boundary-only contract between AI-E Core Execution and AI-E Node. This step does not connect Node to execution.

Current Layer 19 Step 1 status:

- Layer 19 Step 1 - Node Boundary Contract: implemented
- added Node intent envelope
- added Node boundary guard
- Node can submit structured intent only
- Node can receive validation feedback, planning and review status, and evidence summaries
- Node cannot execute, approve, rollback, or mutate Unity
- Core execution gates remain unchanged
- accepted Node intents are reviewable input only and stay on the required `Strategy -> Planning -> Execution -> Review -> Delivery -> Studio Control` path
- direct Node execution and direct Node rollback requests are explicitly blocked with evidence labels
- Unity behavior remains unchanged and the verified bounded lane stays isolated from Node
- Layer 19 Step 2 - Node Planning Advisory Integration: implemented
- added advisory `planning_hint`, `validation_hint`, and `dependency_hint` handling
- Node planning hints are visible during planning but remain non-binding
- system planning remains authoritative and execution authority stays `system_only`
- conflicting Node hints are rejected or overridden in favor of the system plan with explicit evidence labels
- Node planning hints cannot bypass validation, review, delivery, Studio Control, or manual approval gates
- execution behavior remains unchanged and Node still cannot execute, approve, rollback, or mutate Unity
- Layer 19 Step 3 - Core to Node Task Translation Drafts: implemented
- added `translatePlanToNodeTask(plan)` for unsigned Node-compatible task draft generation
- Core task translation output is draft-only with `approval_status: pending` and `signature: null`
- explicit `target_node_id` is required and unsafe commands are rejected during draft validation
- Core cannot sign tasks, submit tasks, trigger Node intake, or trigger execution from this layer
- translated drafts remain operator-gated and preserve the required `Strategy -> Planning -> Execution -> Review -> Delivery -> Studio Control` path
- evidence labels now show draft generation, draft-only storage, and that Node execution was not triggered
- Layer 19 Step 4 - Node Draft Integration / Operator Pipeline Sync: implemented
- added `exportNodeTaskDraftToPipeline(plan)` to write shared-directory `NodeDispatchRecord` drafts into `drafts/tasks/`
- Core-generated drafts now use the existing Node draft file shape with bounded execution payload metadata and remain unread by workers until manually submitted
- manual submission is handled through `submit_draft.py --confirm-submit`, which validates the draft, checks `target_node_id`, and writes the queued job into the existing registry `jobs/` path
- Core still cannot sign tasks, submit directly to intake, bypass `--confirm-submit`, or trigger automatic execution
- Node worker behavior remains unchanged: drafts do nothing in `drafts/tasks/`, submitted jobs enter the normal review and execution pipeline, and operator control remains required

## Layer 20 / Execution Result Learning Substrate

Layer 20 starts the append-only execution outcome substrate for future learning analysis. This step records execution results after they complete and does not introduce autonomy, approval bypasses, or retry behavior.

Current Layer 20 Step 1 status:

- Layer 20 Step 1 - Execution Result Learning Substrate: implemented
- added append-only execution outcome records under `data/execution_outcomes/`
- captures completed, failed, and blocked task results from the Core-to-Node operator-confirmed workflow
- records Core and Node execution evidence, approval path, execution path, task metadata, and result summaries
- outcome recording is post-result only and does not trigger autonomy, retry, approval, or execution
- Node worker behavior remains unchanged while completed results now append stable JSONL learning-substrate records
- this step establishes the data foundation for future learning without training models or changing Layer 17, 18, or 19 behavior

Current Layer 20 Step 3 status:

- Layer 20 Step 3 - Insight Generation Layer: implemented
- added `generateExecutionInsights(outcomes)` and deterministic analytics in `web/lib/aie/executionInsight.ts`
- derives read-only insights for node performance, command success or failure patterns, rollback frequency, and risk-level correlation
- includes structured supporting metrics plus bounded confidence scores for each generated insight
- can render optional human-readable summaries without triggering execution, retries, approvals, or plan changes

Current Layer 20 Step 4 status:

- Layer 20 Step 4 - Insight Surfacing & Operator Visibility: implemented
- added `renderExecutionInsights(insights)` in `web/lib/aie/executionInsightOutput.ts` for display-only operator-facing summaries
- surfaces Node reliability, failure patterns, rollback frequency, and risk-level insights in a readable grouped format
- added `npm run insights` and `npx tsx scripts/showInsights.ts` for read-only CLI visibility over `data/execution_outcomes/`
- insight surfacing remains display-only and does not trigger execution, approvals, retries, or plan changes

## Layer 21 / Insight Annotation

Layer 21 starts the non-binding annotation layer that allows generated insights to be attached to plans as informational guidance without influencing execution, approvals, gates, or plan validity.

Current Layer 21 Step 1 status:

- Layer 21 Step 1 - Insight Annotation: implemented
- added `attachInsightsToPlan(plan, insights)` in `web/lib/aie/nodeBoundary.ts`
- attaches informational annotations such as risk warnings, reliability notes, and pattern notes to planning objects
- annotated plans remain visible during planning while preserving the existing execution path and validation gates unchanged
- translation and draft export behavior remain unchanged because annotations are non-binding and do not flow into execution decisions

Current Layer 21 Step 2 status:

- Layer 21 Step 2 - Operator Acknowledgement of Insights: implemented
- added `operator_acknowledgement` metadata to annotated plans in `web/lib/aie/nodeBoundary.ts`
- added `acknowledgePlanInsights(plan, acknowledgedAt?)` to record acknowledgement timestamps without changing plan behavior
- added `buildInsightAcknowledgementPrompt(plan)` for a visible pre-submission acknowledgement prompt when insights are present
- acknowledgement remains informational only and does not block execution, alter validation gates, or change approval flow

Current Layer 21 Step 3 status:

- Layer 21 Step 3 - Insight Severity Levels: implemented
- added severity levels (`low`, `medium`, `high`, `critical`) to generated insights and non-binding plan annotations
- severity is derived from observed failure rate, rollback frequency, and risk-correlation signals in `web/lib/aie/executionInsight.ts`
- output surfaces now display severity clearly in the CLI insight renderer and the optional acknowledgement prompt
- severity remains informational only and does not affect execution, approvals, gates, or plan validity

## Safe Runtime Action Bridge

AI-E can now translate supported live operator actions into safe runtime intents.

Current contract:

- module path: `web/lib/aie/safeRuntimeActionBridge.ts`
- supported operator actions: `approve_goal`, `pause_goal`, `resume_goal`, `retry_goal`, `pause_all_sessions`, `resume_safe_sessions`, `prioritize_review_queue`, `prioritize_delivery_queue`, `acknowledge_studio_risk`, `request_studio_summary`, `approve_policy_recommendation`, `reject_policy_recommendation`, `defer_policy_recommendation`, `request_meta_summary`, `acknowledge_pattern`, `approve_strategy_goal`, `reject_strategy_goal`, `defer_strategy_goal`, `activate_strategy_goal`, `pause_strategy_goal`, `archive_strategy_goal`, `decompose_strategy_goal`, `request_strategy_summary`, `submit_chat_message`, `select_chat_option`, `archive_chat_session`, and `request_chat_summary`
- supported runtime intents: `grant_session_approval`, `pause_active_goal`, `resume_paused_goal`, `mark_goal_retry_requested`, `pause_all_sessions`, `resume_safe_sessions`, `prioritize_review_queue`, `prioritize_delivery_queue`, `acknowledge_studio_risk`, `request_studio_summary`, `approve_policy_recommendation`, `reject_policy_recommendation`, `defer_policy_recommendation`, `request_meta_summary`, `acknowledge_pattern`, `approve_strategy_goal`, `reject_strategy_goal`, `defer_strategy_goal`, `activate_strategy_goal`, `pause_strategy_goal`, `archive_strategy_goal`, `decompose_strategy_goal`, `request_strategy_summary`, `submit_chat_message`, `select_chat_option`, `archive_chat_session`, `request_chat_summary`, and `no_op`

Example:

- operator clicks Approve on a live runtime approval requirement
- bridge result: `status: action_ready`
- runtime intent: `grant_session_approval`
- reason: `session approval is required and may be granted through the runtime approval path`

Safety boundary:

- this layer does not run shell commands, commit, push, deploy, or bypass approvals
- it does not mutate repo files directly
- it validates the requested action against the current operator state and only produces safe runtime intents
- accepted live actions can now be handed to the runtime mutation executor for bounded persisted state updates

## Runtime Mutation Executor

AI-E can now execute safe runtime intents and persist runtime state changes through the runtime state store.

Current contract:

- module path: `web/lib/aie/runtimeMutationExecutor.ts`
- post-mutation loop controller: `web/lib/aie/executionLoopController.ts`
- supported runtime intents: `grant_session_approval`, `pause_active_goal`, `resume_paused_goal`, `mark_goal_retry_requested`, `pause_all_sessions`, `resume_safe_sessions`, `prioritize_review_queue`, `prioritize_delivery_queue`, `acknowledge_studio_risk`, `request_studio_summary`, `approve_policy_recommendation`, `reject_policy_recommendation`, `defer_policy_recommendation`, `request_meta_summary`, `acknowledge_pattern`, `approve_strategy_goal`, `reject_strategy_goal`, `defer_strategy_goal`, `activate_strategy_goal`, `pause_strategy_goal`, `archive_strategy_goal`, `decompose_strategy_goal`, `request_strategy_summary`, `submit_chat_message`, `select_chat_option`, `archive_chat_session`, `request_chat_summary`, and `no_op`
- output statuses: `mutation_applied`, `mutation_rejected`, and `mutation_no_op`

Execution flow:

- operator clicks Approve, Pause, Resume, or Retry
- the safe runtime action bridge validates the request and produces a runtime intent
- the runtime mutation executor validates the persisted live runtime state again before mutation
- the updated operator snapshot is persisted only through `web/lib/aie/runtimeStateStore.ts`
- approval, resume, and retry mutations may trigger one bounded background queue pass through the execution loop controller
- that bounded pass reuses the existing background queue and session runtime, then rebuilds the dashboard from the queue result
- the operator dashboard refreshes against the persisted live runtime state

Example:

- operator clicks Approve on a live runtime approval requirement
- flow: `approve_goal -> grant_session_approval -> mutation applied -> session unblocked`

Safety boundary:

- the executor does not run shell commands or modify repo files
- it does not bypass validation layers, approval freshness checks, session constraints, or dependency constraints
- the post-mutation execution loop is bounded by queue/session limits and does not create a second autonomous runtime path
- persisted changes are bounded to the runtime state store and include deterministic audit events

## Continuous Runtime Loop

AI-E can now run repeated bounded execution cycles over time against persisted live runtime state instead of stopping after a single post-mutation pass.

Current contract:

- module path: `web/lib/aie/continuousRuntimeLoop.ts`
- entry points: `runContinuousRuntimeLoop()`, `loadContinuousRuntimeLoopConfig()`, `createContinuousRuntimeLoopClock()`, and `summarizeContinuousRuntimeLoop()`
- loop statuses: `loop_running`, `loop_completed`, `loop_blocked`, `loop_paused`, `loop_stopped`, and `loop_error`
- trigger sources: runtime entrypoint start, time-based trigger, and accepted live operator mutations

Execution flow:

- load the persisted runtime state from `web/lib/aie/runtimeStateStore.ts`
- stop immediately if validation, approval, blocked-only, paused-only, or completed-only conditions already apply
- run one bounded execution pass through `web/lib/aie/executionLoopController.ts`
- persist the updated operator dashboard and continuous loop snapshot
- advance to the next bounded tick only when the configured interval budget is satisfied
- stop when work completes, approvals are needed, blockers remain, errors occur, or the max tick bound is reached

Example:

- operator clicks Approve on a live runtime approval requirement
- flow: `approve_goal -> grant_session_approval -> mutation applied -> continuous loop starts -> bounded execution ticks run -> goals progress -> loop stops when blocked, paused, completed, or max ticks are reached`

Safety boundary:

- this is controlled, repeating, bounded execution rather than unbounded background autonomy
- each tick still reuses the existing bounded execution loop controller and queue/session runtime guardrails
- freshness requirements, blocker stops, and max tick limits remain enforced on every run
- the continuous loop persists only runtime state snapshots and deterministic tick history; it does not bypass repo mutation approvals

## Autonomy Layer Status

AI-E has achieved single-agent time-based continuous execution, but not yet full self-directed studio autonomy.

Current layer status:

- runtime state provider: shipped
- operator control surface: shipped
- safe runtime action bridge: shipped
- runtime mutation executor: shipped
- bounded execution loop: shipped
- continuous runtime loop: shipped
- runtime persistence: shipped
- live browser proof at `/operator`: shipped
- observability layer: shipped with persisted runtime timeline events, semantic transitions, and safety-gate visibility
- multi-agent orchestration: scaffolded, bounded, and not yet driving live runtime execution
- fully self-directed operation: not started

What this means today:

- AI-E can continue bounded work across time after one safe operator action
- `/operator` can now show the latest tick, last mutation, last semantic transition, next scheduled tick, latest safety gate decision, and a persisted runtime timeline
- pre-tick review gates and approval gates are now logged as persisted runtime events instead of appearing as silent stops
- timestamp-only observations are tracked separately from semantic progress so the system does not over-claim autonomy

What is not true yet:

- AI-E does not have unbounded background autonomy
- AI-E does not recursively spawn agents
- AI-E does not bypass review gates, approval freshness, or bounded execution limits
- AI-E does not yet run a live planner and executor pair against the continuous runtime loop

## Multi-Agent Runtime Roadmap

Layer 4 is complete.

Single-agent continuous execution is complete.

Deterministic proof is complete.

Multi-agent orchestration is complete within bounded runtime limits.

Layer 5 supervised autonomy is 100% complete.

Layer 6 - Resilient Overnight Autonomy: 100% COMPLETE

Layer 7 - Autonomous Work Planning + Operator Review Queue Intelligence is in progress.

Current phase plan:

- Phase 1: Agent Registry Hardening
- Phase 2: Multi-Agent Runtime Projection
- Phase 3: Bounded Agent Assignment Loop
- Phase 4: Execution Chains
- Phase 5: Deterministic Proof Upgrade

Current Layer 4 reporting rule:

- Layer 4: 100% COMPLETE
- Registry, assignment loop, execution chains, operator visibility, deterministic proof, trace validation, safety boundaries, and persistence checks are all verified together.

Current Layer 5 reporting rule:

- Layer 5: 100% COMPLETE
- Persisted supervised sessions, checkpoint persistence, bounded long-running controls, bounded recovery handling, the `/operator` supervised session panel, deterministic `proof:supervised-autonomy`, and full validation are all verified together.

Current Layer 6 reporting rule:

- Layer 6 - Resilient Overnight Autonomy: 100% COMPLETE
- Verified capabilities: overnight autonomy policy, operator review queue, bounded recovery loop, restart and resume from checkpoint, overnight `/operator` UI controls, all four safe proofs passing, `test:trace:safe` passing at 741/741, and stable resource-safe validation.
- This does not mean fully independent product shipping, unsupervised monetization, self-modifying autonomy, or autonomous deployment without review.

Current Layer 7 reporting rule:

- Layer 7: IN PROGRESS
- Only declare Layer 7 complete when the work item planner, prioritization engine, review package generator, operator planning UI, deterministic `proof:autonomous-planning`, previous safe proofs, `test:trace:safe`, and commit/push are all complete together.

Current Layer 8 reporting rule:

- Layer 8: IN PROGRESS
- Only declare Layer 8 complete when delivery packages, operator delivery approval gates, PR summary recommendations, validation evidence, rollback notes, deterministic `proof:delivery-pipeline`, previous safe proofs, `test:trace:safe`, and commit/push are all complete together.

Current Layer 9 reporting rule:

- Layer 9: 100% COMPLETE
- Verified capabilities: persisted multi-session registry, weighted-fair scheduler, bounded resource allocation, conflict detection, session coordination, `/operator` multi-session controls, deterministic `proof:multi-session:safe`, previous safe proofs, `test:trace:safe`, and commit/push.

Current Layer 10 reporting rule:

- Layer 10: IN PROGRESS
- Only declare Layer 10 complete when the studio command-center state contract, provider-boundary studio aggregator, `/operator` studio command-center UI, safe studio actions, persisted studio summary package, deterministic `proof:studio-command-center:safe`, all previous safe proofs, `test:trace:safe`, and commit/push are all complete together.

Current Layer 11 reporting rule:

- Layer 11: 100% COMPLETE
- Verified capabilities: performance-memory contract, pattern detector, bounded policy recommender, `/operator` Meta-Intelligence panel, safe meta actions, persisted meta summary package, deterministic `proof:meta-intelligence:safe`, all previous safe proofs, `test:trace:safe`, and commit/push.

Current Layer 12 reporting rule:

- Layer 12: 100% COMPLETE
- Verified capabilities: strategic goal contract, deterministic portfolio scorer, bounded goal decomposer, `/operator` Strategy Portfolio panel, safe strategy actions, persisted strategy summary package, deterministic `proof:strategy-engine:safe`, all previous safe proofs, `test:trace:safe`, and commit/push.

Current Layer 13 reporting rule:

- Layer 13: IN PROGRESS
- Only declare Layer 13 complete when the conversational session contract, intent router, response builder, pipeline adapter, `/operator` AI-E Chat panel, safe conversational actions, persisted chat summary state, deterministic `proof:conversational-command:safe`, all previous safe proofs, `test:trace:safe`, and commit/push are all complete together.
- Completion still requires preserving these boundaries: the chat layer is a receptionist, not the CEO; chat must not self-approve, self-execute, bypass review, or create a second execution path.

Roadmap checkpoints:

- Layer 1: observable single-agent execution
  - status: complete
  - proof surface: `web/lib/aie/continuousRuntimeLoop.ts`, `web/lib/aie/operatorRuntimeStateProvider.ts`, and `/operator`
- Layer 2: traceable semantic progression and gate visibility
  - status: complete
  - proof surface: persisted runtime timeline events with semantic transitions and safety-gate results
- Layer 3: extensible multi-agent runtime contract
  - status: scaffolded
  - proof surface: `web/lib/aie/orchestrationSession.ts` and `web/lib/aie/agentRuntimeRegistry.ts`
- Layer 4: bounded multi-agent runtime orchestration
  - status: complete
  - proof surface: `web/lib/aie/continuousRuntimeLoop.ts`, `web/lib/aie/agentRuntimeRegistry.ts`, `web/lib/aie/executionChainState.ts`, `/operator`, and the Layer 4 runtime proofs
- Layer 5: long-running supervised autonomy sessions
  - status: complete
  - proof surface: persisted supervised session state, checkpoints, bounded session controls, and `npm run proof:supervised-autonomy`
- Layer 6: resilient overnight autonomy recovery
  - status: complete
  - proof surface: overnight policy state, persisted review queue decisions, bounded recovery and resume metadata, `/operator`, and `npm run proof:overnight-autonomy:safe`
- Layer 7: autonomous work planning and operator review queue intelligence
  - status: in progress
  - proof surface: bounded work items, deterministic prioritization, review packages, `/operator`, and `npm run proof:autonomous-planning:safe`
- Layer 8: autonomous PR and delivery pipeline
  - status: in progress
  - proof surface: bounded delivery packages, operator approval gates, PR summary recommendations, `/operator`, and `npm run proof:delivery-pipeline:safe`
- Layer 9: coordinated multi-session orchestration
  - status: complete
  - proof surface: persisted autonomous session state, weighted-fair scheduling, bounded resource allocation, conflict and coordination visibility, `/operator`, and `npm run proof:multi-session:safe`
- Layer 10: autonomous studio operations command center
  - status: in progress
  - proof surface: provider-boundary studio health aggregation, studio command-center operator controls, persisted studio risk acknowledgements and summary package state, `/operator`, and `npm run proof:studio-command-center:safe`
- Layer 11: self-improving system / meta-intelligence
  - status: complete
  - proof surface: persisted meta-intelligence state, deterministic pattern detection, bounded policy recommendations, meta summary package state, `/operator`, and `npm run proof:meta-intelligence:safe`
- Layer 12: strategy engine / goal portfolio management
  - status: complete
  - proof surface: persisted strategic goal state, deterministic portfolio ranking, bounded decomposition state, strategy summary package state, `/operator`, and `npm run proof:strategy-engine:safe`
- Layer 13: conversational command layer
  - status: in progress
  - proof surface: persisted conversational session state, bounded intent routing, chat summary state, `/operator`, and `npm run proof:conversational-command:safe`


## Multi-Agent Orchestration Scaffold

AI-E now includes a safe initial multi-agent scaffold that reuses the existing planner and executor vocabulary without creating a second autonomous runtime path.

Current contract:

- orchestration vocabulary: `web/lib/aie/orchestrationSession.ts`
- bounded agent registry scaffold: `web/lib/aie/agentRuntimeRegistry.ts`
- focused regression coverage: `web/lib/aie/agentRuntimeRegistry.test.ts`
- bounded execution chain snapshots: `web/lib/aie/executionChainState.ts`

Current safety boundary:

- the scaffold is capped to the known `planner-agent`, `executor-agent`, `validator-agent`, and `reporter-agent` roles
- each agent can own at most one bounded goal at a time
- child-agent spawning is disabled explicitly
- pause, resume, blocked, and idle transitions are modeled, but no unbounded agent loop is started from this scaffold
- live continuous runtime execution now projects bounded agent and chain state through the owning runtime loop without bypassing the existing approval and stop gates

## Conversational Intent Refinement

## Multi-Turn Conversational Loop

AI-E now also includes a deterministic multi-turn conversational loop that runs before conversational refinement and planning. This layer lets AI-E ask a small number of useful follow-up questions, remember clarification answers inside one session, and only produce a planner-ready request when the user intent becomes clear enough.

What the multi-turn loop does:

- starts a clarification session from a raw user request
- runs conversational intent refinement on the current interpreted request state
- asks at most 1 to 3 follow-up questions at a time when ambiguity remains
- stores user answers, updated interpretation, missing information, and transcript turns inside the session
- produces a planner-ready request only when the clarified request is specific enough and safe enough
- blocks unsafe or overly broad autonomy requests before they can reach planning

Current contract:

- module path: `web/lib/aie/multiTurnConversationalLoop.ts`
- main entry points: `startConversationalLoop(input)`, `answerConversationalLoopQuestion(session, answer)`, `evaluateConversationalLoop(session)`, and `summarizeConversationalLoop(session)`
- session statuses: `awaiting_clarification`, `planner_ready`, `blocked`, and `needs_review`

How it fits into the bounded intake bridge:

```text
raw user message
-> multi-turn conversational loop
-> conversational intent refinement
-> planner-ready request
-> Operator-Light Planner
```

Example:

```text
User: make game better
AI-E: Which part should improve first: enemies, weapons, controls, visuals, or level design?
User: enemies
AI-E: What should enemies do better first: react faster, aim better, flank smarter, or respond to player actions more clearly?
User: when grenade blows up
AI-E: creates a planner-ready request for enemy reaction behavior to grenade explosions
```

Why this improves any-user usability:

- vague or low-vocabulary requests no longer depend on chat history alone to become actionable
- the system preserves the original request, questions asked, answers received, updated interpretation, and next action in one deterministic session record
- downstream refinement and planning receive clearer bounded input without pretending unclear intent is already execution-ready

Current limitation:

- this version is deterministic and rule-based only
- no live LLM dialogue or external API calls are used
- it is not wired into autonomous execution yet

## Adaptive Conversational Questioning

AI-E now also includes adaptive conversational questioning on top of the multi-turn loop. This upgrade decides when AI-E should ask a follow-up, when confidence is high enough to proceed to planning, and when it should stop asking because more clarification is no longer adding enough signal.

What the adaptive layer does:

- upgrades confidence scoring with deterministic bonuses and penalties from missing information, answer quality, and risk
- evaluates whether another question is necessary or whether AI-E can proceed with bounded assumptions
- prioritizes scope-defining questions ahead of system-impact and validation-critical questions
- stops asking after confidence is sufficient, follow-up value is diminishing, vague answers repeat, or the request becomes high risk

Current contract:

- module path: `web/lib/aie/adaptiveConversationalLogic.ts`
- main entry points: `computeConfidenceScore(session)`, `shouldAskFollowUp(session)`, `selectBestFollowUpQuestion(session)`, `shouldStopAsking(session)`, and `determineNextAction(session)`
- adaptive loop fields: `confidence_score`, `clarity_score`, `question_necessity`, `question_priority`, and `stop_reason`

How it improves the loop:

```text
raw user message
-> multi-turn loop session
-> adaptive confidence / question necessity check
-> ask one better question or proceed to planning
```

Example:

```text
User: make game better
AI-E: Which part should improve first: enemies, weapons, or controls?
User: enemies
AI-E: What should enemies do better first?
User: when grenade blows up
AI-E: proceeds to planning without asking more questions
```

Why this improves usability:

- AI-E asks fewer but higher-value questions
- the system can stop asking once confidence is high enough instead of forcing extra clarification
- repeated vague answers no longer trap the conversation in an endless clarification loop

Current limitation:

- the scoring remains deterministic and rule-based only
- no live LLM dialogue policy or learning layer exists yet
- this still does not modify execution, patching, or autonomous runtime behavior

## Session Context Memory

AI-E now also includes a deterministic session context memory layer that carries clarified intent, lightweight user preferences, and recent goals forward across multiple interactions inside one session. This is structured carryover, not raw chat history.

What the session context layer does:

- stores recent planner-ready intent snapshots from completed conversational loops
- extracts lightweight preferences such as focus area or preferred system emphasis
- tracks recurring targets, last planner-ready request, and confidence history
- augments new requests only when the previous context is still relevant
- avoids storing raw transcript logs, sensitive content, or long-term persistence

Current contract:

- module path: `web/lib/aie/sessionContextMemory.ts`
- main entry points: `createSessionContext(session_id)`, `updateSessionContext(context, loopSession)`, `extractPreferences(loopSession)`, `mergeIntentSnapshots(context, loopSession)`, `getContextAugmentedRequest(context, newInput)`, and `summarizeSessionContext(context)`
- stored fields: `session_id`, `created_at`, `updated_at`, `recent_intents`, `resolved_preferences`, `recurring_targets`, `last_planner_ready_request`, `confidence_history`, `conversation_summary`, and `context_version`

How it differs from the conversational loop:

- the conversational loop handles short-term clarification inside one request
- session context memory carries the resolved outcomes of prior clarified requests into the next request
- the context layer stores structured summaries and preferences, not raw turn-by-turn chat history

Example carryover:

```text
Session 1:
User: make game better
AI-E: narrows to enemies, then grenade reaction behavior
Stored context: focus-area=enemies, recent intent=Improve enemy AI reaction to grenade explosions.

Session 2:
User: improve combat feel
AI-E: reuses the relevant enemy/combat preference when building the augmented request context
```

Current limitation:

- this version is deterministic and in-memory only
- no disk, database, or long-term persistence is added yet
- context reuse is relevance-gated and intentionally lightweight to avoid pollution

## Intent Confidence Calibration

AI-E now also includes an intent confidence calibration layer that makes conversational decisions more predictable, explainable, and consistent. This layer separates ambiguity scoring from completeness scoring, then combines them with the existing clarity signal to decide whether AI-E should proceed, ask one question, ask up to two prioritized questions, or block for review.

What the calibration layer does:

- computes a deterministic `ambiguity_score` from vague wording, missing targets, missing actions, missing scope, conflicting signals, and risky autonomy patterns
- computes a deterministic `completeness_score` from target-system coverage, action coverage, scope coverage, and missing-field severity
- combines clarity, completeness, and inverse ambiguity into a calibrated `confidence_score`
- emits a `decision_reason` so the loop can explain why it asked, proceeded, or blocked

Current contract:

- module path: `web/lib/aie/intentConfidenceScoring.ts`
- main entry points: `computeAmbiguityScore(input)`, `computeCompletenessScore(input)`, `computeConfidenceScore(input)`, `buildConfidenceBreakdown(input)`, and `determineConfidenceDecision(result)`
- computed fields: `ambiguity_score`, `completeness_score`, `confidence_score`, `critical_missing_fields`, `non_critical_missing_fields`, `ambiguity_flags`, and `decision_reason`

How AI-E now decides:

```text
confidence >= 0.8
-> proceed to planning

0.5 <= confidence < 0.8
-> ask one focused question

confidence < 0.5
-> ask one or two prioritized questions

high ambiguity + high risk
-> block or needs review
```

Examples:

```text
User: make game better
Result: low completeness, high ambiguity
AI-E: asks one focused scope-defining question

User: make enemies react to grenades
Result: high completeness, low ambiguity
AI-E: proceeds to planning
```

Why this improves conversational decisions:

- ambiguity and incompleteness are no longer treated as the same problem
- the conversational loop can explain why it is asking instead of silently applying thresholds
- stop conditions and question budgets now use calibrated confidence instead of one coarse heuristic

## Intent Normalization Layer

AI-E now also includes a deterministic intent normalization layer that runs before conversational refinement. This layer helps AI-E handle slang, broken grammar, indirect phrasing, and vague emotional wording by mapping noisy input into cleaner structured intent without inventing missing details.

What the normalization layer does:

- normalizes slang and simplified shorthand into cleaner intent language
- repairs a small set of broken-grammar gameplay phrases into readable task language
- extracts likely targets and actions from noisy input
- flags low specificity, mixed signals, indirect phrasing, and uncertainty instead of guessing

Current contract:

- module path: `web/lib/aie/intentNormalization.ts`
- main entry points: `normalizeUserInput(input)`, `extractIntentComponents(input)`, `mapSynonyms(input)`, `detectTargets(input)`, and `detectActions(input)`
- output fields: `original_input`, `normalized_input`, `extracted_intent`, `detected_targets`, `detected_actions`, `normalization_flags`, and `normalization_confidence`

How it fits into conversational intake:

```text
raw user input
-> intent normalization
-> conversational refinement
-> adaptive conversational loop
-> planner-ready request
```

Examples:

```text
Input: enemy AI dumb make better
Output: improve enemy ai behavior

Input: game boring idk why
Output: improve game engagement
Flags: indirect-phrasing, low-specificity
```

Why this improves robustness:

- AI-E can now tolerate messier real-world phrasing before refinement begins
- cleaner normalized input improves downstream ambiguity and confidence scoring
- uncertainty is surfaced as flags instead of being hidden behind forced interpretation

## Intent Decomposition And Recovery

AI-E now also includes a deterministic intent decomposition layer that sits around the front of conversational intake. This layer breaks multi-intent requests into structured sub-intents, recovers likely meanings from extremely vague prompts, and flags conflicting signals before planning begins.

What the decomposition layer does:

- splits multi-part requests into ordered sub-intents
- preserves the original user input while producing cleaner structured summaries
- generates 1 to 3 bounded recovery candidates for very weak or low-signal prompts
- prioritizes more specific intents ahead of broader vague ones
- routes conflicting or unclear phrasing toward clarification instead of guessing

Current contract:

- module path: `web/lib/aie/intentDecomposition.ts`
- main entry points: `decomposeIntent(input)`, `detectMultipleIntents(input)`, `recoverVagueIntent(input)`, `prioritizeIntents(intents)`, and `summarizeDecomposition(result)`
- output fields: `original_input`, `normalized_input`, `sub_intents`, `recovery_candidates`, `primary_intent`, `multiple_intents_detected`, `conflicting_signals_detected`, `should_route_to_clarification`, `decomposition_flags`, and `decomposition_confidence`

How it fits into conversational intake:

```text
raw user input
-> intent decomposition and recovery
-> intent normalization
-> conversational refinement
-> adaptive conversational loop
-> planner-ready request
```

Examples:

```text
Input: fix docs and improve enemy reaction to grenades
Output: two ordered sub-intents

Input: make it better
Output: 1-3 likely recovery candidates
Flags: vague-intent-recovery, needs-clarification

Input: make enemies faster and slower
Output: clarification route
Flags: conflicting-signals
```

Why this completes any-user prompt handling:

- AI-E can now break apart messy compound prompts instead of treating them as one blurred request
- extremely vague input can be recovered into bounded clarification candidates without hallucinating a final plan
- conflicting phrasing is now surfaced explicitly before it pollutes downstream planning

## Conversational Tone Adaptation

AI-E now also includes a deterministic conversational tone adaptation layer that chooses how to explain, clarify, and hand off work based on user wording, estimated skill level, request style, and confidence. This layer changes communication guidance only. It does not change planning logic, execution behavior, or safety boundaries.

Response modes:

- `beginner_friendly`
- `standard`
- `technical`
- `handoff_only`
- `clarification_minimal`
- `safety_review`

Current contract:

- module path: `web/lib/aie/conversationalToneAdaptation.ts`
- main entry points: `detectUserSkillSignals(input)`, `selectResponseMode(input)`, `buildToneAdaptationGuidance(input)`, and `summarizeToneAdaptation(result)`
- output fields: `response_mode`, `user_level_estimate`, `detail_level`, `should_use_plain_language`, `should_include_examples`, `should_include_technical_terms`, `should_use_handoff_format`, `should_minimize_questions`, `safety_tone_required`, `reasons`, and `adapted_guidance`

How it helps any-user usability:

- beginner or low-vocabulary users get simpler explanations and example-driven clarifications
- technical users get concise contract-and-test phrasing instead of tutorial-style over-explaining
- handoff requests can skip explanatory prose and stay in direct handoff format
- risky autonomy requests are framed as safety reviews with blockers and one safe next step

Examples:

```text
Beginner input: idk make enemy less dumb
Mode: beginner_friendly
Effect: plain-language guidance and a simple example-based follow-up

Technical input: Add deterministic artifact eligibility gate with tests
Mode: technical
Effect: concise implementation guidance with precise contract and validation terms

Handoff input: next handoff please
Mode: handoff_only
Effect: concise handoff formatting with minimal explanatory prose
```

Integration path:

```text
raw user input
-> intent normalization
-> conversational refinement
-> tone adaptation guidance
-> adaptive conversational loop
-> planner-ready request
```

Why this layer matters:

- AI-E can now meet users where they are without permanently classifying them
- communication becomes more useful for public-facing usage without weakening deterministic behavior
- the loop can keep the same planning outputs while changing only response framing

## Conversational Readiness Orchestrator

AI-E now also includes a deterministic conversational readiness orchestrator that combines normalization, confidence scoring, tone adaptation, session context, conversational refinement, and multi-turn loop state into one answer to a single question: is this request ready for planning right now?

Why it exists:

- the conversational stack is now strong enough that readiness should be decided in one place
- planning gates need one explainable answer instead of several separate conversational signals
- the orchestrator preserves existing module behavior while producing one unified readiness result

Status meanings:

- `ready_for_planning`: the request is normalized, confident enough, bounded enough, and has a planner-ready request
- `needs_clarification`: one or more answerable gaps still block safe planning
- `needs_review`: risk, context conflict, or broader impact requires human review before planning
- `blocked`: the request is unsafe or cannot be transformed into a bounded planning task

Current contract:

- module path: `web/lib/aie/conversationalReadinessOrchestrator.ts`
- main entry points: `evaluateConversationalReadiness(input)`, `buildPlannerReadinessPacket(input)`, `listConversationalReadinessBlockers(input)`, and `summarizeConversationalReadiness(result)`
- unified inputs considered: intent normalization, intent confidence scoring, tone adaptation, session context memory, conversational refinement, and multi-turn loop state

Example flow:

```text
Input: enemy no react grenade
-> normalized to improve enemy reaction to grenades
-> confidence scored
-> tone guidance selected
-> session context checked
-> ready_for_planning packet produced

Input: do everything automatically overnight
-> blocked
```

Planner readiness packet fields:

- `readiness_id`
- `created_at`
- `original_request`
- `normalized_input`
- `interpreted_intent`
- `planner_ready_request`
- `confidence_score`
- `ambiguity_score`
- `completeness_score`
- `tone_guidance`
- `session_context_summary`
- `missing_information`
- `assumptions`
- `risk_level`
- `next_action`
- `explanation`

Why this helps:

- AI-E can now answer readiness with one deterministic and explainable decision
- conversational modules remain composable, but readiness no longer has to be inferred across multiple surfaces
- session context and tone guidance now participate directly in the planning-readiness decision without changing execution behavior

AI-E now also includes a deterministic conversational refinement layer that runs before the Operator-Light Planner. This layer helps AI-E understand rough, vague, emotional, or low-detail user requests and either turn them into planner-ready task language or ask one small set of useful follow-up questions.

What the Conversational Intent Refinement layer does:

- accepts a raw user request before planning
- estimates whether the user is speaking in plain language, mixed language, or technical language
- detects ambiguity, risky autonomy asks, and missing detail without shaming the user
- asks at most 1 to 3 targeted follow-up questions when narrowing is needed
- produces planner-ready request text only when the request is clear enough and safe enough to plan

Current contract:

- module path: `web/lib/aie/conversationalIntentRefinement.ts`
- main entry point: `refineConversationalIntent(request)`
- optional adapter: `convertRefinementToPlannerRequest(refinement, sourceRequest)`
- output fields: `original_request`, `interpreted_intent`, `user_level_estimate`, `clarity_score`, `confidence_score`, `ambiguity_flags`, `missing_information`, `follow_up_questions`, `simplified_rest_above_user_request`, `planner_ready_request`, `should_ask_follow_up`, `should_create_plan`, `risk_level`, and `next_action`

How it fits with the Operator-Light Planner:

```text
rough user message
-> conversational intent refinement
-> planner-ready request or small follow-up question set
-> Operator-Light Planner
-> structured execution packet
```

Example input:

```ts
const request = {
  rawRequest: "i dont know how to say it but make it feel less boring",
};
```

Example output:

```ts
{
  original_request: "i dont know how to say it but make it feel less boring",
  interpreted_intent: "Improve player engagement or game feel.",
  user_level_estimate: "plain-language",
  clarity_score: 52,
  confidence_score: 58,
  ambiguity_flags: ["missing-target-area", "low-vocabulary-uncertainty", "playtest-sensitive"],
  follow_up_questions: [
    "Should we start with combat feel, enemy behavior, movement, visuals, or level pacing?"
  ],
  simplified_rest_above_user_request: "You want the game to feel less boring, but AI-E still needs one clear area to improve first.",
  planner_ready_request: null,
  should_ask_follow_up: true,
  should_create_plan: false,
  risk_level: "medium",
  next_action: "simplify",
}
```

Why this exists:

- users do not always describe tasks with technical vocabulary or precise scope
- AI-E should preserve the user’s meaning without pretending unclear requests are ready for execution
- downstream planning gets cleaner input, and risky broad asks are narrowed before they reach the planner

Current limitation:

- this version is deterministic and rule-based only
- no live LLM clarification or conversational memory expansion is used in this commit
- it is not wired into UI or autonomous execution yet

## Session Artifact Persistence

AI-E now also includes a deterministic session artifact layer for intake and planning packets. This layer turns conversational refinement results and Operator-Light Planner outputs into durable structured records that can be reviewed, stored, resumed, or handed off later without depending on chat history.

What the session artifact layer does:

- stores conversational refinement outputs as structured artifacts
- stores operator planning packets as structured artifacts
- combines refinement plus planning into one intake packet for future review or resume flows
- keeps artifact status explicit instead of implying approval or execution
- stays file-ready and deterministic without adding a database dependency yet

Current contract:

- module path: `web/lib/aie/sessionArtifacts.ts`
- main entry points: `createSessionArtifact(input)`, `createCombinedIntakePacket(refinement, plan)`, `updateSessionArtifactStatus(artifact, status)`, and `summarizeSessionArtifact(artifact)`
- artifact types: `conversational_refinement`, `operator_plan`, and `combined_intake_packet`
- status values: `planned`, `awaiting_clarification`, `approved`, `executing`, `validated`, `blocked`, and `archived`

How it fits with refinement and planning:

```text
raw user request
-> conversational refinement result
-> operator plan
-> session artifact record
-> future review, resume, or execution handoff
```

Example artifact summary:

```text
Artifact combined_intake_packet-20260424120000-make-enemies-smarter-when-grenade
Type: combined_intake_packet
Status: planned
Created: 2026-04-24T12:00:00.000Z
Source request: make enemies smarter when grenade blows up
Interpreted intent: Improve enemy AI reaction to grenade explosions.
Planner-ready request: Add enemy reaction behavior to grenade explosions in BABYLON.
Risk: low
Clarity: 90
Confidence: 88
Missing information: none.
Follow-up questions: none.
Repo targets: enemy AI scripts, grenade gameplay scripts, gameplay scenes or test levels, playmode or gameplay validation tests
Execution steps: 3
Validation steps: 3
Playtest required: yes.
Next operator decision: Approve the narrow implementation slice and identify the required playtest owner, scene, or validation session before execution starts.
```

Why this exists:

- refinement and planning packets need to survive beyond one chat turn
- future agents or operators need a stable structured handoff surface
- execution should later consume reviewed artifacts rather than infer state from conversation transcripts

Current limitation:

- this commit only provides deterministic in-memory and file-ready structures
- no database, cloud persistence, or UI browser is added yet
- it is not wired into autonomous execution yet

## Approval-Gated Artifact Execution Consumer

AI-E now also includes an approval-gated execution consumer for stored session artifacts. This is the first safe bridge from durable refinement and planning records toward future execution, but it does not execute anything. It only answers whether a stored artifact is eligible to move into a later execution chain.

What the execution consumer does:

- reads a stored session artifact and evaluates execution readiness
- requires explicit approval before an artifact can be marked ready
- blocks high-risk, underspecified, or incomplete artifacts
- explains why an artifact is blocked and recommends the next operator action
- keeps execution readiness separate from actual execution

Current contract:

- module path: `web/lib/aie/artifactExecutionConsumer.ts`
- main entry points: `evaluateArtifactForExecution(artifact)`, `listArtifactExecutionBlockers(artifact)`, and `summarizeExecutionDecision(decision)`
- decision statuses: `ready`, `blocked`, `needs_approval`, `needs_clarification`, `needs_validation_plan`, and `high_risk_blocked`

What “ready” means here:

- the artifact status is already `approved`
- the artifact risk is not `high` or `blocked`
- blocking missing information has been resolved
- validation steps exist
- git commit guidance exists
- the next operator decision no longer asks for clarification
- playtest scope is explicitly identified through the artifact flag

What this does not do yet:

- it does not run git commands, shell commands, or repo mutations
- it does not auto-approve artifacts or change their status
- it does not wire directly into autonomous execution or UI flows in this commit

How it fits into the future bridge:

```text
conversation
-> refinement
-> planning
-> session artifact
-> approval gate
-> future execution chain
```

Why approval comes first:

- stored artifacts should not become executable just because they exist
- operators need a deterministic gate that confirms readiness before any execution bridge consumes the plan
- later execution chains should consume reviewed artifacts, not infer approval from chat state

## Reviewed Execution Bridge Adapter

AI-E now also includes a reviewed execution bridge adapter that converts an approved artifact plus a `ready` execution decision into a reviewed execution handoff packet. This is still not execution. It is a structured handoff for a future dry-run runner or reviewed execution chain.

What the reviewed bridge does:

- consumes only approved artifacts that already passed the execution readiness gate
- produces a reviewed execution handoff packet with scoped actions and completion reporting requirements
- blocks handoff creation when approval, readiness, validation, commit guidance, or risk requirements are not met
- keeps allowed and disallowed actions explicit inside the handoff packet

Current contract:

- module path: `web/lib/aie/reviewedExecutionBridge.ts`
- main entry points: `createReviewedExecutionHandoff(input)`, `buildExecutionHandoffPacket(artifact, decision)`, and `summarizeReviewedExecutionBridge(result)`
- bridge statuses: `handoff_ready`, `blocked`, `needs_review`, `needs_approval`, and `high_risk_blocked`

How it fits with the current bounded pipeline:

```text
conversation
-> refinement
-> planning
-> artifact
-> approval gate
-> reviewed execution handoff
-> future dry-run runner
```

Why this is still not autonomous execution:

- the bridge creates a packet only after explicit approval and a `ready` gate decision
- it does not run git commands, shell commands, or repo mutations
- it does not approve artifacts, mutate status, or bypass validation requirements

Allowed actions in this version:

- inspect files
- propose changes
- prepare patch
- run tests
- summarize results

Disallowed actions in this version:

- auto-approve execution
- push without review
- modify unrelated files
- run destructive commands
- deploy
- spend money
- access secrets
- bypass validation

Future next step:

- connect this reviewed handoff packet to a dry-run execution-chain runner that still respects approval, validation, and reporting boundaries

## Execution-Chain Dry-Run Runner

AI-E now also includes a dry-run execution runner that consumes a reviewed execution handoff packet and simulates how that handoff would move through an execution chain. This is still not real execution. It produces a deterministic simulation report without mutating the repo.

What the dry-run runner does:

- validates that a reviewed handoff packet includes the required review, action, validation, and commit metadata
- simulates each execution step as a non-mutating reviewed step
- blocks dry-runs when a step would require a disallowed action such as deploy, destructive commands, or bypassing validation
- carries forward validation, risk, playtest, and reporting expectations into a deterministic dry-run report

Current contract:

- module path: `web/lib/aie/executionDryRunRunner.ts`
- main entry points: `runExecutionDryRun(input)`, `validateDryRunPacket(packet)`, and `summarizeDryRunReport(report)`
- dry-run statuses: `dry_run_ready`, `dry_run_blocked`, `dry_run_needs_review`, and `dry_run_invalid_packet`

How it fits in the bounded bridge:

```text
conversation
-> refinement
-> planning
-> artifact
-> approval gate
-> reviewed handoff
-> dry-run report
-> future reviewed patch preparation
```

Why this is still not real execution:

- the runner does not modify files
- the runner does not call git or shell commands
- the runner does not push branches, deploy, access secrets, or spend money
- every simulated step remains review-required and mutation-free

Allowed dry-run behavior:

- inspect files
- propose changes
- prepare patch
- run tests
- summarize results

Disallowed dry-run behavior:

- auto-approve execution
- push without review
- modify unrelated files
- run destructive commands
- deploy
- spend money
- access secrets
- bypass validation

Future next step:

- connect the dry-run report to a reviewed patch-preparation layer that still preserves approval, validation, and reporting boundaries

## Reviewed Patch Preparation Layer

AI-E now also includes a reviewed patch preparation layer that converts a valid dry-run execution report into a review-only patch plan. This is still not real file mutation. It prepares structured patch intent for operator review without writing files or applying patches.

What the patch preparation layer does:

- consumes only dry-run reports that are ready, review-required, mutation-free, and validation-backed
- turns proposed file targets into planned change groups with explicit review and validation expectations
- blocks patch planning when dry-run requirements are incomplete, risky, or no longer review-safe
- keeps patch preparation separate from actual file writes or patch application

Current contract:

- module path: `web/lib/aie/reviewedPatchPreparation.ts`
- main entry points: `prepareReviewedPatchPlan(input)`, `validateDryRunForPatchPreparation(report)`, and `summarizeReviewedPatchPreparation(result)`
- patch preparation statuses: `patch_plan_ready`, `patch_plan_blocked`, `patch_plan_needs_review`, `patch_plan_invalid_dry_run`, and `high_risk_blocked`

How it fits into the bounded bridge:

```text
conversation
-> refinement
-> planning
-> artifact
-> approval gate
-> reviewed handoff
-> dry-run runner
-> reviewed patch plan
-> future patch application gate
```

Why this is still not real file mutation:

- the layer does not write files or apply patches
- the layer does not call git or shell commands
- every planned change group remains review-required and mutation-free
- the output is a plan for review, not an implementation action

Allowed patch actions in this version:

- inspect target files
- propose file-level changes
- draft patch instructions
- identify tests to run
- summarize expected diff

Disallowed patch actions in this version:

- write files
- apply patches
- commit changes
- push branches
- deploy
- run destructive commands
- access secrets
- auto-approve implementation
- bypass validation

Future next step:

- connect the reviewed patch plan to a reviewed patch application gate that still requires operator review before any mutation is allowed

## Reviewed Patch Application Gate

AI-E now also includes a reviewed patch application gate that evaluates whether a reviewed patch plan is eligible to move toward a future patch draft or application review step. This is still not file mutation. It is a gatekeeper that decides whether the reviewed plan remains safe enough to advance.

What the patch application gate does:

- consumes reviewed patch plans only after patch preparation reports them ready
- verifies that planned change groups remain review-required and mutation-free
- confirms validation requirements, commit guidance, and explicit disallowed actions are still present
- returns an eligibility decision or a blocked result with the next operator action

Current contract:

- module path: `web/lib/aie/reviewedPatchApplicationGate.ts`
- main entry points: `evaluatePatchPlanForApplication(input)`, `listPatchApplicationBlockers(patchPlan)`, and `summarizePatchApplicationGate(result)`
- application statuses: `application_eligible`, `application_blocked`, `needs_operator_review`, `invalid_patch_plan`, and `high_risk_blocked`

How it fits into the bounded bridge:

```text
conversation
-> refinement
-> planning
-> artifact
-> approval gate
-> reviewed handoff
-> dry-run
-> patch plan
-> application gate
-> future reviewed patch draft generator
```

What `application_eligible` means:

- the patch preparation result is `patch_plan_ready`
- operator review is still explicitly required
- planned change groups exist and remain mutation-free
- validation requirements and git commit guidance still exist
- required disallowed patch actions are still explicit

Why this is still not file mutation:

- the gate does not write files or apply patches
- the gate does not call git or shell commands
- the gate only returns an eligibility decision for a later reviewed draft layer

Future next step:

- connect `application_eligible` decisions to a reviewed patch draft generator that still avoids direct file mutation and preserves approval boundaries

## Reviewed Patch Draft Generator

AI-E now also includes a reviewed patch draft generator that converts an `application_eligible` decision into a structured, review-only patch draft. This is still not real patch application. It provides the final human-readable checkpoint before any future controlled mutation layer would exist.

What the patch draft generator does:

- consumes only application-eligible decisions that still carry the reviewed patch plan context
- turns planned change groups into human-readable change descriptions
- summarizes the likely diff shape and affected targets without generating actual diffs or edits
- blocks draft generation when review, validation, commit guidance, or patch-plan context is missing

Current contract:

- module path: `web/lib/aie/reviewedPatchDraftGenerator.ts`
- main entry points: `generateReviewedPatchDraft(input)`, `validateApplicationDecisionForDraft(decision)`, and `summarizeReviewedPatchDraft(result)`
- draft statuses: `draft_ready`, `draft_blocked`, `draft_needs_review`, `invalid_application_decision`, and `high_risk_blocked`

How it fits into the bounded bridge:

```text
conversation
-> refinement
-> planning
-> artifact
-> approval
-> handoff
-> dry-run
-> patch plan
-> application gate
-> draft
-> future reviewed patch application executor
```

What `draft_ready` means:

- the application decision is `application_eligible`
- operator review remains explicitly required
- the source patch plan, planned change groups, validation requirements, and commit guidance all still exist
- the output is a review-only description of intended changes, not a mutation step

Why this is still not real patch application:

- the generator does not write files or apply patches
- the generator does not call git or shell commands
- it produces descriptions, scope summaries, and expected diff language only

Future next step:

- connect `draft_ready` outputs to a reviewed patch application executor that still preserves human approval before any file mutation is allowed

## Reviewed Patch Application Executor

AI-E now also includes a reviewed patch application executor that converts a `draft_ready` reviewed patch draft result into an application packet. This is still not automatic file mutation. It is a bounded executor-preparation layer that packages the reviewed draft into a final pre-mutation handoff packet.

What the reviewed patch application executor does:

- consumes only `draft_ready` reviewed patch draft results
- verifies the reviewed draft still requires operator review and keeps every change description mutation-free
- confirms validation requirements, commit guidance, and required disallowed draft actions remain explicit
- produces an application packet with exact review-only instructions or blocks with the next operator action

Current contract:

- module path: `web/lib/aie/reviewedPatchApplicationExecutor.ts`
- main entry points: `createReviewedPatchApplicationPacket(input)`, `validateDraftResultForApplicationPacket(draftResult)`, and `summarizeReviewedPatchApplicationExecutor(result)`
- executor statuses: `application_packet_ready`, `application_packet_blocked`, `application_packet_needs_review`, `invalid_patch_draft`, and `high_risk_blocked`

How it fits into the bounded bridge:

```text
conversation
-> refinement
-> planning
-> artifact
-> approval gate
-> reviewed handoff
-> dry-run
-> patch plan
-> application gate
-> draft
-> application executor
-> future controlled patch mutation layer
```

What `application_packet_ready` means:

- the reviewed patch draft result is `draft_ready`
- the reviewed patch draft still exists and requires explicit operator review
- every change description remains review-required and mutation-free
- validation requirements, git commit guidance, and required disallowed draft actions still exist
- the output is still a review-only packet, not a file-writing step

Allowed executor actions in this version:

- inspect target files
- prepare reviewed implementation notes
- generate patch proposal text
- list exact validation commands
- summarize expected changes

Disallowed executor actions in this version:

- write files automatically
- apply patches automatically
- commit automatically
- push automatically
- deploy
- run destructive commands
- access secrets
- auto-approve implementation
- bypass validation

Why this is still not real patch application:

- the executor does not write files or apply patches
- the executor does not call git or shell commands
- the executor only produces a bounded application packet for later human review

Future next step:

- connect `application_packet_ready` outputs to a future controlled patch mutation layer that still requires explicit human approval before any file change is allowed

## Controlled Patch Execution Layer

AI-E now also includes a controlled patch execution layer that can safely apply real file changes from a reviewed application packet, but only after exact diff preview, explicit human approval, and bounded execution-policy checks. This is the first real file-mutation layer in the reviewed patch flow.

Core behavior:

- always generates an exact diff preview before any mutation
- requires explicit approval before applying reviewed file changes
- only mutates files listed in the reviewed application packet targets
- revalidates packet safety before applying changes
- captures rollback data before mutation and can restore prior file state
- logs preview, validation, apply, and rollback steps

Current contract:

- module path: `web/lib/aie/controlledPatchExecutor.ts`
- main entry points: `generatePatchDiff(applicationPacket, fileChanges)`, `validateExecutionSafety(applicationPacket, previewDiff)`, `applyPatch(applicationPacket, previewDiff, rollbackPoint)`, `createRollbackPoint(applicationPacket, previewDiff)`, `rollbackExecution(rollbackPoint)`, `executeControlledPatch(input)`, and `summarizeExecution(result)`
- statuses: `awaiting_approval`, `ready_to_apply`, `applied`, `blocked`, and `rolled_back`

Diff preview format:

- `file_path`
- `change_type`
- `before_snapshot`
- `after_snapshot`
- `summary_of_change`

Approval flow example:

```text
AI-E: Here's what will change -> approve?
User: yes
AI-E: applies the reviewed file changes safely and stores rollback data
```

Why this layer matters:

- AI-E can now move from reviewed planning into real bounded file mutation
- exact diff visibility stays in front of approval instead of after the write
- rollback support makes reviewed file mutation reversible without destructive commands
- the layer still does not auto-approve, deploy, push, or bypass validation

## Controlled Execution Validation

AI-E now also includes a controlled execution validation layer that runs after reviewed file mutation. This layer checks whether the applied files match the approved diff, whether any unexpected files changed, and whether the result is safe to keep or should be rolled back.

What the validation layer does:

- runs only after controlled patch execution reports an applied result
- validates only the files touched by the executor
- compares actual file contents against the approved preview diff
- detects missing files, content mismatches, and unexpected changed files
- converts validation outcomes into a deterministic recommendation: keep changes, rollback, or review

Current contract:

- module path: `web/lib/aie/controlledExecutionValidation.ts`
- main entry points: `runControlledValidation(input)`, `validateChangedFiles(input)`, `evaluateValidationResult(result)`, `buildValidationReport(result)`, and `summarizeValidation(result)`
- statuses: `validation_passed`, `validation_failed`, `validation_needs_review`, and `validation_blocked`

Validation flow:

```text
application packet
-> controlled patch execution
-> controlled execution validation
-> keep changes / rollback recommendation / review required
```

Example:

```text
AI-E: Changes applied. Running validation...
-> validation_passed -> safe to keep

AI-E: Changes applied. Running validation...
-> validation_failed -> recommend rollback
```

Why this improves execution safety:

- applied changes are now checked before anything like commit or push is considered
- AI-E can detect broken or unsafe post-mutation state without mutating files during validation
- rollback becomes an evidence-based recommendation instead of a manual guess

## Commit Gate And Completion Report

AI-E now also includes a commit gate layer that runs after controlled execution validation. This layer decides whether a validated change set is safe to commit, whether it still needs operator review, or whether it should stay blocked and recommend rollback.

What the commit gate does:

- consumes the controlled validation result and reviewed application packet
- checks commit eligibility using validation status, risk level, playtest requirements, and unexpected change signals
- produces a structured completion report before any commit happens
- keeps commit and push behind explicit operator approval

Current contract:

- module path: `web/lib/aie/commitGate.ts`
- main entry points: `evaluateCommitEligibility(input)`, `buildCompletionReport(input)`, and `summarizeCommitGate(result)`
- statuses: `commit_ready`, `commit_blocked`, and `commit_needs_review`

Commit gate flow:

```text
application packet
-> controlled patch execution
-> controlled execution validation
-> commit gate and completion report
-> commit / review / rollback recommendation
```

Completion report includes:

- original request and interpreted goal
- files changed and diff summary
- validation result and validation summary
- risk level and rollback availability
- recommended next action and gate explanation

Why this improves execution safety:

- AI-E now decides whether validated changes are actually commit-eligible instead of assuming validation alone is enough
- every reviewed execution now produces an operator-facing completion report before commit or push is considered
- unsafe or uncertain change sets can be stopped before commit while still preserving rollback evidence

## Commit And Push Approval Gates

AI-E now also includes final approval gates for commit and push. These gates sit after the commit gate and require explicit operator approval before any repository-history action is considered eligible.

What the approval gates do:

- require a separate explicit boolean approval for commit
- require a separate explicit boolean approval for push
- block push unless commit approval has already been granted
- record approval decisions in immutable approval logs
- keep all commit and push actions non-automatic and operator-controlled

Current contract:

- module path: `web/lib/aie/commitAndPushGate.ts`
- main entry points: `evaluateCommitApproval(input)`, `evaluatePushApproval(input)`, `buildApprovalLog(input)`, and `summarizeApproval(result)`
- statuses: `commit_awaiting_approval`, `commit_approved`, `commit_blocked`, `push_awaiting_approval`, `push_approved`, and `push_blocked`

Approval flow:

```text
application packet
-> controlled patch execution
-> controlled execution validation
-> commit gate and completion report
-> explicit commit approval gate
-> explicit push approval gate
```

Example:

```text
AI-E: Commit is ready. Approve?
User: Yes
AI-E: Push is ready. Approve?
User: Yes
```

Why this improves execution safety:

- AI-E cannot modify repository history without explicit operator consent
- commit and push approvals are now separate control points instead of one implied action
- the full execution chain is controlled end to end without auto-commit or auto-push behavior

## Bounded Autonomous Task Chaining

AI-E now also includes a bounded autonomous task-chain coordinator for supervised multi-step work. This layer can plan a small ordered sequence of related steps, require approval before the chain begins, and stop immediately when any step fails or requires further approval.

What the task-chain layer does:

- turns a bounded request into ordered task steps
- enforces a hard max step limit
- requires explicit chain approval before execution starts
- advances only when each step clears the existing validation and approval gates
- pauses the chain on failed validation, rollback recommendation, or missing commit or push approval
- produces a clear chain report while leaving real execution to the existing controlled pipeline

Current contract:

- module path: `web/lib/aie/autonomousTaskChain.ts`
- main entry points: `createAutonomousTaskChain(input)`, `evaluateTaskChainReadiness(chain)`, `advanceTaskChain(chain, stepResult)`, `pauseTaskChain(chain, reason)`, `completeTaskChain(chain)`, and `summarizeTaskChain(chain)`
- statuses: `chain_planned`, `awaiting_chain_approval`, `chain_ready`, `chain_running`, `chain_paused`, `chain_blocked`, and `chain_completed`

Example:

```text
Operator: Improve grenade gameplay in three safe steps.

AI-E chain:
1. Add damage radius
2. Add VFX/SFX hook
3. Add cooldown/inventory rule

Each step is still planned, reviewed, applied only with approval, validated, and paused immediately if a safety gate fails.
```

Why this improves supervised autonomy:

- AI-E can now coordinate a bounded sequence without requiring a brand new prompt for every adjacent task
- every step still flows through the same controlled execution, validation, commit, and push approval gates
- this is supervised autonomy only, not uncontrolled background execution or overnight agent behavior

## Autonomous Chain Recovery

AI-E now also includes an autonomous chain recovery layer for interrupted or paused bounded task chains. This layer stores safe checkpoints, validates the last successful state, and resumes from the next unfinished step rather than restarting the full chain.

What the recovery layer does:

- creates a checkpoint after successful progress so completed work can be preserved
- validates checkpoint integrity and prior validation state before resuming
- resumes only from the last successful step boundary
- requires renewed approval when approvals are missing or stale
- blocks unsafe resume attempts instead of guessing that prior state is still safe

Current contract:

- module path: `web/lib/aie/autonomousChainRecovery.ts`
- main entry points: `createChainCheckpoint(chain)`, `evaluateRecoveryEligibility(chain, checkpoint)`, `resumeTaskChain(chain, checkpoint)`, `validateCheckpoint(checkpoint)`, and `summarizeRecovery(result)`
- statuses: `recoverable`, `not_recoverable`, `requires_restart`, and `awaiting_reapproval`

Example:

```text
Step 1: completed
Step 2: completed
Step 3: paused awaiting approval

Later:
AI-E validates the checkpoint and resumes at Step 3, not Step 1.
```

Why this improves real-world autonomous workflows:

- AI-E can now continue where it left off instead of discarding safe partial progress
- completed steps are not repeated, but the next step is still re-entered through the normal gated flow
- interrupted chains remain supervised because recovery never auto-approves or bypasses validation

## Long-Lived Chain Persistence And Approval Freshness

AI-E now also includes a persistence and approval freshness layer for longer-lived bounded chains. This layer stores chain state durably in a file-ready record, checks whether approvals have expired, detects stale validation or context, and forces safe reapproval or revalidation before continuation.

What the persistence and freshness layer does:

- persists chain state after safe progress checkpoints
- tracks approval timestamps and validity windows for chain, step, commit, and push approvals
- marks expired approvals as requiring reapproval
- detects stale chain context or validation snapshots after time gaps
- blocks unsafe continuation of outdated chains until freshness checks pass

Current contract:

- module paths: `web/lib/aie/chainPersistence.ts` and `web/lib/aie/approvalFreshness.ts`
- main entry points: `persistChainState(chain)`, `loadChainState(chain_id)`, `evaluateApprovalFreshness(approvalState)`, `evaluateContextStaleness(chain)`, `requireReapprovalIfNeeded(chain)`, and `summarizePersistenceState(record)`
- statuses: `fresh`, `stale`, `expired`, `requires_reapproval`, and `requires_revalidation`

Example:

```text
Step 1 completed
Step 2 completed
Chain paused

Later:
AI-E checks approval freshness and context freshness.
If approvals expired, it requires reapproval.
If context is stale, it requires revalidation.
Only then does the resumed chain continue.
```

Why this improves long-lived autonomous safety:

- AI-E can now continue work safely even after time gaps instead of assuming old approvals still hold
- stale context is surfaced explicitly before a resumed chain can continue
- longer-lived workflows remain supervised because neither approval nor validation is silently carried forward forever

## Supervised Autonomous Task Orchestration

AI-E now also includes a supervised autonomous orchestration layer that can suggest what to do next after a bounded chain completes, while staying approval-aware, confidence-gated, and explicitly bounded. This layer does not execute work itself. It only proposes the next supervised continuation steps from prior chain context and persisted results.

What the orchestration layer does:

- proposes logical next tasks after a completed chain
- uses prior chain context and persisted validation state
- stops when continuation confidence is too low
- limits the number of proposed follow-up steps
- requires explicit approval before any continuation can run
- refuses to continue when persisted context is stale or reapproval is required

Current contract:

- module path: `web/lib/aie/autonomousOrchestrator.ts`
- main types: `OrchestrationPlan`, `OrchestrationStep`, `OrchestrationDecision`, and `OrchestrationStatus`
- main entry points: `decideAutonomousOrchestration(input)` and `summarizeOrchestration(decision)`
- statuses: `orchestration_ready`, `awaiting_supervisor_approval`, `orchestration_blocked`, and `orchestration_complete`

Example:

```text
Bounded chain completed
Persisted validation is still fresh
Confidence is high enough to continue

AI-E proposes:
1. review follow-up opportunities
2. plan the next bounded improvement

Execution does not continue until explicit approval is granted.
```

Why this improves supervised autonomy:

- AI-E can now suggest what to do next instead of stopping at the original request boundary
- continuation remains bounded because only a small deterministic set of next steps is proposed
- supervision remains intact because orchestration never bypasses approval, freshness checks, or validation gates

## Persistent Goal Tracking And Orchestration Memory

AI-E now also includes a persistent orchestration memory layer so supervised orchestration can remember what it already proposed or completed across cycles. This keeps the system working toward a goal over time instead of treating each orchestration pass as a fresh blank slate.

What the orchestration memory layer does:

- stores a persistent goal record across orchestration cycles
- records proposed continuation steps and completed steps
- suppresses duplicate or looping suggestions from prior cycles
- evaluates whether the goal is still active, nearing completion, completed, or stalled
- keeps continuation bounded because it only informs planning and completion checks

Current contract:

- module path: `web/lib/aie/orchestrationMemory.ts`
- main types: `OrchestrationMemory`, `GoalState`, `CompletedStep`, `ProposedStep`, and `GoalStatus`
- main entry points: `createOrchestrationMemory(goal)`, `updateOrchestrationMemory(memory, step)`, `detectDuplicateStep(memory, step)`, `evaluateGoalCompletion(memory)`, and `summarizeGoalState(memory)`
- statuses: `active`, `nearing_completion`, `completed`, and `stalled`

Example:

```text
Cycle 1 proposes a follow-up step
Cycle 2 sees the same step title again

AI-E suppresses the duplicate proposal,
keeps the original goal in memory,
and continues looking for the next novel bounded step.
```

Why this improves supervised autonomy:

- AI-E now remembers what it already suggested and what it already finished
- long-lived goal tracking reduces drift across multi-cycle orchestration
- duplicate suppression prevents simple loops from being re-proposed as novel work
- goal completion is surfaced explicitly before more continuation is proposed

Milestone direction:

- this is the first step toward AI-E continuing useful work intelligently without needing every next step spelled out by the operator

## Autonomous Work Session Manager

AI-E now also includes a supervised autonomous work-session manager that wraps the existing chain, recovery, persistence, approval freshness, and orchestration-memory layers into one bounded session lifecycle.

What the work-session manager does:

- creates a long-running supervised session from an operator goal
- requires explicit session approval before the session can run
- tracks goal state, orchestration memory, the active chain, checkpoints, and session cycles in one place
- pauses when approvals are needed or when validation/rollback evidence makes continuation unsafe
- resumes from the latest checkpoint instead of restarting blindly
- completes only when the tracked goal state reaches an explicit completed condition

Current contract:

- module path: `web/lib/aie/autonomousWorkSession.ts`
- main types: `AutonomousWorkSession`, `WorkSessionStatus`, `WorkSessionCycle`, `WorkSessionDecision`, and `WorkSessionReport`
- main entry points: `createAutonomousWorkSession(input)`, `evaluateWorkSessionReadiness(session)`, `advanceWorkSession(session, cycleResult)`, `pauseWorkSession(session, reason)`, `resumeWorkSession(session)`, `completeWorkSession(session)`, and `summarizeWorkSession(session)`
- statuses: `session_planned`, `awaiting_session_approval`, `session_running`, `session_paused`, `session_blocked`, and `session_completed`

Example session lifecycle:

```text
Create session from operator goal
Session waits for explicit approval
Approved session advances one bounded cycle
Session pauses if approval or validation review is required
Session resumes from the latest checkpoint
Session completes when goal memory marks the goal done
```

Why this improves supervised autonomy:

- AI-E now has a single session wrapper for long-running supervised work instead of isolated chain and orchestration passes
- session-level pause and resume reduce drift because checkpoints, approvals, and goal memory stay attached to one lifecycle
- bounded cycle limits prevent simple infinite continuation loops
- completion reporting is explicit, readable, and aligned with the work-session state instead of being inferred externally

Milestone direction:

- this is the first full session wrapper for AI-E autonomous studio operation and a major step toward supervised long-running studio work

## Session Runtime Integration And Execution Loop

AI-E now also includes a supervised session runtime loop that actively drives one bounded work cycle per invocation on top of the autonomous work-session manager. This moves the system from passive session state tracking into active supervised cycle execution without introducing unbounded looping.

What the session runtime layer does:

- evaluates whether a work session is idle, ready, running, paused, blocked, or completed
- resumes a paused session only when checkpoint recovery and approval state make that safe
- executes exactly one deterministic safe cycle per invocation
- advances the active task chain for approval-free controlled steps
- pauses immediately when approval or validation boundaries are encountered
- records a readable runtime result for operator review

Current contract:

- module path: `web/lib/aie/sessionRuntime.ts`
- main types: `SessionRuntimeState`, `SessionRuntimeResult`, `RuntimeCycle`, and `RuntimeStatus`
- main entry points: `runSessionCycle(session)`, `evaluateRuntimeState(session)`, `buildRuntimeResult(session)`, and `summarizeRuntime(result)`
- statuses: `runtime_idle`, `runtime_ready`, `runtime_running`, `runtime_paused`, `runtime_blocked`, and `runtime_completed`

Example runtime behavior:

```text
Operator invokes runSessionCycle(session)
Runtime evaluates whether the session can move safely
Runtime resumes from checkpoint if safe
Runtime executes one approval-free bounded step
Runtime returns an updated session plus a runtime status
```

Why this improves supervised autonomy:

- AI-E can now actively move a supervised session forward instead of waiting for every cycle to be triggered manually in pieces
- one-cycle execution keeps the runtime bounded and deterministic, which avoids hidden loops or runaway continuation
- approval, validation, and rollback boundaries remain intact because the runtime stops immediately when a gate is encountered
- runtime summaries make the execution outcome reviewable at the session level rather than only at the lower chain layer

Milestone direction:

- this is the transition from session management as a passive state layer into supervised active work-cycle execution

## Supervised Runtime Loop Controller

AI-E now also includes a supervised runtime loop controller that can repeatedly invoke the bounded session runtime over multiple cycles without introducing background threads, hidden recursion, or approval bypass. This is the first layer that simulates controlled continuous operation while still stopping at the same validation and approval boundaries as the one-cycle runtime.

What the runtime loop controller does:

- calls the session runtime repeatedly in a bounded sequential loop
- stops immediately when approval, validation, rollback, or blocking boundaries are encountered
- completes when the session goal is reached
- enforces a configured maximum cycle count for each operator-triggered run
- returns a loop state that can be resumed later by another explicit trigger

Current contract:

- module path: `web/lib/aie/runtimeLoopController.ts`
- main types: `RuntimeLoopState`, `RuntimeLoopResult`, `LoopStatus`, and `LoopControlConfig`
- main entry points: `startRuntimeLoop(session, config)`, `runNextCycle(loopState)`, `evaluateLoopState(loopState)`, `stopRuntimeLoop(loopState)`, and `summarizeLoop(loopState)`
- statuses: `loop_idle`, `loop_running`, `loop_paused`, `loop_blocked`, and `loop_completed`

Example loop behavior:

```text
Operator invokes startRuntimeLoop(session, { max_cycles: 3 })
Loop runs one bounded session cycle
Loop reevaluates supervision boundaries
Loop continues into the next safe cycle if allowed
Loop stops and returns state when paused, blocked, completed, or cycle-capped
```

Why this improves supervised autonomy:

- AI-E can now continue safe work across multiple cycles instead of requiring a manual trigger for every single step
- max-cycle enforcement keeps the loop bounded even when work remains
- explicit loop state makes the next operator or controller handoff deterministic and reviewable
- the continuous-operation path still uses the same approval-aware session runtime instead of inventing a second executor

Milestone direction:

- this is the layer that lets AI-E keep working safely across repeated cycles without manual step-by-step triggers

## Background Runtime and Scheduler

AI-E now also includes a background runtime scheduler that can evaluate whether a supervised work session is safe to continue while the operator is away, trigger a bounded runtime loop batch, and return a structured report describing what happened. This is scheduled supervised operation, not unsupervised free-running AI.

What the background runtime scheduler does:

- checks whether a session is eligible for a bounded background run
- requires fresh approvals and fresh context before operator-away execution can start
- delegates bounded execution to the runtime loop controller instead of running work directly
- stops immediately on missing approval, stale approval, stale context, validation failure, rollback recommendation, or loop limits
- returns a deterministic background run report for later operator review

Current contract:

- module path: `web/lib/aie/backgroundRuntimeScheduler.ts`
- main types: `BackgroundRuntimeScheduler`, `BackgroundRuntimeConfig`, `BackgroundRunRequest`, `BackgroundRunResult`, `BackgroundRunStatus`, `BackgroundRunBlocker`, and `BackgroundRunReport`
- main entry points: `createBackgroundRuntimeScheduler(config)`, `evaluateBackgroundRunEligibility(session, scheduler)`, `runBackgroundRuntimeCycle(session, scheduler)`, `buildBackgroundRunReport(result)`, and `summarizeBackgroundRun(result)`
- statuses: `scheduler_idle`, `run_eligible`, `run_started`, `run_paused`, `run_blocked`, `run_completed`, and `run_skipped`

Example background behavior:

```text
Operator configures a background scheduler with bounded max cycles
Scheduler checks session approval freshness and context freshness
Scheduler starts a bounded runtime loop run only when the session is eligible
Scheduler stops at the first safety boundary or cycle cap
Scheduler returns a report for the operator to review later
```

What this does not mean:

- AI-E is not free-running unsupervised in the background
- approvals are not bypassed or renewed automatically
- validation and rollback boundaries still stop the run immediately
- commit and push gates remain approval-bound and are never auto-approved here

Why this improves supervised autonomy:

- AI-E can now simulate “while I’m away” supervised operation using the same bounded runtime layers
- operator-away runs are reviewable because every run produces an explicit report with blockers and next action
- freshness checks reduce the chance of background work continuing on stale approvals or stale context
- scheduled operation remains deterministic because the scheduler only triggers bounded runtime loop batches

Milestone direction:

- this is the first real step toward AI-E working while the operator is away without weakening approval or safety constraints

## Background Session Queue

AI-E now also includes a background session queue that can manage multiple background-capable sessions during an operator-away pass, evaluate them in a stable order, run only the safe eligible sessions, and aggregate the results into a single queue-level report.

What the background session queue does:

- registers background-capable sessions in deterministic queue order
- evaluates each queued session through the existing background runtime scheduler
- runs only the eligible sessions and respects per-pass session limits
- skips blocked sessions safely when configured
- pauses or blocks the queue when safety policy requires it
- produces a multi-session operator-away report summarizing what happened

Current contract:

- module path: `web/lib/aie/backgroundSessionQueue.ts`
- main types: `BackgroundSessionQueue`, `BackgroundQueuedSession`, `BackgroundQueueResult`, `BackgroundQueueStatus`, `BackgroundQueueReport`, and `QueueRunPolicy`
- main entry points: `createBackgroundSessionQueue(config)`, `enqueueBackgroundSession(queue, session)`, `evaluateQueuedSession(queue, queuedSession)`, `runBackgroundSessionQueue(queue)`, `buildQueueRunReport(result)`, and `summarizeBackgroundQueue(result)`
- queue statuses: `queue_idle`, `queue_running`, `queue_paused`, `queue_completed`, and `queue_blocked`
- queued session statuses: `queued`, `eligible`, `running`, `skipped`, `paused`, `blocked`, and `completed`

Example operator-away queue:

```text
1. BABYLON grenade polish
2. AI-E docs cleanup
3. Enemy AI follow-up

Queue pass:
- runs eligible sessions
- pauses sessions needing approval
- skips unsafe sessions when configured
- reports all queue outcomes together
```

Why this improves supervised autonomy:

- AI-E can now manage multiple supervised background sessions instead of only one session per operator-away pass
- queue-level policy makes session selection deterministic and reviewable
- blocked sessions can be skipped without weakening scheduler safety checks
- one report can now summarize an entire operator-away queue pass instead of isolated per-session results

Milestone direction:

- this moves AI-E from running one supervised background session while the operator is away to managing a bounded queue of supervised background sessions safely

## Background Run History and Operator-Away Digest

AI-E now also includes a background run history layer that preserves deterministic queue-run records and an operator-away digest that summarizes what happened while the operator was away. This adds memory and reporting for background queue passes without adding any new execution powers.

What the history and digest layer does:

- records each background session queue run as a deterministic history record
- preserves approvals needed, blockers, next actions, and safe-to-continue state
- aggregates multiple queue records into one operator-away digest
- highlights completed work, paused work, blocked or skipped work, and recommended next actions
- stays file-ready and in-memory only, with no database or shell dependency

Current contract:

- module path: `web/lib/aie/backgroundRunHistory.ts`
- main types: `BackgroundRunHistory`, `BackgroundRunHistoryRecord`, `OperatorAwayDigest`, `DigestSection`, `DigestStatus`, and `DigestRecommendation`
- main entry points: `createBackgroundRunHistory()`, `appendBackgroundRunRecord(history, queueResult)`, `buildOperatorAwayDigest(history, window)`, and `summarizeOperatorAwayDigest(digest)`
- digest statuses: `digest_empty`, `digest_ready`, `digest_needs_attention`, and `digest_blocked`

Example operator-away digest:

```text
3 sessions considered
1 completed
1 paused for approval
1 skipped as stale
next action: review paused session approval
```

Why this improves supervised autonomy:

- AI-E can now remember what happened across multiple operator-away queue passes instead of only reporting one pass at a time
- the operator gets a single digest that surfaces approvals, blockers, completed work, and next actions quickly
- history records are deterministic and file-ready, which makes later persistence straightforward without changing the current execution model
- blockers stay visible instead of being hidden behind aggregate counts

Milestone direction:

- this moves AI-E from being able to run a background session queue to being able to report clearly on what happened while the operator was away

## Time-Based Runtime Trigger

AI-E now also includes a time-based runtime trigger that can automatically invoke bounded background session queue passes at defined intervals, append the results to background run history, and preserve all existing approval and validation boundaries. This is still supervised autonomy and does not introduce threads, free-running execution, or unsafe background behavior.

What the time-based trigger does:

- checks whether the configured interval has elapsed since the last run
- triggers one or more bounded background queue passes when the interval is satisfied
- appends each queue result into background run history
- prevents duplicate triggering inside the configured interval window
- returns deterministic trigger state and summary information for the caller

Current contract:

- module path: `web/lib/aie/timeBasedRuntimeTrigger.ts`
- main types: `TimeTriggerConfig`, `TimeTriggerState`, `TimeTriggerResult`, and `TimeTriggerStatus`
- main entry points: `createTimeTrigger(config)`, `shouldTriggerRun(state, now)`, `runTimeTriggeredCycle(state, queue, history, now)`, `updateTriggerState(state, result)`, and `summarizeTrigger(result)`
- statuses: `trigger_idle`, `trigger_waiting`, `trigger_running`, `trigger_skipped`, and `trigger_completed`

Example timed behavior:

```text
Every 10 minutes:
- check queued sessions
- run eligible background queue passes
- store run results in history
- update the operator-away digest inputs
```

What this still guarantees:

- approvals are still required
- validation and rollback rules are still enforced
- queue and scheduler safety checks are still the only execution path
- there are no background threads or uncontrolled continuous loops

Why this improves supervised autonomy:

- AI-E can now trigger safe background queue passes over time without manual intervention for each pass
- interval-based deduplication prevents accidental duplicate queue execution inside the same window
- queue results and history stay connected automatically, so operator-away reporting reflects real scheduled passes
- the entire operator-away system remains bounded because each invocation still has explicit run limits

Milestone direction:

- AI-E runs while I’m away is 100% complete for the supervised scope.

## Background Runtime Service

AI-E now also includes a background runtime service that repeatedly wakes up, checks the time-based trigger, runs bounded background queue work when eligible, and records a deterministic tick history. This is the first continuous-runner layer, but it remains supervised, bounded, and approval-controlled.

What the background runtime service does:

- starts a deterministic supervised service loop
- wakes up on caller-provided tick times instead of using uncontrolled timers in core logic
- invokes the time-based runtime trigger only through its public API
- records each tick result and preserves the full tick history
- stops cleanly on max tick limits, explicit stop, or blockers when configured

Current contract:

- module path: `web/lib/aie/backgroundRuntimeService.ts`
- main types: `BackgroundRuntimeServiceConfig`, `BackgroundRuntimeServiceState`, `BackgroundRuntimeServiceResult`, `BackgroundRuntimeTickResult`, `BackgroundRuntimeServiceStatus`, and `BackgroundRuntimeServiceStopReason`
- main entry points: `createBackgroundRuntimeService(config)`, `startBackgroundRuntimeService(service, queue, history, clock)`, `runBackgroundRuntimeTick(service, queue, history, now)`, `stopBackgroundRuntimeService(service, reason)`, and `summarizeBackgroundRuntimeService(service)`
- statuses: `service_idle`, `service_running`, `service_paused`, `service_stopped`, `service_blocked`, and `service_completed`

Example service behavior:

```text
Service starts with a bounded max tick count
Each tick asks the deterministic clock for the next time
The service calls the time-based runtime trigger once per tick
Tick results are recorded into service tick history
The service stops at max ticks or a configured blocker boundary
```

What this still does not do:

- it does not run forever uncontrollably
- it does not bypass approvals or validation
- it does not deploy anything or access secrets
- it does not replace the scheduler, queue, trigger, or digest safety layers

Why this improves the runtime environment:

- AI-E now has a real continuous supervised runner over the existing trigger stack instead of only standalone trigger logic
- deterministic tick history makes service behavior reviewable and testable
- production timer wiring can stay outside the core module because the service loop itself is pure and bounded
- the runtime environment improves without weakening any existing supervised autonomy boundaries

Milestone direction:

- this moves AI-E from having a scheduled trigger to having a supervised service that can continuously call that trigger.

## Production Runtime Entrypoint

AI-E now also includes an explicit production-style runtime entrypoint that can intentionally launch the bounded background runtime service from a command or script. This gives the operator a real start command without introducing auto-start behavior, uncontrolled daemons, approval bypasses, or deployment side effects.

What the production runtime entrypoint does:

- loads runtime configuration with safe bounded defaults
- initializes the background runtime service, queue, and history layers explicitly
- starts a supervised bounded runtime run only when the command is invoked
- returns and prints a readable runtime summary for completed, paused, or blocked exits
- keeps dry-run support available for safe validation before a real runtime invocation

Current contract:

- module path: `web/lib/aie/runtimeEntrypoint.ts`
- script path: `web/scripts/runBackgroundRuntime.ts`
- main entry points: `loadRuntimeEntrypointConfig(config)`, `runBackgroundRuntimeEntrypoint(config)`, and `summarizeRuntimeEntrypoint(result)`
- supported config fields: `tick_interval_ms`, `max_ticks_per_run`, `max_runs_per_invocation`, `operator_away_mode`, `require_supervised_scope`, and `dry_run_mode`

Example command:

```text
cd "E:\AI projects 2025\AI-E\web"
npm run aie:runtime
```

Safe dry-run example:

```text
cd "E:\AI projects 2025\AI-E\web"
npm run aie:runtime -- --dry-run
```

What this still guarantees:

- the runtime service starts only when explicitly invoked
- approvals and validation boundaries are still enforced through the existing scheduler, queue, trigger, and history layers
- there is still no uncontrolled daemon, auto-approval flow, unsafe file mutation, or deployment path here
- dry-run mode can validate startup behavior without starting the bounded tick loop

Why this improves the runtime environment:

- AI-E now has a real intentional start command for the supervised background runtime service
- runtime configuration and exit summaries are reviewable instead of being implicit library wiring
- productization improves because operators can launch the bounded runtime stack directly when they are away
- the runtime environment improves without weakening any of the existing supervised autonomy safety guarantees

Milestone direction:

- this moves AI-E from having a background runtime service implementation to having a clear runtime start command.

## Runtime Configuration Profiles

AI-E now also includes named runtime configuration profiles so the production runtime entrypoint can start in clear, safe preset operating modes instead of relying only on raw low-level flags.

What the runtime profile system does:

- exposes named safe preset modes for bounded runtime startup
- maps each profile to reviewed runtime settings such as tick interval, tick limits, and bounded run counts
- preserves dry-run, freshness, blocker-stop, and error-stop behavior through the entrypoint
- rejects unknown profiles and unsafe overrides before the runtime service starts
- keeps runtime startup readable by printing the selected profile in the summary output

Current contract:

- module path: `web/lib/aie/runtimeProfiles.ts`
- main entry points: `listRuntimeProfiles()`, `getRuntimeProfile(name)`, `resolveRuntimeProfile(name, overrides)`, `validateRuntimeProfile(profile)`, and `summarizeRuntimeProfile(profile)`
- available profile names: `dry_run`, `local_supervised`, `operator_away_safe`, `conservative_validation`, and `bounded_batch`

Example commands:

```text
cd "E:\AI projects 2025\AI-E\web"
npm run aie:runtime -- --dry-run
npm run aie:runtime -- --profile dry_run
npm run aie:runtime -- --profile operator_away_safe --dry-run
```

Run runtime commands from the `/web` directory so the `aie:runtime` script resolves from the web package root.

What this still guarantees:

- profiles do not bypass approval gates
- profiles do not disable freshness checks or validation expectations
- profiles do not allow infinite runtime loops or uncontrolled daemon behavior
- profiles only configure bounded supervised runtime behavior through the existing entrypoint and service stack

Why this improves the runtime environment:

- AI-E now has clear safe operating modes for runtime startup instead of only low-level numeric flags
- operator-away and dry-run startup become easier to understand and harder to misconfigure
- runtime startup remains bounded and reviewable even when overrides are supplied
- the runtime environment improves without weakening any supervised autonomy constraints

Milestone direction:

- this moves AI-E from having a runtime start command to having clear safe runtime operating modes.

## Multi-Goal Orchestration

AI-E now also includes a deterministic multi-goal orchestration layer so the bounded runtime can reason about more than one goal without trying to execute multiple goals at the same time.

What the multi-goal orchestration layer does:

- accepts multiple goal records instead of assuming one active goal globally
- tracks each goal with priority, status, creation time, and last-updated time
- picks the next runnable goal using priority-first ordering and oldest-first tie breaking
- skips blocked, paused, and completed goals when selecting the next runnable goal
- preserves fairness and safety by keeping only one goal runnable at a time in the initial version

Current contract:

- module path: `web/lib/aie/multiGoalOrchestrator.ts`
- main entry points: `createGoalRecord()`, `createGoalQueue()`, `insertGoal()`, `removeGoal()`, `reprioritizeGoal()`, `createGoalRecordFromSession()`, `scheduleNextGoal()`, and `summarizeGoalScheduler()`
- goal priorities: `high`, `medium`, and `low`
- goal statuses: `pending`, `active`, `paused`, `completed`, and `blocked`

How it fits into the current bounded runtime stack:

```text
multiple goals
-> multi-goal orchestrator
-> background session queue
-> existing runtime scheduler
-> one bounded session run at a time
```

What this still guarantees:

- the orchestrator does not execute work directly
- the orchestrator does not bypass approval freshness or validation gates
- the runtime still runs only one goal at a time in this version
- queue ordering remains deterministic for repeated runs with the same input state

Why this improves the runtime environment:

- AI-E can now coordinate competing goals instead of relying only on enqueue order
- higher-priority work can run first without broadening the execution surface
- paused, blocked, or completed goals no longer need to be manually filtered before each bounded pass

Milestone direction:

- this moves AI-E from single-goal bounded execution toward deterministic multi-goal coordination.

## Task Dependency Graph

AI-E now also includes a task dependency graph so multi-goal orchestration can reason about prerequisites, blockers, and conflicts before it chooses the next goal.

What the task dependency graph does:

- models goals and tasks as graph nodes with deterministic status and priority metadata
- models `depends_on`, `blocks`, `conflicts_with`, and `related_to` relationships as graph edges
- blocks tasks whose prerequisites are incomplete or circular
- blocks tasks that conflict with an active task
- explains why a task is runnable or blocked before the runtime queue touches it

Current contract:

- module path: `web/lib/aie/taskDependencyGraph.ts`
- main entry points: `createTaskDependencyGraph()`, `evaluateTaskRunnable()`, `getRunnableTasks()`, `detectTaskConflicts()`, `detectCircularDependencies()`, `summarizeTaskDependencyGraph()`, and `explainTaskBlockers()`
- node statuses: `pending`, `active`, `completed`, `blocked`, `paused`, and `failed`
- edge types: `depends_on`, `blocks`, `conflicts_with`, and `related_to`

How it improves orchestration decisions:

```text
Goal A: Fix KBM input
Goal B: Playtest grenade feature
Goal B depends_on Goal A

AI-E should not schedule Goal B until Goal A is completed.
```

What this still guarantees:

- the dependency graph does not execute tasks directly
- the dependency graph does not bypass approval or validation gates
- operator priority is preserved, but only among tasks that are actually runnable
- blocker explanations stay explicit instead of turning into hidden scheduling rules

Why this improves the runtime environment:

- AI-E can now understand “do this before that” and “this goal is not runnable yet”
- active conflicts no longer have to be inferred from queue order alone
- multi-goal orchestration remains deterministic while becoming dependency-aware

Milestone direction:

- this moves AI-E from “Which goal has priority?” toward “Which goal is actually safe and ready to run?”

## Runtime State Store and Boot Resume

AI-E now also includes a runtime state store so the bounded runtime can remember its last service state across process restarts and decide whether boot resume is safe before the runtime starts again.

What the runtime state store does:

- saves a deterministic runtime service snapshot keyed by runtime id
- loads prior runtime state at boot without requiring an external database
- validates whether the prior runtime state is clean, blocked, stale, or corrupt
- only permits boot resume when the prior state is fresh and safe
- reports previous shutdown reason, stored tick history, and boot-resume status in the runtime summary

Current contract:

- module path: `web/lib/aie/runtimeStateStore.ts`
- main entry points: `createRuntimeStateStore()`, `saveRuntimeState(store, serviceState)`, `loadRuntimeState(store, runtime_id)`, `validateRuntimeState(record, now)`, `evaluateBootResume(store, runtime_id, now)`, and `summarizeBootResume(result)`
- boot-resume statuses: `no_prior_state`, `resume_ready`, `resume_blocked`, `resume_requires_review`, and `state_corrupt`

Example boot flow:

```text
AI-E starts
-> loads prior runtime state
-> checks freshness and prior stop reason
-> either resumes safely through the normal entrypoint or asks the operator to review
```

What this still guarantees:

- boot resume never bypasses approval freshness
- boot resume never bypasses context freshness
- boot resume never auto-approves anything
- the state store never runs cycles directly
- the runtime only resumes through the existing bounded scheduler and session safety gates

Why this improves the runtime environment:

- AI-E can now remember its last runtime state across process restarts
- stale or unsafe prior runtime states are surfaced for operator review instead of being resumed automatically
- previous shutdown reason and stored tick history remain visible at the runtime boundary
- the runtime environment improves without weakening any existing supervised autonomy constraints

Milestone direction:

- this moves AI-E from having a runtime that starts safely to having a runtime that survives restarts safely.

## Operator-Light Planner

AI-E now also includes an Operator-Light Planner for the post-100% expansion phase. This layer takes rough operator intent and converts it into a deterministic execution packet for Codex, Copilot, or future autonomous agents without directly mutating code from vague instructions.

What the Operator-Light Planner does:

- accepts a rough request and turns it into a structured plan packet
- always separates planning, implementation, validation, commit, and follow-up responsibilities
- calls out assumptions, missing information, risk, repo targets, and whether human playtesting is required
- always includes GitHub procedure guidance so downstream execution stays reviewable
- keeps the system planning-first rather than over-eager when the request is vague or risky

Current contract:

- module path: `web/lib/aie/operatorLightPlanner.ts`
- main entry point: `createOperatorLightPlan(request)`
- output fields: `interpreted_goal`, `assumptions`, `missing_information`, `risk_level`, `repo_targets`, `execution_steps`, `validation_steps`, `git_commit_plan`, `playtest_required`, and `next_operator_decision`

Example input:

```ts
const request = {
  rawRequest: "Make the enemies smarter and add better grenade stuff.",
  projectName: "BABYLON Unity gameplay project",
};
```

Example output:

```ts
{
  interpreted_goal: "Plan a bounded gameplay improvement pass for enemy behavior and grenade interactions without directly mutating code from the rough request.",
  assumptions: [
    "Assume the target project is BABYLON Unity gameplay project.",
    "Do not execute code changes directly from this rough request; inspect first and turn approved scope into a staged handoff.",
    "Treat gameplay-affecting work as playtest-sensitive even when automated checks pass.",
  ],
  missing_information: [
    "The exact enemy behavior change is not specified.",
    "The exact grenade behavior, damage model, or reaction scope is not specified.",
  ],
  risk_level: "medium",
  repo_targets: [
    "enemy AI scripts",
    "grenade gameplay scripts",
    "gameplay scenes or test levels",
    "playmode or gameplay validation tests",
  ],
  playtest_required: true,
  next_operator_decision: "Approve the narrow implementation slice and identify the required playtest owner, scene, or validation session before execution starts.",
}
```

Why this matters for the expansion phase:

- AI-E can accept rougher operator input without pretending that vague requests are safe to execute immediately
- downstream coding agents receive a cleaner handoff packet with explicit blockers and validation expectations
- the planner stays deliberately separate from autonomous execution so this commit adds structure without adding unattended repo mutation

## Constraint Router

Build the system that uses everything else, safely.

AI-E is a constraint-aware orchestration and execution layer that translates human intent into safe, bounded, environment-aware plans. The new Constraint Router is the first engine-facing proof of that positioning: it takes a messy game-development request, parses what is actually present, resolves engine and safety constraints, produces a bounded scaffold-first plan, and emits a Unity-first handoff without pretending the request is more complete than it is.

What the Constraint Router does:

- parses natural-language game requests into a typed intent model
- resolves explicit constraints, ambiguities, unsupported targets, and blocked actions before planning
- produces bounded scaffold-level execution plans instead of overpromising full systems
- emits Unity-first structured JSON and Codex-ready handoff text for practical execution

Why Unity is first:

- Unity is the first implemented engine adapter, not the center of the architecture
- the core parser, constraint resolver, and plan builder stay engine-agnostic so later adapters can reuse the same contract
- Unity support is intentionally bounded to planning and handoff generation rather than scene mutation, prefab editing, or build automation

Current limitations:

- only Unity is implemented today; Unreal and Godot return clean unsupported-target results
- vague requests downgrade to bounded draft plans with explicit missing inputs instead of hidden guesses
- this layer does not automate engines, mutate scenes, edit prefabs, or run build pipelines
- the first pass is scaffold-first and operator-reviewed by design
## Windows OpenClaw Operator Console Status

The current active operator-console surface in this repo is the Windows-first OpenClaw controller shell. The known-good checkpoint is:

- Current baseline: `Windows OpenClaw Operator Console v3.0 - Operator Dev Loop Stabilization`
- Health: `Healthy`
- Security: `Safe`
- Readiness: `Ready`
- Launch command: `python -m app.main`

What is now working:

- local OpenClaw runtime start, stop, restart, and status control from the PySide6 desktop shell
- offline/online mode selection with policy guardrails preserved
- trusted health and security diagnostics, including ownership-aware port conflict checks and multi-signal runtime liveness
- secure Telegram bot validation, connection testing, and polling-loop start/stop controls
- duplicate-safe Telegram interaction loop with `/start`, `/help`, `/status`, `/mode`, `/models`, `/repo`, `/file <path>`, `/patchfile <path>`, `/writefile <path>`, `/lastaction`, `/run <command>`, `/test [target]`, `/web <url>`, `/contexts`, `/clearcontext`, `/capabilities`, `/ask <prompt>`, `/askd <prompt>`, `/asklast <prompt>`, `/askctx <id> <prompt>`, `/explainrepo [path]`, `/explainfile <path>`, `/summarizeweb <url>`, `/workflows`, `/workflowstatus [id]`, and `/cancelworkflow [id]`
- deterministic Telegram command parsing with whitespace-tolerant handling, consistent casing behavior, and short correction replies for malformed commands
- per-chat provider-ask control with explicit in-flight rejection, bounded provider timeouts, and a narrow provider-ask cooldown to prevent accidental spam
- centralized capability registry and evaluator that gate command execution through explicit `allowed`, `blocked`, `degraded`, `confirmation_required`, or `unavailable` states
- one-shot confirmation handling for online-sensitive asks under `Ask Before Online`, including short-lived pending approvals plus Telegram `/confirm <id>` and `/deny <id>` controls
- structured execution requests and results that drive Telegram command replies, recent operator summaries, and desktop result visibility with consistent success, blocked, degraded, timed-out, and confirmation-aware outcomes
- manifest-backed capability definitions with explicit trust-boundary classification, Telegram exposure rules, startup validation, trust-aware `/capabilities` output, and compact desktop trust summaries for the most recent capability and execution result
- explicit repository, file, and web read-only capability surfaces that preserve scope enforcement, trust labels, and auditability across `/repo`, `/file`, and `/web`
- controlled file mutation through confirmation-gated `/patchfile` and `/writefile`, with scoped existing-file writes only, bounded text formats, stale-base rejection, and audit summaries that stay Telegram-readable
- controlled local execution through confirmation-gated `/run` and `/test`, with repository-root scope enforcement, blocked shell operators, bounded Python/test command allowlists, deterministic exact-once confirmation handling, timeout enforcement, and concise execution summaries
- explicit operator loop continuity through `/lastaction`, which preserves the latest meaningful inspect/edit/run action without being overwritten by passive status or audit reads
- bounded explicit context reuse with Option A semantics: visible recent contexts, stale contexts allowed with warning, expired contexts visible but blocked from reuse, and no hidden carryover across chats or restarts
- explicit bounded workflow composition that chains existing safe capabilities into short operator-visible sequences without adding autonomy, background planning, or mutation powers
- workflow reliability hardening with bounded workflow retention, deterministic expiry, explicit cancel/resume semantics, and operator-visible workflow inspection replies
- concise audit summaries that now keep execution exit codes and output summaries visible enough to follow edit-to-test sequences from Telegram

What the v2.7 workflow layer means in this project:

- workflows are explicit Telegram commands, not freeform planning
- each workflow is a short deterministic sequence over already-supported capabilities
- current workflows are `/explainrepo [path]`, `/explainfile <path>`, and `/summarizeweb <url>`
- workflows may reuse one or more explicit context buffers as grounded input to a single final `/ask` step
- each step still runs through the normal evaluator, scope validator, confirmation rules, audit store, and context buffer layer
- workflows pause explicitly on confirmation, retain the pending confirmation id, and resume only from `/confirm <id>` in the same chat
- paused or running workflows expire deterministically after a bounded lifetime instead of lingering indefinitely in resumable state
- operators can inspect recent workflows with `/workflows`, inspect one workflow with `/workflowstatus [id]`, and cancel an active workflow with `/cancelworkflow [id]`
- workflow status is visible in the desktop shell through last workflow type, state, step, and summary, with workflow id and pause/confirmation state reflected in those labels
- workflows do not introduce branching graphs, retries, hidden tools, scheduling, or autonomous execution

What `web.fetch.read` means in this project:

- `/web <url>` is a bounded public-web preview capability, not a browser or scraper
- only configured allowlisted domains are reachable, using normalized hostname matching with explicit wildcard-subdomain support such as `*.ollama.com`
- supported preview types are intentionally narrow: `text/plain`, `text/html`, `text/markdown`, and `application/json`
- fetch execution is bounded by a fixed timeout, max response size, and max returned preview length
- HTML is converted to readable text, JSON is compacted into a small summary, and unsupported or binary content is rejected cleanly
- redirects are allowed only when the redirected target remains inside the configured allowlist; redirect escape attempts are blocked and audited
- no POST, PUT, PATCH, or DELETE support exists; no browser automation, cookies, login/session handling, crawling, downloads, or script execution are performed
- `always_offline` still blocks remote web fetches, `ask_before_online` still requires one-shot confirmation when applicable, and confirmation never overrides out-of-scope domains
- successful `/web` replies can enter the explicit context buffer as `web_preview` entries, where truncation and source type remain visible through `/contexts`
- each `web.fetch.read` execution is audited with bounded sanitized metadata only; full page bodies and query-string secrets are not recorded

What a capability manifest means in this project:

- a capability manifest is now the source of truth for one named action's identity, execution type, provider dependency, runtime/readiness needs, trust boundary, exposure rules, timeout support, confirmation sensitivity, and user visibility
- registry loading validates capability ids, required fields, and basic trust-boundary consistency before the controller uses those capabilities
- evaluator, executor, `/capabilities`, and recent desktop summaries now read trust assumptions from the manifest instead of duplicating them in scattered command branches
- manifests currently classify each capability by `access_kind`, `locality`, `data_scope`, `offline_safety`, `confirmation_sensitivity`, and `telegram_exposure`

Execution and trust model:

- every Telegram capability execution still creates one structured request and one structured result with outcome, reason code, user-facing message, sanitized internal summary, duration, provider/mode usage, and confirmation usage state
- execution results now also carry manifest trust metadata so Telegram summaries and the desktop shell can show concise trust labels like `read-only`, `local`, or `online-sensitive`
- Telegram exposure is now explicit: capabilities marked `denied` cannot run from Telegram, and `limited` capabilities degrade into a restricted Telegram-safe path instead of executing as a full action
- no capability can silently bypass `always_offline`, invalid provider state, runtime failure, readiness failure, or confirmation rules
- web capability audit and reply surfaces remain bounded: concise previews only, no giant JSON dumps, no full-page HTML dumps, and no body leakage into audit summaries

Confirmation flow:

- online-sensitive `/ask` requests under `ask_before_online` return a confirmation prompt with a short id instead of silently escalating
- approve that one request with `/confirm <id>` or reject it with `/deny <id>` from the same Telegram chat
- pending confirmations expire automatically after a short lifetime and can be used only once
- confirmation does not override `always_offline`, runtime failures, readiness failures, or invalid provider state

Milestone notes:

- v1 baseline: `docs/OPENCLAW_BASELINE_V1.md`
- v1.1: `docs/milestones/windows_openclaw_operator_console_v1_1_telegram_interaction_loop.md`
- v1.2: `docs/milestones/windows_openclaw_operator_console_v1_2_first_useful_commands_layer.md`
- v1.3: `docs/milestones/windows_openclaw_operator_console_v1_3_conversation_quality_layer.md`
- v1.4: `docs/milestones/windows_openclaw_operator_console_v1_4_interaction_reliability_and_control_layer.md`
- v1.5: `docs/milestones/windows_openclaw_operator_console_v1_5_controlled_capability_layer.md`
- v1.6: `docs/milestones/windows_openclaw_operator_console_v1_6_confirmation_and_escalation_layer.md`
- v1.7: `docs/milestones/windows_openclaw_operator_console_v1_7_capability_execution_contracts.md`
- v1.8: `docs/milestones/windows_openclaw_operator_console_v1_8_capability_manifests_and_trust_boundaries.md`
- v1.9: `docs/milestones/windows_openclaw_operator_console_v1_9_sandbox_scope_and_audit_layer.md`
- v2.0: `docs/milestones/windows_openclaw_operator_console_v2_0_read_only_repo_insight_capability.md`
- v2.1: `docs/milestones/windows_openclaw_operator_console_v2_1_read_only_file_access_capability.md`
- v2.2: `docs/milestones/windows_openclaw_operator_console_v2_2_bounded_web_fetch_capability.md`
- v2.3: `docs/milestones/windows_openclaw_operator_console_v2_3_context_bridging_layer.md`
- v2.5: `docs/milestones/windows_openclaw_operator_console_v2_5_bounded_web_fetch_capability.md`
- v2.6: `docs/milestones/windows_openclaw_operator_console_v2_6_multi_step_task_composition_operator_workflow_layer.md`
- v2.7: `docs/milestones/windows_openclaw_operator_console_v2_7_workflow_reliability_resume_and_operator_transparency.md`
- v2.8: `docs/milestones/windows_openclaw_operator_console_v2_8_controlled_file_mutation_patch_first.md`
- v2.9: `docs/milestones/windows_openclaw_operator_console_v2_9_controlled_execution_layer.md`
- v3.0: `docs/milestones/windows_openclaw_operator_console_v3_0_operator_dev_loop_stabilization.md`

Important guardrails and usage notes:

- Offline Mode remains first-class and no silent provider or mode fallback is allowed.
- `/ask` and `/askd` remain explicit; generic plain text is not auto-routed into provider-backed queries.
- capability manifests define Telegram exposure and trust boundaries; registration, evaluation, and execution do not guess these rules dynamically
- `/confirm <id>` approves exactly one pending action; `/deny <id>` rejects it; expired or already-used confirmations cannot be replayed
- `/capabilities` is introspection only; it reports current trust-aware capability state and does not grant new powers
- the controller stays local-first with loopback bind defaults and secret redaction in logs, summaries, and Telegram activity surfaces
- still intentionally not implemented: automation, scheduling, scraping, RAG, open-ended repo mutation, multi-channel expansion, or AI-E orchestration behavior

Current active checkpoint:

- `Windows OpenClaw Operator Console v3.0 - Operator Dev Loop Stabilization`
- goal: prove the explicit inspect -> patch -> confirm -> run/test -> inspect-result loop stays deterministic, concise, and non-autonomous

Fast operator path:

1. Launch the desktop shell with `python -m app.main`.
2. Start the runtime and run Health/Security checks.
3. Validate Telegram, start the Telegram loop, and message the configured bot.
4. Use `/help`, `/status`, `/mode`, `/repo`, `/file <path>`, `/patchfile <path>`, `/writefile <path>`, `/lastaction`, `/run <command>`, `/test [target]`, `/web <url>`, `/explainrepo [path]`, `/explainfile <path>`, `/summarizeweb <url>`, `/workflows`, `/workflowstatus [id]`, `/contexts`, `/capabilities`, `/ask hello`, or `/askd hello` from Telegram.
5. If `/ask`, `/web`, or a workflow step returns a confirmation prompt, reply with `/confirm <id>` to approve that one request, `/deny <id>` to reject it, or `/cancelworkflow [id]` to cancel the active workflow instead of resuming it.
6. If `/capabilities` shows `blocked`, `degraded`, or `unavailable` state for provider, repo, file, or web actions, resolve the noted readiness, scope, or provider issue before retrying.
7. Run `python -m unittest discover -s tests -v` and `python diagnostics_smoke.py` for the current controller verification pass.

## AI-E v1 Product Surface Status

These sections are the current source of truth for the public-facing AI-E v1 experience. Where they conflict with older control-panel wording below, use this product-surface status first.

## Latest Validation Findings

AI-E v1 validation is now complete for the current supported deterministic path. The validated surface includes Home, Prompt Intake, Approval Review, Live Run Status, Result Summary, and Project / Session History, plus the hardening pass for copy, empty/error guidance, onboarding, proof/history polish, launch reliability, sandbox handoff, and next-step guidance. Intent normalization is now included in the deterministic movement path, so light natural-language variations map cleanly to the canonical supported action instead of failing on strict string matching alone.

The latest bounded autonomy milestone is also validated for supported platformer intent flows. AI-E can now map approved gameplay directives such as `make level more intense` into a bounded traversal plan, run an internal capped attempt loop, retain only valid deterministic candidates, and surface them through an explicit review state before any completion wording appears, without ranking, auto-approving, or bypassing user review.

AI-E also now supports bounded platformer manual correction and layout-quality review flows. Designers can capture explicit keyboard/mouse platformer layout edits through a Unity-side correction tool, persist project-local correction artifacts, and surface deterministic spatial validation findings through the existing experiment, evaluation, and proof outputs.

AI-E now also supports bounded environment theme review for the Babylon Ground object. The Babylon ground-theme lane can restore the live Ground object to the Cement baseline and apply the supported grass, dirt, gravel, and damaged-ground themes through the same deterministic translator/router/probe path. Supported prompts such as `make the ground grassy`, `change the ground to dirt`, `change the ground to gravel`, and `make the ground look damaged` resolve to explicit approval review first, execute only after approval, and continue to fail closed for unsupported broad terrain-art prompts. AI-E now also supports a small allowlisted compound family on top of that proven lane: `make the ground gravel and damaged`, `apply a dirt and damaged ground theme`, `make the ground grassy and damaged`, and `apply a damaged gravel ground theme`. These compound requests stay review-gated and decompose into fixed sequential Ground theme steps rather than freeform blending or broader terrain-art generation. The damaged-ground milestone is now proven through both direct Babylon execution and the approval-reviewed AI-E path, and the bounded composition pass is proven end-to-end with live cleanup back to the Cement baseline.

AI-E now also supports the first two bounded explosive-barrel layers in BABYLON. Foundation prompts such as `place an explosive barrel`, `add an explosive barrel`, and `enable the explosive barrel` normalize into one approval-gated deterministic action that designates the fixed approved scene target `barrel0` as the explosive barrel foundation. The next bounded prompt family, including `make the explosive barrel destructible`, `prepare the explosive barrel as a destructible prop`, and `configure the explosive barrel for destructible behavior`, now advances that same approved target into the reviewed `destructible_ready` state/config without yet adding leak, explosion, blast-radius, chain-reaction, or broader combat behavior.

## AI-E System Evolution (Latest)

AI-E now layers bounded interpretation and review tools on top of the original deterministic mutation path without introducing autonomous execution. Supported requests can move through explicit goal-intent mapping, bounded goal composition, deterministic outcome evaluation, current-session experiment tracking, and explicit experiment decision tracking while still resolving into known capabilities, known predefined plans, or safe review-only summaries.

AI-E now also supports bounded platformer autonomy for a narrow set of approved traversal intents. Supported directives are translated into known platformer plans, executed through a capped internal attempt loop, persisted as an unranked deterministic candidate set, and reported back through an explicit review surface that shows candidate sets, attempt logs, and approval actions directly while preserving user approval, rejection, and follow-up control. `AUTONOMOUS BUILD COMPLETE` is reserved for the post-approval completion state after a user-selected variation has been applied.

AI-E now also records platformer manual correction sessions and validation-aware review metadata without expanding into open-ended generation. The correction path is explicit and project-local, the Unity bridge emits a deterministic payload, and the validation layer reports reachability, ladder, elevator, gap, and overlap findings directly into comparison and proof summaries instead of silently changing geometry.

AI-E now supports two bounded enemy profiles in BABYLON:

- `zombie`
- `runner`

Runner is the selected second archetype because BABYLON already provides a deterministic runner bootstrap path on top of the existing enemy AI surface, which keeps the expansion low-friction, explainable, and compatible with the current bounded experimentation architecture.

- Goal-intent mapping:
  - explicit gameplay goals such as `make zombie more dangerous`, `make zombie easier`, `make runner more dangerous`, and `make runner easier` now resolve to supported bounded plans instead of requiring only literal plan phrasing
- Goal composition:
  - supported multi-goal requests such as `make zombie faster but less aggressive` resolve into bounded composed plans with conflict blocking for unsupported combinations like `make zombie faster and slower`
- Multi-entity ambiguity handling:
  - now that both `zombie` and `runner` are supported, generalized prompts such as `make enemy more dangerous` or `make character faster` are blocked until the user names the supported target explicitly
- Outcome evaluation:
  - AI-E now compares the latest supported result against the previous related result and can emit deterministic summaries such as `Current zombie is faster but less aggressive than previous version.`
- Experiment tracking:
  - AI-E now records current-session variants under deterministic ids such as `experiment_0001`, `variant_0001`, and `variant_0002`
  - review-only prompts such as `show current experiment variants` surface variant lineage without starting execution
- Decision tracking:
  - users can now mark the active variant as kept or rejected, set a preferred baseline, and review those decisions through bounded review-only prompts

Example flows:

- `make zombie faster but less aggressive`
  - resolves through bounded goal composition into a supported multi-step plan
- `make runner more dangerous`
  - resolves through bounded goal-intent mapping into the supported runner combat-variation plan
- `show current experiment variants`
  - returns a review-only current-session variant summary
- `keep current variant`
  - records an explicit user decision on the active variant without executing any mutation
- `make level more intense`
  - resolves through bounded platformer goal-intent mapping into the supported challenge traversal plan
- `make traversal more challenging but fair`
  - runs the bounded platformer autonomy loop, stores valid deterministic candidates, and returns an autonomy review surface first; `AUTONOMOUS BUILD COMPLETE` appears only after a user-approved variation is applied
- `save manual platformer correction`
  - persists explicit keyboard/mouse correction artifacts under project-local storage and exposes the saved correction summary through review surfaces
- `compare level set a and level set b`
  - returns a review-only platformer layout/profile comparison without starting execution

## AI-E 4-Layer Operating Model

This is the current strategic model for AI-E. It separates the already-shippable MVP-quality surface from the deeper intelligence and autonomy layers that still need to be built.

### Layer 1 — Trustable Intelligence Output

- Purpose: produce credible, specific, useful first-pass diagnosis
- Includes: one likely cause, evidence-backed reasoning, code-aware diagnosis, actionable next steps, stable output formatting
- Long-term weight: 20%
- Current completion estimate: 85% to 90%

### Layer 2 — Guided Debugging System

- Purpose: turn diagnosis into a guided debugging workflow
- Includes: follow-up questioning, narrowing the cause, branching debug paths, preserving issue context through a session, step-by-step user guidance
- Long-term weight: 25%
- Current completion estimate: 10% to 15%
- Current minimal shipped behavior: the first guided debugging step in the product diagnosis flow is now forced to be the highest-signal confirmation check for the primary cause before broader debugging begins

#### Layer 2 Follow-Up Loop (Planned)

- Trigger: after the user tries step 1, they can enter a short observation in response to `After you try the first step, what did you observe?`
- Expected observation shape: one brief concrete result such as `the error changed`, `nothing changed`, `the object is missing`, `the warning disappeared`, or `a different step now fails`
- Future desired behavior: AI-E should treat that observation as the result of the first confirmation check and respond with one bounded follow-up turn that either confirms the current diagnosis, refines it, or redirects the user to the next most relevant check
- Product boundary for this loop: this is one follow-up cycle only, not a general conversation system
- Out of scope for now: memory, long-running session state, autonomous multi-step planning, execution behavior, hidden wiring, prompt/schema/API changes, or any new architecture layer beyond the current UI design target

#### Bounded Verification Model (Layer 2 -> Layer 3 Bridge)

- Purpose: define how AI-E should interpret the user's observation after a confirmation step without expanding beyond the current stateless loop
- Verification result types:
  - `Confirmed`: the observation supports the current diagnosis
  - `Falsified`: the observation disproves the current diagnosis
  - `Inconclusive`: the observation changes behavior partially or does not isolate the cause clearly
- Expected AI-E behavior:
  - `Confirmed`: narrow further or move toward fix guidance
  - `Falsified`: drop the disproven cause and re-center on the next strongest grounded cause
  - `Inconclusive`: preserve the best grounded cause but suggest a more discriminating next check later
- Verification quality principles:
  - prefer observations that isolate one system
  - prefer reversible checks over permanent changes
  - treat `symptom A changed but symptom B remained` as especially valuable evidence
  - do not confuse reduced severity with full confirmation
  - do not treat broad reverts as strong proof
- Out of scope:
  - no memory model
  - no multi-step planner
  - no execution engine
  - no hidden state
  - no autonomous chaining

#### 10-Case Audit Rerun (2026-04-15)

- Audit scope: reran the same 10-case full-loop validation after the client-side interpretation refinement in `AnalysisResult.tsx`
- Result: `Pass 7`, `Borderline 2`, `Fail 1`
- Stability threshold: met the `7/10 pass` gate for the current bounded Layer 3 loop
- What improved: decisive falsification and decisive confirmation cases no longer default to `Inconclusive` when the follow-up evidence is clear
- Regression check: messy, partial, and ambiguous cases remained appropriately conservative and did not show a new over-classification pattern
- Recommended next move: treat the current interpretation loop as the new stable baseline and proceed to the next small bounded Layer 3 refinement
- Remaining weakness: the next smallest failure source appears to be first-step and second-pass diagnosis quality in weak-evidence cases, not the current verification-state classifier

#### Confirmation-Step And Falsification Re-centering Refinement (2026-04-15)

- What changed: the client-side result renderer now rewrites passive confirmation-first steps into reversible before/after checks, and falsified follow-up results are displayed with a re-centered diagnosis that explicitly names the newly indicated lever instead of leading with the disproven cause
- Why it was needed: the stable interpretation baseline still showed two product weaknesses in playtesting, weak inspection-style first steps and falsified cases where the badge changed faster than the diagnosis copy
- Expected effect: users should get sharper step-1 evidence and clearer visible redirection when the first hypothesis fails
- Targeted validation status: one decisive falsification case re-centered correctly, both weak-evidence cases showed stronger confirmation steps while remaining `Inconclusive`, and one mixed-system falsification probe still stayed `Inconclusive`
- Next validation move: keep this out of full playtest for now and re-check falsification behavior on a broader mixed-system subset before rerunning the full 10-case audit

#### Alternate Lever Dominance Refinement (2026-04-15)

- What changed: the client-side renderer now treats `first step had no effect` plus `a different action clearly fixed or removed the issue` as alternate-lever dominance, even when the refined diagnosis text does not independently re-center fast enough
- Why it was needed: mixed-system falsification cases were still sticking in `Inconclusive` when the user observation clearly showed that another lever dominated the result
- Expected effect: mixed-system follow-ups should classify as `Falsified` more reliably and route the visible diagnosis toward the effective lever
- Targeted validation status: two mixed-system falsification probes now classified as `Falsified` with visible re-centering, while two weak-evidence controls remained `Inconclusive`
- Next validation move: this passes the targeted gate for mixed-system falsification behavior, but the loop is still not full playtest-ready until the broader 10-case audit is rerun against the new baseline

#### Second-Step Guidance For Falsified And Inconclusive Outcomes (2026-04-15)

- What changed: the client-side renderer now adds a small `Next focused step` block for non-confirmed refined results, deriving a second guided check from the current refined diagnosis plus the latest observation without expanding backend state or schema
- Why it was needed: the bounded Layer 3 loop could now classify follow-up evidence more reliably, but falsified and inconclusive outcomes still stopped one step too early and left the user to invent the next probe alone
- Expected effect: falsified outcomes should immediately point to the newly indicated lever, while inconclusive outcomes should narrow the next probe to one concrete system variable instead of broadening the search
- Targeted validation status: two falsification probes produced relevant second steps aimed at the alternate lever (`stamina limiter`, `timeline handoff`), and two inconclusive probes produced system-focused second steps (`slope handling code`, `audio singleton implementation`) without any classification regression in the subset
- Implementation boundary: this remains a renderer-only refinement in `AnalysisResult.tsx` and does not change prompts, API shape, persistence, or autonomous behavior

#### Third-Step Continuation For Non-Confirmed Follow-Ups (2026-04-16)

- What changed: the client-side renderer now extends the same stateless guided-debugging pattern one step further, allowing a third focused probe when the second-step follow-up still lands in `Falsified` or `Inconclusive`
- Loop boundary: confirmed second-step outcomes continue to use the normal backend-provided next steps, while non-confirmed refined outcomes can generate one more bounded renderer-side step and then stop at step 3
- Stateless implementation: the guided chain is preserved only inside the existing `what_to_do_next` payload so the renderer can compare the current candidate against both prior steps without adding backend state, schema fields, API changes, or local memory
- Progression rule: the third step must still differ from both earlier steps by shifting lever, scope, or method, and the renderer rejects candidates that collapse back into the same action pattern or heavily overlap prior wording
- Targeted validation status: a live 2-chain subset covering `falsified -> falsified` and `inconclusive -> inconclusive` follow-up paths produced coherent 3-step sequences with no passive phrasing, low overlap between steps, and visible progression across the chain
- Remaining edge case: later-step focus extraction is structurally stable but can still inherit awkward wording from noisy observation text, so some step-3 phrases are less clean than the underlying lever shift even when the progression guard is doing the right thing
- Implementation boundary: this remains a renderer-only refinement in `AnalysisResult.tsx`, deliberately capped at three total guided steps, and is meant to validate chained reasoning stability rather than introduce open-ended autonomy

#### Loop Termination Classification For Guided Debugging (2026-04-16)

- What changed: the renderer now derives a small `Current status` block for refined follow-ups, classifying the bounded guided-debugging chain as `Resolved`, `Converging`, or `Stuck` without changing prompts, API shape, persistence, or backend behavior
- Status rule: refined follow-ups that classify as `confirmed` now terminate cleanly as `Resolved`, and strong recovery wording in the latest observation can still force `Resolved` when the user clearly reports that the issue is fixed, gone, or back to normal
- Status rule: `Converging` covers partial improvement, clearer narrowing, or a meaningful next lever before the bounded loop is exhausted
- Status rule: `Stuck` covers repeated unresolved outcomes with no partial-improvement signal, and strong dead-end observation wording now also forces `Stuck` for mixed, inconsistent, or no-clear-change outcomes even before the bounded loop is exhausted
- UI effect: refined results now show `Current status` alongside the existing refined diagnosis messaging so the user can tell whether the loop appears solved, still narrowing, or no longer moving
- Targeted validation status: the requested live 6-case matrix passed in full against `/api/analyze` with `2 resolved`, `2 converging`, and `2 stuck` chains matching expected status labels
- Targeted validation status: a follow-up 4-case live rerun for the threaded override pass also passed in full against the local analyzer route, with `Resolved + Stop`, `Converging + Continue debugging`, `Stuck + Escalate`, and `Stuck + Restart fresh` all matching the expected outcomes
- Targeted validation status: a natural-language robustness pass then reran 12 live wording variants against the local analyzer route without changing renderer logic, covering `4 resolved`, `3 converging`, `3 stuck dead-end`, and `2 stuck restart-fresh` observations such as `It's back to normal now`, `That fixed it`, `Movement is smoother, but not fully fixed`, `I still can't isolate the real cause`, and `Everything still feels mixed together and I don't trust the thread anymore`; all 12 matched the expected status and suggested action outputs
- Regression check: the same validation run reported `MISMATCHES: None` and `PASSIVE: None`, so the status layer did not interfere with existing guided-step generation or reintroduce passive phrasing
- Remaining edge case: structural variation alone is not treated as progress anymore at the step-3 boundary, so intentionally bounded-loop exhaustion is now the deciding signal when the chain is still unresolved; future monitoring should focus on less explicit everyday phrasing that implies recovery or dead-end status without using direct terms like `fixed`, `stuck`, or `back to normal`

#### Stuck Loop Escalation Strategies (2026-04-16)

- What changed: when the renderer classifies a refined debugging chain as `Stuck`, it now shows a small `Suggested escalation` block instead of continuing to surface another normal focused step
- Escalation boundary: this only appears for `Stuck` chains and stays renderer-only, with no backend, schema, API, or persistence changes
- Strategy rule: the escalation must shift to a higher-level recovery move rather than suggest a minor variation of the same step pattern
- Available strategies: `Isolate to minimal reproduction`, `Switch to logging/debug instrumentation`, `Disable all but one system and rebuild`, and `Test in a clean scene or environment`
- Selection rule: the renderer chooses among those strategies from the current stuck context, prior guided steps, and broad problem signals so scene/bootstrap-style failures bias toward clean-environment checks while mixed-system churn biases toward single-system rebuild isolation
- UI effect: `Next focused step` is suppressed for stuck chains so the user sees the escalation strategy as the next move instead of another bounded-loop micro-step, and the escalation block is now hidden when the stuck recommendation is `Restart fresh` rather than `Escalate`
- Targeted validation status: two known stuck chains were re-run against the live analyzer and both kept `Current status = Stuck` while the escalation output remained actionable and materially different from the prior guided steps
- Recommendation split: true dead-end observations now align to `Stuck + Escalate`, while low-signal mixed observations align to `Stuck + Restart fresh` without leaving the status sounding optimistic
- Regression check: the stuck validation did not change the existing loop classifier or step-generation path for non-stuck chains, and both checked escalations passed the difference check against the latest guided step

#### Lightweight Session Threading For Debugging Continuation (2026-04-16)

- What changed: the analyze form can now opt into a lightweight session thread that passes the last stored diagnosis, most recent attempted step, and latest `Resolved` / `Converging` / `Stuck` status into the next analysis request as structured client-side context
- Threading boundary: this remains stateless at the backend level, uses only the existing browser session storage entry, and does not add persistent storage, agents, background loops, or a redesigned API contract
- Continuation rule: the new turn still requires fresh user input, but when session threading is enabled the next `/api/analyze` request includes a compact continuation block in `context` so the model starts from the previous debugging position instead of a fresh generic first pass
- UI effect: the analyze page now shows a `Session threading` card when a prior result exists, lets the user toggle continuation on or off, and the result page adds a direct `Continue this debugging flow` path back into the analyze form
- Workflow control: the result renderer now adds a `Suggested next action` recommendation so threaded sessions explicitly tell the user whether to continue the current thread, restart with a fresh analysis, stop because the issue appears resolved, or escalate when the loop is stuck
- Stored thread state: refined result updates now persist the last attempted step plus the latest loop-status label alongside the existing result payload so the next turn has concrete continuity anchors
- Targeted validation status: two sparse multi-turn scenarios were re-run against the live analyzer with threaded context, and both continuation turns retained the prior debugging frame instead of dropping back to a generic cold-start diagnosis
- Regression check: the existing bounded follow-up loop remains renderer-driven, and the threading change only affects new analyze submissions plus client-side session payload shaping

#### Session Isolation For Fresh Vs Threaded Analysis (2026-04-17)

- Observed issue: a fresh visit back into the analyze form could still inherit the previous browser-session debugging thread because both result-page actions landed on the same route and the continuation toggle defaulted on once session state existed
- What changed: the analyze page now resolves an explicit entry mode, defaults to `fresh`, and only loads the stored thread snapshot when the user intentionally enters through `mode=continue`
- Fresh-entry rule: `Analyze another issue` now routes to `/analyze?mode=fresh`, which bypasses the stored continuation snapshot and resets the continuation toggle so a new case starts cold by default
- Continue-entry rule: `Continue this debugging flow` now routes to `/analyze?mode=continue`, which preserves the prior diagnosis, last attempted step, and last status as an intentional client-side continuation only
- Boundary: this remains client-side only, keeps the existing session-storage payload, and does not add backend state, schema changes, or a new persistence layer
- Targeted validation status: the web lint pass completed cleanly, and a focused source validation confirmed all five path checks: fresh-default routing, explicit continue routing, explicit fresh routing, conditional session load on continue only, and continuation-toggle reset by entry mode

#### Lightweight Intent Anchoring For Guided Debugging Steps (2026-04-17)

- What changed: the result renderer now derives a small intent anchor from the active debugging thread before choosing steps 2 and 3, then biases later guided steps to stay aligned with that direction instead of picking the next merely-valid intervention
- Intent scope: the anchor stays renderer-only and ephemeral, with no planner, no backend changes, no schema changes, and no new stored state beyond the existing guided-step chain
- Current intent labels: `isolate root cause`, `confirm system boundary`, `narrow conflicting systems`, and `verify state transitions`
- Inference rule: the renderer derives the anchor from the earliest and latest guided steps plus the current diagnosis and observation, so falsified mixed-system threads bias toward conflicting-system narrowing while transition-heavy diagnoses bias toward state-transition verification
- Bias rule: the existing progression scorer still blocks repetition, while candidate method ordering and final scoring reward steps that match the inferred intent without letting that intent bonus overpower a same-method, same-lane near-repeat
- User-facing effect: multi-step flows now keep a more stable direction across steps 2 and 3, so the chain reads more like one line of investigation instead of hopping between unrelated but individually reasonable tests
- Targeted validation status: the renderer change kept the existing classification and non-repetition path intact while the manual live-case review focused on whether later steps stayed in the same investigative lane rather than just remaining technically valid

#### Lightweight Confidence Signaling For Debugging Analysis (2026-04-16)

- What changed: the result renderer now derives a small `Confidence: High|Medium|Low` label from the current verification state, loop status, and existing low-evidence cue, then displays it directly in the `Diagnosis` card
- Mapping rule: `resolved` or `confirmed` reads as `High`, `converging` or `falsified` reads as `Medium`, and low-evidence, inconclusive, or stuck states read as `Low`
- Boundary: this is renderer-only interpretability, uses only already-derived signals, and does not change classification, step generation, API contracts, or stored state
- User-facing effect: the diagnosis now communicates whether the current direction looks strongly supported, still narrowing, or worth double-checking before the user commits to the next step
- Targeted validation status: the renderer logic stayed isolated to presentation, while the live-case review focused on whether the visible confidence label would make the current result easier to trust at a glance without adding UI clutter

#### Observation Focus Sanitization For Threaded Follow-Ups (2026-04-16)

- Observed issue: live threaded follow-ups could still promote raw observation fragments into malformed step targets such as outcome phrases, vague process wording, or conversational leftovers instead of concrete system anchors
- What changed: the result renderer now sanitizes focus phrases more aggressively, strips helper-clause tails like `and one related variable`, blocks generic instructional fallbacks such as `next likely system`, and only accepts observation-derived anchors when they remain concrete and component-like
- Fallback rule: when the latest observation does not yield a safe focus, the renderer now falls back to diagnosis and prior-step system anchors rather than surfacing a malformed follow-up target
- Targeted validation status: the same 4 live playtest cases were rerun against the local analyzer route after the patch, and all four kept concrete second-step focuses (`stamina limiter`, `timeline handoff`, `slope handling logic or friction settings`, `audio singleton`) with `MALFORMED = None`, `PASSIVE = None`, and `WORKFLOW_REGRESSION = None`
- Remaining note: workflow suggestions still vary by case because they depend on the live analyzer wording, but the malformed focus leakage is now closed in the renderer path that feeds threaded follow-up guidance

#### First-Step Precision For Messy Multi-System Inputs (2026-04-16)

- What changed: the renderer now applies a lightweight first-step override for overloaded problem descriptions before showing the initial `What to do next` guidance
- Trigger rule: this only activates when the input looks messy or multi-system, such as `changed a bunch`, `touched X, Y, Z`, `everything feels broken`, `one pass`, or other broad mixed-system phrasing
- Selection rule: instead of preserving an arbitrary single-system guess or a broad `revert the recent changes` step, the renderer now extracts explicit recently changed systems from the problem description and starts with one named system at a time
- UI effect: messy inputs now bias toward a narrowing step like `Start by isolating one recently changed system at a time, beginning with ...` followed by a single-system compare step, while focused inputs keep their original specific first step
- Constraint boundary: this remains renderer-only, adds no planner, no extra state, and no backend, schema, or API changes
- Targeted validation status: five live first-pass cases were checked against the local analyzer route, and the four messy cases all resolved to intentional first-step narrowing anchored to an explicitly mentioned system while the focused projectile-pool control stayed specific instead of being rewritten into a broad multi-system step
- Remaining edge case: the heuristic still depends on recognizable system nouns in the original problem description, so very vague reports without named systems may still fall back to a generic isolate-one-system opening rather than a sharper named anchor

#### Second-Step Progression And Non-Repetition Guard (2026-04-15)

- What changed: the renderer now applies a small coherence guard before showing the second debugging step, rejecting candidates that reuse the same action pattern, stay on the same lever without narrowing, or overlap too heavily with the first step
- Progression rule: the second step must either move to a different lever, narrow to a subcomponent within the same system, or change method (`disable -> isolate`, `disable -> replace`, `disable -> force`) instead of restating the same test in different words
- Progression hardening: later guided steps now score candidate follow-ups instead of taking the first acceptable option, prefer concrete observation or analyzer-suggested anchors over broad fallback focus, and reject same-domain same-method churn unless the focus clearly narrows
- Suppression rule: if the renderer cannot find a concrete next lever after those checks, it now prefers returning no extra step over surfacing a generic or meta follow-up that only rephrases the previous test
- Stack hygiene: guided-step stacks are now sanitized before display and persistence, so weak generated follow-ups such as generic `system` placeholders or meta-step references are dropped instead of becoming the next displayed debugging step
- Fallback behavior: when the first candidate fails those checks, the renderer regenerates from alternate focus sources in priority order (`diagnosis`, `observation`, then remaining local anchors) while keeping the step reversible, observable, and action-oriented
- Targeted validation status: the 4-case live subset held classification steady (`2 falsified`, `2 inconclusive`), all second steps differed meaningfully from the displayed first step, phrase overlap stayed low, and no passive `inspect/check/log` phrasing appeared
- Targeted validation status: a later 4-case live progression probe for partial, messy, falsified, and stuck follow-ups showed the best improvement in cases that surfaced a concrete alternate lever (`stamina limiter`, `transition blend`, `shallow slopes`), while the remaining weak cases were narrowed to renderer-side candidate selection rather than status or workflow-control regressions
- Remaining edge case: if the first step itself comes back with very broad wording such as `revert the changes`, progression can still be enforced by method shift, but the first-step focus extraction is less crisp than the newer second-step focus selection

#### Full 10-Case Audit After Mixed-System Refinement (2026-04-15)

- Audit scope: reran the established 10-case full-loop audit against the current shipped renderer behavior after decisive-evidence interpretation, confirmation-step sharpening, falsification re-centering, and alternate-lever dominance refinements
- Result: `Pass 7`, `Borderline 2`, `Fail 1`
- Threshold result: the loop still clears the `7/10 pass` stability gate and remains suitable as the current bounded Layer 3 baseline
- Mixed-system result: no ambiguity regression appeared in the mixed-system audit cases, and the targeted mixed-system falsification probes already validated the new alternate-lever recentring path
- Remaining weakness: the next smallest issue is still first-step quality in low-evidence runtime and messy-input cases, not broad verification-state collapse
- Recommended next move: adopt the current Layer 3 loop as the stable baseline and treat any further work as a small bounded refinement on top of it rather than an architectural expansion

### Layer 3 — Execution / Verification

- Purpose: validate whether a diagnosis is true instead of only sounding convincing
- Includes: dry-run plans, execution checks, verification receipts, deterministic validation logic, eventually bounded real actions
- Long-term weight: 25%
- Current completion estimate: 20% to 25%

### Layer 4 — Deep / Autonomous Intelligence

- Purpose: achieve the long-term AI-E vision of powerful cross-project reasoning and bounded autonomy
- Includes: persistent project understanding, multi-step problem solving, evolving internal models, cross-session continuity, bounded autonomy, eventually studio-operation capability
- Long-term weight: 30%
- Current completion estimate: 3% to 5%

### Interpretation

- Deep intelligence is the destination, not the first shippable layer.
- Layer 1 proves credibility.
- Layer 2 proves workflow value.
- Layer 3 proves trust through validation.
- Layer 4 is the long-term moat.

## Design References

- Milestone summary: [docs/milestones/ai_e_bounded_experimentation.md](docs/milestones/ai_e_bounded_experimentation.md)
- Environment theme composition: [docs/milestones/ai_e_environment_theme_composition.md](docs/milestones/ai_e_environment_theme_composition.md)
- Explosive barrel foundation: [docs/milestones/ai_e_explosive_barrel_foundation.md](docs/milestones/ai_e_explosive_barrel_foundation.md)
- Explosive barrel destructible-ready: [docs/milestones/ai_e_explosive_barrel_destructible_ready.md](docs/milestones/ai_e_explosive_barrel_destructible_ready.md)
- Bounded autonomous build loop: [docs/milestones/ai_e_bounded_autonomous_build_loop.md](docs/milestones/ai_e_bounded_autonomous_build_loop.md)
- Manual correction capture: [docs/architecture/platformer_manual_correction_capture.md](docs/architecture/platformer_manual_correction_capture.md)
- Spatial layout validation: [docs/architecture/platformer_layout_validation.md](docs/architecture/platformer_layout_validation.md)
- Second supported enemy: [docs/milestones/ai_e_second_enemy_runner.md](docs/milestones/ai_e_second_enemy_runner.md)
- Design doctrine: [docs/doctrine/ai_e_design_doctrine.md](docs/doctrine/ai_e_design_doctrine.md)

## Current V1 Validated Status

AI-E now exposes a validated v1 front door over the existing system. A user can launch with `python -m app.ui`, land in a clean first-run flow, select a supported project, prepare a bounded request, see a clear intake decision, review approval when required, run the current sandbox-first mutation path, follow status updates, open a readable result summary, and revisit saved sessions or results. Supported prompts that stay within the current deterministic scope now execute cleanly, and unsupported deterministic requests fail honestly with clear guidance instead of pretending support.

## Intent Normalization Support

- prompt normalization now removes light filler words such as `again`, `slightly`, `a bit`, `just`, and `please` before deterministic capability lookup
- soft matching now maps known movement phrasing back to the canonical deterministic command when the user intent is still clearly the same
- canonical prompt resolution feeds the existing deterministic intake, approval, runtime, and artifact flow without introducing a new execution path
- explicit unsupported-direction handling now blocks unsupported deterministic requests honestly instead of silently downgrading them

## Conversational Mapping Support

- generalized conversational terms stay bounded and explicit; AI-E will not guess between multiple supported enemy archetypes
- once more than one bounded enemy archetype is supported, generalized terms such as `enemy` and `character` are blocked until the user names the supported target explicitly
- direct named enemy support is broader than generalized mapping:
  - `zombie` and `runner` are both supported named archetypes for bounded speed/aggression/danger flows
  - generic `enemy` and `character` no longer auto-map because AI-E must not guess between multiple bounded archetypes
  - supported rephrases are explicit, for example `make zombie more dangerous` or `make runner more dangerous`
- unsupported generalized terms such as `boss` remain blocked with a clear supported example instead of being guessed or executed blindly

## Supported Prompt Variation Examples

- `move zombie forward`
- `move zombie forward again`
- `move zombie slightly forward`
- `please move zombie forward`

All of these normalize to the canonical deterministic command `move zombie forward` and resolve to `level_0001_move_zombie_forward`.

## Explicitly Unsupported Deterministic Examples

- `move zombie backward`
- `move zombie backwards`
- `move zombie slightly backward`
- `please move zombie backward`
- `move boss forward`

These requests remain intentionally blocked because backward zombie movement is not a supported deterministic action yet, and unsupported generalized targets such as `boss` do not have a safe deterministic mapping. AI-E now says so clearly and suggests the supported example `move zombie forward`.

## What AI-E Supports Today

- supported-project selection from existing registry data plus the safe `BABYLON VER 2` fallback when present
- staged request preparation using existing intake and routing logic
- one-time approval review for requests that need approval
- live status polling from existing queue, session, and runtime state
- sandbox-first execution for the current bounded deterministic mutation path
- readable result summaries built from saved proof, run, and session artifacts
- project/session history with reopen and re-stage paths when saved data supports them
- deterministic prompt normalization for currently supported forward-movement variants
- bounded environment theme review for the Babylon Ground object using the supported grass, dirt, gravel, and damaged-ground themes
- bounded explosive-barrel foundation and destructible-ready review for one fixed approved barrel target in `Babylon FPS game ver 002`
- controlled conversational mapping from `enemy` and `character` onto the supported zombie target with explicit confirmation before execution
- direct bounded enemy tuning for the supported `zombie` and `runner` profiles in BABYLON
- bounded goal-intent prompts such as `make runner more dangerous` and `make runner easier`
- current-session experiment and decision review flows for both supported enemy profiles

## What Users Can Do Today

- choose a supported project like `BABYLON VER 2`
- prepare a request such as `move zombie forward`, `move zombie forward again`, or `please move zombie forward`
- prepare a bounded environment theme request such as `make the ground grassy`, `change the ground to dirt`, `change the ground to gravel`, or `make the ground look damaged`
- prepare a direct bounded tuning request such as `make zombie faster`, `make runner faster`, `make runner more dangerous`, or `make runner easier`
- prepare a bounded destructible-object request such as `place an explosive barrel`, `enable the explosive barrel`, or `make the explosive barrel destructible`
- name the supported enemy target explicitly when tuning archetypes, for example `zombie` or `runner`
- generalized terms such as `enemy` or `character` are intentionally blocked once multiple bounded enemy archetypes are supported, so AI-E does not guess the target for you
- submit it when AI-E shows `Ready`, or open review and approve it once when needed
- use `Run in sandbox` when AI-E says `Sandbox first`
- watch progress in `Live Run Status`
- open `Result Summary` to see verdict, changes, and validations
- reopen earlier results or prepare the same request again from `Project / Session History`

## First-Run Path

1. Launch AI-E and confirm a supported project is selected.
2. Use the recommended first request: `move zombie forward`.
3. Choose `Prepare Request`.
4. Submit it when AI-E shows `Ready`, open review and use `Approve once` if approval is required, or choose `Run in sandbox` when AI-E says `Sandbox first`.
5. Follow `Live Run Status`.
6. Open `Result Summary` or `Project / Session History` to confirm the saved outcome.

## Validation Closeout Status

- Launch validated: `python -m app.ui` reliably creates the Qt application, shows the main window, and keeps the process running until the window closes.
- First-run experience validated: onboarding appears on a true clean-profile launch, stays in normal layout flow, and points the user to the first action.
- Core path validated: Home -> Intake -> Review -> Status -> Result -> History is working on the supported Babylon path.
- Result guidance validated: result opening, next-step guidance, and supporting-file access are visible and usable after completion.
- Honest failure boundary validated: unsupported deterministic requests now fail with explicit, trustworthy guidance instead of generic or misleading fallback behavior.

### Product-Layer Prompt MVP Baseline

- MVP-ready baseline confirmed for the validated jump-case first-pass diagnosis.
- Passing regression standard:
  - exactly one primary cause
  - code-first diagnosis anchored to the velocity write / jump-force interaction
  - no fallback to mass, drag, gravity, or jumpForce tuning
  - next steps stay targeted to verifying that one code-level cause
- Baseline evidence: the validated jump case now diagnoses the per-frame `rb.velocity` write in `HeroController` as the cause that suppresses the upward `AddForce` result after the movement path changed to Rigidbody2D velocity.

## What Remains Deferred to V2

- broader structured intent parsing beyond the minimal normalization layer
- additional deterministic actions such as backward zombie movement
- messaging/chat
- overnight session launcher UI
- multi-user and permissions work
- new backend architecture or orchestration redesign
- broader integrations, analytics, or comparison features

## Mission (Locked)

AI-E:

- Observes target windows (no desktop-wide capture)
- Structures artifacts immutably per run
- Reports clearly so operators can reason quickly
- Never automates without explicit approval
- Never trains on copyrighted content
- Never fights human input

AI-E **is not** a bot player, training framework, content generator, stealth automation tool, or monetization engine.

## v5 Definition of Done

| Pillar | Status | Notes |
| --- | --- | --- |
| Core Architecture | ✅ Locked | Engine-agnostic perception adapter (`UnityWindowPerception`), action interface abstraction (`DisabledActionInterface` by default), and clear separation of perception / processing / reporting / UI layers. |
| Perception Layer | 🟡 Stable | Window-bound captures, hash-based delta detection, and focus-aware input gating via `InputFocusGate`. |
| Artifact & Reporting | 🟡 Stable | Timestamped run directories, structured JSON outputs, and movement telemetry stored alongside screenshots. |
| Operator UI | 🟡 Calm | Start/Stop, runtime diagnostics, action layer status indicator, and explicit messaging that automation stays locked. |
| Stability & Guardrails | 🟡 Enforced | Zero background network calls, failure-aware recorders, and regression hooks for missing windows/devices/artifacts. |

Nothing outside these pillars is part of v5.

## Architecture Overview

- Lane separation: [docs/architecture/ai_e_lane_separation.md](docs/architecture/ai_e_lane_separation.md) - Defines separation between product UI, raw dev testing, and execution layers
- Finalized prompt behavior to prevent inferred Rigidbody parameter diagnoses and enforce structural root-cause identification
- Improved diagnosis accuracy by prioritizing code-level interaction issues when snippets are provided
- Current MVP baseline: the product-layer prompt now achieves MVP-quality first-pass diagnosis on the validated jump case by selecting the code interaction bug over parameter tuning
- Minimal Layer 2 behavior is now present in the product lane: the first guided step is required to be the single highest-signal confirmation check for the primary diagnosis

```
app/
  actions.py      # Action interface abstractions (locked by default)
  artifacts.py    # Artifact builders, JSON writers, snapshot helpers
  config.py       # Operator profiles + persisted state
  dependencies.py # Optional dependency health checks
  diagnostics.py  # Focus tracker + elevation snapshot
  logger.py       # Append-only run event log
  main.py         # Entry point (python -m app.main)
  paths.py        # Project + artifact path helpers
  perception.py   # Window-bound perception adapters + movement deltas
  recorders.py    # Input + mic recorders (processing helpers)
  runner.py       # RunSession orchestrator (processing layer)
  ui.py           # PySide6 operator surface
```

- **Perception Layer** — `perception.py` exposes `UnityWindowPerception`, which captures screenshots, hashes them, and records `MovementDelta` entries to prove the window is alive without touching gameplay.
- **Processing Layer** — `RunSession` (runner.py) coordinates focus tracking, recorders, and action/perception adapters. Input capture is gated by `InputFocusGate` (recorders.py) so only foreground BABYLON activity is stored.
- **Reporting Layer** — `artifacts.py` (`build_run_summary`, `build_mapprobe_snapshot`) and `logger.py` guarantee immutable artifacts with explicit status blocks (OK, attention, no_data) instead of silent failures.
- **UI Layer** — `ui.py` (PySide6) keeps Start/Stop within reach, surfaces artifact folders, and shows the action layer lock so operators stay informed.
- **Action Layer** — `actions.py` defines `ActionInterface` but defaults to `DisabledActionInterface`. The UI’s Action Layer panel reiterates that automation stays off until an operator explicitly unlocks it.

## Setup & Run

## Python Environment Policy

- Approved interpreter: `E:\AI projects 2025\AI-E\.venv\Scripts\python.exe`
- For VS Code and Copilot work, pin this repo to `.venv\Scripts\python.exe`; do not create or select a different environment for this repo unless this README changes.
- For shell automation, prefer explicit interpreter invocation (`.\.venv\Scripts\python.exe ...`) over bare `python`.
- Run `powershell -ExecutionPolicy Bypass -File .\build_scripts\show_python_env.ps1` to print the expected interpreter path, version, and PASS/WARN status.

### Prerequisites

- Windows 10+
- Python 3.11+
- PowerShell 5.1+

### One-command environment setup

```powershell
cd "E:\AI projects 2025\AI-E"
. .\build_scripts\setup_env.ps1
```

Dot-source the script so your shell inherits the virtual environment. The script bootstraps `.venv`, upgrades `pip`, installs pinned requirements (PySide6, psutil, mss, pynput, sounddevice, pyinstaller), and activates the venv. Use `-SkipInstall` to reuse an existing environment.

### Manual setup (fallback)

```powershell
cd "E:\AI projects 2025\AI-E"
Set-ExecutionPolicy -Scope Process Bypass
.\.venv\Scripts\Activate.ps1
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

### Run from source

```powershell
.\.venv\Scripts\activate
.\.venv\Scripts\python.exe -m app.ui
```

The window title reads **AI-E v1**. On first launch, AI-E prefers a supported project such as `BABYLON VER 2` when one is available, keeps guardrails visible on the Home screen, and lets the user prepare a bounded request before anything runs. Use the Home screen to prepare a request, follow the intake decision, track progress, and open the saved result. The Action Layer panel remains locked unless future revisions explicitly enable automation.

### Demo checklist

Use **Help > Demo Checklist...** inside the app and walk through:

1. Launch AI-E (exe or source) and confirm the Home screen, guardrails, and a supported project are visible.
2. Use a direct bounded demo prompt such as `make zombie more dangerous` or `make runner more dangerous`.
3. Choose `Prepare Request` and show the bounded plan preview.
4. Run the supported request in sandbox.
5. Open `Result Summary` and show the proof-backed outcome.
6. Use the next-step actions to show the fast iteration path: modify the request again or try a variation.

## Artifact & Reporting Layer

Every run creates a timestamped folder under `runner_artifacts/`:

```
runner_artifacts/
  YYYYMMDD_HHMMSS_run_0001/
    run_meta.json            # full operator config + diagnostics (start & stop)
    run_summary.json         # perception, action layer descriptor, warnings
    mapprobe_snapshot.json   # connection + focus heartbeat
    events.log               # append-only timeline
    screenshot_start.png
    screenshot_end.png
    input_events.jsonl       # only when Record Input is enabled
    mic.wav + mic_meta.json  # only when Record Mic is enabled
```

- `run_summary.json` now includes `perception.adapter`, `perception.movement[]`, and `action_layer` sections so every run proves observation (not automation).
- `events.log` logs attaches/detaches, screenshot successes/failures, and focus transitions; nothing fails silently.
- Movement deltas are derived from SHA-256 hashes of captured frames to confirm window activity without saving raw comparisons.
- When recorders are enabled but emit no data, artifacts include `{ "status": "no_data", "reason": "..." }` blocks so operators aren’t left guessing.

## Stability & Guardrails

- Window-bound focus gating prevents background capture.
- No network calls run in the background; only local filesystem + OS APIs are used.
- Missing dependencies (psutil, mss, pynput, sounddevice) surface in the System Warnings label.
- Failure modes (window not found, device count zero, artifact write failure) log explicit warnings and bubble into `run_summary.json`.
- Action interface stays disarmed. Requests for automation must be logged manually.

## Frozen Backlog Rule

All new ideas that stretch beyond the five pillars live in [`/FROZEN_BACKLOG.md`](FROZEN_BACKLOG.md). Log them; do not implement them in v5 without an explicit unlock. The Action Layer panel links back to this rule so future-you never wonders where an experimental toggle originated.
# AI-E Control Panel v0.1

Operator-first companion application for BABYLON diagnostics and run orchestration. This project intentionally lives outside the Unity repository to keep responsibilities separated.

## Prerequisites

- Windows 10+
- Python 3.11+
- PowerShell 5.1+

## Setup

### One-command setup

```powershell
cd "E:\AI projects 2025\AI-E"
. .\build_scripts\setup_env.ps1
```

Dot-source the script (`. path\setup_env.ps1`) so the PowerShell session remains active inside the virtual environment after it finishes. The helper script creates `.venv` if needed, upgrades `pip`, installs the pinned requirements (PySide6, psutil, pyinstaller, etc.), and finally activates the venv for you. Pass `-SkipInstall` if you just want to reopen the environment without reinstalling packages.

### Manual setup

```powershell
cd "E:\AI projects 2025\AI-E"
Set-ExecutionPolicy -Scope Process Bypass
\.\.venv\Scripts\Activate.ps1
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

### Sanity install

Use this anytime you need to verify the environment is intact (after pulling or before opening an issue):

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m app.ui
```

## Running from Source

```powershell
.\.venv\Scripts\activate
.\.venv\Scripts\python.exe -m app.ui
```

The UI appears as **AI-E v1**. Use the Home screen to confirm a supported project, prepare a bounded request, review approval or sandbox guidance when needed, then follow status and open the saved result.

## Run Artifacts

Every run creates a timestamped folder under `runner_artifacts/` containing:

```
runner_artifacts/
  YYYYMMDD_HHMMSS_run_0001/
    run_meta.json
    events.log                # run_started, babylon_launched, attach_ok/failed, run_stopped, errors
    run_summary.json          # duration, attach status, artifact counts, warnings
    mapprobe_snapshot.json    # connection snapshot + heartbeat timestamps
    screenshot_start.png
    screenshot_end.png
    input_events.jsonl        # only when Record Input is enabled
    mic.wav + mic_meta.json   # only when Record Mic is enabled
```

- `run_meta.json` captures operator selections, timestamps, duration, PID, and environment diagnostics so every folder stands alone.
- `events.log` now always records start/stop plus launch/attach attempts and focus/elevation diagnostics; attach failures surface the exception text.
- `run_summary.json` aggregates duration, attach status, artifact health, focus time, and warnings (including why input or screenshots might be missing).
- `mapprobe_snapshot.json` includes connection + focus status with `data_status` fields (`no_data` + reason when BABYLON is unreachable).
- Input and mic artifacts are omitted entirely if their toggles remain off, keeping the folders clean.

Guaranteed outputs every run:

- `run_meta.json` is written when **Start Run** is pressed and updated on stop with diagnostics, so it never ships empty.
- `events.log` always logs start/stop, launches, attaches, screenshot outcomes, and warnings (even if no input or mic data exists).
- `run_summary.json` is emitted on **Stop Run** with explicit references to each screenshot (or the failure reason) plus the new input-focus statistics.

Input capture is now clamped to the BABYLON foreground window. When **Record Input (BABYLON focus only)** is enabled, any keyboard/mouse events detected while another window is active are suppressed, counted, and surfaced as warnings so “empty” runs are still explainable.

Screenshots rely on Windows desktop capture permissions; if a capture fails the folder now contains a `screenshot_*` reason entry plus an events.log warning. Mic recording is mic-only (no system audio) and can optionally be gated by holding the space bar when Push-to-Talk is enabled. When a recorder is enabled but produces no data, the artifacts include `{ "status": "no_data", "reason": "..." }` blocks so operators never see empty files.

## Building the Windows Executable

```powershell
cd "E:\AI projects 2025\AI-E"
.\.venv\Scripts\activate
./build_scripts/build_windows.ps1
```

The script installs pinned dependencies, runs PyInstaller with the updated settings, and produces `dist/AI-E.exe`. It also collects the required PySide6 binaries, writes a transcript to `build_artifacts\build_log.txt`, and returns a non-zero exit code if anything fails. Double-clicking the executable shows the same UI with no console window, and assets (icons, future resources) are bundled automatically.

First-launch UX: if the BABYLON path is empty, the UI prompts you to browse. Once selected, the exe path persists via the local runtime state file `app_state.local.json` so subsequent launches auto-fill it. The tracked `app_state.example.json` file is only a sanitized example and is not used for runtime writes. The Run Controls panel now keeps the operator-oriented signals front and center: Target EXE path, detected PID/state, a live duration timer, and the artifacts destination. The typical workflow is **Launch BABYLON** → **Attach** → **Start Run** → interact/gameplay → **Stop Run** → **Open Run Folder** / **Open Logs Folder** to inspect the collected screenshots, logs, and summaries.

## Local State Files

- `app_state.example.json` is the tracked, sanitized example for operator profile structure.
- `app_state.local.json` is created and maintained locally at runtime; the app reads and writes this file only.
- `project_registry/projects.example.json` is a tracked, sanitized example for optional multi-project registry data.
- `project_registry/projects.local.json` is reserved for local-only registry data and is ignored by git.

## Usage Expectations

- Operator must pick the BABYLON executable path manually.
- **Launch BABYLON** starts the executable via subprocess.
- **Attach** checks whether the BABYLON process is currently running (using `psutil`).
- **Record Input** writes `input_events.jsonl` with keyboard/mouse telemetry.
- **Record Mic** captures mic-only audio to `mic.wav` (with optional push-to-talk gating) plus `mic_meta.json`.
- **Open Last Run Folder** opens the most recent artifacts directory in Windows Explorer.
- No gameplay logic or Unity assets live in this repository; integration happens through operator-selected paths and generated artifacts only.

## Acceptance Test Checklist

Use **Help > Demo Checklist...** inside the app to run the current quick walkthrough:

1. **A.** Launch `AI-E.exe` (or run from source) and confirm the Home screen and guardrails are visible.
2. **B.** Confirm a supported project is selected, such as `BABYLON VER 2`.
3. **C.** Use a direct bounded prompt such as `make zombie more dangerous` and choose `Prepare Request`.
4. **D.** Run the supported request in sandbox.
5. **E.** Open `Result Summary` and point out the proof-backed outcome.
6. **F.** Use `Modify and test again` or `Try a variation` to show the next quick iteration.

The dialog resets each time you open it, so the same checklist can be reused before the next demo or local-user handoff.



