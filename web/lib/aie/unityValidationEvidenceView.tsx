import React from "react";

import type { AutonomousDeliveryPackage, AutonomousReviewPackage } from "./autonomousWorkPlanning";

export type UnityValidationEvidenceKind = "adapter_preview" | "real_bridge_unavailable" | "real_bridge_read_only" | "scene_object_creation_preview";

export type UnityValidationEvidence = {
  kind: UnityValidationEvidenceKind;
  bridgeStatus: string;
  sceneValidationStatus: string;
  checkedSceneName: string | null;
  missingScriptCount: number | null;
  consoleErrorCount: number | null;
  objectCount: number | null;
  evidenceTimestamp: string | null;
  recommendedNextOperatorAction: string | null;
  demoPreview: boolean;
  requestedObjectName: string | null;
  targetScene: string | null;
  intendedComponents: string[];
  intendedTransformPosition: string | null;
  intendedTransformRotation: string | null;
  intendedTransformScale: string | null;
  riskLevel: string | null;
  requiredApprovalGates: string[];
  dryRun: boolean | null;
  executed: boolean | null;
};

function parseLabeledValue(lines: string[], label: string): string | null {
  const prefix = `${label}:`;
  for (const line of lines) {
    if (line.startsWith(prefix)) {
      return line.slice(prefix.length).trim() || null;
    }
  }
  return null;
}

