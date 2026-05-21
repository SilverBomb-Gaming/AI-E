import assert from "node:assert/strict";
import test from "node:test";

import {
  generateGovernedOperationProposal,
  getCategoryLabel,
  getRuntimeLabel,
} from "./governedTaskIntake";

const FIXED_NOW = "2026-05-21T00:00:00.000Z";
const now = () => FIXED_NOW;

test("generateGovernedOperationProposal returns a proposal with all safety invariants", () => {
  const p = generateGovernedOperationProposal("Fix enemy patrol AI", { now });
  assert.equal(p.executionAllowed, false);
  assert.equal(p.dryRun, true);
  assert.equal(p.sandboxRequired, true);
  assert.equal(p.snapshotRequired, true);
  assert.equal(p.approvalRequired, true);
  assert.equal(p.laneState, "approval_pending");
  assert.equal(p.proposedAt, FIXED_NOW);
});

test("generateGovernedOperationProposal routes gameplay keywords to openclaw runtime", () => {
  const p = generateGovernedOperationProposal("Fix enemy patrol AI behavior", { now });
  assert.equal(p.runtime, "openclaw");
  assert.equal(p.category, "gameplay_fix");
});

test("generateGovernedOperationProposal routes test keywords to codex runtime", () => {
  const p = generateGovernedOperationProposal("Review test coverage for dashboard", { now });
  assert.equal(p.runtime, "codex");
});

test("generateGovernedOperationProposal routes refactor keywords to claude_code runtime", () => {
  const p = generateGovernedOperationProposal("Refactor the API layer types", { now });
  assert.equal(p.runtime, "claude_code");
  assert.equal(p.category, "code_refactor");
});

test("generateGovernedOperationProposal marks source as SIMULATED", () => {
  const p = generateGovernedOperationProposal("Update UI layout", { now });
  assert.equal(p.source, "SIMULATED");
  assert.match(p.governanceNote, /GOVERNED PREVIEW/i);
  assert.match(p.governanceNote, /SIMULATED/i);
});

test("generateGovernedOperationProposal includes base command policy with blocked shell execution", () => {
  const p = generateGovernedOperationProposal("Fix fall recovery", { now });
  const shellRule = p.commandPolicy.find((r) => r.rule === "Shell execution");
  assert.ok(shellRule, "Expected shell execution rule");
  assert.equal(shellRule?.status, "blocked");
  const fileReadRule = p.commandPolicy.find((r) => r.rule === "File read in sandbox");
  assert.ok(fileReadRule, "Expected file read rule");
  assert.equal(fileReadRule?.status, "allowed");
});

test("generateGovernedOperationProposal estimates affected files for gameplay request", () => {
  const p = generateGovernedOperationProposal("Fix enemy fall recovery behavior", { now });
  assert.ok(p.estimatedAffectedFiles.some((f) => f.includes("BasicEnemy")), "Expected BasicEnemy.cs in affected files");
  assert.ok(p.estimatedAffectedFiles.some((f) => f.includes("FallRecovery")), "Expected FallRecovery.cs in affected files");
});

test("getRuntimeLabel and getCategoryLabel return non-empty strings for all variants", () => {
  const runtimes = ["openclaw", "claude_code", "codex", "human", "unknown"] as const;
  for (const r of runtimes) {
    assert.ok(getRuntimeLabel(r).length > 0, `getRuntimeLabel("${r}") returned empty string`);
  }

  const categories = ["gameplay_fix", "code_refactor", "ui_update", "test_review", "asset_patch", "regression_review", "general"] as const;
  for (const c of categories) {
    assert.ok(getCategoryLabel(c).length > 0, `getCategoryLabel("${c}") returned empty string`);
  }
});
