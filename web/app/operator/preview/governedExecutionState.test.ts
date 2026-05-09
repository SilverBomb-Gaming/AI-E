import assert from "node:assert/strict";
import test from "node:test";

import {
  INITIAL_GOVERNED_EXECUTION_STATE,
  advanceGovernedExecutionPhase,
  buildGovernedExecutionTimeline,
  completeGovernedExecution,
  completeGovernedRollback,
  extractGifArtifactPath,
  failGovernedExecution,
  isGovernedExecutionLocked,
  startGovernedExecution,
} from "./governedExecutionState";

test("accepted does not equal success", () => {
  const result = startGovernedExecution(INITIAL_GOVERNED_EXECUTION_STATE, {
    action: "preview",
    requestId: "preview-001",
    startedAt: 100,
    manualApprovalGranted: true,
    gifPackagingRequested: true,
  });

  assert.equal(result.started, true);
  assert.equal(result.state.currentPhase, "REQUEST_ACCEPTED");
  assert.equal(result.state.renderCompleted, false);
  assert.equal(result.state.exportedArtifactPaths.length, 0);
  assert.equal(isGovernedExecutionLocked(result.state), true);
});

test("execution states transition through active preview phases", () => {
  const started = startGovernedExecution(INITIAL_GOVERNED_EXECUTION_STATE, {
    action: "preview",
    requestId: "preview-002",
    startedAt: 100,
    manualApprovalGranted: true,
    gifPackagingRequested: true,
  }).state;
  const validating = advanceGovernedExecutionPhase(started, "VALIDATING");
  const rendering = advanceGovernedExecutionPhase(validating, "PREVIEW_RENDER_RUNNING");
  const gifPackaging = advanceGovernedExecutionPhase(rendering, "GIF_PACKAGING");
  const exporting = advanceGovernedExecutionPhase(gifPackaging, "EXPORTING_OUTPUTS");
  const complete = completeGovernedExecution(exporting, {
    finishedAt: 500,
    status: "complete",
    sandboxPath: ".aie/governed_preview_sandbox/run_001/",
    exportedArtifactPaths: [
      ".aie/governed_preview_sandbox/run_001/preview_frame_001.png",
      ".aie/governed_preview_sandbox/run_001/governed_preview.gif",
    ],
    diagnosticsGenerated: true,
    gifPackagingRequested: true,
  });

  assert.equal(complete.currentPhase, "RENDER_COMPLETE");
  assert.equal(complete.renderInProgress, false);
  assert.equal(complete.renderCompleted, true);
  assert.equal(complete.gifArtifactPath, ".aie/governed_preview_sandbox/run_001/governed_preview.gif");
  assert.deepEqual(complete.phaseHistory, [
    "REQUEST_ACCEPTED",
    "VALIDATING",
    "PREVIEW_RENDER_RUNNING",
    "GIF_PACKAGING",
    "EXPORTING_OUTPUTS",
    "RENDER_COMPLETE",
  ]);
});

test("duplicate clicks are blocked while execution is active", () => {
  const started = startGovernedExecution(INITIAL_GOVERNED_EXECUTION_STATE, {
    action: "micro-sequence",
    requestId: "micro-001",
    startedAt: 100,
    manualApprovalGranted: true,
  }).state;
  const duplicate = startGovernedExecution(started, {
    action: "preview",
    requestId: "preview-duplicate",
    startedAt: 101,
    manualApprovalGranted: true,
  });

  assert.equal(duplicate.started, false);
  assert.equal(duplicate.state.activeRequestId, "micro-001");
  assert.equal(duplicate.state.duplicateClickBlocked, true);
  assert.match(duplicate.reason, /already in progress/i);
});

test("buttons should unlock only after completion failure or rejection", () => {
  const started = startGovernedExecution(INITIAL_GOVERNED_EXECUTION_STATE, {
    action: "micro-sequence",
    requestId: "micro-002",
    startedAt: 100,
    manualApprovalGranted: true,
  }).state;

  assert.equal(isGovernedExecutionLocked(started), true);

  const complete = completeGovernedExecution(started, {
    finishedAt: 200,
    status: "complete",
    exportedArtifactPaths: [".aie/governed_preview_sandbox/micro_sequence/frame_001.png"],
    diagnosticsGenerated: true,
  });
  assert.equal(isGovernedExecutionLocked(complete), false);

  const failedStart = startGovernedExecution(INITIAL_GOVERNED_EXECUTION_STATE, {
    action: "preview",
    requestId: "preview-failed",
    startedAt: 300,
    manualApprovalGranted: true,
  }).state;
  const failed = failGovernedExecution(failedStart, { finishedAt: 400, failureReason: "renderer crash" });
  assert.equal(isGovernedExecutionLocked(failed), false);
  assert.equal(failed.renderFailed, true);
});

test("governance rejection stays explicit", () => {
  const waiting = startGovernedExecution(INITIAL_GOVERNED_EXECUTION_STATE, {
    action: "preview",
    requestId: "preview-no-approval",
    startedAt: 100,
    manualApprovalGranted: false,
  }).state;
  const rejected = completeGovernedExecution(waiting, {
    finishedAt: 150,
    status: "rejected",
    failureReason: "Blocked pending manual approval.",
  });

  assert.equal(waiting.currentPhase, "WAITING_FOR_APPROVAL");
  assert.equal(rejected.currentPhase, "RENDER_REJECTED");
  assert.equal(rejected.renderRejected, true);
  assert.match(rejected.failureReason ?? "", /manual approval/i);
});