function parseCount(value: string | null): number | null {
  if (!value || /unknown|none/i.test(value)) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBoolean(value: string | null): boolean | null {
  if (!value) {
    return null;
  }

  if (/^true$/i.test(value)) {
    return true;
  }

  if (/^false$/i.test(value)) {
    return false;
  }

  return null;
}

function parseList(value: string | null): string[] {
  if (!value) {
    return [];
  }

  return value.split(/,\s*/).map((item) => item.trim()).filter(Boolean);
}

function parseSummary(summary: string): Partial<UnityValidationEvidence> {
  const completedMatch = summary.match(
    /Unity read-only validation probe completed for (.+?) with status ([a-z_]+), missing scripts ([a-z0-9_-]+), console errors ([a-z0-9_-]+), and object count ([a-z0-9_-]+)/i,
  );
  if (completedMatch) {
    return {
      kind: "real_bridge_read_only",
      checkedSceneName: completedMatch[1]?.trim() ?? null,
      sceneValidationStatus: completedMatch[2]?.trim() ?? "unknown",
      missingScriptCount: parseCount(completedMatch[3] ?? null),
      consoleErrorCount: parseCount(completedMatch[4] ?? null),
      objectCount: parseCount(completedMatch[5] ?? null),
    };
  }

  if (/bridge was requested but is currently unavailable/i.test(summary)) {
    return {
      kind: "real_bridge_unavailable",
      bridgeStatus: "bridge_unavailable",
      sceneValidationStatus: "not_checked",
    };
  }

  if (/validation preview was not executed/i.test(summary)) {
    return {
      kind: "adapter_preview",
      bridgeStatus: "adapter_preview",
      sceneValidationStatus: "not_checked",
    };
  }

  const mutationPreviewMatch = summary.match(/DRY RUN ONLY: Unity scene object creation preview for (.+?) in (.+?)\. NOT EXECUTED\./i);
  if (mutationPreviewMatch) {
    return {
      kind: "scene_object_creation_preview",
      bridgeStatus: "dry_run_only",
      sceneValidationStatus: "not_checked",
      requestedObjectName: mutationPreviewMatch[1]?.trim() ?? null,
      targetScene: mutationPreviewMatch[2]?.trim() ?? null,
      dryRun: true,
      executed: false,
    };
  }

  return {};
}

function inferKind(lines: string[], summary: string): UnityValidationEvidenceKind | null {
  const executionKind = parseLabeledValue(lines, "Execution kind");
  if (executionKind === "adapter_preview" || executionKind === "real_bridge_unavailable" || executionKind === "real_bridge_read_only") {
    return executionKind;
  }

  if (executionKind === "dry_run_preview" || executionKind === "preview_blocked") {
    return "scene_object_creation_preview";
  }

  if (/unity read-only bridge -> unavailable/i.test(lines.join("\n"))) {
    return "real_bridge_unavailable";
  }

  if (/unity read-only bridge -> evidence_captured/i.test(lines.join("\n"))) {
    return "real_bridge_read_only";
  }

  return (parseSummary(summary).kind as UnityValidationEvidenceKind | undefined) ?? null;
}

function isUnityEvidencePackage(workItemId: string, lines: string[], summary: string): boolean {
  if (/unity-validation/i.test(workItemId)) {
    return true;
  }

  if (/unity-mutation-preview/i.test(workItemId)) {
    return true;
  }

  const text = [summary, ...lines].join("\n");
  return /unity read-only validation probe|unity validation preview|unity scene object creation preview|bridge status:|requested object name:|dry run:/i.test(text);
}

function buildEvidence(workItemId: string, summary: string, lines: string[]): UnityValidationEvidence | null {
  if (!isUnityEvidencePackage(workItemId, lines, summary)) {
    return null;
  }

  const summaryValues = parseSummary(summary);
  const kind = inferKind(lines, summary);
  if (!kind) {
    return null;
  }

  const bridgeStatus = parseLabeledValue(lines, "Bridge status")
    ?? summaryValues.bridgeStatus
    ?? (kind === "real_bridge_read_only" ? "bridge_ready" : kind === "real_bridge_unavailable" ? "bridge_unavailable" : "adapter_preview");
  const sceneValidationStatus = parseLabeledValue(lines, "Scene validation status")
    ?? summaryValues.sceneValidationStatus
    ?? "not_checked";
  const checkedSceneName = parseLabeledValue(lines, "Checked scene name")
    ?? summaryValues.checkedSceneName
    ?? null;
  const evidenceTimestamp = parseLabeledValue(lines, "Evidence timestamp");
  const recommendedNextOperatorAction = parseLabeledValue(lines, "Recommended next operator action")
    ?? (summary.match(/Next operator action:\s*(.+)$/im)?.[1]?.trim() ?? null);
  const requestedObjectName = parseLabeledValue(lines, "Requested object name")
    ?? summaryValues.requestedObjectName
    ?? null;
  const targetScene = parseLabeledValue(lines, "Target scene")
    ?? summaryValues.targetScene
    ?? null;
  const requiredApprovalGates = lines
    .filter((line) => line.startsWith("Required approval gate:"))
    .map((line) => line.slice("Required approval gate:".length).trim())
    .filter(Boolean);

  return {
    kind,
    bridgeStatus,
    sceneValidationStatus,
    checkedSceneName: checkedSceneName && checkedSceneName !== "none" ? checkedSceneName : null,
    missingScriptCount: parseCount(parseLabeledValue(lines, "Missing script count")) ?? summaryValues.missingScriptCount ?? null,
    consoleErrorCount: parseCount(parseLabeledValue(lines, "Console error count")) ?? summaryValues.consoleErrorCount ?? null,
    objectCount: parseCount(parseLabeledValue(lines, "Object count")) ?? summaryValues.objectCount ?? null,
    evidenceTimestamp,
    recommendedNextOperatorAction,
    demoPreview: /demo preview/i.test([summary, ...lines].join("\n")),
    requestedObjectName,
    targetScene,
    intendedComponents: parseList(parseLabeledValue(lines, "Intended components")),
    intendedTransformPosition: parseLabeledValue(lines, "Intended transform position"),
    intendedTransformRotation: parseLabeledValue(lines, "Intended transform rotation"),
    intendedTransformScale: parseLabeledValue(lines, "Intended transform scale"),
    riskLevel: parseLabeledValue(lines, "Risk level"),
    requiredApprovalGates,
    dryRun: parseBoolean(parseLabeledValue(lines, "Dry run")) ?? summaryValues.dryRun ?? null,
    executed: parseBoolean(parseLabeledValue(lines, "Executed")) ?? summaryValues.executed ?? null,
  };
}

export function extractUnityValidationEvidenceFromReviewPackage(item: AutonomousReviewPackage): UnityValidationEvidence | null {
  return buildEvidence(item.work_item_id, item.summary, [...item.tests_run, ...item.proof_results, ...item.risks, item.rollback_notes]);
}

export function extractUnityValidationEvidenceFromDeliveryPackage(item: AutonomousDeliveryPackage): UnityValidationEvidence | null {
  return buildEvidence(
    item.work_item_id,
    item.release_notes,
    [...item.validation_results, ...item.proof_results, item.risk_summary, item.recommended_pr_body, item.rollback_plan],
  );
}

function kindLabel(kind: UnityValidationEvidenceKind): string {
  switch (kind) {
    case "scene_object_creation_preview":
      return "Scene Object Creation Preview";
    case "adapter_preview":
      return "Adapter Preview";
    case "real_bridge_unavailable":
      return "Bridge Unavailable";
    case "real_bridge_read_only":
    default:
      return "Read-Only Bridge";
  }
}

function formatMetric(value: number | null): string {
  return value === null ? "unknown" : String(value);
}

export function UnityValidationEvidencePanel({ evidence }: { evidence: UnityValidationEvidence }) {
  return (
    <section className="mt-3 rounded-[1.25rem] border border-ocean/15 bg-ocean/5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-slate">Unity validation evidence</p>
        <span className="inline-flex rounded-full border border-ocean/20 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-ocean">
          {kindLabel(evidence.kind)}
        </span>
        {evidence.demoPreview ? (
          <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
            Demo preview
          </span>
        ) : null}
        {evidence.kind === "scene_object_creation_preview" ? (
          <>
            <span className="inline-flex rounded-full border border-coral/20 bg-coral/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-ember">
              DRY RUN ONLY
            </span>
            <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
              NOT EXECUTED
            </span>
          </>
        ) : null}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <p className="text-xs leading-6 text-slate">Bridge status: {evidence.bridgeStatus}</p>
        <p className="text-xs leading-6 text-slate">Scene validation status: {evidence.sceneValidationStatus}</p>
        <p className="text-xs leading-6 text-slate">Checked scene: {evidence.checkedSceneName ?? "none"}</p>
        <p className="text-xs leading-6 text-slate">Missing scripts: {formatMetric(evidence.missingScriptCount)}</p>
        <p className="text-xs leading-6 text-slate">Console errors: {formatMetric(evidence.consoleErrorCount)}</p>
        <p className="text-xs leading-6 text-slate">Object count: {formatMetric(evidence.objectCount)}</p>
      </div>
      {evidence.kind === "scene_object_creation_preview" ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <p className="text-xs leading-6 text-slate">Requested object name: {evidence.requestedObjectName ?? "none"}</p>
          <p className="text-xs leading-6 text-slate">Target scene: {evidence.targetScene ?? "none"}</p>
          <p className="text-xs leading-6 text-slate">Intended components: {evidence.intendedComponents.length > 0 ? evidence.intendedComponents.join(", ") : "none"}</p>
          <p className="text-xs leading-6 text-slate">Intended transform position: {evidence.intendedTransformPosition ?? "none"}</p>
          <p className="text-xs leading-6 text-slate">Intended transform rotation: {evidence.intendedTransformRotation ?? "none"}</p>
          <p className="text-xs leading-6 text-slate">Intended transform scale: {evidence.intendedTransformScale ?? "none"}</p>
          <p className="text-xs leading-6 text-slate">Risk level: {evidence.riskLevel ?? "unknown"}</p>
          <p className="text-xs leading-6 text-slate">Dry run: {String(evidence.dryRun ?? false)}</p>
          <p className="text-xs leading-6 text-slate">Executed: {String(evidence.executed ?? false)}</p>
        </div>
      ) : null}
      {evidence.kind === "scene_object_creation_preview" ? (
        <div className="mt-2">
          <p className="text-xs uppercase tracking-[0.18em] text-slate">Required approval gates</p>
          <p className="mt-1 text-xs leading-6 text-slate">{evidence.requiredApprovalGates.length > 0 ? evidence.requiredApprovalGates.join(" | ") : "none"}</p>
        </div>
      ) : null}
      {evidence.evidenceTimestamp ? <p className="mt-2 text-xs leading-6 text-slate">Evidence timestamp: {evidence.evidenceTimestamp}</p> : null}
      {evidence.recommendedNextOperatorAction ? (
        <p className="mt-1 text-xs leading-6 text-slate">Recommended next operator action: {evidence.recommendedNextOperatorAction}</p>
      ) : null}
    </section>
  );
}