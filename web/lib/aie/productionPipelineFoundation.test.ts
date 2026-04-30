import assert from "node:assert/strict";
import test from "node:test";

import {
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
});

test("non-production requests do not create a production pipeline plan", () => {
  const plan = deriveProductionPipelinePlan("summarize the latest blocked goal", "plan");
  assert.equal(plan, null);
});