test("export states and GIF packaging remain visible", () => {
  assert.equal(extractGifArtifactPath(["preview_frame_001.png", "governed_preview.gif"]), "governed_preview.gif");

  const started = startGovernedExecution(INITIAL_GOVERNED_EXECUTION_STATE, {
    action: "preview",
    requestId: "preview-export",
    startedAt: 100,
    manualApprovalGranted: true,
    gifPackagingRequested: true,
  }).state;
  const packaging = advanceGovernedExecutionPhase(started, "GIF_PACKAGING");
  const exporting = advanceGovernedExecutionPhase(packaging, "EXPORTING_OUTPUTS");
  const complete = completeGovernedExecution(exporting, {
    finishedAt: 300,
    status: "complete",
    exportedArtifactPaths: ["preview_frame_001.png", "governed_preview.gif", "manifest.json"],
    diagnosticsGenerated: true,
    gifPackagingRequested: true,
  });

  assert.equal(packaging.gifPackagingInProgress, true);
  assert.equal(exporting.exportInProgress, true);
  assert.equal(complete.exportedArtifactPaths.length, 3);
  assert.equal(complete.diagnosticsGenerated, true);
});

test("timeline updates and final verdict is not auto-passed", () => {
  const complete = completeGovernedExecution(
    advanceGovernedExecutionPhase(
      advanceGovernedExecutionPhase(
        startGovernedExecution(INITIAL_GOVERNED_EXECUTION_STATE, {
          action: "preview",
          requestId: "preview-timeline",
          startedAt: 100,
          manualApprovalGranted: true,
          gifPackagingRequested: true,
        }).state,
        "PREVIEW_RENDER_RUNNING",
      ),
      "EXPORTING_OUTPUTS",
    ),
    {
      finishedAt: 400,
      status: "complete",
      exportedArtifactPaths: ["preview_frame_001.png", "governed_preview.gif"],
      diagnosticsGenerated: true,
    },
  );

  const timeline = buildGovernedExecutionTimeline(complete, {
    outputReviewed: false,
    diagnosticsReviewed: false,
    truthChecksPassed: false,
    finalVerdictReady: false,
  });

  assert.equal(timeline.find((item) => item.id === "export-complete")?.status, "complete");
  assert.equal(timeline.find((item) => item.id === "visual-review")?.status, "active");
  assert.equal(timeline.find((item) => item.id === "final-verdict")?.status, "waiting");
});

test("rollback state is explicit", () => {
  const started = startGovernedExecution(INITIAL_GOVERNED_EXECUTION_STATE, {
    action: "rollback",
    requestId: "rollback-001",
    startedAt: 100,
    manualApprovalGranted: true,
  }).state;
  const restoring = advanceGovernedExecutionPhase(started, "ROLLBACK_RESTORING");
  const complete = completeGovernedRollback(restoring, {
    finishedAt: 200,
    deletedOutputTargets: [".aie/governed_preview_sandbox/run_001/preview_frame_001.png"],
    sandboxPath: ".aie/governed_preview_sandbox/run_001/",
  });

  assert.equal(restoring.rollbackInProgress, true);
  assert.equal(complete.renderCompleted, true);
  assert.match(complete.statusMessage, /Rollback complete/i);
});

test("anime character execution uses character render phases", () => {
  const started = startGovernedExecution(INITIAL_GOVERNED_EXECUTION_STATE, {
    action: "anime-character-render",
    requestId: "operator-anime-character-render-001",
    startedAt: 100,
    manualApprovalGranted: true,
    gifPackagingRequested: true,
  }).state;
  const validating = advanceGovernedExecutionPhase(started, "CHARACTER_RENDER_VALIDATING");
  const rendering = advanceGovernedExecutionPhase(validating, "CHARACTER_RENDER_RUNNING");
  const packaging = advanceGovernedExecutionPhase(rendering, "CHARACTER_GIF_PACKAGING");
  const exporting = advanceGovernedExecutionPhase(packaging, "CHARACTER_EXPORTING_OUTPUTS");
  const complete = completeGovernedExecution(exporting, {
    finishedAt: 500,
    status: "complete",
    sandboxPath: ".aie/governed_anime_character_preview_sandbox/character-001",
    exportedArtifactPaths: [
      ".aie/governed_anime_character_preview_sandbox/character-001/anime_character_frame_001.png",
      ".aie/governed_anime_character_preview_sandbox/character-001/anime_character_preview.gif",
      ".aie/governed_anime_character_preview_sandbox/character-001/anime_character_manifest.json",
    ],
    diagnosticsGenerated: true,
    gifPackagingRequested: true,
  });

  assert.equal(started.currentPhase, "CHARACTER_REQUEST_ACCEPTED");
  assert.equal(packaging.gifPackagingInProgress, true);
  assert.equal(exporting.exportInProgress, true);
  assert.equal(complete.currentPhase, "CHARACTER_RENDER_COMPLETE");
  assert.equal(complete.gifArtifactPath, ".aie/governed_anime_character_preview_sandbox/character-001/anime_character_preview.gif");
  assert.match(complete.statusMessage, /Anime character export complete/i);
  assert.deepEqual(complete.phaseHistory, [
    "CHARACTER_REQUEST_ACCEPTED",
    "CHARACTER_RENDER_VALIDATING",
    "CHARACTER_RENDER_RUNNING",
    "CHARACTER_GIF_PACKAGING",
    "CHARACTER_EXPORTING_OUTPUTS",
    "CHARACTER_RENDER_COMPLETE",
  ]);
});
