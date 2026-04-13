## AI-E Bounded Environment Theme Composition

This milestone extends the proven Babylon Ground theme family from single reviewed actions into a very small allowlisted multi-intent composition layer.

### Scope

- Target object: `Ground`
- Target scene: `Babylon FPS game ver 002`
- Execution model: reviewed sequential composition over the existing deterministic ground-theme mutation lane
- Final live baseline after proof: `Assets/Resources/Materials/Cement.mat`

### Supported reviewed single-theme actions

- `make the ground grassy`
- `change the ground to dirt`
- `change the ground to gravel`
- `make the ground look damaged`

### Supported reviewed compound prompts

- `make the ground gravel and damaged`
- `apply a dirt and damaged ground theme`
- `make the ground grassy and damaged`
- `apply a damaged gravel ground theme`

### Composition model

AI-E does not blend materials or generate freeform terrain art in this pass. Each supported compound prompt resolves to a reviewed two-step plan built from the already-proven Ground theme family:

1. apply the base ground theme
2. apply the damaged-ground theme

### Guarantees

- explicit prepare and review before execution
- operator approval required
- fixed reviewed step list
- deterministic Ground-only mutation path
- fail-closed handling for broad terrain-art requests
- proof/result output tied to the approved combined scope

### Guardrails

Blocked examples remain intentionally unsupported:

- `make the terrain realistic with damaged gravel, dirt paths, flowers, fog, and battle debris`
- `blend grass, gravel, dirt, smoke, and crater effects across the battlefield`
- `turn the map into a realistic ruined battlefield`

### Live proof

The reviewed compound prompt `make the ground gravel and damaged` was executed end-to-end against the live Babylon repo through the existing approval-gated environment-theme lane.

Observed Ground material transitions:

- baseline verify: `Cement -> Cement` (`skipped_already_satisfied`)
- step 1: `Cement -> GravelGround`
- step 2: `GravelGround -> DamagedGround`
- cleanup restore: `DamagedGround -> Cement`

No Babylon execution-lane expansion was required for this milestone. The existing deterministic route already supported the bounded sequential composition model.
