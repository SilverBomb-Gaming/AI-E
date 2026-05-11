import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCampaignRuntimeSummary,
  checkpointCampaignRuntime,
  createCampaignRuntimeState,
  decideCampaignRuntimeContinuation,
  formatCampaignRuntimeTimestamp,
  formatElapsedCampaignRuntime,
  recordCampaignRuntimeRecovery,
  resumeCampaignRuntime,
} from "./longRunningCampaignRuntime";

const campaignStartTime = "2026-05-11T03:00:00.000Z";
const now = "2026-05-11T07:12:33.000Z";

function baseState() {
  return createCampaignRuntimeState({
    campaignStartTime,
    now,
    completedLayers: [
      "SAFE_EXECUTION_GUARDRAILS_PHASE1",
      "SUPERVISED_MULTI_STEP_EXECUTION_PHASE1",
      "PROJECT_STATE_INSPECTION_PHASE1",
    ],
    activeLayer: "LONG_RUNNING_CAMPAIGN_RUNTIME_PHASE1",
    queuedLayers: ["UNITY_WORKFLOW_AWARENESS_PHASE1"],
    blockedLayers: ["FULL_HANDS_OFF_STUDIO_OPERATION"],
    testPassHistory: [{ timestamp: now, passed: true, summary: "focused gate passed" }],
    buildHistory: [{ timestamp: now, passed: true, summary: "build passed" }],
  });
}

test("campaign runtime state tracks elapsed time completed layers and metrics", () => {
  const state = baseState();

  assert.equal(state.layerId, "LONG_RUNNING_CAMPAIGN_RUNTIME_PHASE1");
  assert.equal(state.elapsedRuntimeMs, 15_153_000);
  assert.equal(state.completedLayerCount, 3);
  assert.equal(state.activeLayer, "LONG_RUNNING_CAMPAIGN_RUNTIME_PHASE1");
  assert.equal(state.runtimeIteration, 1);
  assert.equal(state.metrics.totalRuntimeMs, 15_153_000);
  assert.equal(state.metrics.interruptionCount, 0);
  assert.equal(state.metrics.testPassHistory.length, 1);
});

test("runtime checkpoint labels in-memory durable and partial persistence scopes", () => {
  const state = baseState();
  const inMemory = checkpointCampaignRuntime(state, "2026-05-11T07:13:00.000Z", "in_memory_only");
  const durable = checkpointCampaignRuntime(state, "2026-05-11T07:13:01.000Z", "durable");
  const partial = checkpointCampaignRuntime(state, "2026-05-11T07:13:02.000Z", "partial_persistence");

  assert.equal(inMemory.persistenceLabel, "in-memory-only checkpoint metadata");
  assert.equal(durable.persistenceLabel, "durable checkpoint metadata");
  assert.equal(partial.persistenceLabel, "partial persistence checkpoint metadata");
  assert.equal(inMemory.continuationMetadata.continueExistingCampaign, true);
  assert.equal(inMemory.continuationMetadata.restartFromScratch, false);
});

test("campaign runtime resumes from checkpoint and increments iteration", () => {
  const checkpoint = checkpointCampaignRuntime(baseState(), "2026-05-11T07:13:00.000Z", "partial_persistence");
  const resumed = resumeCampaignRuntime(checkpoint, "2026-05-11T07:20:00.000Z");

  assert.equal(resumed.runtimeStatus, "resuming");
  assert.equal(resumed.runtimeIteration, 2);
  assert.equal(resumed.campaignStartTime, campaignStartTime);
  assert.deepEqual(resumed.previousLayerHistory, baseState().previousLayerHistory);
  assert.match(resumed.nextSuggestedAction, /do not restart campaign planning from scratch/);
});

test("runtime continuation prefers existing campaigns when stable", () => {
  const decision = decideCampaignRuntimeContinuation(baseState());

  assert.equal(decision.decision, "continue_existing_campaign");
  assert.equal(decision.runtimeStatus, "running");
  assert.match(decision.truthfulnessLabel, /no unattended execution claimed/);
});

