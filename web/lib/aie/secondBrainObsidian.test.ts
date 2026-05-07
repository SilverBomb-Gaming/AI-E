import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { exportSecondBrainToObsidian } from "./secondBrainObsidian";

async function collectFiles(root: string, relative = ""): Promise<string[]> {
  const directory = relative ? path.join(root, relative) : root;
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const nextRelative = relative ? path.join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) {
      files.push(...await collectFiles(root, nextRelative));
      continue;
    }

    files.push(nextRelative.replace(/\\/g, "/"));
  }

  return files.sort();
}

async function snapshotVault(root: string): Promise<Record<string, string>> {
  const files = await collectFiles(root);
  const snapshot: Record<string, string> = {};
  for (const file of files) {
    snapshot[file] = await readFile(path.join(root, file), "utf8");
  }

  return snapshot;
}

function extractWikiLinks(markdown: string): string[] {
  return [...markdown.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => match[1] ?? "");
}

test("exportSecondBrainToObsidian creates deterministic vault structure and read-only notes", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-second-brain-obsidian-"));
  const vaultRoot = path.join(tempRoot, "Second Brain");
  const brainPath = path.join(tempRoot, "data", "second_brain", "brain.json");

  try {
    const initialExport = await exportSecondBrainToObsidian({ root: tempRoot, vaultRoot });

    const files = await collectFiles(vaultRoot);
    const homeText = await readFile(path.join(vaultRoot, "Home.md"), "utf8");
    const aiText = await readFile(path.join(vaultRoot, "Projects", "AI-E.md"), "utf8");
    const babylonText = await readFile(path.join(vaultRoot, "Projects", "BABYLON 2026.md"), "utf8");
    const currentStateText = await readFile(path.join(vaultRoot, "Projects", "Current Project State.md"), "utf8");
    const outcomeText = await readFile(path.join(vaultRoot, "Outcomes", "Outcome History.md"), "utf8");
    const sessionText = await readFile(path.join(vaultRoot, "Sessions", "Session Continuity Summary.md"), "utf8");
    const brainBeforeRerun = await readFile(brainPath, "utf8");
    const firstSnapshot = await snapshotVault(vaultRoot);

    assert.equal(initialExport.vaultRoot, vaultRoot);
    assert.ok(files.includes("Home.md"));
    assert.ok(files.includes("Current Focus.md"));
    assert.ok(files.includes("Active Projects.md"));
    assert.ok(files.includes("Operational Lessons.md"));
    assert.ok(files.includes("Projects/AI-E.md"));
    assert.ok(files.includes("Projects/BABYLON 2026.md"));
    assert.ok(files.includes("Projects/Current Project State.md"));
    assert.ok(files.includes("Projects/Next Safe Task.md"));
    assert.ok(files.includes("Architecture/Architecture Rules.md"));
    assert.ok(files.includes("Architecture/Old BABYLON Anti-Patterns.md"));
    assert.ok(files.includes("Architecture/Continuity Rules.md"));
    assert.ok(files.includes("Outcomes/Outcome History.md"));
    assert.ok(files.includes("Outcomes/Failed Generations.md"));
    assert.ok(files.includes("Outcomes/Successful Generations.md"));
    assert.ok(files.includes("Recovery/Recovery Procedures.md"));
    assert.ok(files.includes("Resources/Asset Reuse Log.md"));
    assert.ok(files.includes("Resources/Asset Reuse Decisions.md"));
    assert.ok(files.includes("Resources/Cost-Aware Iteration Notes.md"));
    assert.ok(files.includes("Strategy/Strategic Roadmap.md"));
    assert.ok(files.includes("Strategy/Cinematic Production Memory.md"));
    assert.ok(files.includes("Strategy/Scene Sequences.md"));
    assert.ok(files.includes("Strategy/Gameplay Cutscene Triggers.md"));
    assert.ok(files.includes("Strategy/Shot Planning Rules.md"));
    assert.ok(files.includes("Strategy/Shot Progression Examples.md"));
    assert.ok(files.includes("Architecture/Continuity Validation Rules.md"));
    assert.ok(files.includes("Resources/Resource Fallback State.md"));
    assert.ok(files.includes("Sessions/Session Continuity Summary.md"));
    assert.ok(files.includes("Projects/BABYLON Cutscene Layer.md"));

    assert.match(homeText, /^---[\s\S]*project_key:/m);
    assert.match(homeText, /^---[\s\S]*updated_at:/m);
    assert.match(homeText, /^---[\s\S]*session_id:/m);
    assert.match(homeText, /^---[\s\S]*status:/m);
    assert.match(homeText, /^---[\s\S]*tags:/m);
    assert.match(aiText, /\[\[Current Project State\]\]/);
    assert.match(homeText, /\[\[AI-E\]\]/);
    assert.match(babylonText, /\[\[Old BABYLON Anti-Patterns\]\]/);
    assert.match(currentStateText, /\[\[BABYLON 2026\]\]/);
    assert.match(currentStateText, /\[\[AI-E\]\]/);
    assert.match(outcomeText, /\[\[AI-E\]\]|\[\[BABYLON 2026\]\]/);
    assert.match(sessionText, /\[\[Outcome History\]\]/);

    const cinematicMemoryText = await readFile(path.join(vaultRoot, "Strategy", "Cinematic Production Memory.md"), "utf8");
    const cutsceneLayerText = await readFile(path.join(vaultRoot, "Projects", "BABYLON Cutscene Layer.md"), "utf8");
    const costNotesText = await readFile(path.join(vaultRoot, "Resources", "Cost-Aware Iteration Notes.md"), "utf8");
    const sceneSequencesText = await readFile(path.join(vaultRoot, "Strategy", "Scene Sequences.md"), "utf8");
    const triggerText = await readFile(path.join(vaultRoot, "Strategy", "Gameplay Cutscene Triggers.md"), "utf8");
    const continuityValidationText = await readFile(path.join(vaultRoot, "Architecture", "Continuity Validation Rules.md"), "utf8");
    const progressionText = await readFile(path.join(vaultRoot, "Strategy", "Shot Progression Examples.md"), "utf8");
    const assetReuseDecisionText = await readFile(path.join(vaultRoot, "Resources", "Asset Reuse Decisions.md"), "utf8");

    assert.match(cinematicMemoryText, /Production Memory Manager/);
    assert.match(cinematicMemoryText, /\[\[BABYLON Cutscene Layer\]\]/);
    assert.match(cinematicMemoryText, /\[\[Scene Sequences\]\]/);
    assert.match(cutsceneLayerText, /Wave Start Pressure Beat/);
    assert.match(costNotesText, /Failed generations tracked:/);
    assert.match(sceneSequencesText, /Wave Transition Pressure Sequence/);
    assert.match(sceneSequencesText, /intro-shot/);
    assert.match(triggerText, /Wave Escalation Transition/);
    assert.match(triggerText, /boss-intro/);
    assert.match(continuityValidationText, /timeline consistency/i);
    assert.match(continuityValidationText, /sequence-wave-transition-001-intro/);
    assert.match(progressionText, /intro-shot -> establish-environment -> reveal-subject/);
    assert.match(assetReuseDecisionText, /Preserve the approved wave reveal prompt/);

    const existingTitles = new Set(files.map((file) => path.basename(file, ".md")));
    for (const file of files.filter((entry) => entry.endsWith(".md"))) {
      const markdown = await readFile(path.join(vaultRoot, file), "utf8");
      for (const link of extractWikiLinks(markdown)) {
        const noteTitle = link.split("#")[0]?.trim() ?? "";
        assert.ok(existingTitles.has(noteTitle), `Missing linked note ${noteTitle} from ${file}`);
      }
    }

    const secondExport = await exportSecondBrainToObsidian({ root: tempRoot, vaultRoot });
    const brainAfterRerun = await readFile(brainPath, "utf8");
    const secondSnapshot = await snapshotVault(vaultRoot);

    assert.equal(secondExport.currentProjectKey, initialExport.currentProjectKey);
    assert.deepEqual(secondSnapshot, firstSnapshot);
    assert.equal(brainAfterRerun, brainBeforeRerun);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});