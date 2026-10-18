# SilverBomb Video Autopilot — AI-E Integration Plan

Status: **planning / recovery audit**. This document does not claim video generation, local autonomy, or rendering is operational.

## Product identity and scope

**SilverBomb Video Autopilot** is a production capability within the **existing AI-E repository/ecosystem**, not a new GitHub repository.

Production categories:
- **Movies:** shorts and eventual feature-length films; screenplay, shot lists, scenes, editing, delivery.
- **TV Shows:** episodes/seasons, persistent cast, locations, continuity, recaps, production scheduling.
- **Music Videos:** beat/lyric/timeline-aware shot planning, music synchronization, final video; optionally accept exports from SilverBomb Music Autopilot.

Shared pipeline: brief -> screenplay/treatment -> asset bible -> shot/scene plan -> provider selection -> bounded generation jobs -> continuity QA -> editorial timeline -> audio -> render/export -> review.

## Findings from the initial read-only audit

- AI-E's root README describes a public, **planning-only** Constraint Router. Its demo never executes Unity work. Do not interpret this as a functioning autonomous video agent.
- AI-E's `docs/operator-console-status.md` describes an older local Windows OpenClaw operator with permission-gated file/command execution. This is historical documentation; local availability, health, and compatibility must be verified on the user's machine before use.
- Existing `SilverBomb-Gaming/ai-e-video-providers` has `providers/base.py`, `providers/registry.py`, Seedance adapter/client, and ComfyUI node. The Seedance adapter has a fake API endpoint and simulated completion/download; the client is placeholder-only. **No working provider has been verified.**
- Existing provider repository may remain as a legacy dependency/source during migration. Do not create any new repository. Do not delete, archive, or overwrite existing repositories.

## Safety and concurrency contract

Grok agents are actively working on the user's Windows PC. **Do not start or reconfigure local processes**, change display settings, move/resize windows, touch Ableton, consume GPU VRAM, kill tasks, or modify active worktrees without checking ownership and obtaining an isolated workspace.

- Work only in an isolated AI-E feature branch/worktree; no direct writes to main or production.
- Preserve all existing project data and backups. No destructive git cleanup.
- Before local work: inspect running agent jobs, GPU/VRAM availability, disk headroom, ports, and repository/worktree ownership; defer work if contention exists.
- Use explicit allowlisted project paths, resource budgets, timeouts, cancellation, audit logs, and checkpoint/resume.
- Treat external models/providers as untrusted; secrets from environment/secure configuration only. No hardcoded tokens.
- Public AI-E demo remains planning-only; Movie Mode execution must be a separately gated capability, never a global bypass.
- No paid API calls or publishing without explicit budget/authorization.
- Do not promise an agent continues operating when no installed scheduler/runner has been verified.

## Proposed internal modules (subject to compatibility audit)

```text
movie_mode/
  core/             # project manifest, schemas, deterministic state transitions
  story/            # screenplay, scene, cast, location and continuity bibles
  planning/         # shot list, timing, storyboard metadata, production plans
  providers/        # validated local/remote provider adapters
  production/       # bounded generation jobs, provenance, retries
  editorial/        # timeline, transitions, audio sync, export
  qa/               # technical validation and human-review checkpoints
  agent/            # durable task queue, locks, leases, recovery
```

These directories are **proposed**, not yet implemented.

## Milestones and acceptance criteria

### M0 — Recovery and compatibility audit
- Inventory AI-E, existing video provider, operator, tests, branches, and documented interfaces.
- Confirm no overlap with Grok-owned tasks or working directories.
- Record hardware/software prerequisites and whether a local agent is actually installed and working.
- Deliver a gap matrix with evidence, not assumed capabilities.

### M1 — Real provider proof
- Choose one verified local backend that can run on the user's RTX 3090 within an agreed resource budget.
- Produce a reproducible short video with actual output file, metadata, and validation; no placeholder jobs or fake success.
- Support cancel/retry, clear failure reporting, and clean separation from optional paid providers.
- Tests mock external dependencies, but the acceptance demo must include a real generation.

### M2 — Structured film-production pipeline
- Versioned production manifest, project/scene/shot IDs, character/location bibles, assets and provenance.
- Reproducible job plans, bounded queues, checkpoint/resume, human review gates.
- Tests for missing inputs, failed shots, continuity metadata, interrupted runs.

### M3 — Category-specific workflows
- Movies: shot-based short film with beginning/middle/end.
- TV Shows: two scenes or episodes reusing persistent character/location specifications.
- Music Videos: timeline synchronization with an imported music track, optionally from Music Autopilot.

### M4 — Cinematic pilot and evaluation
- Produce a 2–5 minute scene with dialogue, continuity, edit, audio, and explicit review criteria.
- Document time, cost, GPU usage, failure rate, and visual consistency.
- Scale toward longer productions only after measurable pilot success.

## Immediate next engineering task

Perform a **read-only compatibility audit** of the existing AI-E orchestration interfaces and video-provider repository, then propose the smallest testable integration patch. Avoid simultaneous edits by Grok. No credits purchase is required for this audit; local video inference capability and quality remain unverified.
