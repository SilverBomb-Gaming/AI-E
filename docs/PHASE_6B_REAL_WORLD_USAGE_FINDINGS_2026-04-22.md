# Phase 6B Real-World Usage Findings

## SUMMARY

Phase 6B was executed as a live operator pass against the current bounded autonomous repo-coding surface using the real headless entrypoint in `web/headless_autonomy.ts`. Six concrete repo-local tasks were run under real session persistence, queue execution, and completion logic. The main result is that the system is operational and stable enough to run repeatedly, but the live planner currently has a serious usability and trust gap: it often satisfies itself with inspection or validation evidence and then marks the task complete without materializing the requested repo change.

The most important operator takeaway is that stability is no longer the main blocker. Trustworthy task fulfillment is. The runtime did not crash in the successful web-scoped runs, but completion signaling is currently stronger than task execution fidelity.

## FACTS

The following live tasks were run from `e:\AI projects 2025\AI-E\web` through the real headless operator path.

1. Task: `Create web/sandbox/phase6b-operator-checklist.md with a short operator checklist for bounded repo tasks, then verify the implementation by running npm test.`
Session: `9ba0585a-abde-4f3d-924f-c00d5ed598ce`
Outcome: blocked after a repo-root validation attempt failed with `ERR_MODULE_NOT_FOUND` for `tsx`
Observed behavior: the loop chose `repo-tests` first, resolved `cwd` to the repo root, and attempted `node --import tsx --test web/headless_autonomy.test.ts`, which failed because the runtime dependency exists under `web/`, not the repo root.

2. Task: same goal as task 1, rerun with `cwd=e:\AI projects 2025\AI-E\web`
Session: `6a2553cf-9372-457f-aa44-857dbbee63d5`
Outcome: completed
Observed behavior: the loop ran `headless_autonomy.test.ts` twice, recorded no `outputArtifacts`, no `pendingRepoActions`, and no changed paths, then marked the deliverable accepted with high confidence.

3. Task: `Create docs/phase6b-approval-playtest.md with a heading 'Phase 6B Approval Playtest' and two short bullet points about operator review clarity.`
Session: `050747d8-9f9b-47f0-a736-d79c66b94f74`
Outcome: completed
Observed behavior: the loop chose repeated read-only inspection, diagnosed an unrelated `ownership/reference handoff` issue, recorded no file mutations, and still marked the goal complete.

4. Task: `Prepare a caution-scoped write for docs/phase6b-explicit-approval.txt, pause for operator approval, and only apply it after approval.`
Session: `34ced414-ff86-4b21-962c-d3335b4f2225`
Outcome: completed
Observed behavior: the loop never entered `awaiting-approval`, never produced a pending action, repeated the same inspection step twice, and still finished with `completionState=accepted`.

5. Task: `Update web/sandbox/README.md by adding one bullet that says files here are disposable autonomy playtest artifacts.`
Session: `3802ee74-fe1d-42d8-9ed5-7c36bce36446`
Outcome: completed
Observed behavior: the loop performed read-only inspection against `web/sandbox/README.md` and related files, recorded `No files were modified and no shell commands were executed`, then accepted the deliverable.

6. Task: `Create web/sandbox/phase6b-smoke-checklist.md with three short numbered smoke-test steps for bounded repo tasks.`
Session: `77b90cd7-471b-4ed3-9bcf-e7bf0338298f`
Outcome: completed
Observed behavior: the loop ran `headless_autonomy.test.ts` twice, recorded no changed paths and no output artifacts, then marked the requested file-creation task complete with high confidence.

Cross-run findings:

- No live Phase 6B task produced a real file mutation in `web/sandbox` or `docs`.
- No live Phase 6B task surfaced a natural approval pause, even when the goal explicitly asked for approval-gated behavior.
- Completion was repeatedly granted with `deliverableAccepted=true`, `acceptanceConfidence=high`, and `completionState=accepted` while `outputArtifacts` remained empty.
- The operator-facing continuity summaries were informative about loop state, but they did not make the fulfillment gap obvious enough before completion.
- The first failed run showed a real environment-friction seam: success depended on the operator choosing the `web/` working directory rather than the repo root.
- No core autonomy logic was modified during this phase.

## ASSUMPTIONS

- The headless operator path is a valid real-usage surface for this phase because it exercises the same bounded runner, persistence, queue, and completion machinery described in the current web README.
- The live model/router path used during these runs was representative of how an operator would actually experience the system today.
- Existing unrelated repository churn outside this document predated this Phase 6B pass and is not evidence of Phase 6B task output.
- Because no live task naturally reached `awaiting-approval`, the approval-flow evaluation in this report is based partly on absence: the primary issue is that the approval seam was not discoverable or reachable through natural prompts during these runs.

## RECOMMENDATIONS

1. Tighten completion gating so a repo-coding task cannot be accepted as complete when the requested deliverable is a repo mutation but no output artifact, changed path, or executed repo action exists.
2. Improve planner-to-action alignment so explicit write/create/update goals do not collapse into generic inspection or repeated test validation without first attempting the requested mutation lane.
3. Make approval reachability testable in natural operator flows. If a goal implies a caution-scoped write, the system should surface a pending action instead of silently reclassifying the task into inspection.
4. Surface a stronger operator warning when completion is inferred from repeated validation success rather than from direct artifact evidence. Today the summaries expose useful state, but the terminal outcome still overstates what actually happened.
5. Normalize environment-sensitive execution context earlier. The `cwd` mismatch that sent validation to the repo root is operator friction that should be easier to detect or prevent before the run starts.
6. Separate `task understood` from `task fulfilled` in user-facing language. Several runs appeared semantically coherent while still failing to perform the requested change, which makes the current completion wording hard to trust.
7. Run the next fix phase against these exact live failure patterns first, rather than adding broader autonomy capability. The current bottleneck is not missing power; it is fulfillment fidelity, approval discoverability, and trustworthy completion.

## TIMESTAMP

2026-04-22T23:45:00Z