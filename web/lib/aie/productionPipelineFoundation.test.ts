import assert from "node:assert/strict";
import test from "node:test";

import {
  buildUnityProductionPlanningPacket,
  deriveProductionPipelinePlan,
  PRODUCTION_PIPELINE_CAPABILITY_MAP,
} from "./productionPipelineFoundation";

test("production pipeline capability map covers all Layer 14 foundation domains", () => {
  assert.deepEqual(
    PRODUCTION_PIPELINE_CAPABILITY_MAP.map((capability) => capability.domain),
    ["assets", "art", "audio", "unity-integration"],
  );
});

test("production pipeline planning derives advisory-only plan for multi-domain requests", () => {
  const plan = deriveProductionPipelinePlan(
    "plan the Unity audio asset pipeline for ambience imports",
    "review",
  );

  assert.ok(plan);
  assert.deepEqual(plan?.domains, ["assets", "audio", "unity-integration"]);
  assert.equal(plan?.next_safe_stage, "review");
  assert.equal(plan?.mutation_policy, "planning_only");
  assert.match(plan?.summary ?? "", /advisory production-pipeline plan only/i);
  assert.equal(plan?.unity_planning_packet?.adapter_status, "design_only");
  assert.equal(plan?.unity_validation_execution_result, null);
});

test("non-production requests do not create a production pipeline plan", () => {
  const plan = deriveProductionPipelinePlan("summarize the latest blocked goal", "plan");
  assert.equal(plan, null);
});

test("Unity production planning packet builder classifies bounded Unity request types", () => {
  const packet = buildUnityProductionPlanningPacket(
    "review the scene prefab script validation plan for a Unity room import",
    "review",
    ["assets", "unity-integration"],
  );

  assert.ok(packet);
  assert.deepEqual(packet?.request_types, [
    "scene_request",
    "prefab_request",
    "component_script_request",
    "validation_playtest_request",
    "asset_import_request",
  ]);
  assert.equal(packet?.mutation_policy, "planning_only");
  assert.equal(packet?.adapter_status, "design_only");
  assert.match(packet?.execution_path ?? "", /Strategy -> Planning -> Execution -> Review -> Delivery -> Studio Control/);
});