test("runtime continuation checkpoints and stabilizes after failures", () => {
  const state = createCampaignRuntimeState({
    campaignStartTime,
    now,
    completedLayers: ["SAFE_EXECUTION_GUARDRAILS_PHASE1"],
    activeLayer: "LONG_RUNNING_CAMPAIGN_RUNTIME_PHASE1",
    queuedLayers: ["UNITY_WORKFLOW_AWARENESS_PHASE1"],
    blockedLayers: [],
    buildHistory: [{ timestamp: now, passed: false, summary: "build failed" }],
    failures: [{ timestamp: now, layerId: "LONG_RUNNING_CAMPAIGN_RUNTIME_PHASE1", recoverable: true, summary: "build failed" }],
  });
  const decision = decideCampaignRuntimeContinuation(state);

  assert.equal(decision.decision, "checkpoint_and_stabilize");
  assert.equal(decision.runtimeStatus, "stabilizing");
  assert.match(decision.nextSuggestedAction, /Checkpoint, summarize the failure/);
});

test("runtime continuation routes blocked active layers safely", () => {
  const state = createCampaignRuntimeState({
    campaignStartTime,
    now,
    completedLayers: [],
    activeLayer: "UNITY_WORKFLOW_AWARENESS_PHASE1",
    queuedLayers: [],
    blockedLayers: ["UNITY_WORKFLOW_AWARENESS_PHASE1"],
  });
  const decision = decideCampaignRuntimeContinuation(state);

  assert.equal(decision.decision, "blocked_waiting_for_dependency");
  assert.equal(decision.runtimeStatus, "blocked");
  assert.match(decision.truthfulnessLabel, /no execution performed/);
});

test("runtime recovery records recovery history before continuation", () => {
  const recovered = recordCampaignRuntimeRecovery(baseState(), {
    timestamp: "2026-05-11T07:15:00.000Z",
    layerId: "LONG_RUNNING_CAMPAIGN_RUNTIME_PHASE1",
    summary: "Recovered from stale checkpoint metadata.",
  });

  assert.equal(recovered.runtimeStatus, "recovering");
  assert.equal(recovered.lastRecovery?.summary, "Recovered from stale checkpoint metadata.");
  assert.match(recovered.nextSuggestedAction, /checkpoint and continue/);
});

test("timestamp and elapsed runtime formatting include seconds and timezone label", () => {
  assert.equal(formatCampaignRuntimeTimestamp("2026-05-11T03:42:18.000Z", "UTC"), "2026-05-11 03:42:18 UTC");
  assert.equal(formatElapsedCampaignRuntime(15_153_000), "04h 12m 33s");
});

test("runtime summaries include exact timestamp elapsed runtime and truthfulness label", () => {
  const summary = buildCampaignRuntimeSummary(baseState(), now, "UTC");

  assert.match(summary, /2026-05-11 07:12:33 UTC/);
  assert.match(summary, /Elapsed campaign runtime: 04h 12m 33s/);
  assert.match(summary, /not unattended execution or autonomous shell control/);
});

test("interruption count and failure frequency are tracked", () => {
  const state = createCampaignRuntimeState({
    campaignStartTime,
    now,
    completedLayers: [],
    activeLayer: "LONG_RUNNING_CAMPAIGN_RUNTIME_PHASE1",
    queuedLayers: [],
    blockedLayers: [],
    interruptionCount: 2,
    failures: [
      { timestamp: now, layerId: "LONG_RUNNING_CAMPAIGN_RUNTIME_PHASE1", recoverable: true, summary: "transient interruption" },
      { timestamp: now, layerId: "LONG_RUNNING_CAMPAIGN_RUNTIME_PHASE1", recoverable: true, summary: "retry needed" },
    ],
  });

  assert.equal(state.metrics.interruptionCount, 2);
  assert.equal(state.metrics.failureFrequency > 0, true);
  assert.equal(state.lastFailure?.summary, "retry needed");
});