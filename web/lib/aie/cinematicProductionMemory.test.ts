import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  compileCinematicShotPrompt,
  ensureCinematicProductionMemoryInitialized,
  readCinematicProductionMemory,
  recordCinematicGenerationOutcome,
  recordCinematicShotHistory,
  writeCinematicProductionMemory,
} from "./cinematicProductionMemory";

test("cinematic production memory persists bounded planning state and compiles shot prompts", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-cinematic-production-memory-"));

  try {
    const initialized = await ensureCinematicProductionMemoryInitialized(tempRoot);
    assert.match(initialized.productionMemoryPath, /data[\\/]second_brain[\\/]production_memory\.json/i);

    await writeCinematicProductionMemory({
      root: tempRoot,
      value: {
        pacing_notes: [
          "Use a half-beat pause before the wave reveal lands.",
          "Return to gameplay immediately after the threat is established.",
        ],
      },
    });

    await recordCinematicShotHistory({
      root: tempRoot,
      entry: {
        shot_id: "shot-wave-reveal-002",
        recorded_at: "2026-05-07T13:00:00.000Z",
        beat_id: "babylon-cutscene-proof",
        intent: "Confirm the next wave arrival while keeping the player grounded in the arena.",
        camera_framing: "medium-wide over-shoulder arena reveal",
        camera_motion: "controlled push-in",
        lens_language: "28mm tactical action lens",
        lighting_direction: "arena practicals with readable rim separation",
        outcome: "ready for prompt compilation",
      },
    });

    await recordCinematicGenerationOutcome({
      root: tempRoot,
      entry: {
        generation_id: "success-wave-reveal-002",
        recorded_at: "2026-05-07T13:05:00.000Z",
        shot_id: "shot-wave-reveal-002",
        status: "successful",
        prompt_summary: "Readable cutscene insert with clear arena geography and wave anticipation.",
        engine: "prompt-compiler-stub",
        cost_tier: "medium",
        asset_ids: ["prompt-wave-reveal-001"],
        notes: ["Reuse the existing reveal prompt structure.", "Keep enemy spawn geography visible."],
      },
    });

    await recordCinematicGenerationOutcome({
      root: tempRoot,
      entry: {
        generation_id: "failed-wave-reveal-002",
        recorded_at: "2026-05-07T13:06:00.000Z",
        shot_id: "shot-wave-reveal-002",
        status: "failed",
        prompt_summary: "Tried a low-key moody pass that obscured the lane geometry.",
        engine: "prompt-compiler-stub",
        cost_tier: "low",
        asset_ids: [],
        notes: ["Reject because gameplay readability degraded."],
      },
    });

    const record = await readCinematicProductionMemory({ root: tempRoot });
    const compiled = await compileCinematicShotPrompt({ root: tempRoot, shotId: "shot-wave-reveal-002" });

    assert.equal(record.project_key, "babylon-2026");
    assert.ok(record.characters.some((entry) => entry.name === "BABYLON Runner"));
    assert.ok(record.roadmap_systems.some((entry) => entry.id === "shot-planner"));
    assert.ok(record.story_beats.some((entry) => /Wave Start Pressure Beat/i.test(entry.title)));
    assert.ok(record.shot_history.some((entry) => entry.shot_id === "shot-wave-reveal-002"));
    assert.ok(record.successful_generations.some((entry) => entry.generation_id === "success-wave-reveal-002"));
    assert.ok(record.failed_generations.some((entry) => entry.generation_id === "failed-wave-reveal-002"));
    assert.match(compiled.prompt, /Wave Start Pressure Beat/i);
    assert.match(compiled.prompt, /gameplay context/i);
    assert.ok(compiled.continuity_constraints.some((entry) => /current production case study/i.test(entry)));
    assert.ok(compiled.asset_reuse_candidates.some((entry) => /prompt-wave-reveal-001/i.test(entry)));
    assert.match(compiled.estimated_cost_tier, /low|medium|high/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});