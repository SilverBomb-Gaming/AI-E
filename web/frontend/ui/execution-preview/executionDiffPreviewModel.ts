import type { GovernedPreviewFormInput } from "@/lib/aie/governedPreviewGenerationContract";

export type ExecutionDiffPreviewAction = "micro-sequence" | "preview" | "anime-character-render" | "rollback";

export type ExecutionDiffPreviewPlan = {
  id: string;
  title: string;
  action: ExecutionDiffPreviewAction;
  riskLevel: "low" | "medium" | "high";
  summary: string;
  plannedMutations: string[];
  affectedFiles: string[];
  commands: string[];
  approvalRequired: boolean;
  rollbackAvailable: boolean;
  dryRunOnly: boolean;
  warnings: string[];
};

export type ExecutionDiffPreviewInput = {
  form: GovernedPreviewFormInput;
  action: ExecutionDiffPreviewAction;
  activeRequestId: string | null;
  exportedArtifactPaths: string[];
  sandboxPath: string | null;
  animeProfileLabel?: string | null;
};

export function buildExecutionDiffPreviewPlan(input: ExecutionDiffPreviewInput): ExecutionDiffPreviewPlan {
  const planId = input.activeRequestId ?? `local-preview-${input.action}`;
  const outputRoot = input.sandboxPath ?? "web/public/generated/previews/operator-sandbox";
  const commonFiles = [
    `${outputRoot}/manifest.json`,
    `${outputRoot}/diagnostics.json`,
    `${outputRoot}/operator-summary.json`,
  ];

  if (input.action === "rollback") {
    return {
      id: planId,
      title: "Rollback sandbox outputs",
      action: input.action,
      riskLevel: "medium",
      summary: "Remove preview sandbox artifacts created by the governed operator surface while preserving source configuration.",
      plannedMutations: [
        "Delete generated preview frames from the sandbox output path.",
        "Delete generated GIF and review package files when present.",
        "Record rollback visibility in the local operator state.",
      ],
      affectedFiles: input.exportedArtifactPaths.length ? input.exportedArtifactPaths : [outputRoot],
      commands: ["Operator-triggered rollback only; no backend mutation is started from this modal."],
      approvalRequired: true,
      rollbackAvailable: false,
      dryRunOnly: true,
      warnings: ["Rollback preview is informational here; execution still requires the governed runtime control."],
    };
  }

  if (input.action === "anime-character-render") {
    const profileLabel = input.animeProfileLabel ?? "selected anime character profile";
    return {
      id: planId,
      title: "Anime character render diff",
      action: input.action,
      riskLevel: input.form.package_gif_preview ? "medium" : "low",
      summary: `Generate a bounded character-first frame set for ${profileLabel} at ${input.form.resolution}.`,
      plannedMutations: [
        "Create low-resolution character PNG frames in the sandbox output path.",
        input.form.package_gif_preview ? "Package reviewed frames into an anime GIF preview." : "Skip GIF packaging for this run.",
        "Write visual diagnostics, truth-check metadata, and an operator review summary.",
      ],
      affectedFiles: [
        `${outputRoot}/anime-character-frames/*.png`,
        input.form.package_gif_preview ? `${outputRoot}/anime-character-preview.gif` : `${outputRoot}/anime-character-preview.gif (not planned)`,
        ...commonFiles,
      ],
      commands: ["Character-first renderer invocation remains behind governed operator approval."],
      approvalRequired: true,
      rollbackAvailable: true,
      dryRunOnly: true,
      warnings: input.form.governance_approval ? [] : ["Manual governance approval is not enabled yet."],
    };
  }

  if (input.action === "micro-sequence") {
    return {
      id: planId,
      title: "Micro-sequence prerequisite diff",
      action: input.action,
      riskLevel: "low",
      summary: `Generate the short continuity prerequisite for ${input.form.duration_seconds}s at ${input.form.resolution}.`,
      plannedMutations: [
        "Create prerequisite PNG frames in the sandbox output path.",
        "Write continuity validation and preview diagnostics.",
        "Expose generated frame references for operator review.",
      ],
      affectedFiles: [
        `${outputRoot}/micro-sequence/*.png`,
        ...commonFiles,
      ],
      commands: ["Micro-sequence generation remains operator-triggered from the existing UI control."],
      approvalRequired: true,
      rollbackAvailable: true,
      dryRunOnly: true,
      warnings: input.form.governance_approval ? [] : ["Manual governance approval is not enabled yet."],
    };
  }

  return {
    id: planId,
    title: "Motion preview render diff",
    action: input.action,
    riskLevel: input.form.package_gif_preview ? "medium" : "low",
    summary: `Generate a bounded motion preview for ${input.form.subject || "the current subject"} at ${input.form.resolution}.`,
    plannedMutations: [
      "Create governed preview PNG frames in the sandbox output path.",
      input.form.package_gif_preview ? "Package preview frames into a GIF artifact." : "Skip GIF packaging for this run.",
      "Write diagnostics, receipt-facing metadata, and an operator summary.",
    ],
    affectedFiles: [
      `${outputRoot}/motion-preview/*.png`,
      input.form.package_gif_preview ? `${outputRoot}/motion-preview.gif` : `${outputRoot}/motion-preview.gif (not planned)`,
      ...commonFiles,
    ],
    commands: ["Motion preview generation remains behind the existing governed runtime action."],
    approvalRequired: true,
    rollbackAvailable: true,
    dryRunOnly: true,
    warnings: input.form.governance_approval ? [] : ["Manual governance approval is not enabled yet."],
  };
}