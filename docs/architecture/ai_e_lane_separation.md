# AI-E Lane Separation

## Purpose

AI-E now has at least two materially different interaction modes:

- a product-facing Unity issue analyzer with constrained user experience and bounded output contracts
- a developer-only raw API test lane used to verify direct model controllability

These must stay separate. The product surface exists to deliver a narrow, predictable user outcome. The dev lane exists to test model behavior directly. A future controllable execution layer should sit between them as an explicit orchestration boundary rather than as a hidden mode inside the product UI.

## Lane 1: Product-Facing Constrained App Behavior

### Purpose

- Deliver a narrow Unity issue analysis workflow.
- Keep the user experience stable, low-friction, and bounded.
- Enforce output contracts that are safe for rendering and follow-up logic.

### Tests That Belong Here

- request validation and route behavior
- formatter and result-shape validation
- safe fallback behavior when model access fails
- deployment verification for live app paths
- user-visible latency and error-handling checks

### Must Not Be Mixed In

- raw prompt console behavior
- arbitrary developer prompts
- hidden debug toggles that change model authority or tool access
- exploratory multi-step controllability experiments

### Safety And Cost Constraints

- every call path must be explicit and observable in logs
- no silent escalation from bounded product flow into expensive dev behaviors
- fallbacks must be deterministic enough to preserve product continuity
- model usage should remain tied to a known product action, not an open-ended session

## Lane 2: Raw Dev And Testing Lane

### Purpose

- Verify direct API behavior independently of the product UI.
- Test role separation, schema obedience, prompt sensitivity, and basic controllability.
- Keep debugging simple by reducing the stack to one prompt path and one response.

### Tests That Belong Here

- one-call smoke tests
- strict JSON schema obedience checks
- system-versus-user conflict tests
- minimal cost and failure-path verification
- direct SDK and credential validation

### Must Not Be Mixed In

- production UI routing
- end-user feature flags
- automatic retries, polling, or long-running agent behavior
- hidden attachment to product telemetry or persistent sessions

### Safety And Cost Constraints

- one call means one call
- no retries, loops, or background polling
- prompt and model choice must stay visible in the file
- credentials must come only from environment variables
- this lane should never be reachable from normal product UX

## Lane 3: Future Controllable Execution Layer

### Purpose

- Provide a formal middle layer between raw model access and product UX.
- Support bounded tool use, structured execution plans, policy checks, and explicit observability.
- Turn direct model output into controlled system behavior rather than free-form app behavior.

### Tests That Belong Here

- execution policy enforcement
- step budgeting and tool-call limits
- traceability of system, tool, and result boundaries
- deterministic fallback rules when execution cannot continue
- auditability for cost, safety, and operator review

### Must Not Be Mixed In

- raw unconstrained prompting presented as a user feature
- invisible tool execution under product-facing flows
- direct dev harness experiments promoted into runtime without policy gates
- silent crossovers between evaluation and production execution lanes

### Safety And Cost Constraints

- every execution step must have an explicit budget and boundary
- tool access must be policy-gated, typed, and reviewable
- logs must show when execution is reasoning-only versus tool-using
- cost ceilings must be enforced at the execution layer, not left to UI assumptions

## Non-Negotiable Separation Rules

- The product web app is not a raw prompt console.
- The dev harness is not a hidden product mode.
- Execution control should be introduced as a first-class layer, not as ad hoc prompt growth inside the app.
- Cost-bearing behaviors must be visible, bounded, and lane-specific.
- Test artifacts from the dev lane should not silently affect product prompts or UI behavior.

## Recommended Roadmap

1. Keep the current web app constrained to the Unity issue analyzer use case with explicit logging and bounded fallbacks.
2. Keep the local one-call harness as the only direct raw-model verification lane for now.
3. Add a small documented catalog of dev controllability tests so prompt and schema experiments stay reproducible.
4. Define a typed execution contract for the future controllable layer: budget, allowed tools, trace shape, stop conditions, and fallback behavior.
5. Introduce the controllable execution layer behind internal-only entry points before exposing any richer runtime behavior in product surfaces.
6. Only promote a capability from dev lane to product lane after it has explicit policy, cost, observability, and failure-mode definitions.

## Current Decision Guidance

- If the goal is user value in the web app, keep the behavior constrained.
- If the goal is prompt or model controllability testing, use the local dev harness.
- If the goal is safe tool-using intelligence, build it into the future execution layer rather than stretching either of the first two lanes.