import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  chooseSecondBrainFallbackMode,
  ensureSecondBrainInitialized,
  readSecondBrainMemory,
  retrieveCurrentProjectContext,
  summarizeSecondBrainMemory,
  updateSecondBrainOutcomeLog,
  writeSecondBrainMemory,
} from "./secondBrainMemory";

test("second brain seeds persistent BABYLON 2026 continuity memory", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-second-brain-init-"));

  try {
    const initialized = await ensureSecondBrainInitialized(tempRoot);
    const summary = await summarizeSecondBrainMemory({ root: tempRoot });
    const caseStudyText = await readFile(initialized.caseStudyPath, "utf8");

    assert.match(initialized.brainPath, /data[\\/]second_brain[\\/]brain\.json/i);
    assert.match(summary.summary, /BABYLON 2026/i);
    assert.match(summary.summary, /stable_paused_case_study/i);
    assert.match(caseStudyText, /Anti-Patterns From Older BABYLON Work/i);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("second brain retrieves current project context and anti-pattern guidance", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-second-brain-context-"));

  try {
    const context = await retrieveCurrentProjectContext({ root: tempRoot });

    assert.equal(context.project.project_key, "babylon-2026");
    assert.match(context.next_safe_task, /Integrate second-brain context retrieval/i);
    assert.ok(context.project.anti_patterns.some((entry) => /legacy BABYLON repair-loop habits/i.test(entry)));
    assert.ok(context.architecture_memory.anti_patterns.some((entry) => /hidden repair loops/i.test(entry)));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("second brain derives an AI-E project context from the active repo root", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-second-brain-ai-e-parent-"));
  const aieRoot = path.join(tempRoot, "AI-E");

  try {
    await ensureSecondBrainInitialized(aieRoot);
    const context = await retrieveCurrentProjectContext({ root: aieRoot });
    const summary = await summarizeSecondBrainMemory({ root: aieRoot });

    assert.equal(context.project.project_key, "ai-e");
    assert.equal(context.project.title, "AI-E");
    assert.match(context.next_safe_task, /persistent second-brain foundation|preserves project context/i);
    assert.ok(context.architecture_memory.anti_patterns.some((entry) => /hidden repair loops/i.test(entry)));
    assert.equal(summary.current_project_key, "ai-e");
    assert.match(summary.summary, /AI-E/i);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("second brain records append-only outcome logs and updates persisted memory", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-second-brain-outcomes-"));

  try {
    const first = await updateSecondBrainOutcomeLog({
      root: tempRoot,
      entry: {
        outcome_id: "outcome-1",
        recorded_at: "2026-05-06T12:00:00.000Z",
        project_key: "babylon-2026",
        task_source: "copilot",
        task_title: "Wave stability handoff",
        attempted: "Captured the stable BABYLON 2026 sandbox summary.",
        status: "passed",
        validation_result: "Summary captured cleanly.",
        should_never_repeat: false,
      },
    });
    await updateSecondBrainOutcomeLog({
      root: tempRoot,
      entry: {
        outcome_id: "outcome-2",
        recorded_at: "2026-05-06T12:05:00.000Z",
        project_key: "babylon-2026",
        task_source: "codex",
        task_title: "Unsafe legacy retry",
        attempted: "Tried to reintroduce a mixed-owner patch pattern.",
        status: "failed",
        validation_result: "Rejected due to architecture drift risk.",
        should_never_repeat: true,
        never_repeat_reason: "Do not retry mixed-owner legacy BABYLON patches.",
      },
    });

    const lines = (await readFile(first.output_path, "utf8")).trim().split(/\r?\n/);
    const memory = await readSecondBrainMemory({ root: tempRoot });

    assert.equal(lines.length, 2);
    assert.match(JSON.parse(lines[1])?.validation_result ?? "", /architecture drift risk/i);
    assert.ok("sections" in memory);
    if ("sections" in memory) {
      assert.ok(memory.sections.outcome_memory.what_failed.includes("Unsafe legacy retry"));
      assert.ok(memory.sections.outcome_memory.should_never_be_repeated.includes("Do not retry mixed-owner legacy BABYLON patches."));
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("second brain persists working-memory updates across restart-style reloads", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-second-brain-restart-"));

  try {
    await writeSecondBrainMemory({
      root: tempRoot,
      section: "working_memory",
      merge: true,
      value: {
        current_task_state: "Resuming after restart with second-brain context.",
        active_files: ["web/lib/aie/secondBrainMemory.ts"],
        active_repo_project: "AI-E",
        current_objective: "Resume continuity with minimal operator restatement.",
        recent_errors_fixes: ["Recovered from restart using persisted memory."],
        resume_checkpoint: "Continue from the stored second-brain state.",
      },
    });

    const record = await readSecondBrainMemory({ root: tempRoot });
    assert.ok("sections" in record);
    if ("sections" in record) {
      assert.match(record.sections.working_memory.current_task_state, /Resuming after restart/i);
      assert.match(record.sections.working_memory.resume_checkpoint, /stored second-brain state/i);
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("second brain chooses fallback mode when hardware or APIs are unavailable", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-second-brain-fallback-"));

  try {
    const fallback = await chooseSecondBrainFallbackMode({
      root: tempRoot,
      unavailableHardware: ["local gpu"],
      unavailableApis: ["premium model api"],
      unavailableModels: ["frontier model"],
    });

    assert.equal(fallback.mode, "local_memory_only_mode");
    assert.match(fallback.reason, /Resource pressure detected/i);
    assert.ok(fallback.continuity_actions.some((entry) => /Persist current project summary/i.test(entry)));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});