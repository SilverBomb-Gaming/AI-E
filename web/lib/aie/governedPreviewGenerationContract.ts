export const GOVERNED_PREVIEW_MAX_DURATION_SECONDS = 2;
export const GOVERNED_PREVIEW_MIN_DURATION_SECONDS = 1;
export const GOVERNED_PREVIEW_RESOLUTION = "720p" as const;

export type GovernedPreviewResolution = typeof GOVERNED_PREVIEW_RESOLUTION;
export type GovernedPreviewDurationSeconds = 1 | 2;
export type GovernedPreviewContinuityPriority = "low" | "medium" | "high";

export type GovernedPreviewFormInput = {
  prompt: string;
  subject: string;
  motion_intent: string;
  style: string;
  duration_seconds: number;
  resolution: string;
  continuity_priority: GovernedPreviewContinuityPriority;
  governance_approval: boolean;
};

export type GovernedPreviewRequest = {
  request_id: string;
  created_at: string;
  prompt: string;
  subject: string;
  motion_intent: string;
  style: string;
  compiled_prompt: string;
  duration_seconds: GovernedPreviewDurationSeconds;
  resolution: GovernedPreviewResolution;
  continuity_priority: GovernedPreviewContinuityPriority;
  manual_approval_required: true;
  manual_approval_granted: boolean;
  sandbox_output_only: true;
  rollback_enabled: true;
  autonomous_continuation_allowed: false;
  governance_constraints: string[];
  compiler_notes: string[];
  blockers: string[];
};

export type GovernedPreviewExecutionStatus = "accepted" | "blocked";

function clampDurationSeconds(value: number): GovernedPreviewDurationSeconds {
  if (!Number.isFinite(value)) {
    return GOVERNED_PREVIEW_MAX_DURATION_SECONDS;
  }

  if (value <= GOVERNED_PREVIEW_MIN_DURATION_SECONDS) {
    return GOVERNED_PREVIEW_MIN_DURATION_SECONDS;
  }

  return GOVERNED_PREVIEW_MAX_DURATION_SECONDS;
}

function normalizeText(value: string, fallback: string): string {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
}

function buildCompiledPrompt(input: {
  prompt: string;
  subject: string;
  motionIntent: string;
  style: string;
  durationSeconds: GovernedPreviewDurationSeconds;
  continuityPriority: GovernedPreviewContinuityPriority;
}): string {
  return [
    input.prompt,
    `Subject: ${input.subject}`,
    `Motion intent: ${input.motionIntent}`,
    `Style: ${input.style}`,
    `Governed preview duration: ${input.durationSeconds}s`,
    `Continuity priority: ${input.continuityPriority}`,
    "Governance: manual approval required, sandbox output only, rollback enabled, no autonomous continuation.",
  ].join("\n");
}

export function compileGovernedPreviewRequest(input: GovernedPreviewFormInput): GovernedPreviewRequest {
  const compilerNotes: string[] = [];
  const blockers: string[] = [];
  const durationSeconds = clampDurationSeconds(input.duration_seconds);
  if (!Number.isFinite(input.duration_seconds) || durationSeconds !== input.duration_seconds) {
    compilerNotes.push(`Duration adjusted to governed preview bound of ${durationSeconds}s.`);
  }

  if (input.resolution !== GOVERNED_PREVIEW_RESOLUTION) {
    compilerNotes.push(`Resolution forced to governed low-resolution cap of ${GOVERNED_PREVIEW_RESOLUTION}.`);
  }

  const prompt = input.prompt.trim();
  if (prompt.length === 0) {
    blockers.push("Prompt is required before preview generation can start.");
  }
  if (!input.governance_approval) {
    blockers.push("Manual governance approval is required for governed preview generation.");
  }

  const subject = normalizeText(input.subject, "unspecified subject");
  const motionIntent = normalizeText(input.motion_intent, "bounded preview motion");
  const style = normalizeText(input.style, "governed preview style");
  const createdAt = new Date().toISOString();

  return {
    request_id: `governed-preview-${createdAt.replace(/[:.]/g, "-")}`,
    created_at: createdAt,
    prompt,
    subject,
    motion_intent: motionIntent,
    style,
    compiled_prompt: buildCompiledPrompt({
      prompt,
      subject,
      motionIntent,
      style,
      durationSeconds,
      continuityPriority: input.continuity_priority,
    }),
    duration_seconds: durationSeconds,
    resolution: GOVERNED_PREVIEW_RESOLUTION,
    continuity_priority: input.continuity_priority,
    manual_approval_required: true,
    manual_approval_granted: input.governance_approval,
    sandbox_output_only: true,
    rollback_enabled: true,
    autonomous_continuation_allowed: false,
    governance_constraints: [
      "Low-duration preview only.",
      "Low-resolution only.",
      "Manual approval required.",
      "Sandbox output only.",
      "Rollback enabled.",
      "No autonomous continuation.",
    ],
    compiler_notes: compilerNotes,
    blockers,
  };
}