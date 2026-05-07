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
    assert.ok(files.includes("Outcomes/Approval Audit Trail.md"));
    assert.ok(files.includes("Outcomes/Sandbox Simulation Results.md"));
    assert.ok(files.includes("Outcomes/Successful Generations.md"));
    assert.ok(files.includes("Recovery/Recovery Procedures.md"));
    assert.ok(files.includes("Architecture/Provider Capability Registry.md"));
    assert.ok(files.includes("Architecture/Prompt Normalization Rules.md"));
    assert.ok(files.includes("Architecture/Generation Budget Rules.md"));
    assert.ok(files.includes("Architecture/Budget Governance Decisions.md"));
    assert.ok(files.includes("Architecture/Approval Escalation Rules.md"));
    assert.ok(files.includes("Architecture/Execution Readiness Checklist.md"));
    assert.ok(files.includes("Architecture/Local Model Registry.md"));
    assert.ok(files.includes("Architecture/Local Runtime Readiness.md"));
    assert.ok(files.includes("Architecture/Hardware Capability Planning.md"));
    assert.ok(files.includes("Architecture/Local-vs-Cloud Routing.md"));
    assert.ok(files.includes("Architecture/Manual Approval Workflow.md"));
    assert.ok(files.includes("Architecture/Continuity Review Notes.md"));
    assert.ok(files.includes("Architecture/Provider Constraint Matrix.md"));
    assert.ok(files.includes("Resources/Asset Reuse Log.md"));
    assert.ok(files.includes("Resources/Asset Reuse Decisions.md"));
    assert.ok(files.includes("Resources/Cost-Aware Iteration Notes.md"));
    assert.ok(files.includes("Resources/Cost-Aware Generation Strategy.md"));
    assert.ok(files.includes("Resources/Cost Forecast Examples.md"));
    assert.ok(files.includes("Resources/Local Asset Cache Strategy.md"));
    assert.ok(files.includes("Resources/Provider Comparison Notes.md"));
    assert.ok(files.includes("Strategy/Strategic Roadmap.md"));
    assert.ok(files.includes("Strategy/Cinematic Production Memory.md"));
    assert.ok(files.includes("Strategy/Future Local Inference Notes.md"));
    assert.ok(files.includes("Strategy/Generation Job Queue.md"));
    assert.ok(files.includes("Strategy/Operator Approval Queue.md"));
    assert.ok(files.includes("Strategy/Real Provider Dry Run.md"));
    assert.ok(files.includes("Strategy/Provider Payload Examples.md"));
    assert.ok(files.includes("Strategy/Submission Package Examples.md"));
    assert.ok(files.includes("Strategy/Deferred Execution Plans.md"));
    assert.ok(files.includes("Strategy/Execution Manifest Examples.md"));
    assert.ok(files.includes("Strategy/Scene Sequences.md"));
    assert.ok(files.includes("Strategy/Gameplay Cutscene Triggers.md"));
    assert.ok(files.includes("Strategy/Shot Planning Rules.md"));
    assert.ok(files.includes("Strategy/Shot Progression Examples.md"));
    assert.ok(files.includes("Architecture/Continuity Validation Rules.md"));
    assert.ok(files.includes("Architecture/Provider Routing Rules.md"));
    assert.ok(files.includes("Architecture/Cinematic Execution Lifecycle.md"));
    assert.ok(files.includes("Architecture/Retry Planning Rules.md"));
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
    const jobQueueText = await readFile(path.join(vaultRoot, "Strategy", "Generation Job Queue.md"), "utf8");
    const routingRulesText = await readFile(path.join(vaultRoot, "Architecture", "Provider Routing Rules.md"), "utf8");
    const capabilityRegistryText = await readFile(path.join(vaultRoot, "Architecture", "Provider Capability Registry.md"), "utf8");
    const normalizationRulesText = await readFile(path.join(vaultRoot, "Architecture", "Prompt Normalization Rules.md"), "utf8");
    const budgetRulesText = await readFile(path.join(vaultRoot, "Architecture", "Generation Budget Rules.md"), "utf8");
    const budgetGovernanceText = await readFile(path.join(vaultRoot, "Architecture", "Budget Governance Decisions.md"), "utf8");
    const escalationRulesText = await readFile(path.join(vaultRoot, "Architecture", "Approval Escalation Rules.md"), "utf8");
    const readinessChecklistText = await readFile(path.join(vaultRoot, "Architecture", "Execution Readiness Checklist.md"), "utf8");
    const approvalWorkflowText = await readFile(path.join(vaultRoot, "Architecture", "Manual Approval Workflow.md"), "utf8");
    const continuityReviewText = await readFile(path.join(vaultRoot, "Architecture", "Continuity Review Notes.md"), "utf8");
    const providerConstraintMatrixText = await readFile(path.join(vaultRoot, "Architecture", "Provider Constraint Matrix.md"), "utf8");
    const localModelRegistryText = await readFile(path.join(vaultRoot, "Architecture", "Local Model Registry.md"), "utf8");
    const localRuntimeReadinessText = await readFile(path.join(vaultRoot, "Architecture", "Local Runtime Readiness.md"), "utf8");
    const hardwarePlanningText = await readFile(path.join(vaultRoot, "Architecture", "Hardware Capability Planning.md"), "utf8");
    const localVsCloudRoutingText = await readFile(path.join(vaultRoot, "Architecture", "Local-vs-Cloud Routing.md"), "utf8");
    const lifecycleText = await readFile(path.join(vaultRoot, "Architecture", "Cinematic Execution Lifecycle.md"), "utf8");
    const retryRulesText = await readFile(path.join(vaultRoot, "Architecture", "Retry Planning Rules.md"), "utf8");
    const generationStrategyText = await readFile(path.join(vaultRoot, "Resources", "Cost-Aware Generation Strategy.md"), "utf8");
    const costForecastText = await readFile(path.join(vaultRoot, "Resources", "Cost Forecast Examples.md"), "utf8");
    const localAssetCacheText = await readFile(path.join(vaultRoot, "Resources", "Local Asset Cache Strategy.md"), "utf8");
    const providerComparisonNotesText = await readFile(path.join(vaultRoot, "Resources", "Provider Comparison Notes.md"), "utf8");
    const futureLocalInferenceText = await readFile(path.join(vaultRoot, "Strategy", "Future Local Inference Notes.md"), "utf8");
    const operatorQueueText = await readFile(path.join(vaultRoot, "Strategy", "Operator Approval Queue.md"), "utf8");
    const realProviderDryRunText = await readFile(path.join(vaultRoot, "Strategy", "Real Provider Dry Run.md"), "utf8");
    const submissionPackageExamplesText = await readFile(path.join(vaultRoot, "Strategy", "Submission Package Examples.md"), "utf8");
    const deferredPlansText = await readFile(path.join(vaultRoot, "Strategy", "Deferred Execution Plans.md"), "utf8");
    const executionManifestExamplesText = await readFile(path.join(vaultRoot, "Strategy", "Execution Manifest Examples.md"), "utf8");
    const payloadExamplesText = await readFile(path.join(vaultRoot, "Strategy", "Provider Payload Examples.md"), "utf8");
    const approvalAuditText = await readFile(path.join(vaultRoot, "Outcomes", "Approval Audit Trail.md"), "utf8");
    const sandboxResultsText = await readFile(path.join(vaultRoot, "Outcomes", "Sandbox Simulation Results.md"), "utf8");

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
    assert.match(jobQueueText, /No generation jobs planned yet\./);
    assert.match(routingRulesText, /Cheap draft routing should prefer Seedance/i);
    assert.match(capabilityRegistryText, /Sora: duration<=20s/i);
    assert.match(normalizationRulesText, /Normalize prompts into provider-ready payloads without changing continuity intent/i);
    assert.match(budgetRulesText, /Sandbox-only mode: enabled/i);
    assert.match(budgetGovernanceText, /No budget governance decisions recorded yet\./i);
    assert.match(escalationRulesText, /Escalate when estimated cost exceeds/i);
    assert.match(readinessChecklistText, /Sandbox-only mode: still blocking real execution/i);
    assert.match(approvalWorkflowText, /A human approval step is required before any provider execution or credit spend is considered valid/i);
    assert.match(continuityReviewText, /No continuity review notes recorded yet\./i);
    assert.match(providerConstraintMatrixText, /Sora: duration<=20s/i);
    assert.match(localModelRegistryText, /Wan 2\.1 Text-to-Video Q8/i);
    assert.match(localRuntimeReadinessText, /ComfyUI Local Video Lane/i);
    assert.match(hardwarePlanningText, /Windows DirectML Baseline/i);
    assert.match(localVsCloudRoutingText, /Prefer LocalFutureProvider only when runtime, model, and hardware checks pass/i);
    assert.match(lifecycleText, /Execution lifecycle remains append-only/i);
    assert.match(retryRulesText, /Retry planning must preserve successful shot outputs/i);
    assert.match(generationStrategyText, /Use cheap draft routing for first-pass framing validation/i);
    assert.match(costForecastText, /Seedance draft pass/i);
    assert.match(localAssetCacheText, /Cache model weights and VAE assets separately from generated outputs/i);
    assert.match(providerComparisonNotesText, /Compare providers by cost, duration support, continuity support/i);
    assert.match(futureLocalInferenceText, /Use LocalFutureProvider as a stable abstraction over future open-source backends/i);
    assert.match(operatorQueueText, /No operator-facing jobs are queued yet\./i);
    assert.match(realProviderDryRunText, /No real-provider dry-run previews generated yet\./i);
    assert.match(submissionPackageExamplesText, /No submission packages prepared yet\./i);
    assert.match(deferredPlansText, /No deferred execution plans recorded yet\./i);
    assert.match(executionManifestExamplesText, /No execution manifests prepared yet\./i);
    assert.match(payloadExamplesText, /Sora-ready payloads should keep cinematic prose/i);
    assert.match(approvalAuditText, /No approval audit entries recorded yet\./i);
    assert.match(sandboxResultsText, /No sandbox simulations recorded yet\./);

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