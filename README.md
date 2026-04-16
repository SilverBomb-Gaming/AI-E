# AI-E v1

Controlled execution surface for supported projects. AI-E turns a bounded request into a real, reviewable result with guardrails, live status, proof summaries, and saved history.

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
- Status rule: `Resolved` requires a confirmed follow-up plus a strong confirmation signal that the issue is clearly fixed or gone
- Status rule: `Converging` covers partial improvement, clearer narrowing, or a meaningful next lever before the bounded loop is exhausted
- Status rule: `Stuck` covers repeated unresolved outcomes with no partial-improvement signal, and step-3 exhaustion now wins over structural-looking progression so an unresolved capped loop surfaces as stuck instead of optimistic
- UI effect: refined results now show `Current status` alongside the existing refined diagnosis messaging so the user can tell whether the loop appears solved, still narrowing, or no longer moving
- Targeted validation status: the requested live 6-case matrix passed in full against `/api/analyze` with `2 resolved`, `2 converging`, and `2 stuck` chains matching expected status labels
- Regression check: the same validation run reported `MISMATCHES: None` and `PASSIVE: None`, so the status layer did not interfere with existing guided-step generation or reintroduce passive phrasing
- Remaining edge case: structural variation alone is not treated as progress anymore at the step-3 boundary, so intentionally bounded-loop exhaustion is now the deciding signal when the chain is still unresolved

#### Stuck Loop Escalation Strategies (2026-04-16)

- What changed: when the renderer classifies a refined debugging chain as `Stuck`, it now shows a small `Suggested escalation` block instead of continuing to surface another normal focused step
- Escalation boundary: this only appears for `Stuck` chains and stays renderer-only, with no backend, schema, API, or persistence changes
- Strategy rule: the escalation must shift to a higher-level recovery move rather than suggest a minor variation of the same step pattern
- Available strategies: `Isolate to minimal reproduction`, `Switch to logging/debug instrumentation`, `Disable all but one system and rebuild`, and `Test in a clean scene or environment`
- Selection rule: the renderer chooses among those strategies from the current stuck context, prior guided steps, and broad problem signals so scene/bootstrap-style failures bias toward clean-environment checks while mixed-system churn biases toward single-system rebuild isolation
- UI effect: `Next focused step` is suppressed for stuck chains so the user sees the escalation strategy as the next move instead of another bounded-loop micro-step
- Targeted validation status: two known stuck chains were re-run against the live analyzer and both kept `Current status = Stuck` while the escalation output remained actionable and materially different from the prior guided steps
- Regression check: the stuck validation did not change the existing loop classifier or step-generation path for non-stuck chains, and both checked escalations passed the difference check against the latest guided step

#### Lightweight Session Threading For Debugging Continuation (2026-04-16)

- What changed: the analyze form can now opt into a lightweight session thread that passes the last stored diagnosis, most recent attempted step, and latest `Resolved` / `Converging` / `Stuck` status into the next analysis request as structured client-side context
- Threading boundary: this remains stateless at the backend level, uses only the existing browser session storage entry, and does not add persistent storage, agents, background loops, or a redesigned API contract
- Continuation rule: the new turn still requires fresh user input, but when session threading is enabled the next `/api/analyze` request includes a compact continuation block in `context` so the model starts from the previous debugging position instead of a fresh generic first pass
- UI effect: the analyze page now shows a `Session threading` card when a prior result exists, lets the user toggle continuation on or off, and the result page adds a direct `Continue this debugging flow` path back into the analyze form
- Stored thread state: refined result updates now persist the last attempted step plus the latest loop-status label alongside the existing result payload so the next turn has concrete continuity anchors
- Targeted validation status: two sparse multi-turn scenarios were re-run against the live analyzer with threaded context, and both continuation turns retained the prior debugging frame instead of dropping back to a generic cold-start diagnosis
- Regression check: the existing bounded follow-up loop remains renderer-driven, and the threading change only affects new analyze submissions plus client-side session payload shaping

#### Second-Step Progression And Non-Repetition Guard (2026-04-15)

- What changed: the renderer now applies a small coherence guard before showing the second debugging step, rejecting candidates that reuse the same action pattern, stay on the same lever without narrowing, or overlap too heavily with the first step
- Progression rule: the second step must either move to a different lever, narrow to a subcomponent within the same system, or change method (`disable -> isolate`, `disable -> replace`, `disable -> force`) instead of restating the same test in different words
- Fallback behavior: when the first candidate fails those checks, the renderer regenerates from alternate focus sources in priority order (`diagnosis`, `observation`, then remaining local anchors) while keeping the step reversible, observable, and action-oriented
- Targeted validation status: the 4-case live subset held classification steady (`2 falsified`, `2 inconclusive`), all second steps differed meaningfully from the displayed first step, phrase overlap stayed low, and no passive `inspect/check/log` phrasing appeared
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



