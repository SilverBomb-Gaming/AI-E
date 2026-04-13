# AI-E Bounded Experimentation Milestone

## Milestone Title

AI-E Bounded Experimentation

## Suggested Version

AI-E v1.5-bounded-experimentation

## Branch Name

`codex/home-screen-v1`

## Latest Commit Id

`6e45197ce22ba1ef90487e3f10b1551d442bc0c8`

## Architectural Layers Added

- Intent normalization for bounded deterministic prompts
- Explicit entity mapping for supported zombie-only execution
- Goal-intent mapping for bounded gameplay-goal resolution
- Multi-goal composition for approved speed and aggression combinations
- Predefined bounded plans for aggression, safety, combat variation, and movement variation
- State-aware capability guards with skip-as-success behavior
- Session-aware tuning history, revert, and bounded follow-up resolution
- Deterministic outcome evaluation with rule-based comparison and suggestions
- Current-session experiment tracking with variant lineage
- Current-session experiment decision tracking with preferred-baseline support
- Result-surface metadata and review-only experiment summaries

## Supported User Flows

- Direct deterministic mutation prompts such as `make zombie faster` and `make zombie more aggressive`
- Generalized supported prompts such as `make enemy more dangerous` through confirmation into zombie-only bounded execution
- Predefined multi-step plans such as `test combat variation`
- Goal-intent prompts such as `make zombie more intense`
- Multi-goal prompts such as `make zombie faster but less aggressive`
- Session follow-ups such as `make it slower`, `revert last change`, and `try another version`
- Review-only prompts such as `show current experiment variants` and `show current experiment decisions`
- Explicit experiment decisions such as `keep current variant`, `reject current variant`, and `set current variant as baseline`

## Guarantees

- Execution stays bounded to supported zombie-system capabilities in BABYLON
- Unsupported or ambiguous prompts fail closed with explicit guidance
- Generalized supported prompts require confirmation before execution
- Multi-step execution remains deterministic and dependency-ordered
- State-aware guards can skip already-satisfied mutations without treating them as failures
- Evaluation, experiment tracking, and decision tracking are rule-based and current-session only
- No autonomous planning, ranking, or long-term learning is introduced by this milestone

## Constraints

- Zombie-only support in the bounded BABYLON environment
- No arbitrary numeric tuning from natural language
- No open-ended agent orchestration
- No cross-experiment or cross-session inference
- No subjective scoring or automatic best-variant selection
- No planner or supervisor redesign beyond bounded extension points
