# AI-E Portability Checkpoint

## What Portability Means Now

AI-E is now a portable bounded tuning framework rather than a single-domain FPS/survival tuning system.

Portability in the current milestone means:

- bounded capabilities are represented through one generic capability schema
- direct prompts still resolve through explicit bounded contracts
- experiment tracking, decision tracking, navigation, and cross-experiment comparison operate across multiple gameplay domains
- deterministic evaluation works across domains without recommendation logic

## Domains That Prove Portability

- zombie: speed, aggression
- runner: speed, aggression
- encounter: spawn count, spawn pressure
- racer: acceleration, max speed
- platformer: jump height, gravity, speed

These domains span enemy tuning, encounter tuning, racing, and platformer movement/physics.

## What Is Locked In At This Checkpoint

- generic capability schema fields and bounded deterministic values
- additive backward-compatible runtime integration
- cross-domain experiment review, decision flow, navigation, and comparison
- no autonomous inference, ranking, or recommendation behavior

## What Remains Before Broader Production Scaling

- longer-running supervisor validation in a more reliable execution environment
- broader project-specific content contracts for Super Monkee
- future bounded layout and procedural-readiness families before any procedural generation work

## Next Ordered Expansion

The next bounded expansion layer is Super Monkee platformer content/system tuning, starting from the existing platformer movement and physics capabilities and extending later into bounded layout families.