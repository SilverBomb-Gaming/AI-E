# BABYLON 2026 Case Study

## Stable State
- Deterministic 1 -> 2 -> 3 wave combat loop passes.
- KBM, gamepad, pause/menu, firing, health/death, pursuit, steering, and crowd separation all hold.
- Phase 10 pacing and recovery polish improved readability without breaking ownership.

## Positive Patterns
- Keep each owner local and narrow.
- Use focused validation after each bounded edit.
- Preserve known-good commits at the end of each stable slice.

## Anti-Patterns From Older BABYLON Work
- Avoid hidden repair loops and emergency bootstrap chains.
- Avoid mixing weapon, wave, spawn, and health state into one script.
- Avoid random recovery behavior that masks structural ownership errors.

## Current Safe Next Step
- Resume AI-E core evolution by persisting memory, outcomes, and fallback strategy before adding new autonomous production behavior.