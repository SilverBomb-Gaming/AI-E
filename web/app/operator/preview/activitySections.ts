import type { CinematicGovernedPreviewDiagnostics } from "@/lib/aie/cinematicProductionMemory";
import type { AnimeCharacterDiagnosticSummary, AnimeCharacterReport } from "@/lib/aie/animeCharacters/governedAnimeCharacterState";

export type ActivityTone = "ok" | "warn" | "blocked" | "info" | "review";

export type ActivityIndicator = {
  label: string;
  tone: ActivityTone;
  summary: string;
  critical: boolean;
};

export function activityIconLabel(tone: ActivityTone): string {
  if (tone === "blocked") {
    return "!";
  }
  if (tone === "warn" || tone === "review") {
    return "*";
  }
  if (tone === "ok") {
    return "OK";
  }
  return "i";
}

export function statusToneFromActivity(tone: ActivityTone): "ok" | "warn" | "blocked" | "default" {
  if (tone === "blocked") {
    return "blocked";
  }
  if (tone === "warn" || tone === "review") {
    return "warn";
  }
  if (tone === "ok") {
    return "ok";
  }
  return "default";
}

export function buildRendererOutputActivity(outputCount: number, diagnostics?: CinematicGovernedPreviewDiagnostics | null): ActivityIndicator {
  const truthCheck = diagnostics?.anime_character_truth_check;
  if (truthCheck?.fallback_primitive_dominance || truthCheck?.scaffold_status === "SCAFFOLD_ACTIVE") {
    return {
      label: "fallback blocked",
      tone: "blocked",
      summary: "Renderer output has scaffold or fallback primitive dominance and cannot be treated as character success.",
      critical: true,
    };
  }
  if (outputCount > 0 && truthCheck?.diagnostics_match_rendered_output) {
    return {
      label: `${outputCount} outputs ready`,
      tone: "ok",
      summary: "Generated renderer outputs are available and diagnostics match the rendered output.",
      critical: false,
    };
  }
  if (outputCount > 0) {
    return {
      label: `${outputCount} outputs pending review`,
      tone: "review",
      summary: "Generated renderer outputs are available and need visual or diagnostic review.",
      critical: false,
    };
  }
  return {
    label: "no output yet",
    tone: "info",
    summary: "No renderer output has been generated for this section yet.",
    critical: false,
  };
}

export function buildAnimeSummaryActivity(summary?: AnimeCharacterDiagnosticSummary | null): ActivityIndicator {
  if (!summary) {
    return {
      label: "idle",
      tone: "info",
      summary: "No anime character report has been generated yet.",
      critical: false,
    };
  }
  if (summary.fallbackPrimitiveDominanceCount > 0 || summary.scaffoldStatus === "SCAFFOLD_ACTIVE") {
    return {
      label: "scaffold/fallback blocked",
      tone: "blocked",
      summary: "Scaffold or fallback primitive activity is present and remains visible while collapsed.",
      critical: true,
    };
  }
  if (summary.failedCharacterCount > 0 || summary.scaffoldStatus === "PARTIAL_REAL_OUTPUT") {
    return {
      label: "warnings",
      tone: "warn",
      summary: "Some character runs failed or only partial real output is active.",
      critical: true,
    };
  }
  if (summary.visualReviewReadyCount > 0) {
    return {
      label: `${summary.visualReviewReadyCount} visual checks ready`,
      tone: "review",
      summary: "New character visual review packages are ready to inspect.",
      critical: false,
    };
  }
  return {
    label: "summary ready",
    tone: "ok",
    summary: "Anime character diagnostic summary is available with no scaffold/fallback dominance.",
    critical: false,
  };
}

export function buildAnimeReportActivity(report: AnimeCharacterReport): ActivityIndicator {
  if (report.truthCheck.fallback_primitive_dominance || report.scaffoldStatus === "SCAFFOLD_ACTIVE") {
    return {
      label: "fallback/scaffold",
      tone: "blocked",
      summary: report.failureReason ?? "This character report is blocked by scaffold or fallback primitive activity.",
      critical: true,
    };
  }
  if (!report.pass) {
    return {
      label: "failed validation",
      tone: "blocked",
      summary: report.failureReason ?? "This character report failed validation.",
      critical: true,
    };
  }
  if (report.visualReviewPackage?.reviewLabel === "USER_VISUAL_CHECK_READY") {
    return {
      label: "review ready",
      tone: "review",
      summary: "Visual review package is ready with inspectable PNG/GIF output.",
      critical: false,
    };
  }
  return {
    label: "completed",
    tone: "ok",
    summary: "Character report completed without scaffold or fallback dominance.",
    critical: false,
  };
}

export function buildDiagnosticsActivity(diagnostics?: CinematicGovernedPreviewDiagnostics | null): ActivityIndicator {
  if (!diagnostics) {
    return {
      label: "no diagnostics",
      tone: "info",
      summary: "No diagnostics are available for this section yet.",
      critical: false,
    };
  }
  const rejectedTransitions = [
    diagnostics.rejected_pose_transition_count ?? 0,
    diagnostics.rejected_formation_transition_count ?? 0,
    diagnostics.rejected_staging_transition_count ?? 0,
    diagnostics.rejected_focus_transition_count ?? 0,
    diagnostics.rejected_tension_transition_count ?? 0,
    diagnostics.rejected_momentum_transition_count ?? 0,
    diagnostics.rejected_blend_transition_count ?? 0,
    diagnostics.rejected_cohesion_transition_count ?? 0,
  ].reduce((sum, value) => sum + value, 0);
  if (diagnostics.anime_character_truth_check?.fallback_primitive_dominance) {
    return {
      label: "diagnostic fallback",
      tone: "blocked",
      summary: "Diagnostics identify fallback primitive dominance; this warning remains visible while collapsed.",
      critical: true,
    };
  }
  if (rejectedTransitions > 0 || diagnostics.rollback_integrity_status === "WATCH") {
    return {
      label: "diagnostic warnings",
      tone: "warn",
      summary: `${rejectedTransitions} rejected transitions or rollback integrity warnings require review.`,
      critical: true,
    };
  }
  return {
    label: "new diagnostics",
    tone: "ok",
    summary: "Diagnostics are available with no critical rollback or transition warnings.",
    critical: false,
  };
}
