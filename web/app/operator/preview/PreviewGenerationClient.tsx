"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition, type ReactNode, type RefObject } from "react";

import {
  GOVERNED_PREVIEW_RESOLUTION,
  type GovernedPreviewFormInput,
  type GovernedPreviewRequest,
} from "@/lib/aie/governedPreviewGenerationContract";
import type {
  CinematicGovernedPreviewDiagnostics,
  CinematicGovernedPreviewFrameDiagnostic,
  CinematicGovernedPreviewQualityIndicator,
} from "@/lib/aie/cinematicProductionMemory";
import type {
  GovernedPreviewExecutionResult,
  GovernedPreviewMicroSequenceResult,
  GovernedPreviewPrerequisiteState,
  GovernedPreviewRollbackResult,
} from "@/lib/aie/governedPreviewGeneration";
import type { ApprovedPromptVariant } from "@/lib/aie/promptVariation/approvedPromptVariants";
import type {
  PromptVariationDiagnosticSummary,
  PromptVariationExecutionPlan,
  PromptVariationHarnessState,
  PromptVariationVariantReport,
} from "@/lib/aie/promptVariation/promptVariationHarnessState";
import type { PromptSafetyResult } from "@/lib/aie/promptVariation/promptSafetyClassifier";
import type { ApprovedPromptDomainTemplate } from "@/lib/aie/promptDomains/approvedPromptDomainTemplates";
import type {
  GovernedPromptDomainState,
  PromptDomainDiagnosticSummary,
  PromptDomainExecutionPlan,
  PromptDomainReport,
} from "@/lib/aie/promptDomains/governedPromptDomainRegistry";
import type { ApprovedVisualStyleProfile } from "@/lib/aie/styleProfiles/approvedVisualStyleProfiles";
import type {
  GovernedVisualStyleState,
  VisualStyleDiagnosticSummary,
  VisualStyleExecutionPlan,
  VisualStyleReport,
} from "@/lib/aie/styleProfiles/governedVisualStyleRegistry";
import type {
  GovernedStyleStressState,
  StyleStressDiagnosticSummary,
  StyleStressExecutionPlan,
  StyleStressMatrixCell,
  StyleStressReport,
} from "@/lib/aie/styleStress/governedStyleStressState";
import type {
  GovernedStyleIntensityState,
  StyleDomainIntensityMatrixCell,
  StyleIntensityDiagnosticSummary,
  StyleIntensityExecutionPlan,
  StyleIntensityPreset,
  StyleIntensityReport,
} from "@/lib/aie/styleIntensity/governedStyleIntensityState";
import type {
  GovernedHighIntensityState,
  HighIntensityDiagnosticSummary,
  HighIntensityExecutionPlan,
  HighIntensityProbeCell,
  HighIntensityReport,
} from "@/lib/aie/highIntensity/governedHighIntensityState";
import type {
  AnimeCharacterDiagnosticSummary,
  AnimeCharacterExecutionPlan,
  AnimeCharacterExpressionTemplate,
  AnimeCharacterPoseTemplate,
  AnimeCharacterProfile,
  AnimeCharacterReport,
  GovernedAnimeCharacterState,
} from "@/lib/aie/animeCharacters/governedAnimeCharacterState";
import { CHARACTER_PROFILE_SELECTION_REQUIRED, resolveAnimeCharacterProfileForRequest } from "@/lib/aie/animeCharacters/characterFirstExecutionRouter";
import {
  activityIconLabel,
  buildAnimeReportActivity,
  buildAnimeSummaryActivity,
  buildDiagnosticsActivity,
  buildRendererOutputActivity,
  statusToneFromActivity,
  type ActivityIndicator,
} from "./activitySections";
import {
  INITIAL_GUIDED_WORKFLOW_STATE,
  advanceGuidedWorkflow,
  buildGuidedWorkflowSteps,
  evaluateFinalOperatorVerdict,
  getGuidedStepTarget,
  resolveGuidedStepNavigationTarget,
  type FinalOperatorVerdict,
  type GuidedWorkflowFacts,
  type GuidedWorkflowSectionId,
  type GuidedWorkflowState,
  type GuidedWorkflowStepId,
  type GuidedWorkflowStepView,
} from "./guidedWorkflow";
import {
  INITIAL_GOVERNED_EXECUTION_STATE,
  advanceGovernedExecutionPhase,
  buildGovernedExecutionTimeline,
  completeGovernedExecution,
  completeGovernedRollback,
  failGovernedExecution,
  getGovernedExecutionPhaseLabel,
  getGovernedExecutionPhaseTone,
  isGovernedExecutionLocked,
  startGovernedExecution,
  type GovernedExecutionAction,
  type GovernedExecutionPhase,
  type GovernedExecutionState,
  type GovernedExecutionTimelineItem,
} from "./governedExecutionState";

const DEFAULT_FORM: GovernedPreviewFormInput = {
  prompt: "",
  subject: "",
  motion_intent: "",
  style: "",
  duration_seconds: 2,
  resolution: GOVERNED_PREVIEW_RESOLUTION,
  continuity_priority: "medium",
  governance_approval: false,
  package_gif_preview: true,
};

type PreviewGalleryCard = {
  id: string;
  label: string;
  source: "micro-sequence" | "motion-preview" | "anime-character";
  format: "png" | "gif";
  assetPath: string;
  assetUrl: string;
  frameIndex: number | null;
  diagnostic: CinematicGovernedPreviewFrameDiagnostic | null;
};

type PromptVariationPayload = {
  variants: ApprovedPromptVariant[];
  executionPlan: PromptVariationExecutionPlan;
  unsafePromptExample: string;
};

type PromptDomainPayload = {
  domains: ApprovedPromptDomainTemplate[];
  executionPlan: PromptDomainExecutionPlan;
  unsafePromptExample: string;
};

type VisualStylePayload = {
  styles: ApprovedVisualStyleProfile[];
  executionPlan: VisualStyleExecutionPlan;
};

type StyleStressPayload = {
  cells: StyleStressMatrixCell[];
  starterCells: StyleStressMatrixCell[];
  executionPlan: StyleStressExecutionPlan;
};

type StyleIntensityPayload = {
  presets: StyleIntensityPreset[];
  cells: StyleDomainIntensityMatrixCell[];
  starterCells: StyleDomainIntensityMatrixCell[];
  highProbeCells: StyleDomainIntensityMatrixCell[];
  executionPlan: StyleIntensityExecutionPlan;
};

type HighIntensityPayload = {
  probes: HighIntensityProbeCell[];
  executionPlan: HighIntensityExecutionPlan;
};

type AnimeCharacterPayload = {
  profiles: AnimeCharacterProfile[];
  poseTemplates: AnimeCharacterPoseTemplate[];
  expressionTemplates: AnimeCharacterExpressionTemplate[];
  executionPlan: AnimeCharacterExecutionPlan;
};

type PreviewGenerationBootstrapPayload = {
  error?: string;
  prerequisiteState?: GovernedPreviewPrerequisiteState;
  promptVariation?: PromptVariationPayload;
  promptDomain?: PromptDomainPayload;
  visualStyle?: VisualStylePayload;
  styleStress?: StyleStressPayload;
  styleIntensity?: StyleIntensityPayload;
  highIntensity?: HighIntensityPayload;
  animeCharacters?: AnimeCharacterPayload;
};

type PromptVariationClassificationPayload = {
  error?: string;
  safety?: PromptSafetyResult;
  promptVariation?: PromptVariationPayload;
};

type PromptDomainClassificationPayload = {
  error?: string;
  safety?: PromptSafetyResult;
  promptDomain?: PromptDomainPayload;
};

type PromptVariationRunPayload = {
  error?: string;
  compiledRequest?: GovernedPreviewRequest;
  report?: PromptVariationVariantReport;
  reports?: PromptVariationVariantReport[];
  reportSummary?: PromptVariationDiagnosticSummary;
  harnessState?: PromptVariationHarnessState | null;
  prerequisiteState?: GovernedPreviewPrerequisiteState | null;
  promptVariation?: PromptVariationPayload;
};

type PromptDomainRunPayload = {
  error?: string;
  compiledRequest?: GovernedPreviewRequest;
  report?: PromptDomainReport;
  reports?: PromptDomainReport[];
  reportSummary?: PromptDomainDiagnosticSummary;
  harnessState?: GovernedPromptDomainState | null;
  prerequisiteState?: GovernedPreviewPrerequisiteState | null;
  promptDomain?: PromptDomainPayload;
};

type VisualStyleRunPayload = {
  error?: string;
  compiledRequest?: GovernedPreviewRequest;
  report?: VisualStyleReport;
  reports?: VisualStyleReport[];
  reportSummary?: VisualStyleDiagnosticSummary;
  harnessState?: GovernedVisualStyleState | null;
  prerequisiteState?: GovernedPreviewPrerequisiteState | null;
  visualStyle?: VisualStylePayload;
};

type StyleStressRunPayload = {
  error?: string;
  compiledRequest?: GovernedPreviewRequest;
  report?: StyleStressReport;
  reports?: StyleStressReport[];
  reportSummary?: StyleStressDiagnosticSummary;
  harnessState?: GovernedStyleStressState | null;
  prerequisiteState?: GovernedPreviewPrerequisiteState | null;
  styleStress?: StyleStressPayload;
};

type StyleIntensityRunPayload = {
  error?: string;
  compiledRequest?: GovernedPreviewRequest;
  report?: StyleIntensityReport;
  reports?: StyleIntensityReport[];
  reportSummary?: StyleIntensityDiagnosticSummary;
  harnessState?: GovernedStyleIntensityState | null;
  prerequisiteState?: GovernedPreviewPrerequisiteState | null;
  styleIntensity?: StyleIntensityPayload;
};

type HighIntensityRunPayload = {
  error?: string;
  compiledRequest?: GovernedPreviewRequest;
  report?: HighIntensityReport;
  reports?: HighIntensityReport[];
  reportSummary?: HighIntensityDiagnosticSummary;
  harnessState?: GovernedHighIntensityState | null;
  prerequisiteState?: GovernedPreviewPrerequisiteState | null;
  highIntensity?: HighIntensityPayload;
};

type AnimeCharacterRunPayload = {
  error?: string;
  compiledRequest?: GovernedPreviewRequest;
  report?: AnimeCharacterReport;
  reports?: AnimeCharacterReport[];
  reportSummary?: AnimeCharacterDiagnosticSummary;
  harnessState?: GovernedAnimeCharacterState | null;
  prerequisiteState?: GovernedPreviewPrerequisiteState | null;
  animeCharacters?: AnimeCharacterPayload;
};

function buildSandboxAssetUrl(assetPath: string): string {
  return `/api/operator/preview-generation/asset?path=${encodeURIComponent(assetPath)}`;
}

function extractFrameIndex(assetPath: string): number | null {
  const match = assetPath.match(/_(\d{3})\.(ppm|png)$/i);
  return match ? Number(match[1]) : null;
}

function buildFrameDiagnosticMap(diagnostics: CinematicGovernedPreviewDiagnostics | null | undefined): Map<number, CinematicGovernedPreviewFrameDiagnostic> {
  return new Map((diagnostics?.frame_diagnostics ?? []).map((entry) => [entry.frame_index, entry]));
}

function buildGalleryCards(
  assetPaths: string[],
  source: PreviewGalleryCard["source"],
  diagnostics?: CinematicGovernedPreviewDiagnostics | null,
): PreviewGalleryCard[] {
  const diagnosticMap = buildFrameDiagnosticMap(diagnostics);
  return assetPaths
    .filter((assetPath) => assetPath.endsWith(".png") || assetPath.endsWith(".gif"))
    .map((assetPath) => {
      const frameIndex = extractFrameIndex(assetPath);
      const format = assetPath.endsWith(".gif") ? "gif" : "png";
      const label = format === "gif"
        ? source === "anime-character"
          ? "Anime character preview GIF"
          : source === "motion-preview"
          ? "Governed motion preview GIF"
          : "Governed micro-sequence GIF"
        : source === "anime-character"
          ? `Anime character frame ${String(frameIndex ?? 1).padStart(3, "0")}`
          : frameIndex !== null
          ? `${source === "motion-preview" ? "Preview" : "Sequence"} frame ${String(frameIndex).padStart(3, "0")}`
          : `${source} preview asset`;

      return {
        id: `${source}-${assetPath}`,
        label,
        source,
        format,
        assetPath,
        assetUrl: buildSandboxAssetUrl(assetPath),
        frameIndex,
        diagnostic: frameIndex !== null ? (diagnosticMap.get(frameIndex) ?? null) : null,
      };
    });
}

function indicatorTone(score: number): "ok" | "warn" | "blocked" {
  if (score >= 88) {
    return "ok";
  }
  if (score >= 76) {
    return "warn";
  }
  return "blocked";
}

function DiagnosticIndicatorCard({ indicator }: { indicator: CinematicGovernedPreviewQualityIndicator }) {
  return (
    <article className="rounded-[1.25rem] border border-ink/10 bg-white/90 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-ink">{indicator.label}</p>
        <StatusPill label={`${indicator.score}/100`} tone={indicatorTone(indicator.score)} />
      </div>
      <p className="mt-3 text-sm leading-7 body-muted">{indicator.summary}</p>
    </article>
  );
}

function DiagnosticsOverview({ diagnostics }: { diagnostics: CinematicGovernedPreviewDiagnostics }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {diagnostics.continuity_quality_indicators.map((indicator) => (
          <DiagnosticIndicatorCard key={indicator.id} indicator={indicator} />
        ))}
      </div>
      <div className="rounded-[1.25rem] border border-ink/10 bg-white/90 p-4 text-sm leading-7 body-muted">
        <p><strong className="text-ink">Recognizable object:</strong> {diagnostics.recognizable_object}</p>
        <p><strong className="text-ink">Relationships:</strong> {diagnostics.object_relationship_summary}</p>
        <p><strong className="text-ink">Environment:</strong> {diagnostics.environment_profile}</p>
        <p><strong className="text-ink">Lighting:</strong> {diagnostics.lighting_profile}</p>
        <p><strong className="text-ink">Beacon influence:</strong> {diagnostics.beacon_influence_summary}</p>
        <p><strong className="text-ink">Environmental response:</strong> {diagnostics.environmental_response_summary}</p>
        <p><strong className="text-ink">Reflection and shadow:</strong> {diagnostics.reflection_shadow_summary}</p>
        <p><strong className="text-ink">Believability:</strong> {diagnostics.scene_believability_summary}</p>
        {diagnostics.shot_engine_summary ? <p><strong className="text-ink">Shot engine:</strong> {diagnostics.shot_engine_summary}</p> : null}
        {diagnostics.camera_governance_summary ? <p><strong className="text-ink">Camera governance:</strong> {diagnostics.camera_governance_summary}</p> : null}
        {diagnostics.articulated_entity_summary ? <p><strong className="text-ink">Articulated entity:</strong> {diagnostics.articulated_entity_summary}</p> : null}
        {diagnostics.pose_governance_summary ? <p><strong className="text-ink">Pose governance:</strong> {diagnostics.pose_governance_summary}</p> : null}
        {diagnostics.multi_entity_choreography_summary ? <p><strong className="text-ink">Multi-entity choreography:</strong> {diagnostics.multi_entity_choreography_summary}</p> : null}
        {diagnostics.spacing_governance_summary ? <p><strong className="text-ink">Spacing governance:</strong> {diagnostics.spacing_governance_summary}</p> : null}
        {diagnostics.cinematic_staging_summary ? <p><strong className="text-ink">Cinematic staging:</strong> {diagnostics.cinematic_staging_summary}</p> : null}
        {diagnostics.cinematic_focus_flow_summary ? <p><strong className="text-ink">Cinematic focus flow:</strong> {diagnostics.cinematic_focus_flow_summary}</p> : null}
        {diagnostics.cinematic_tension_curve_summary ? <p><strong className="text-ink">Cinematic tension curve:</strong> {diagnostics.cinematic_tension_curve_summary}</p> : null}
        {diagnostics.cinematic_momentum_flow_summary ? <p><strong className="text-ink">Cinematic momentum flow:</strong> {diagnostics.cinematic_momentum_flow_summary}</p> : null}
        {diagnostics.cinematic_transition_blend_summary ? <p><strong className="text-ink">Cinematic transition blend:</strong> {diagnostics.cinematic_transition_blend_summary}</p> : null}
        {diagnostics.cinematic_scene_cohesion_summary ? <p><strong className="text-ink">Cinematic scene cohesion:</strong> {diagnostics.cinematic_scene_cohesion_summary}</p> : null}
        {diagnostics.active_entity_type ? <p><strong className="text-ink">Entity type:</strong> {diagnostics.active_entity_type}</p> : null}
        {diagnostics.active_formation_type ? <p><strong className="text-ink">Active formation:</strong> {diagnostics.active_formation_type}</p> : null}
        {diagnostics.active_beat_type ? <p><strong className="text-ink">Active beat:</strong> {diagnostics.active_beat_type}</p> : null}
        {diagnostics.active_focus_subject ? <p><strong className="text-ink">Active focus subject:</strong> {diagnostics.active_focus_subject}</p> : null}
        {diagnostics.previous_focus_subject ? <p><strong className="text-ink">Previous focus subject:</strong> {diagnostics.previous_focus_subject}</p> : null}
        {diagnostics.active_tension_phase ? <p><strong className="text-ink">Active tension phase:</strong> {diagnostics.active_tension_phase}</p> : null}
        {diagnostics.active_momentum_phase ? <p><strong className="text-ink">Active momentum phase:</strong> {diagnostics.active_momentum_phase}</p> : null}
        {diagnostics.active_blend_phase ? <p><strong className="text-ink">Active blend phase:</strong> {diagnostics.active_blend_phase}</p> : null}
        {diagnostics.active_scene_identity ? <p><strong className="text-ink">Active scene identity:</strong> {diagnostics.active_scene_identity}</p> : null}
        {diagnostics.from_beat ? <p><strong className="text-ink">From beat:</strong> {diagnostics.from_beat}</p> : null}
        {diagnostics.to_beat ? <p><strong className="text-ink">To beat:</strong> {diagnostics.to_beat}</p> : null}
        {diagnostics.focus_subject ? <p><strong className="text-ink">Focus subject:</strong> {diagnostics.focus_subject}</p> : null}
        {typeof diagnostics.focus_transition_phase === "number" ? <p><strong className="text-ink">Focus transition phase:</strong> {diagnostics.focus_transition_phase.toFixed(2)}</p> : null}
        {typeof diagnostics.focus_priority_score === "number" ? <p><strong className="text-ink">Focus priority:</strong> {diagnostics.focus_priority_score}/100</p> : null}
        {typeof diagnostics.focus_continuity_score === "number" ? <p><strong className="text-ink">Focus continuity:</strong> {diagnostics.focus_continuity_score}/100</p> : null}
        {typeof diagnostics.subject_readability_score === "number" ? <p><strong className="text-ink">Subject readability:</strong> {diagnostics.subject_readability_score}/100</p> : null}
        {typeof diagnostics.reveal_focus_preservation_score === "number" ? <p><strong className="text-ink">Reveal focus preservation:</strong> {diagnostics.reveal_focus_preservation_score}/100</p> : null}
        {typeof diagnostics.drone_response_focus_score === "number" ? <p><strong className="text-ink">Drone response focus:</strong> {diagnostics.drone_response_focus_score}/100</p> : null}
        {typeof diagnostics.aftermath_focus_balance_score === "number" ? <p><strong className="text-ink">Aftermath focus balance:</strong> {diagnostics.aftermath_focus_balance_score}/100</p> : null}
        {typeof diagnostics.focus_camera_compatibility_score === "number" ? <p><strong className="text-ink">Focus-camera compatibility:</strong> {diagnostics.focus_camera_compatibility_score}/100</p> : null}
        {typeof diagnostics.tension_intensity === "number" ? <p><strong className="text-ink">Tension intensity:</strong> {diagnostics.tension_intensity.toFixed(2)}</p> : null}
        {typeof diagnostics.escalation_rate === "number" ? <p><strong className="text-ink">Escalation rate:</strong> {diagnostics.escalation_rate.toFixed(2)}</p> : null}
        {typeof diagnostics.release_rate === "number" ? <p><strong className="text-ink">Release rate:</strong> {diagnostics.release_rate.toFixed(2)}</p> : null}
        {typeof diagnostics.tension_continuity_score === "number" ? <p><strong className="text-ink">Tension continuity:</strong> {diagnostics.tension_continuity_score}/100</p> : null}
        {typeof diagnostics.tension_readability_score === "number" ? <p><strong className="text-ink">Tension readability:</strong> {diagnostics.tension_readability_score}/100</p> : null}
        {typeof diagnostics.reveal_peak_preservation_score === "number" ? <p><strong className="text-ink">Reveal peak preservation:</strong> {diagnostics.reveal_peak_preservation_score}/100</p> : null}
        {typeof diagnostics.decay_stability_score === "number" ? <p><strong className="text-ink">Decay stability:</strong> {diagnostics.decay_stability_score}/100</p> : null}
        {typeof diagnostics.tension_focus_compatibility_score === "number" ? <p><strong className="text-ink">Tension-focus compatibility:</strong> {diagnostics.tension_focus_compatibility_score}/100</p> : null}
        {typeof diagnostics.tension_camera_compatibility_score === "number" ? <p><strong className="text-ink">Tension-camera compatibility:</strong> {diagnostics.tension_camera_compatibility_score}/100</p> : null}
        {typeof diagnostics.momentum_intensity === "number" ? <p><strong className="text-ink">Momentum intensity:</strong> {diagnostics.momentum_intensity.toFixed(2)}</p> : null}
        {typeof diagnostics.propagation_rate === "number" ? <p><strong className="text-ink">Propagation rate:</strong> {diagnostics.propagation_rate.toFixed(2)}</p> : null}
        {typeof diagnostics.stabilization_rate === "number" ? <p><strong className="text-ink">Stabilization rate:</strong> {diagnostics.stabilization_rate.toFixed(2)}</p> : null}
        {typeof diagnostics.momentum_continuity_score === "number" ? <p><strong className="text-ink">Momentum continuity:</strong> {diagnostics.momentum_continuity_score}/100</p> : null}
        {typeof diagnostics.momentum_readability_score === "number" ? <p><strong className="text-ink">Momentum readability:</strong> {diagnostics.momentum_readability_score}/100</p> : null}
        {typeof diagnostics.reveal_propagation_score === "number" ? <p><strong className="text-ink">Reveal propagation:</strong> {diagnostics.reveal_propagation_score}/100</p> : null}
        {typeof diagnostics.reaction_carryover_score === "number" ? <p><strong className="text-ink">Reaction carryover:</strong> {diagnostics.reaction_carryover_score}/100</p> : null}
        {typeof diagnostics.decay_inertia_score === "number" ? <p><strong className="text-ink">Decay inertia:</strong> {diagnostics.decay_inertia_score}/100</p> : null}
        {typeof diagnostics.momentum_camera_compatibility_score === "number" ? <p><strong className="text-ink">Momentum-camera compatibility:</strong> {diagnostics.momentum_camera_compatibility_score}/100</p> : null}
        {typeof diagnostics.blend_progress === "number" ? <p><strong className="text-ink">Blend progress:</strong> {diagnostics.blend_progress.toFixed(2)}</p> : null}
        {typeof diagnostics.blend_weight === "number" ? <p><strong className="text-ink">Blend weight:</strong> {diagnostics.blend_weight.toFixed(2)}</p> : null}
        {typeof diagnostics.transition_smoothness_score === "number" ? <p><strong className="text-ink">Transition smoothness:</strong> {diagnostics.transition_smoothness_score}/100</p> : null}
        {typeof diagnostics.visual_continuity_score === "number" ? <p><strong className="text-ink">Visual continuity:</strong> {diagnostics.visual_continuity_score}/100</p> : null}
        {typeof diagnostics.reveal_transition_preservation_score === "number" ? <p><strong className="text-ink">Reveal transition preservation:</strong> {diagnostics.reveal_transition_preservation_score}/100</p> : null}
        {typeof diagnostics.response_to_aftermath_score === "number" ? <p><strong className="text-ink">Response to aftermath:</strong> {diagnostics.response_to_aftermath_score}/100</p> : null}
        {typeof diagnostics.settle_blend_stability_score === "number" ? <p><strong className="text-ink">Settle blend stability:</strong> {diagnostics.settle_blend_stability_score}/100</p> : null}
        {typeof diagnostics.blend_camera_compatibility_score === "number" ? <p><strong className="text-ink">Blend-camera compatibility:</strong> {diagnostics.blend_camera_compatibility_score}/100</p> : null}
        {typeof diagnostics.cohesion_weight === "number" ? <p><strong className="text-ink">Cohesion weight:</strong> {diagnostics.cohesion_weight.toFixed(2)}</p> : null}
        {typeof diagnostics.visual_language_score === "number" ? <p><strong className="text-ink">Visual language:</strong> {diagnostics.visual_language_score}/100</p> : null}
        {typeof diagnostics.phrase_continuity_score === "number" ? <p><strong className="text-ink">Phrase continuity:</strong> {diagnostics.phrase_continuity_score}/100</p> : null}
        {typeof diagnostics.scene_cohesion_score === "number" ? <p><strong className="text-ink">Scene cohesion:</strong> {diagnostics.scene_cohesion_score}/100</p> : null}
        {typeof diagnostics.environment_identity_score === "number" ? <p><strong className="text-ink">Environment identity:</strong> {diagnostics.environment_identity_score}/100</p> : null}
        {typeof diagnostics.formation_identity_score === "number" ? <p><strong className="text-ink">Formation identity:</strong> {diagnostics.formation_identity_score}/100</p> : null}
        {typeof diagnostics.final_composition_score === "number" ? <p><strong className="text-ink">Final composition:</strong> {diagnostics.final_composition_score}/100</p> : null}
        {typeof diagnostics.cohesion_camera_compatibility_score === "number" ? <p><strong className="text-ink">Cohesion-camera compatibility:</strong> {diagnostics.cohesion_camera_compatibility_score}/100</p> : null}
        {typeof diagnostics.beat_phase === "number" ? <p><strong className="text-ink">Beat phase:</strong> {diagnostics.beat_phase.toFixed(2)}</p> : null}
        {typeof diagnostics.staging_intensity === "number" ? <p><strong className="text-ink">Staging intensity:</strong> {diagnostics.staging_intensity.toFixed(2)}</p> : null}
        {typeof diagnostics.entity_count === "number" ? <p><strong className="text-ink">Entity count:</strong> {diagnostics.entity_count}</p> : null}
        {diagnostics.entity_ids?.length ? <p><strong className="text-ink">Entity IDs:</strong> {diagnostics.entity_ids.join(", ")}</p> : null}
        {typeof diagnostics.joint_count === "number" ? <p><strong className="text-ink">Joint count:</strong> {diagnostics.joint_count}</p> : null}
        {typeof diagnostics.max_chain_depth === "number" ? <p><strong className="text-ink">Max chain depth:</strong> {diagnostics.max_chain_depth}</p> : null}
        {typeof diagnostics.joint_continuity_score === "number" ? <p><strong className="text-ink">Joint continuity:</strong> {diagnostics.joint_continuity_score}/100</p> : null}
        {typeof diagnostics.pose_stability_score === "number" ? <p><strong className="text-ink">Pose stability:</strong> {diagnostics.pose_stability_score}/100</p> : null}
        {typeof diagnostics.silhouette_readability_score === "number" ? <p><strong className="text-ink">Silhouette readability:</strong> {diagnostics.silhouette_readability_score}/100</p> : null}
        {typeof diagnostics.entity_spatial_persistence_score === "number" ? <p><strong className="text-ink">Entity spatial persistence:</strong> {diagnostics.entity_spatial_persistence_score}/100</p> : null}
        {typeof diagnostics.entity_camera_framing_compatibility_score === "number" ? <p><strong className="text-ink">Entity-camera framing:</strong> {diagnostics.entity_camera_framing_compatibility_score}/100</p> : null}
        {typeof diagnostics.rejected_pose_transition_count === "number" ? <p><strong className="text-ink">Rejected pose transitions:</strong> {diagnostics.rejected_pose_transition_count}</p> : null}
        {typeof diagnostics.entity_separation_score === "number" ? <p><strong className="text-ink">Entity separation:</strong> {diagnostics.entity_separation_score}/100</p> : null}
        {typeof diagnostics.formation_stability_score === "number" ? <p><strong className="text-ink">Formation stability:</strong> {diagnostics.formation_stability_score}/100</p> : null}
        {typeof diagnostics.multi_entity_silhouette_score === "number" ? <p><strong className="text-ink">Multi-entity silhouette:</strong> {diagnostics.multi_entity_silhouette_score}/100</p> : null}
        {typeof diagnostics.choreography_continuity_score === "number" ? <p><strong className="text-ink">Choreography continuity:</strong> {diagnostics.choreography_continuity_score}/100</p> : null}
        {typeof diagnostics.group_spatial_persistence_score === "number" ? <p><strong className="text-ink">Group spatial persistence:</strong> {diagnostics.group_spatial_persistence_score}/100</p> : null}
        {typeof diagnostics.rejected_formation_transition_count === "number" ? <p><strong className="text-ink">Rejected formation transitions:</strong> {diagnostics.rejected_formation_transition_count}</p> : null}
        {typeof diagnostics.rollback_restored_formation === "boolean" ? <p><strong className="text-ink">Rollback restored formation:</strong> {diagnostics.rollback_restored_formation ? "yes" : "no"}</p> : null}
        {typeof diagnostics.emphasis_score === "number" ? <p><strong className="text-ink">Emphasis score:</strong> {diagnostics.emphasis_score}/100</p> : null}
        {typeof diagnostics.beat_readability_score === "number" ? <p><strong className="text-ink">Beat readability:</strong> {diagnostics.beat_readability_score}/100</p> : null}
        {typeof diagnostics.focus_persistence_score === "number" ? <p><strong className="text-ink">Focus persistence:</strong> {diagnostics.focus_persistence_score}/100</p> : null}
        {typeof diagnostics.event_focus_alignment_score === "number" ? <p><strong className="text-ink">Event focus alignment:</strong> {diagnostics.event_focus_alignment_score}/100</p> : null}
        {typeof diagnostics.staging_camera_compatibility_score === "number" ? <p><strong className="text-ink">Staging-camera compatibility:</strong> {diagnostics.staging_camera_compatibility_score}/100</p> : null}
        {typeof diagnostics.reaction_continuity_score === "number" ? <p><strong className="text-ink">Reaction continuity:</strong> {diagnostics.reaction_continuity_score}/100</p> : null}
        {typeof diagnostics.event_causality_score === "number" ? <p><strong className="text-ink">Event causality:</strong> {diagnostics.event_causality_score}/100</p> : null}
        {typeof diagnostics.camera_event_framing_score === "number" ? <p><strong className="text-ink">Camera event framing:</strong> {diagnostics.camera_event_framing_score}/100</p> : null}
        {typeof diagnostics.rejected_staging_transition_count === "number" ? <p><strong className="text-ink">Rejected staging transitions:</strong> {diagnostics.rejected_staging_transition_count}</p> : null}
        {typeof diagnostics.rejected_focus_transition_count === "number" ? <p><strong className="text-ink">Rejected focus transitions:</strong> {diagnostics.rejected_focus_transition_count}</p> : null}
        {typeof diagnostics.rejected_tension_transition_count === "number" ? <p><strong className="text-ink">Rejected tension transitions:</strong> {diagnostics.rejected_tension_transition_count}</p> : null}
        {typeof diagnostics.rejected_momentum_transition_count === "number" ? <p><strong className="text-ink">Rejected momentum transitions:</strong> {diagnostics.rejected_momentum_transition_count}</p> : null}
        {typeof diagnostics.rejected_blend_transition_count === "number" ? <p><strong className="text-ink">Rejected blend transitions:</strong> {diagnostics.rejected_blend_transition_count}</p> : null}
        {typeof diagnostics.rejected_cohesion_transition_count === "number" ? <p><strong className="text-ink">Rejected cohesion transitions:</strong> {diagnostics.rejected_cohesion_transition_count}</p> : null}
        {typeof diagnostics.rollback_restored_staging === "boolean" ? <p><strong className="text-ink">Rollback restored staging:</strong> {diagnostics.rollback_restored_staging ? "yes" : "no"}</p> : null}
        {typeof diagnostics.rollback_restored_focus === "boolean" ? <p><strong className="text-ink">Rollback restored focus:</strong> {diagnostics.rollback_restored_focus ? "yes" : "no"}</p> : null}
        {typeof diagnostics.rollback_restored_tension === "boolean" ? <p><strong className="text-ink">Rollback restored tension:</strong> {diagnostics.rollback_restored_tension ? "yes" : "no"}</p> : null}
        {typeof diagnostics.rollback_restored_momentum === "boolean" ? <p><strong className="text-ink">Rollback restored momentum:</strong> {diagnostics.rollback_restored_momentum ? "yes" : "no"}</p> : null}
        {typeof diagnostics.rollback_restored_blend === "boolean" ? <p><strong className="text-ink">Rollback restored blend:</strong> {diagnostics.rollback_restored_blend ? "yes" : "no"}</p> : null}
        {typeof diagnostics.rollback_restored_cohesion === "boolean" ? <p><strong className="text-ink">Rollback restored cohesion:</strong> {diagnostics.rollback_restored_cohesion ? "yes" : "no"}</p> : null}
        {diagnostics.rollback_integrity_status ? <p><strong className="text-ink">Rollback integrity:</strong> {diagnostics.rollback_integrity_status}</p> : null}
        <p><strong className="text-ink">Camera:</strong> {diagnostics.camera_profile}</p>
        <p><strong className="text-ink">Continuity anchor:</strong> {diagnostics.continuity_anchor_visualization}</p>
        <p><strong className="text-ink">Scene overlay:</strong> {diagnostics.scene_readability_overlay}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {diagnostics.artifact_diagnostics.map((entry) => (
          <div key={entry} className="rounded-[1rem] border border-ink/10 bg-white/80 px-4 py-3 text-sm leading-7 body-muted">{entry}</div>
        ))}
      </div>
    </div>
  );
}

function CharacterDiagnosticsOverview({ report }: { report: AnimeCharacterReport }) {
  const visualFidelity = report.diagnostics?.anime_visual_fidelity_diagnostics;

  return (
    <div className="mb-4 rounded-[1.25rem] border border-ocean/20 bg-ocean/5 p-4 text-sm leading-7 body-muted">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-semibold text-ink">Character-First Diagnostics</p>
        <StatusPill label={report.truthCheck.renderer_path} tone={report.truthCheck.renderer_path === "CHARACTER_FIRST" ? "ok" : "blocked"} />
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <p><strong className="text-ink">Character Face Readability:</strong> {report.metrics?.characterFaceReadability ?? "not scored"}{report.metrics ? "/100" : ""}</p>
        <p><strong className="text-ink">Character Silhouette:</strong> {report.metrics?.characterSilhouette ?? "not scored"}{report.metrics ? "/100" : ""}</p>
        <p><strong className="text-ink">Pose Readability:</strong> {report.metrics?.characterPoseReadability ?? "not scored"}{report.metrics ? "/100" : ""}</p>
        <p><strong className="text-ink">Anime Style Identity:</strong> {report.metrics?.animeStyleIdentity ?? "not scored"}{report.metrics ? "/100" : ""}</p>
        <p><strong className="text-ink">Character Scene Integration:</strong> {report.metrics?.characterSceneIntegration ?? "not scored"}{report.metrics ? "/100" : ""}</p>
        <p><strong className="text-ink">Character Focus Priority:</strong> {report.metrics?.characterFocusPriority ?? "not scored"}{report.metrics ? "/100" : ""}</p>
        <p><strong className="text-ink">Fallback Primitive Dominance:</strong> {report.truthCheck.fallback_primitive_dominance ? "yes" : "no"}</p>
        <p><strong className="text-ink">Diagnostics Match Rendered Output:</strong> {report.truthCheck.diagnostics_match_rendered_output ? "yes" : "no"}</p>
        <p><strong className="text-ink">Character Pixels Generated:</strong> {report.truthCheck.character_pixels_generated ? "yes" : "no"}</p>
        <p><strong className="text-ink">Character Primary Subject:</strong> {report.truthCheck.character_primary_subject ? "yes" : "no"}</p>
        <p><strong className="text-ink">Scaffold Status:</strong> {report.scaffoldStatus}</p>
        <p><strong className="text-ink">Visual Review:</strong> {report.visualReviewPackage?.reviewLabel ?? "not ready"}</p>
        {visualFidelity ? <p><strong className="text-ink">Visual Fidelity Tier:</strong> {visualFidelity.fidelity_tier}</p> : null}
        {visualFidelity ? <p><strong className="text-ink">Visual Fidelity Score:</strong> {visualFidelity.visual_fidelity_score}/100</p> : null}
        {visualFidelity ? <p><strong className="text-ink">Anime Eye Quality:</strong> {visualFidelity.anime_eye_quality}/100</p> : null}
        {visualFidelity ? <p><strong className="text-ink">Layered Hair Quality:</strong> {visualFidelity.layered_hair_quality}/100</p> : null}
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: string }) {
  return <span className="text-xs uppercase tracking-[0.18em] text-slate">{children}</span>;
}

function StatusPill({ label, tone }: { label: string; tone: "ok" | "warn" | "blocked" | "default" }) {
  const toneClassName = tone === "ok"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : tone === "warn"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : tone === "blocked"
        ? "border-coral/20 bg-coral/10 text-ember"
        : "border-ink/10 bg-white text-ink/75";

  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${toneClassName}`}>{label}</span>;
}

function waitForExecutionPhase(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function createOperatorRequestId(action: GovernedExecutionAction): string {
  return `operator-${action}-${Date.now()}`;
}

function formatExecutionTimestamp(value: number | null): string {
  return value ? new Date(value).toLocaleTimeString() : "not started";
}

function formatArtifactName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function formatBoolean(value: boolean): string {
  return value ? "yes" : "no";
}

function formatDateTime(value: number | null): string {
  return value ? new Date(value).toLocaleString() : "not recorded";
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function actionRenderMode(action: GovernedExecutionAction | null): string {
  return action === "micro-sequence"
    ? "Micro-sequence prerequisite"
    : action === "preview"
      ? "Governed preview render"
      : action === "anime-character-render"
        ? "Anime character render"
        : action === "rollback"
          ? "Rollback cleanup"
          : "No active render";
}

function timelineStatusClass(status: GovernedExecutionTimelineItem["status"]): string {
  return status === "complete"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : status === "active"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : status === "failed" || status === "blocked"
        ? "border-coral/20 bg-coral/10 text-ember"
        : "border-ink/10 bg-white text-ink/70";
}

function ExecutionStatusPanel({ executionState, timeline }: { executionState: GovernedExecutionState; timeline: GovernedExecutionTimelineItem[] }) {
  const phaseTone = getGovernedExecutionPhaseTone(executionState.currentPhase);
  const isActive = isGovernedExecutionLocked(executionState);
  const pngArtifacts = executionState.exportedArtifactPaths.filter((path) => path.toLowerCase().endsWith(".png"));
  const gifArtifacts = executionState.exportedArtifactPaths.filter((path) => path.toLowerCase().endsWith(".gif"));
  const otherArtifacts = executionState.exportedArtifactPaths.filter((path) => !path.toLowerCase().endsWith(".png") && !path.toLowerCase().endsWith(".gif"));

  return (
    <article className={`rounded-[1.25rem] border p-4 ${phaseTone === "blocked" ? "border-coral/20 bg-coral/10" : isActive ? "border-amber-200 bg-amber-50/80" : "border-ink/10 bg-white/85"}`} data-execution-status-panel="true">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="section-label">Execution Status</p>
          <h3 className="mt-2 text-xl font-semibold text-ink">Governed Runtime State</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isActive ? <span aria-label="Processing" className="h-4 w-4 animate-spin rounded-full border-2 border-amber-300 border-t-ocean" /> : null}
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${isActive ? "animate-pulse border-amber-200 bg-amber-50 text-amber-700" : "border-ink/10 bg-white text-ink/70"}`}>
            {isActive ? "processing" : "not processing"}
          </span>
          <StatusPill label={getGovernedExecutionPhaseLabel(executionState.currentPhase)} tone={phaseTone} />
        </div>
      </div>

      <div className="mt-4 grid gap-3 text-sm leading-7 body-muted md:grid-cols-2">
        <p><strong className="text-ink">Current phase:</strong> {getGovernedExecutionPhaseLabel(executionState.currentPhase)}</p>
        <p><strong className="text-ink">Active request:</strong> {executionState.activeRequestId ?? "none"}</p>
        <p><strong className="text-ink">Render mode:</strong> {actionRenderMode(executionState.activeAction)}</p>
        <p><strong className="text-ink">Approval status:</strong> {executionState.waitingForApproval ? "waiting for approval" : executionState.renderRejected ? "rejected" : "approved or not required for idle"}</p>
        <p><strong className="text-ink">Started:</strong> {formatExecutionTimestamp(executionState.executionStartedAt)}</p>
        <p><strong className="text-ink">Finished:</strong> {formatExecutionTimestamp(executionState.executionFinishedAt)}</p>
        <p><strong className="text-ink">GIF packaging:</strong> {executionState.gifPackagingInProgress ? "running" : executionState.gifArtifactPath ? "complete" : "not exported yet"}</p>
        <p><strong className="text-ink">Export status:</strong> {executionState.exportInProgress ? "exporting" : executionState.exportedArtifactPaths.length ? "complete" : "waiting"}</p>
        <p><strong className="text-ink">Rollback state:</strong> {executionState.rollbackInProgress ? "restoring" : executionState.activeAction === "rollback" && executionState.renderCompleted ? "complete" : "idle"}</p>
        <p><strong className="text-ink">Diagnostics:</strong> {executionState.diagnosticsGenerated ? "generated" : "not generated yet"}</p>
      </div>

      <div className="mt-4 rounded-[1rem] border border-ink/10 bg-white/80 p-4 text-sm leading-7 body-muted">
        <p><strong className="text-ink">Estimated current action:</strong> {executionState.statusMessage}</p>
        <p><strong className="text-ink">Next action:</strong> {executionState.nextActionRecommendation}</p>
        {executionState.duplicateClickBlocked ? <p className="mt-2 rounded-[0.75rem] border border-amber-200 bg-amber-50 px-3 py-2 font-semibold text-amber-800">Execution already in progress.</p> : null}
        {executionState.failureReason ? <p className="mt-2 rounded-[0.75rem] border border-coral/20 bg-coral/10 px-3 py-2 font-semibold text-ember">{executionState.failureReason}</p> : null}
      </div>

      {executionState.exportedArtifactPaths.length ? (
        <div className="mt-4 grid gap-3 text-sm leading-7 body-muted md:grid-cols-3">
          <div className="rounded-[1rem] border border-ink/10 bg-white/80 p-4">
            <p className="font-semibold text-ink">PNG</p>
            {pngArtifacts.length ? <ul className="mt-2 space-y-1">{pngArtifacts.map((path) => <li key={path}>{formatArtifactName(path)}</li>)}</ul> : <p className="mt-2">No PNG exported.</p>}
          </div>
          <div className="rounded-[1rem] border border-ink/10 bg-white/80 p-4">
            <p className="font-semibold text-ink">GIF</p>
            {gifArtifacts.length ? <ul className="mt-2 space-y-1">{gifArtifacts.map((path) => <li key={path}>{formatArtifactName(path)}</li>)}</ul> : <p className="mt-2">No GIF exported.</p>}
          </div>
          <div className="rounded-[1rem] border border-ink/10 bg-white/80 p-4">
            <p className="font-semibold text-ink">Sandbox</p>
            <p className="mt-2 break-words">{executionState.sandboxPath ?? "not created"}</p>
            {otherArtifacts.length ? <p className="mt-2 break-words">Other: {otherArtifacts.map(formatArtifactName).join(", ")}</p> : null}
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {timeline.map((item) => (
          <div key={item.id} className={`rounded-[1rem] border px-4 py-3 text-sm leading-6 ${timelineStatusClass(item.status)}`}>
            <div className="flex items-center justify-between gap-3">
              <p className="font-semibold text-ink">{item.label}</p>
              <span className="text-xs uppercase tracking-[0.18em]">{item.status}</span>
            </div>
            <p className="mt-1">{item.detail}</p>
          </div>
        ))}
      </div>
    </article>
  );
}

function CollapsibleActivitySection({
  sectionLabel,
  title,
  activity,
  children,
  defaultOpen,
  className = "",
  sectionDomId,
  guidedStepLabel,
  containsActiveStep = false,
  hasWorkflowWarning = false,
}: {
  sectionLabel: string;
  title: string;
  activity: ActivityIndicator;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  sectionDomId?: string;
  guidedStepLabel?: string;
  containsActiveStep?: boolean;
  hasWorkflowWarning?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen ?? activity.critical);
  useEffect(() => {
    if (containsActiveStep) {
      setIsOpen(true);
    }
  }, [containsActiveStep]);

  const actionLabel = isOpen ? "Collapse" : "Expand";
  const activityLabel = activity.tone === "blocked"
    ? "Failure or block"
    : activity.tone === "warn"
      ? "Warning"
      : activity.tone === "review"
        ? "Needs review"
        : activity.tone === "ok"
          ? "New activity"
          : "Ready";
  const iconClassName = activity.tone === "blocked"
    ? "border-coral/30 bg-coral/10 text-ember"
    : activity.tone === "warn" || activity.tone === "review"
      ? "border-amber-300 bg-amber-50 text-amber-700"
      : activity.tone === "ok"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : "border-ink/10 bg-white text-ink/75";

  return (
    <article id={sectionDomId} tabIndex={sectionDomId ? -1 : undefined} className={`self-start scroll-mt-6 rounded-[1.25rem] border bg-white/90 shadow-float ${containsActiveStep ? "border-ocean/50 ring-2 ring-ocean/15" : hasWorkflowWarning ? "border-amber-300" : "border-ink/15"} ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setIsOpen(false);
          }
        }}
        aria-expanded={isOpen}
        aria-label={`${isOpen ? "Collapse" : "Expand"} ${sectionLabel}${guidedStepLabel ? ` for ${guidedStepLabel}` : ""}`}
        className={`flex w-full flex-col items-start justify-between gap-4 rounded-[1.25rem] border-b border-ink/10 px-5 py-4 text-left transition hover:bg-mist/60 xl:flex-row ${containsActiveStep ? "bg-ocean/5" : "bg-white"}`}
      >
        <span className="flex min-w-0 items-start gap-3">
          <span className={`mt-1 inline-flex h-9 min-w-9 items-center justify-center rounded-full border px-2 text-sm font-bold ${iconClassName}`} aria-hidden="true">
            {activityIconLabel(activity.tone)}
          </span>
          <span className="min-w-0">
            <span className="section-label block">{sectionLabel}</span>
            <span className="mt-2 flex flex-wrap items-center gap-2 text-2xl font-semibold text-ink">
              <span className="text-xl" aria-hidden="true">{isOpen ? "v" : ">"}</span>
              <span>{title}</span>
            </span>
            <span className="mt-2 block text-sm leading-7 body-muted">{activity.summary}</span>
            {guidedStepLabel ? (
              <span className={`mt-3 inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${containsActiveStep ? "border-ocean/30 bg-ocean/10 text-ocean" : hasWorkflowWarning ? "border-amber-300 bg-amber-50 text-amber-700" : "border-ink/10 bg-mist/70 text-ink"}`}>
                {guidedStepLabel}
              </span>
            ) : null}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-start gap-2 xl:items-end">
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${iconClassName}`}>{activityLabel}</span>
          <StatusPill label={activity.label} tone={statusToneFromActivity(activity.tone)} />
          <span className="rounded-full border border-ink/10 bg-mist/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-ink">{actionLabel}</span>
        </span>
      </button>
      {!isOpen && activity.critical ? (
        <div className="mx-6 mb-5 rounded-[1.25rem] border border-coral/20 bg-coral/10 p-4 text-sm leading-7 text-ember">
          {activity.summary}
        </div>
      ) : null}
      {isOpen ? <div className="px-5 pb-5">{children}</div> : null}
    </article>
  );
}

function promptVariationStatusTone(report: PromptVariationVariantReport): "ok" | "warn" | "blocked" {
  if (report.pass) {
    return "ok";
  }
  if (report.safetyStatus === "REJECTED") {
    return "blocked";
  }
  return "warn";
}

function promptDomainStatusTone(report: PromptDomainReport): "ok" | "warn" | "blocked" {
  if (report.pass) {
    return "ok";
  }
  if (report.safetyStatus === "REJECTED") {
    return "blocked";
  }
  return "warn";
}

function visualStyleStatusTone(report: VisualStyleReport): "ok" | "warn" | "blocked" {
  if (report.pass) {
    return "ok";
  }
  if (report.safetyStatus === "REJECTED") {
    return "blocked";
  }
  return "warn";
}

function styleStressStatusTone(report: StyleStressReport): "ok" | "warn" | "blocked" {
  if (report.pass) {
    return "ok";
  }
  if (report.safetyStatus === "REJECTED") {
    return "blocked";
  }
  return "warn";
}

function styleIntensityStatusTone(report: StyleIntensityReport): "ok" | "warn" | "blocked" {
  if (report.pass) {
    return "ok";
  }
  if (report.safetyStatus === "REJECTED") {
    return "blocked";
  }
  return "warn";
}

function highIntensityStatusTone(report: HighIntensityReport): "ok" | "warn" | "blocked" {
  if (report.pass) {
    return "ok";
  }
  if (report.safetyStatus === "REJECTED") {
    return "blocked";
  }
  return "warn";
}

function animeCharacterStatusTone(report: AnimeCharacterReport): "ok" | "warn" | "blocked" {
  if (report.pass) {
    return "ok";
  }
  if (report.safetyStatus === "REJECTED") {
    return "blocked";
  }
  return "warn";
}

function guidedStatusClass(status: string): string {
  if (status === "completed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "warning" || status === "needs review") {
    return "border-amber-300 bg-amber-50 text-amber-700";
  }
  if (status === "failed" || status === "blocked") {
    return "border-coral/20 bg-coral/10 text-ember";
  }
  if (status === "active") {
    return "border-ocean/30 bg-ocean/10 text-ocean";
  }
  return "border-ink/10 bg-white text-ink/75";
}

function verdictClass(verdict: FinalOperatorVerdict): string {
  if (verdict === "PASS") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (verdict === "FAIL") {
    return "border-coral/20 bg-coral/10 text-ember";
  }
  return "border-amber-300 bg-amber-50 text-amber-700";
}

function guidedTargetHighlightClass(isActive: boolean): string {
  return isActive ? "border-ocean/50 bg-ocean/5 ring-4 ring-ocean/15" : "border-ink/10 bg-white/80";
}

function GuidedTargetCallout({ active, label, instruction }: { active: boolean; label: string; instruction: string }) {
  if (!active) {
    return null;
  }
  return (
    <div className="mb-4 rounded-[1rem] border-2 border-ocean/40 bg-ocean/10 p-4 text-sm leading-7 text-ink shadow-sm" role="status">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ocean">{label}</p>
      <p className="mt-2">{instruction}</p>
    </div>
  );
}

function OperatorGuidedWorkflow({
  steps,
  activeStepRef,
  notice,
  finalVerdict,
  subjectStyleConfirmed,
  onSubjectStyleConfirmedChange,
  microSequenceReviewed,
  onMicroSequenceReviewedChange,
  previewOutputReviewed,
  onPreviewOutputReviewedChange,
  diagnosticsReviewed,
  onDiagnosticsReviewedChange,
  finalVisualIntentMatched,
  onFinalVisualIntentMatchedChange,
  finalTruthChecksPassed,
  onFinalTruthChecksPassedChange,
  finalScaffoldFallbackInactive,
  onFinalScaffoldFallbackInactiveChange,
  finalDiagnosticsClear,
  onFinalDiagnosticsClearChange,
  onAdvance,
  onNavigateStep,
}: {
  steps: GuidedWorkflowStepView[];
  activeStepRef: RefObject<HTMLButtonElement>;
  notice: string | null;
  finalVerdict: FinalOperatorVerdict;
  subjectStyleConfirmed: boolean;
  onSubjectStyleConfirmedChange: (value: boolean) => void;
  microSequenceReviewed: boolean;
  onMicroSequenceReviewedChange: (value: boolean) => void;
  previewOutputReviewed: boolean;
  onPreviewOutputReviewedChange: (value: boolean) => void;
  diagnosticsReviewed: boolean;
  onDiagnosticsReviewedChange: (value: boolean) => void;
  finalVisualIntentMatched: boolean;
  onFinalVisualIntentMatchedChange: (value: boolean) => void;
  finalTruthChecksPassed: boolean;
  onFinalTruthChecksPassedChange: (value: boolean) => void;
  finalScaffoldFallbackInactive: boolean;
  onFinalScaffoldFallbackInactiveChange: (value: boolean) => void;
  finalDiagnosticsClear: boolean;
  onFinalDiagnosticsClearChange: (value: boolean) => void;
  onAdvance: () => void;
  onNavigateStep: (stepId: GuidedWorkflowStepId) => void;
}) {
  const activeStep = steps.find((step) => step.isActive) ?? steps[0];
  const activeStepTarget = getGuidedStepTarget(activeStep.id);
  const finalVerdictActive = activeStepTarget.highlightSelector === "[data-guided-highlight='final-verdict']";

  return (
    <section className="mb-6 rounded-[1.25rem] border border-ocean/20 bg-white/95 p-5 shadow-float" aria-label="Operator guided anime preview workflow">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="section-label">Guided Operator Workflow</p>
          <h2 className="mt-3 text-2xl font-semibold text-ink">Anime Preview Task Walkthrough</h2>
          <p className="mt-2 max-w-3xl text-sm leading-7 body-muted">Follow the active step. Press Enter on the highlighted step only after the instruction is satisfied; request accepted is not render success.</p>
        </div>
        <StatusPill label={`Final ${finalVerdict}`} tone={finalVerdict === "PASS" ? "ok" : finalVerdict === "FAIL" ? "blocked" : "warn"} />
      </div>

      <ol className="mt-5 grid gap-3 lg:grid-cols-2">
        {steps.map((step) => (
          <li key={step.id}>
            <button
              type="button"
              ref={step.isActive ? activeStepRef : undefined}
              onClick={() => onNavigateStep(step.id)}
              onKeyDown={(event) => {
                if (step.isActive && event.key === "Enter") {
                  event.preventDefault();
                  onAdvance();
                }
              }}
              aria-current={step.isActive ? "step" : undefined}
              aria-label={`Step ${step.number}: ${step.title}. ${step.status}. ${step.reason}`}
              className={`flex h-full w-full gap-3 rounded-[1rem] border p-4 text-left transition ${step.isActive ? "border-ocean/40 bg-ocean/10 ring-2 ring-ocean/15" : step.hasPersistentWarning ? "border-amber-300 bg-amber-50" : "border-ink/10 bg-mist/50"}`}
            >
              <span className={`flex h-9 min-w-9 items-center justify-center rounded-full border text-sm font-bold ${guidedStatusClass(step.status)}`}>{step.status === "completed" ? "OK" : step.number}</span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-ink">{step.title}</span>
                  <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${guidedStatusClass(step.status)}`}>{step.status}</span>
                </span>
                <span className="mt-2 block text-sm leading-6 body-muted">{step.instruction}</span>
                {step.isActive || step.hasPersistentWarning ? <span className="mt-2 block text-sm leading-6 text-ink">{step.reason}</span> : null}
              </span>
            </button>
          </li>
        ))}
      </ol>

      {notice ? <p className="mt-4 rounded-[1rem] border border-amber-300 bg-amber-50 p-4 text-sm leading-7 text-amber-700">{notice}</p> : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <article className="rounded-[1rem] border border-ink/10 bg-mist/50 p-4">
          <p className="text-sm font-semibold text-ink">Active Step</p>
          <p className="mt-2 text-sm leading-7 body-muted">Step {activeStep.number}: {activeStep.title}</p>
          <p className="mt-2 text-sm leading-7 text-ink">{getGuidedStepTarget(activeStep.id).instruction}</p>
          <button
            type="button"
            onClick={() => onNavigateStep(activeStep.id)}
            className="mt-3 rounded-full border border-ocean/20 bg-ocean px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5"
          >
            Go To Active Step
          </button>
        </article>

        <article
          id="final-verdict-section"
          data-guided-highlight="final-verdict"
          className={`scroll-mt-6 rounded-[1rem] border p-4 ${guidedTargetHighlightClass(finalVerdictActive)}`}
        >
          <GuidedTargetCallout active={finalVerdictActive} label={activeStepTarget.calloutLabel} instruction={activeStepTarget.instruction} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-ink">Final Operator Verdict</p>
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${verdictClass(finalVerdict)}`}>{finalVerdict}</span>
          </div>
          <div className="mt-3 grid gap-3 text-sm leading-6 body-muted md:grid-cols-2">
            <label className="flex items-start gap-2 rounded-[0.75rem] border border-ink/10 bg-mist/40 p-3">
              <input type="checkbox" checked={subjectStyleConfirmed} onChange={(event) => onSubjectStyleConfirmedChange(event.target.checked)} className="mt-1 h-4 w-4" />
              <span>Subject and style alignment confirmed.</span>
            </label>
            <label className="flex items-start gap-2 rounded-[0.75rem] border border-ink/10 bg-mist/40 p-3">
              <input type="checkbox" checked={microSequenceReviewed} onChange={(event) => onMicroSequenceReviewedChange(event.target.checked)} className="mt-1 h-4 w-4" />
              <span>Micro-sequence outputs reviewed.</span>
            </label>
            <label className="flex items-start gap-2 rounded-[0.75rem] border border-ink/10 bg-mist/40 p-3">
              <input type="checkbox" checked={previewOutputReviewed} onChange={(event) => onPreviewOutputReviewedChange(event.target.checked)} className="mt-1 h-4 w-4" />
              <span>Preview outputs reviewed.</span>
            </label>
            <label className="flex items-start gap-2 rounded-[0.75rem] border border-ink/10 bg-mist/40 p-3">
              <input type="checkbox" checked={diagnosticsReviewed} onChange={(event) => onDiagnosticsReviewedChange(event.target.checked)} className="mt-1 h-4 w-4" />
              <span>Diagnostics and rollback warnings reviewed.</span>
            </label>
            <label className="flex items-start gap-2 rounded-[0.75rem] border border-ink/10 bg-mist/40 p-3">
              <input type="checkbox" checked={finalVisualIntentMatched} onChange={(event) => onFinalVisualIntentMatchedChange(event.target.checked)} data-guided-focus="final-verdict-pass" className="mt-1 h-4 w-4" />
              <span>Did visible output match the operator intent?</span>
            </label>
            <label className="flex items-start gap-2 rounded-[0.75rem] border border-ink/10 bg-mist/40 p-3">
              <input type="checkbox" checked={finalTruthChecksPassed} onChange={(event) => onFinalTruthChecksPassedChange(event.target.checked)} className="mt-1 h-4 w-4" />
              <span>Did the truth checks pass?</span>
            </label>
            <label className="flex items-start gap-2 rounded-[0.75rem] border border-ink/10 bg-mist/40 p-3">
              <input type="checkbox" checked={finalScaffoldFallbackInactive} onChange={(event) => onFinalScaffoldFallbackInactiveChange(event.target.checked)} className="mt-1 h-4 w-4" />
              <span>Did scaffold/fallback stay inactive?</span>
            </label>
            <label className="flex items-start gap-2 rounded-[0.75rem] border border-ink/10 bg-mist/40 p-3">
              <input type="checkbox" checked={finalDiagnosticsClear} onChange={(event) => onFinalDiagnosticsClearChange(event.target.checked)} className="mt-1 h-4 w-4" />
              <span>Were diagnostics free of unresolved warnings?</span>
            </label>
          </div>
        </article>
      </div>
    </section>
  );
}

export function PreviewGenerationClient() {
  const [form, setForm] = useState<GovernedPreviewFormInput>(DEFAULT_FORM);
  const [compiledRequest, setCompiledRequest] = useState<GovernedPreviewRequest | null>(null);
  const [execution, setExecution] = useState<GovernedPreviewExecutionResult | null>(null);
  const [microSequence, setMicroSequence] = useState<GovernedPreviewMicroSequenceResult | null>(null);
  const [prerequisiteState, setPrerequisiteState] = useState<GovernedPreviewPrerequisiteState | null>(null);
  const [rollback, setRollback] = useState<GovernedPreviewRollbackResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string>("Governed preview interface ready. Manual approval remains required.");
  const [approvedPromptVariants, setApprovedPromptVariants] = useState<ApprovedPromptVariant[]>([]);
  const [promptVariationPlan, setPromptVariationPlan] = useState<PromptVariationExecutionPlan | null>(null);
  const [selectedPromptVariationId, setSelectedPromptVariationId] = useState<string>("");
  const [promptVariationPrompt, setPromptVariationPrompt] = useState<string>("A humanoid character speaks to the drones in a long dialogue scene.");
  const [promptVariationSafety, setPromptVariationSafety] = useState<PromptSafetyResult | null>(null);
  const [promptVariationReports, setPromptVariationReports] = useState<PromptVariationVariantReport[]>([]);
  const [promptVariationSummary, setPromptVariationSummary] = useState<PromptVariationDiagnosticSummary | null>(null);
  const [promptVariationHarnessState, setPromptVariationHarnessState] = useState<PromptVariationHarnessState | null>(null);
  const [approvedPromptDomains, setApprovedPromptDomains] = useState<ApprovedPromptDomainTemplate[]>([]);
  const [promptDomainPlan, setPromptDomainPlan] = useState<PromptDomainExecutionPlan | null>(null);
  const [selectedPromptDomainId, setSelectedPromptDomainId] = useState<string>("");
  const [promptDomainPrompt, setPromptDomainPrompt] = useState<string>("A human pilot gives spoken orders to armed drones during a long battle sequence.");
  const [promptDomainSafety, setPromptDomainSafety] = useState<PromptSafetyResult | null>(null);
  const [promptDomainReports, setPromptDomainReports] = useState<PromptDomainReport[]>([]);
  const [promptDomainSummary, setPromptDomainSummary] = useState<PromptDomainDiagnosticSummary | null>(null);
  const [promptDomainHarnessState, setPromptDomainHarnessState] = useState<GovernedPromptDomainState | null>(null);
  const [approvedVisualStyles, setApprovedVisualStyles] = useState<ApprovedVisualStyleProfile[]>([]);
  const [visualStylePlan, setVisualStylePlan] = useState<VisualStyleExecutionPlan | null>(null);
  const [selectedVisualStyleId, setSelectedVisualStyleId] = useState<string>("");
  const [visualStyleReports, setVisualStyleReports] = useState<VisualStyleReport[]>([]);
  const [visualStyleSummary, setVisualStyleSummary] = useState<VisualStyleDiagnosticSummary | null>(null);
  const [visualStyleHarnessState, setVisualStyleHarnessState] = useState<GovernedVisualStyleState | null>(null);
  const [approvedStyleStressCells, setApprovedStyleStressCells] = useState<StyleStressMatrixCell[]>([]);
  const [starterStyleStressCells, setStarterStyleStressCells] = useState<StyleStressMatrixCell[]>([]);
  const [styleStressPlan, setStyleStressPlan] = useState<StyleStressExecutionPlan | null>(null);
  const [selectedStyleStressCellId, setSelectedStyleStressCellId] = useState<string>("");
  const [styleStressReports, setStyleStressReports] = useState<StyleStressReport[]>([]);
  const [styleStressSummary, setStyleStressSummary] = useState<StyleStressDiagnosticSummary | null>(null);
  const [styleStressHarnessState, setStyleStressHarnessState] = useState<GovernedStyleStressState | null>(null);
  const [styleIntensityPresets, setStyleIntensityPresets] = useState<StyleIntensityPreset[]>([]);
  const [approvedStyleIntensityCells, setApprovedStyleIntensityCells] = useState<StyleDomainIntensityMatrixCell[]>([]);
  const [starterStyleIntensityCells, setStarterStyleIntensityCells] = useState<StyleDomainIntensityMatrixCell[]>([]);
  const [highProbeStyleIntensityCells, setHighProbeStyleIntensityCells] = useState<StyleDomainIntensityMatrixCell[]>([]);
  const [styleIntensityPlan, setStyleIntensityPlan] = useState<StyleIntensityExecutionPlan | null>(null);
  const [selectedStyleIntensityCellId, setSelectedStyleIntensityCellId] = useState<string>("");
  const [styleIntensityReports, setStyleIntensityReports] = useState<StyleIntensityReport[]>([]);
  const [styleIntensitySummary, setStyleIntensitySummary] = useState<StyleIntensityDiagnosticSummary | null>(null);
  const [styleIntensityHarnessState, setStyleIntensityHarnessState] = useState<GovernedStyleIntensityState | null>(null);
  const [highIntensityApproval, setHighIntensityApproval] = useState<boolean>(false);
  const [approvedHighIntensityProbes, setApprovedHighIntensityProbes] = useState<HighIntensityProbeCell[]>([]);
  const [highIntensityPlan, setHighIntensityPlan] = useState<HighIntensityExecutionPlan | null>(null);
  const [selectedHighIntensityProbeId, setSelectedHighIntensityProbeId] = useState<string>("");
  const [highIntensityReports, setHighIntensityReports] = useState<HighIntensityReport[]>([]);
  const [highIntensitySummary, setHighIntensitySummary] = useState<HighIntensityDiagnosticSummary | null>(null);
  const [highIntensityHarnessState, setHighIntensityHarnessState] = useState<GovernedHighIntensityState | null>(null);
  const [highProbeApproval, setHighProbeApproval] = useState<boolean>(false);
  const [approvedAnimeCharacterProfiles, setApprovedAnimeCharacterProfiles] = useState<AnimeCharacterProfile[]>([]);
  const [animeCharacterPoseTemplates, setAnimeCharacterPoseTemplates] = useState<AnimeCharacterPoseTemplate[]>([]);
  const [animeCharacterExpressionTemplates, setAnimeCharacterExpressionTemplates] = useState<AnimeCharacterExpressionTemplate[]>([]);
  const [animeCharacterPlan, setAnimeCharacterPlan] = useState<AnimeCharacterExecutionPlan | null>(null);
  const [selectedAnimeCharacterProfileId, setSelectedAnimeCharacterProfileId] = useState<string>("");
  const [animeCharacterReports, setAnimeCharacterReports] = useState<AnimeCharacterReport[]>([]);
  const [animeCharacterSummary, setAnimeCharacterSummary] = useState<AnimeCharacterDiagnosticSummary | null>(null);
  const [animeCharacterHarnessState, setAnimeCharacterHarnessState] = useState<GovernedAnimeCharacterState | null>(null);
  const [animeCharacterApproval, setAnimeCharacterApproval] = useState<boolean>(false);
  const [guidedWorkflowState, setGuidedWorkflowState] = useState<GuidedWorkflowState>(INITIAL_GUIDED_WORKFLOW_STATE);
  const [guidedWorkflowNotice, setGuidedWorkflowNotice] = useState<string | null>(null);
  const [activeGuidedTargetStepId, setActiveGuidedTargetStepId] = useState<GuidedWorkflowStepId>(INITIAL_GUIDED_WORKFLOW_STATE.activeStepId);
  const [governedExecutionState, setGovernedExecutionState] = useState<GovernedExecutionState>(INITIAL_GOVERNED_EXECUTION_STATE);
  const [subjectStyleConfirmed, setSubjectStyleConfirmed] = useState<boolean>(false);
  const [microSequenceReviewed, setMicroSequenceReviewed] = useState<boolean>(false);
  const [previewOutputReviewed, setPreviewOutputReviewed] = useState<boolean>(false);
  const [diagnosticsReviewed, setDiagnosticsReviewed] = useState<boolean>(false);
  const [finalVisualIntentMatched, setFinalVisualIntentMatched] = useState<boolean>(false);
  const [finalTruthChecksPassed, setFinalTruthChecksPassed] = useState<boolean>(false);
  const [finalScaffoldFallbackInactive, setFinalScaffoldFallbackInactive] = useState<boolean>(false);
  const [finalDiagnosticsClear, setFinalDiagnosticsClear] = useState<boolean>(false);
  const [forceCharacterControlsOpen, setForceCharacterControlsOpen] = useState<boolean>(false);
  const activeGuidedStepRef = useRef<HTMLButtonElement>(null);
  const executionLockRef = useRef<boolean>(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;

    void fetch("/api/operator/preview-generation", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as PreviewGenerationBootstrapPayload;

        if (!response.ok || !payload.prerequisiteState) {
          throw new Error(payload.error ?? "We couldn't load the governed preview prerequisite state.");
        }

        if (cancelled) {
          return;
        }

        setPrerequisiteState(payload.prerequisiteState);
        setApprovedPromptVariants(payload.promptVariation?.variants ?? []);
        setPromptVariationPlan(payload.promptVariation?.executionPlan ?? null);
        setSelectedPromptVariationId((current) => current || payload.promptVariation?.variants[0]?.id || "");
        if (payload.promptVariation?.unsafePromptExample) {
          setPromptVariationPrompt(payload.promptVariation.unsafePromptExample);
        }
        setApprovedPromptDomains(payload.promptDomain?.domains ?? []);
        setPromptDomainPlan(payload.promptDomain?.executionPlan ?? null);
        setSelectedPromptDomainId((current) => current || payload.promptDomain?.domains[0]?.id || "");
        if (payload.promptDomain?.unsafePromptExample) {
          setPromptDomainPrompt(payload.promptDomain.unsafePromptExample);
        }
        setApprovedVisualStyles(payload.visualStyle?.styles ?? []);
        setVisualStylePlan(payload.visualStyle?.executionPlan ?? null);
        setSelectedVisualStyleId((current) => current || payload.visualStyle?.styles[0]?.id || "");
        setApprovedStyleStressCells(payload.styleStress?.cells ?? []);
        setStarterStyleStressCells(payload.styleStress?.starterCells ?? []);
        setStyleStressPlan(payload.styleStress?.executionPlan ?? null);
        setSelectedStyleStressCellId((current) => current || payload.styleStress?.starterCells[0]?.cellId || payload.styleStress?.cells[0]?.cellId || "");
        setStyleIntensityPresets(payload.styleIntensity?.presets ?? []);
        setApprovedStyleIntensityCells(payload.styleIntensity?.cells ?? []);
        setStarterStyleIntensityCells(payload.styleIntensity?.starterCells ?? []);
        setHighProbeStyleIntensityCells(payload.styleIntensity?.highProbeCells ?? []);
        setStyleIntensityPlan(payload.styleIntensity?.executionPlan ?? null);
        setSelectedStyleIntensityCellId((current) => current || payload.styleIntensity?.starterCells[0]?.cellId || payload.styleIntensity?.cells[0]?.cellId || "");
        setApprovedHighIntensityProbes(payload.highIntensity?.probes ?? []);
        setHighIntensityPlan(payload.highIntensity?.executionPlan ?? null);
        setSelectedHighIntensityProbeId((current) => current || payload.highIntensity?.probes[0]?.probeId || "");
        setApprovedAnimeCharacterProfiles(payload.animeCharacters?.profiles ?? []);
        setAnimeCharacterPoseTemplates(payload.animeCharacters?.poseTemplates ?? []);
        setAnimeCharacterExpressionTemplates(payload.animeCharacters?.expressionTemplates ?? []);
        setAnimeCharacterPlan(payload.animeCharacters?.executionPlan ?? null);
        setSelectedAnimeCharacterProfileId((current) => current || payload.animeCharacters?.profiles[0]?.id || "");
        setMessage(payload.prerequisiteState.motion_preview_ready
          ? "Governed micro-sequence prerequisite satisfied. Motion preview generation is available."
          : "Governed motion preview is blocked until the micro-sequence continuity prerequisite is satisfied.");
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "We couldn't load the governed preview prerequisite state.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function updateField<Key extends keyof GovernedPreviewFormInput>(key: Key, value: GovernedPreviewFormInput[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === "prompt" || key === "subject" || key === "style") {
      setSubjectStyleConfirmed(false);
      setPreviewOutputReviewed(false);
      setFinalVisualIntentMatched(false);
    }
  }

  function loadApprovedPromptVariant(variant: ApprovedPromptVariant) {
    setSelectedPromptVariationId(variant.id);
    setForm((current) => ({
      ...current,
      prompt: variant.prompt,
      subject: variant.subject,
      motion_intent: variant.motion_intent,
      style: variant.style,
      duration_seconds: variant.duration_seconds,
      resolution: variant.resolution,
      continuity_priority: variant.continuity_priority,
      package_gif_preview: variant.package_gif_preview,
    }));
    setMessage(`Loaded approved prompt variation ${variant.label} into the governed preview form.`);
  }

  function loadApprovedPromptDomain(domain: ApprovedPromptDomainTemplate) {
    setSelectedPromptDomainId(domain.id);
    setForm((current) => ({
      ...current,
      prompt: domain.prompt,
      subject: domain.subject,
      motion_intent: domain.motion_intent,
      style: domain.style,
      duration_seconds: domain.duration_seconds,
      resolution: domain.resolution,
      continuity_priority: domain.continuity_priority,
      package_gif_preview: domain.package_gif_preview,
    }));
    setMessage(`Loaded approved prompt domain ${domain.label} into the governed preview form.`);
  }

  function loadApprovedVisualStyle(styleProfile: ApprovedVisualStyleProfile) {
    setSelectedVisualStyleId(styleProfile.id);
    setForm((current) => ({
      ...current,
      prompt: styleProfile.prompt,
      subject: styleProfile.subject,
      motion_intent: styleProfile.motion_intent,
      style: styleProfile.style,
      duration_seconds: styleProfile.duration_seconds,
      resolution: styleProfile.resolution,
      continuity_priority: styleProfile.continuity_priority,
      package_gif_preview: styleProfile.package_gif_preview,
    }));
    setMessage(`Loaded approved visual style ${styleProfile.label} into the governed preview form.`);
  }

  function loadApprovedStyleStressCell(cell: StyleStressMatrixCell) {
    const styleProfile = approvedVisualStyles.find((entry) => entry.id === cell.styleId);
    const domain = approvedPromptDomains.find((entry) => entry.id === cell.domainId);
    if (!styleProfile || !domain) {
      setError("We couldn't resolve the selected style stress cell resources.");
      return;
    }

    setSelectedStyleStressCellId(cell.cellId);
    setSelectedVisualStyleId(styleProfile.id);
    setSelectedPromptDomainId(domain.id);
    setForm((current) => ({
      ...current,
      prompt: domain.prompt,
      subject: domain.subject,
      motion_intent: domain.motion_intent,
      style: `${styleProfile.style}; ${styleProfile.characteristics.join(", ")}`,
      duration_seconds: Math.min(styleProfile.duration_seconds, domain.duration_seconds),
      resolution: styleProfile.resolution,
      continuity_priority: styleProfile.continuity_priority === "high" || domain.continuity_priority === "high"
        ? "high"
        : styleProfile.continuity_priority === "medium" || domain.continuity_priority === "medium"
          ? "medium"
          : "low",
      package_gif_preview: styleProfile.package_gif_preview || domain.package_gif_preview,
    }));
    setMessage(`Loaded style stress cell ${cell.styleLabel} × ${cell.domainLabel} into the governed preview form.`);
  }

  function loadApprovedStyleIntensityCell(cell: StyleDomainIntensityMatrixCell) {
    const styleProfile = approvedVisualStyles.find((entry) => entry.id === cell.styleId);
    const domain = approvedPromptDomains.find((entry) => entry.id === cell.domainId);
    const preset = styleIntensityPresets.find((entry) => entry.level === cell.intensityLevel);
    if (!styleProfile || !domain || !preset) {
      setError("We couldn't resolve the selected style intensity cell resources.");
      return;
    }

    setSelectedStyleIntensityCellId(cell.cellId);
    setSelectedVisualStyleId(styleProfile.id);
    setSelectedPromptDomainId(domain.id);
    setForm((current) => ({
      ...current,
      prompt: domain.prompt,
      subject: domain.subject,
      motion_intent: domain.motion_intent,
      style: `${styleProfile.style}; ${styleProfile.characteristics.join(", ")}; governed ${cell.intensityLevel.toLowerCase()} intensity (${cell.intensityValue})`,
      duration_seconds: Math.min(styleProfile.duration_seconds, domain.duration_seconds),
      resolution: styleProfile.resolution,
      continuity_priority: styleProfile.continuity_priority === "high" || domain.continuity_priority === "high"
        ? "high"
        : styleProfile.continuity_priority === "medium" || domain.continuity_priority === "medium"
          ? "medium"
          : "low",
      package_gif_preview: styleProfile.package_gif_preview || domain.package_gif_preview,
    }));
    setMessage(`Loaded style intensity cell ${cell.styleLabel} × ${cell.domainLabel} × ${cell.intensityLevel} into the governed preview form.`);
  }

  function loadApprovedHighIntensityProbe(probe: HighIntensityProbeCell) {
    const styleProfile = approvedVisualStyles.find((entry) => entry.id === probe.styleId);
    const domain = approvedPromptDomains.find((entry) => entry.id === probe.domainId);
    if (!styleProfile || !domain) {
      setError("We couldn't resolve the selected HIGH probe resources.");
      return;
    }

    setSelectedHighIntensityProbeId(probe.probeId);
    setSelectedVisualStyleId(styleProfile.id);
    setSelectedPromptDomainId(domain.id);
    setForm((current) => ({
      ...current,
      prompt: domain.prompt,
      subject: domain.subject,
      motion_intent: domain.motion_intent,
      style: `${styleProfile.style}; ${styleProfile.characteristics.join(", ")}; governed high intensity probe (${probe.probeId})`,
      duration_seconds: Math.min(styleProfile.duration_seconds, domain.duration_seconds),
      resolution: styleProfile.resolution,
      continuity_priority: styleProfile.continuity_priority === "high" || domain.continuity_priority === "high"
        ? "high"
        : styleProfile.continuity_priority === "medium" || domain.continuity_priority === "medium"
          ? "medium"
          : "low",
      package_gif_preview: styleProfile.package_gif_preview || domain.package_gif_preview,
    }));
    setMessage(`Loaded HIGH probe ${probe.styleLabel} × ${probe.domainLabel} into the governed preview form.`);
  }

  function loadApprovedAnimeCharacter(profile: AnimeCharacterProfile) {
    const pose = animeCharacterPoseTemplates.find((entry) => entry.id === profile.poseDefault);
    const expression = animeCharacterExpressionTemplates.find((entry) => entry.id === profile.expressionDefault);

    setSelectedAnimeCharacterProfileId(profile.id);
    setForm((current) => ({
      ...current,
      prompt: `${profile.promptSubject} stands as the primary cinematic subject in a glowing sci-fi chamber beside a softly pulsing beacon. The face is clearly visible with ${profile.eyeDescription}, ${profile.hairDescription}, clean anime facial proportions, and ${profile.outfitDescription}.`,
      subject: profile.promptSubject,
      motion_intent: `${pose?.motionIntent ?? "Hold a readable character-centered pose"}; expression stays ${expression?.label.toLowerCase() ?? "calm"}; no dialogue or lip-sync`,
      style: `Governed unmistakable anime character rendering; single young-adult character only; ${profile.visualIdentity.join(", ")}; no dialogue, no lip-sync, no combat choreography, no cast expansion`,
      duration_seconds: 2,
      resolution: GOVERNED_PREVIEW_RESOLUTION,
      continuity_priority: "high",
      package_gif_preview: true,
    }));
    setMessage(`Loaded anime character ${profile.label} into the governed preview form.`);
  }

  function beginOperatorExecution(action: GovernedExecutionAction, manualApprovalGranted: boolean): string | null {
    const requestId = createOperatorRequestId(action);
    const startedAt = Date.now();

    if (executionLockRef.current) {
      const duplicate = startGovernedExecution(governedExecutionState, {
        action,
        requestId,
        startedAt,
        manualApprovalGranted,
        gifPackagingRequested: form.package_gif_preview,
      });
      setGovernedExecutionState(duplicate.state);
      setMessage("Execution already in progress.");
      return null;
    }

    const started = startGovernedExecution(governedExecutionState, {
      action,
      requestId,
      startedAt,
      manualApprovalGranted,
      gifPackagingRequested: form.package_gif_preview,
    });

    if (!started.started) {
      setGovernedExecutionState(started.state);
      setMessage(started.reason);
      return null;
    }

    executionLockRef.current = true;
    setGovernedExecutionState(started.state);
    setMessage(started.reason);
    return requestId;
  }

  function updateOperatorExecutionPhase(phase: GovernedExecutionPhase) {
    setGovernedExecutionState((current) => advanceGovernedExecutionPhase(current, phase));
  }

  function completeOperatorExecution(updater: (current: GovernedExecutionState) => GovernedExecutionState) {
    executionLockRef.current = false;
    setGovernedExecutionState((current) => updater(current));
  }

  function exportedAnimeCharacterArtifacts(report: AnimeCharacterReport): string[] {
    const packageArtifacts = report.visualReviewPackage
      ? [
        ...report.visualReviewPackage.framePaths,
        report.visualReviewPackage.firstPngToInspect,
        report.visualReviewPackage.gifToInspect,
        report.visualReviewPackage.manifestPath,
        report.visualReviewPackage.diagnosticsPath,
        report.visualReviewPackage.operatorSummaryPath,
      ]
      : [];

    return Array.from(new Set(packageArtifacts.filter((path): path is string => Boolean(path))));
  }

  function scrollToAnimeCharacterRenderingControls(messageText: string) {
    setForceCharacterControlsOpen(true);
    setMessage(messageText);
    setGuidedWorkflowNotice(messageText);
    requestAnimationFrame(() => {
      const section = document.getElementById("anime-character-rendering-section");
      section?.scrollIntoView({ behavior: "smooth", block: "start" });
      window.setTimeout(() => {
        const approval = document.querySelector("[data-guided-focus='anime-character-approval']") as HTMLElement | null;
        approval?.focus({ preventScroll: true });
      }, 275);
    });
  }

  function routeAnimeRequestFromForm(trigger: "micro-sequence" | "preview"): boolean {
    const profileResolution = resolveAnimeCharacterProfileForRequest({
      prompt: form.prompt,
      subject: form.subject,
      style: form.style,
      motionIntent: form.motion_intent,
    });

    if (!profileResolution.isAnimeCharacterRequest) {
      return false;
    }

    setError(null);
    if (profileResolution.resolutionStatus !== "RESOLVED" || !profileResolution.resolvedProfileId) {
      scrollToAnimeCharacterRenderingControls("Anime character request detected. Choose approved anime character profile before rendering.");
      return true;
    }

    setSelectedAnimeCharacterProfileId(profileResolution.resolvedProfileId);
    if (!form.governance_approval || !animeCharacterApproval) {
      scrollToAnimeCharacterRenderingControls(`${CHARACTER_PROFILE_SELECTION_REQUIRED} Next action: approve anime character rendering and select ${profileResolution.resolvedProfileLabel}.`);
      return true;
    }

    setMessage(`Anime character request detected. Routing ${trigger === "micro-sequence" ? "Generate Micro-Sequence First" : "Generate Preview"} to ${profileResolution.resolvedProfileLabel} character-first renderer.`);
    setForceCharacterControlsOpen(true);
    handleRunAnimeCharacter(profileResolution.resolvedProfileId);
    return true;
  }

  async function runVisibleExecutionPhases(action: GovernedExecutionAction) {
    await waitForExecutionPhase(90);
    updateOperatorExecutionPhase(action === "anime-character-render" ? "CHARACTER_RENDER_VALIDATING" : "VALIDATING");
    await waitForExecutionPhase(160);
    updateOperatorExecutionPhase(action === "micro-sequence"
      ? "MICRO_SEQUENCE_RUNNING"
      : action === "rollback"
        ? "ROLLBACK_RESTORING"
        : action === "anime-character-render"
          ? "CHARACTER_RENDER_RUNNING"
          : "PREVIEW_RENDER_RUNNING");
  }

  function handleClassifyPromptVariation() {
    setError(null);
    startTransition(() => {
      void fetch("/api/operator/preview-generation", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "classify-prompt-variation", prompt: promptVariationPrompt }),
      })
        .then(async (response) => {
          const payload = await response.json() as PromptVariationClassificationPayload;
          if (!response.ok || !payload.safety) {
            throw new Error(payload.error ?? "Prompt variation classification failed.");
          }

          setPromptVariationSafety(payload.safety);
          setApprovedPromptVariants(payload.promptVariation?.variants ?? approvedPromptVariants);
          setPromptVariationPlan(payload.promptVariation?.executionPlan ?? promptVariationPlan);
          setMessage(payload.safety.status === "APPROVED"
            ? `Prompt variation stays inside the approved ${payload.safety.approvedDomain?.toLowerCase().replaceAll("_", " ") ?? "governed"} domain.`
            : "Prompt variation blocked before preview execution. Review blocked terms and approved domains.");
        })
        .catch((nextError) => {
          setError(nextError instanceof Error ? nextError.message : "Prompt variation classification failed.");
        });
    });
  }

  function handleRunPromptVariationVariant(variantId: string) {
    setError(null);
    setRollback(null);
    startTransition(() => {
      void fetch("/api/operator/preview-generation", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "run-prompt-variation-variant",
          variantId,
          governanceApproval: form.governance_approval,
          priorReports: promptVariationReports,
        }),
      })
        .then(async (response) => {
          const payload = await response.json() as PromptVariationRunPayload;
          if (!response.ok || !payload.report) {
            throw new Error(payload.error ?? "Prompt variation execution failed.");
          }

          setSelectedPromptVariationId(variantId);
          setCompiledRequest(payload.compiledRequest ?? null);
          setMicroSequence(payload.report.microSequence);
          setExecution(payload.report.previewExecution);
          setRollback(payload.report.rollback);
          setPrerequisiteState(payload.prerequisiteState ?? payload.report.prerequisiteAfter ?? payload.report.prerequisiteBefore);
          setPromptVariationSafety(payload.report.safety);
          setPromptVariationReports(payload.reports ?? [payload.report]);
          setPromptVariationSummary(payload.reportSummary ?? null);
          setPromptVariationHarnessState(payload.harnessState ?? null);
          setApprovedPromptVariants(payload.promptVariation?.variants ?? approvedPromptVariants);
          setPromptVariationPlan(payload.promptVariation?.executionPlan ?? promptVariationPlan);
          setMessage(payload.report.pass
            ? `Approved prompt variation ${payload.report.variantLabel} passed governed regression thresholds.`
            : payload.report.failureReason ?? `Approved prompt variation ${payload.report.variantLabel} failed governed regression thresholds.`);
        })
        .catch((nextError) => {
          setError(nextError instanceof Error ? nextError.message : "Prompt variation execution failed.");
        });
    });
  }

  function handleClassifyPromptDomain() {
    setError(null);
    startTransition(() => {
      void fetch("/api/operator/preview-generation", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "classify-prompt-domain", prompt: promptDomainPrompt }),
      })
        .then(async (response) => {
          const payload = await response.json() as PromptDomainClassificationPayload;
          if (!response.ok || !payload.safety) {
            throw new Error(payload.error ?? "Prompt domain classification failed.");
          }

          setPromptDomainSafety(payload.safety);
          setApprovedPromptDomains(payload.promptDomain?.domains ?? approvedPromptDomains);
          setPromptDomainPlan(payload.promptDomain?.executionPlan ?? promptDomainPlan);
          setMessage(payload.safety.status === "APPROVED"
            ? "Prompt domain stays inside the approved governed cinematic domain surface."
            : "Prompt domain blocked before preview execution. Review blocked terms and approved domains.");
        })
        .catch((nextError) => {
          setError(nextError instanceof Error ? nextError.message : "Prompt domain classification failed.");
        });
    });
  }

  function handleRunPromptDomain(domainId: string) {
    setError(null);
    setRollback(null);
    startTransition(() => {
      void fetch("/api/operator/preview-generation", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "run-prompt-domain",
          domainId,
          governanceApproval: form.governance_approval,
          priorReports: promptDomainReports,
        }),
      })
        .then(async (response) => {
          const payload = await response.json() as PromptDomainRunPayload;
          if (!response.ok || !payload.report) {
            throw new Error(payload.error ?? "Prompt domain execution failed.");
          }

          setSelectedPromptDomainId(domainId);
          setCompiledRequest(payload.compiledRequest ?? null);
          setMicroSequence(payload.report.microSequence);
          setExecution(payload.report.previewExecution);
          setRollback(payload.report.rollback);
          setPrerequisiteState(payload.prerequisiteState ?? payload.report.prerequisiteAfter ?? payload.report.prerequisiteBefore);
          setPromptDomainSafety(payload.report.safety);
          setPromptDomainReports(payload.reports ?? [payload.report]);
          setPromptDomainSummary(payload.reportSummary ?? null);
          setPromptDomainHarnessState(payload.harnessState ?? null);
          setApprovedPromptDomains(payload.promptDomain?.domains ?? approvedPromptDomains);
          setPromptDomainPlan(payload.promptDomain?.executionPlan ?? promptDomainPlan);
          setMessage(payload.report.pass
            ? `Approved prompt domain ${payload.report.domainLabel} passed governed domain thresholds.`
            : payload.report.failureReason ?? `Approved prompt domain ${payload.report.domainLabel} failed governed domain thresholds.`);
        })
        .catch((nextError) => {
          setError(nextError instanceof Error ? nextError.message : "Prompt domain execution failed.");
        });
    });
  }

  function handleRunVisualStyle(styleId: string) {
    setError(null);
    setRollback(null);
    startTransition(() => {
      void fetch("/api/operator/preview-generation", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "run-visual-style-profile",
          styleId,
          governanceApproval: form.governance_approval,
          priorReports: visualStyleReports,
        }),
      })
        .then(async (response) => {
          const payload = await response.json() as VisualStyleRunPayload;
          if (!response.ok || !payload.report) {
            throw new Error(payload.error ?? "Visual style execution failed.");
          }

          setSelectedVisualStyleId(styleId);
          setCompiledRequest(payload.compiledRequest ?? null);
          setMicroSequence(payload.report.microSequence);
          setExecution(payload.report.previewExecution);
          setRollback(payload.report.rollback);
          setPrerequisiteState(payload.prerequisiteState ?? payload.report.prerequisiteAfter ?? payload.report.prerequisiteBefore);
          setVisualStyleReports(payload.reports ?? [payload.report]);
          setVisualStyleSummary(payload.reportSummary ?? null);
          setVisualStyleHarnessState(payload.harnessState ?? null);
          setApprovedVisualStyles(payload.visualStyle?.styles ?? approvedVisualStyles);
          setVisualStylePlan(payload.visualStyle?.executionPlan ?? visualStylePlan);
          setMessage(payload.report.pass
            ? `Approved visual style ${payload.report.styleLabel} passed governed style thresholds.`
            : payload.report.failureReason ?? `Approved visual style ${payload.report.styleLabel} failed governed style thresholds.`);
        })
        .catch((nextError) => {
          setError(nextError instanceof Error ? nextError.message : "Visual style execution failed.");
        });
    });
  }

  function handleRunStyleStressCell(cellId: string) {
    setError(null);
    setRollback(null);
    startTransition(() => {
      void fetch("/api/operator/preview-generation", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "run-style-stress-cell",
          cellId,
          governanceApproval: form.governance_approval,
          priorReports: styleStressReports,
        }),
      })
        .then(async (response) => {
          const payload = await response.json() as StyleStressRunPayload;
          if (!response.ok || !payload.report) {
            throw new Error(payload.error ?? "Style stress execution failed.");
          }

          setSelectedStyleStressCellId(cellId);
          setSelectedVisualStyleId(payload.report.styleId);
          setSelectedPromptDomainId(payload.report.domainId);
          setCompiledRequest(payload.compiledRequest ?? null);
          setMicroSequence(payload.report.microSequence);
          setExecution(payload.report.previewExecution);
          setRollback(payload.report.rollback);
          setPrerequisiteState(payload.prerequisiteState ?? payload.report.prerequisiteAfter ?? payload.report.prerequisiteBefore);
          setStyleStressReports(payload.reports ?? [payload.report]);
          setStyleStressSummary(payload.reportSummary ?? null);
          setStyleStressHarnessState(payload.harnessState ?? null);
          setApprovedStyleStressCells(payload.styleStress?.cells ?? approvedStyleStressCells);
          setStarterStyleStressCells(payload.styleStress?.starterCells ?? starterStyleStressCells);
          setStyleStressPlan(payload.styleStress?.executionPlan ?? styleStressPlan);
          setMessage(payload.report.pass
            ? `Style stress cell ${payload.report.styleLabel} × ${payload.report.domainLabel} passed governed cross-domain thresholds.`
            : payload.report.failureReason ?? `Style stress cell ${payload.report.styleLabel} × ${payload.report.domainLabel} failed governed cross-domain thresholds.`);
        })
        .catch((nextError) => {
          setError(nextError instanceof Error ? nextError.message : "Style stress execution failed.");
        });
    });
  }

  function handleRunStyleIntensityCell(cellId: string) {
    setError(null);
    setRollback(null);
    startTransition(() => {
      void fetch("/api/operator/preview-generation", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "run-style-intensity-cell",
          cellId,
          governanceApproval: form.governance_approval,
          highIntensityApproval,
          priorReports: styleIntensityReports,
        }),
      })
        .then(async (response) => {
          const payload = await response.json() as StyleIntensityRunPayload;
          if (!response.ok || !payload.report) {
            throw new Error(payload.error ?? "Style intensity execution failed.");
          }

          setSelectedStyleIntensityCellId(cellId);
          setSelectedVisualStyleId(payload.report.styleId);
          setSelectedPromptDomainId(payload.report.domainId);
          setCompiledRequest(payload.compiledRequest ?? null);
          setMicroSequence(payload.report.microSequence);
          setExecution(payload.report.previewExecution);
          setRollback(payload.report.rollback);
          setPrerequisiteState(payload.prerequisiteState ?? payload.report.prerequisiteAfter ?? payload.report.prerequisiteBefore);
          setStyleIntensityReports(payload.reports ?? [payload.report]);
          setStyleIntensitySummary(payload.reportSummary ?? null);
          setStyleIntensityHarnessState(payload.harnessState ?? null);
          setStyleIntensityPresets(payload.styleIntensity?.presets ?? styleIntensityPresets);
          setApprovedStyleIntensityCells(payload.styleIntensity?.cells ?? approvedStyleIntensityCells);
          setStarterStyleIntensityCells(payload.styleIntensity?.starterCells ?? starterStyleIntensityCells);
          setHighProbeStyleIntensityCells(payload.styleIntensity?.highProbeCells ?? highProbeStyleIntensityCells);
          setStyleIntensityPlan(payload.styleIntensity?.executionPlan ?? styleIntensityPlan);
          setMessage(payload.report.pass
            ? `Style intensity cell ${payload.report.styleLabel} × ${payload.report.domainLabel} × ${payload.report.intensityLevel} passed governed intensity thresholds.`
            : payload.report.failureReason ?? `Style intensity cell ${payload.report.styleLabel} × ${payload.report.domainLabel} × ${payload.report.intensityLevel} failed governed intensity thresholds.`);
        })
        .catch((nextError) => {
          setError(nextError instanceof Error ? nextError.message : "Style intensity execution failed.");
        });
    });
  }

  function handleRunHighIntensityProbe(probeId: string) {
    setError(null);
    setRollback(null);
    startTransition(() => {
      void fetch("/api/operator/preview-generation", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "run-high-intensity-probe",
          probeId,
          governanceApproval: form.governance_approval,
          highProbeApproval,
          priorReports: highIntensityReports,
        }),
      })
        .then(async (response) => {
          const payload = await response.json() as HighIntensityRunPayload;
          if (!response.ok || !payload.report) {
            throw new Error(payload.error ?? "HIGH probe execution failed.");
          }

          setSelectedHighIntensityProbeId(probeId);
          setSelectedVisualStyleId(payload.report.styleId);
          setSelectedPromptDomainId(payload.report.domainId);
          setCompiledRequest(payload.compiledRequest ?? null);
          setMicroSequence(payload.report.microSequence);
          setExecution(payload.report.previewExecution);
          setRollback(payload.report.rollback);
          setPrerequisiteState(payload.prerequisiteState ?? payload.report.prerequisiteAfter ?? payload.report.prerequisiteBefore);
          setHighIntensityReports(payload.reports ?? [payload.report]);
          setHighIntensitySummary(payload.reportSummary ?? null);
          setHighIntensityHarnessState(payload.harnessState ?? null);
          setApprovedHighIntensityProbes(payload.highIntensity?.probes ?? approvedHighIntensityProbes);
          setHighIntensityPlan(payload.highIntensity?.executionPlan ?? highIntensityPlan);
          setMessage(payload.report.pass
            ? `HIGH probe ${payload.report.styleLabel} × ${payload.report.domainLabel} passed governed HIGH thresholds.`
            : payload.report.failureReason ?? `HIGH probe ${payload.report.styleLabel} × ${payload.report.domainLabel} failed governed HIGH thresholds.`);
        })
        .catch((nextError) => {
          setError(nextError instanceof Error ? nextError.message : "HIGH probe execution failed.");
        });
    });
  }

  function handleRunAnimeCharacter(profileId: string) {
    if (!beginOperatorExecution("anime-character-render", form.governance_approval && animeCharacterApproval)) {
      return;
    }
    setError(null);
    setRollback(null);
    void (async () => {
      const phaseProgress = runVisibleExecutionPhases("anime-character-render");
      try {
        const response = await fetch("/api/operator/preview-generation", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "run-anime-character-render",
          characterProfileId: profileId,
          governanceApproval: form.governance_approval,
          characterApproval: animeCharacterApproval,
          priorReports: animeCharacterReports,
        }),
        });
        const payload = await response.json() as AnimeCharacterRunPayload;
        if (!response.ok || !payload.report) {
          throw new Error(payload.error ?? "Anime character render failed.");
        }
        const report = payload.report;
        await phaseProgress;

        const exportedArtifactPaths = exportedAnimeCharacterArtifacts(report);
        if (report.visualReviewPackage?.gifToInspect) {
          updateOperatorExecutionPhase("CHARACTER_GIF_PACKAGING");
          await waitForExecutionPhase(180);
        }
        updateOperatorExecutionPhase("CHARACTER_EXPORTING_OUTPUTS");
        await waitForExecutionPhase(180);

        setSelectedAnimeCharacterProfileId(profileId);
        setCompiledRequest(payload.compiledRequest ?? null);
  setMicroSequence(report.microSequence);
  setExecution(report.previewExecution);
  setRollback(report.rollback);
  setPrerequisiteState(payload.prerequisiteState ?? report.prerequisiteAfter ?? report.prerequisiteBefore);
  setAnimeCharacterReports(payload.reports ?? [report]);
        setAnimeCharacterSummary(payload.reportSummary ?? null);
        setAnimeCharacterHarnessState(payload.harnessState ?? null);
        setApprovedAnimeCharacterProfiles(payload.animeCharacters?.profiles ?? approvedAnimeCharacterProfiles);
        setAnimeCharacterPoseTemplates(payload.animeCharacters?.poseTemplates ?? animeCharacterPoseTemplates);
        setAnimeCharacterExpressionTemplates(payload.animeCharacters?.expressionTemplates ?? animeCharacterExpressionTemplates);
        setAnimeCharacterPlan(payload.animeCharacters?.executionPlan ?? animeCharacterPlan);
        setMessage(report.pass
          ? `Anime character ${report.characterLabel} passed governed face, silhouette, pose, and anime identity thresholds.`
          : report.failureReason ?? `Anime character ${report.characterLabel} failed governed character rendering thresholds.`);
        completeOperatorExecution((current) => completeGovernedExecution(current, {
          finishedAt: Date.now(),
          status: report.pass ? "complete" : "rejected",
          failureReason: report.pass ? null : report.failureReason ?? "Anime character render did not pass governed truth checks.",
          exportedArtifactPaths,
          sandboxPath: report.visualReviewPackage?.sandboxDirectory ?? report.previewExecution?.sandbox_path ?? null,
          diagnosticsGenerated: Boolean(report.diagnostics || report.truthCheck),
          gifPackagingRequested: Boolean(report.visualReviewPackage?.gifToInspect),
        }));
      } catch (nextError) {
        const failureReason = nextError instanceof Error ? nextError.message : "Anime character render failed.";
        setError(failureReason);
        completeOperatorExecution((current) => failGovernedExecution(current, { finishedAt: Date.now(), failureReason }));
      }
    })();
  }

  function handleGenerate() {
    if (routeAnimeRequestFromForm("preview")) {
      return;
    }

    if (!beginOperatorExecution("preview", form.governance_approval)) {
      return;
    }
    setError(null);
    setRollback(null);
    setPreviewOutputReviewed(false);
    setDiagnosticsReviewed(false);
    setFinalVisualIntentMatched(false);
    setFinalTruthChecksPassed(false);
    setFinalScaffoldFallbackInactive(false);
    setFinalDiagnosticsClear(false);
    void (async () => {
      const phaseProgress = runVisibleExecutionPhases("preview");
      try {
        const response = await fetch("/api/operator/preview-generation", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "generate", input: form }),
        });
        const payload = await response.json() as {
          error?: string;
          compiledRequest?: GovernedPreviewRequest;
          execution?: GovernedPreviewExecutionResult;
          prerequisiteState?: GovernedPreviewPrerequisiteState;
        };

        if (!response.ok || !payload.compiledRequest || !payload.execution) {
          throw new Error(payload.error ?? "Governed preview generation failed.");
        }
        const previewExecution = payload.execution;
        await phaseProgress;
        if (previewExecution.status === "accepted" && form.package_gif_preview) {
          updateOperatorExecutionPhase("GIF_PACKAGING");
          await waitForExecutionPhase(180);
        }
        updateOperatorExecutionPhase("EXPORTING_OUTPUTS");
        await waitForExecutionPhase(180);

        setCompiledRequest(payload.compiledRequest);
        setExecution(previewExecution);
        setMicroSequence(null);
        setPrerequisiteState(payload.prerequisiteState ?? previewExecution.prerequisite_state);
        setMessage(previewExecution.status === "accepted"
          ? "Governed preview request accepted inside the low-duration sandbox."
          : previewExecution.blockers.includes("micro-sequence-prerequisite")
            ? "Governed motion preview is blocked until the micro-sequence continuity prerequisite is satisfied."
            : "Governed preview request blocked by approval or compile-time safety checks.");
        completeOperatorExecution((current) => completeGovernedExecution(current, {
          finishedAt: Date.now(),
          status: previewExecution.status === "accepted" && previewExecution.generated_preview_references.length > 0 ? "complete" : "rejected",
          failureReason: previewExecution.status === "accepted" ? null : previewExecution.governance_status || previewExecution.blockers.join(", ") || "Governed preview was rejected.",
          exportedArtifactPaths: previewExecution.generated_preview_references,
          sandboxPath: previewExecution.sandbox_path,
          diagnosticsGenerated: Boolean(previewExecution.preview_diagnostics),
          gifPackagingRequested: form.package_gif_preview,
        }));
      } catch (nextError) {
        const failureReason = nextError instanceof Error ? nextError.message : "Governed preview generation failed.";
        setError(failureReason);
        completeOperatorExecution((current) => failGovernedExecution(current, { finishedAt: Date.now(), failureReason }));
      }
    })();
  }

  function handleGenerateMicroSequence() {
    if (routeAnimeRequestFromForm("micro-sequence")) {
      return;
    }

    if (!beginOperatorExecution("micro-sequence", form.governance_approval)) {
      return;
    }
    setError(null);
    setRollback(null);
    setMicroSequenceReviewed(false);
    setPreviewOutputReviewed(false);
    setDiagnosticsReviewed(false);
    void (async () => {
      const phaseProgress = runVisibleExecutionPhases("micro-sequence");
      try {
        const response = await fetch("/api/operator/preview-generation", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "generate-micro-sequence", input: form }),
        });
        const payload = await response.json() as {
          error?: string;
          compiledRequest?: GovernedPreviewRequest;
          microSequence?: GovernedPreviewMicroSequenceResult;
          prerequisiteState?: GovernedPreviewPrerequisiteState;
        };

        if (!response.ok || !payload.compiledRequest || !payload.microSequence) {
          throw new Error(payload.error ?? "Governed micro-sequence generation failed.");
        }
        const microSequenceResult = payload.microSequence as GovernedPreviewMicroSequenceResult;
        await phaseProgress;
        updateOperatorExecutionPhase("EXPORTING_OUTPUTS");
        await waitForExecutionPhase(180);

        setCompiledRequest(payload.compiledRequest);
        setExecution(null);
        setMicroSequence(microSequenceResult);
        setPrerequisiteState(payload.prerequisiteState ?? microSequenceResult.prerequisite_state);
        setMessage(microSequenceResult.status === "generated"
          ? "Governed micro-sequence continuity preview generated. Motion preview can be retried once continuity remains green."
          : microSequenceResult.request.blockers.length > 0
            ? "Governed micro-sequence generation remains blocked by approval or compile-time safety checks."
            : `Governed micro-sequence continuity preview ran, but motion preview remains blocked by ${microSequenceResult.blockers.join(", ") || "continuity validation blockers"}.`);
        completeOperatorExecution((current) => completeGovernedExecution(current, {
          finishedAt: Date.now(),
          status: microSequenceResult.status === "generated" ? "complete" : "rejected",
          failureReason: microSequenceResult.status === "generated" ? null : microSequenceResult.governance_status || microSequenceResult.blockers.join(", ") || "Governed micro-sequence was rejected.",
          exportedArtifactPaths: microSequenceResult.generated_frame_references,
          sandboxPath: microSequenceResult.sandbox_path,
          diagnosticsGenerated: Boolean(microSequenceResult.preview_diagnostics),
          gifPackagingRequested: false,
        }));
      } catch (nextError) {
        const failureReason = nextError instanceof Error ? nextError.message : "Governed micro-sequence generation failed.";
        setError(failureReason);
        completeOperatorExecution((current) => failGovernedExecution(current, { finishedAt: Date.now(), failureReason }));
      }
    })();
  }

  function handleRollback() {
    if (!beginOperatorExecution("rollback", true)) {
      return;
    }
    setError(null);
    void (async () => {
      const phaseProgress = runVisibleExecutionPhases("rollback");
      try {
        const response = await fetch("/api/operator/preview-generation", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "rollback" }),
        });
        const payload = await response.json() as {
          error?: string;
          rollback?: GovernedPreviewRollbackResult;
        };
        if (!response.ok || !payload.rollback) {
          throw new Error(payload.error ?? "Governed preview rollback failed.");
        }
        await phaseProgress;
        setRollback(payload.rollback);
        setMessage(payload.rollback.status === "rolled_back"
          ? "Governed preview sandbox rollback completed."
          : "No governed preview sandbox outputs were present to clear.");
        completeOperatorExecution((current) => completeGovernedRollback(current, {
          finishedAt: Date.now(),
          deletedOutputTargets: payload.rollback?.deleted_output_targets ?? [],
          sandboxPath: payload.rollback?.sandbox_path ?? null,
        }));
      } catch (nextError) {
        const failureReason = nextError instanceof Error ? nextError.message : "Governed preview rollback failed.";
        setError(failureReason);
        completeOperatorExecution((current) => failGovernedExecution(current, { finishedAt: Date.now(), failureReason }));
      }
    })();
  }

  const statusTone: "ok" | "warn" | "blocked" | "default" = execution?.status === "accepted"
    ? "warn"
    : execution?.status === "blocked"
      ? "blocked"
      : "default";
  const executionLocked = isPending || isGovernedExecutionLocked(governedExecutionState);
  const motionPreviewReady = prerequisiteState?.motion_preview_ready === true;
  const latestMicroSequenceFrameReferences = microSequence?.generated_frame_references.length
    ? microSequence.generated_frame_references
    : (prerequisiteState?.generated_frame_references ?? []);
  const activeDiagnostics = execution?.preview_diagnostics ?? microSequence?.preview_diagnostics ?? prerequisiteState?.preview_diagnostics ?? null;
  const microSequenceGalleryCards = buildGalleryCards(latestMicroSequenceFrameReferences, "micro-sequence", microSequence?.preview_diagnostics ?? prerequisiteState?.preview_diagnostics);
  const previewGallerySource: PreviewGalleryCard["source"] = execution?.generated_preview_references.some((path) => path.includes("anime_character_")) ? "anime-character" : "motion-preview";
  const previewGalleryCards = buildGalleryCards(execution?.generated_preview_references ?? [], previewGallerySource, execution?.preview_diagnostics);
  const motionPreviewFrameCards = previewGalleryCards.filter((entry) => entry.format === "png");
  const comparisonCards = motionPreviewFrameCards.length >= 2
    ? [motionPreviewFrameCards[0], motionPreviewFrameCards[motionPreviewFrameCards.length - 1]]
    : microSequenceGalleryCards.filter((entry) => entry.format === "png").length >= 2
      ? [microSequenceGalleryCards.filter((entry) => entry.format === "png")[0], microSequenceGalleryCards.filter((entry) => entry.format === "png").at(-1)!]
      : [];
  const showGenerateMicroSequenceCta = !motionPreviewReady
    || execution?.blockers.includes("micro-sequence-prerequisite")
    || microSequence?.status === "blocked";
  const selectedPromptVariation = approvedPromptVariants.find((entry) => entry.id === selectedPromptVariationId) ?? null;
  const selectedPromptDomain = approvedPromptDomains.find((entry) => entry.id === selectedPromptDomainId) ?? null;
  const selectedVisualStyle = approvedVisualStyles.find((entry) => entry.id === selectedVisualStyleId) ?? null;
  const selectedStyleStressCell = approvedStyleStressCells.find((entry) => entry.cellId === selectedStyleStressCellId)
    ?? starterStyleStressCells.find((entry) => entry.cellId === selectedStyleStressCellId)
    ?? null;
  const selectedStyleIntensityCell = approvedStyleIntensityCells.find((entry) => entry.cellId === selectedStyleIntensityCellId)
    ?? starterStyleIntensityCells.find((entry) => entry.cellId === selectedStyleIntensityCellId)
    ?? highProbeStyleIntensityCells.find((entry) => entry.cellId === selectedStyleIntensityCellId)
    ?? null;
  const selectedHighIntensityProbe = approvedHighIntensityProbes.find((entry) => entry.probeId === selectedHighIntensityProbeId) ?? null;
  const selectedAnimeCharacterProfile = approvedAnimeCharacterProfiles.find((entry) => entry.id === selectedAnimeCharacterProfileId) ?? null;
  const animeSummaryActivity = buildAnimeSummaryActivity(animeCharacterSummary);
  const rendererOutputActivity = buildRendererOutputActivity(previewGalleryCards.length, execution?.preview_diagnostics);
  const microSequenceOutputActivity = buildRendererOutputActivity(microSequenceGalleryCards.length, microSequence?.preview_diagnostics ?? prerequisiteState?.preview_diagnostics);
  const diagnosticsActivity = buildDiagnosticsActivity(activeDiagnostics);
  const validationActivity = execution?.blockers.length || prerequisiteState?.continuity_validation.blockers.length
    ? {
      label: "blocked validation",
      tone: "blocked" as const,
      summary: "Validation blockers or preview blockers are active and remain visible while collapsed.",
      critical: true,
    }
    : rollback?.deleted_output_targets.length
      ? {
        label: "rollback completed",
        tone: "warn" as const,
        summary: "Rollback completed sandbox cleanup; review deleted output targets if needed.",
        critical: false,
      }
      : {
        label: "no blockers",
        tone: "ok" as const,
        summary: "No active preview blockers are recorded and rollback remains sandbox-limited.",
        critical: false,
      };
  const executionActivity = error
    ? {
      label: "failed validation",
      tone: "blocked" as const,
      summary: error,
      critical: true,
    }
    : executionLocked
      ? {
        label: getGovernedExecutionPhaseLabel(governedExecutionState.currentPhase).toLowerCase().replaceAll(" ", "-"),
        tone: "warn" as const,
        summary: governedExecutionState.statusMessage,
        critical: true,
      }
      : governedExecutionState.renderRejected || governedExecutionState.renderFailed
        ? {
          label: getGovernedExecutionPhaseLabel(governedExecutionState.currentPhase).toLowerCase().replaceAll(" ", "-"),
          tone: "blocked" as const,
          summary: governedExecutionState.failureReason ?? governedExecutionState.statusMessage,
          critical: true,
        }
        : governedExecutionState.renderCompleted
          ? {
            label: "export-complete",
            tone: "ok" as const,
            summary: governedExecutionState.statusMessage,
            critical: false,
          }
      : {
        label: execution?.status === "accepted" ? "request-accepted" : execution?.status ?? "ready",
        tone: statusTone === "blocked" ? "blocked" as const : statusTone === "warn" ? "warn" as const : "info" as const,
        summary: message,
        critical: statusTone === "blocked",
      };
  const capabilityHarnessActivity = {
    label: "controls collapsed",
    tone: promptVariationSafety?.status === "REJECTED" || promptDomainSafety?.status === "REJECTED" ? "blocked" as const : "info" as const,
    summary: "Prompt, domain, style, intensity, HIGH probe, and anime profile controls are grouped as dashboard dropdowns.",
    critical: promptVariationSafety?.status === "REJECTED" || promptDomainSafety?.status === "REJECTED",
  };
  const requestControlsActivity = !motionPreviewReady
    ? {
      label: "prerequisite needed",
      tone: "warn" as const,
      summary: "Motion preview controls are collapsed; micro-sequence prerequisite is still required.",
      critical: false,
    }
    : {
      label: "controls ready",
      tone: "info" as const,
      summary: "Execution controls and request fields are available when expanded.",
      critical: false,
    };
  const comparisonActivity = comparisonCards.length === 2
    ? {
      label: "comparison ready",
      tone: "ok" as const,
      summary: "Frame comparison is available when expanded.",
      critical: false,
    }
    : {
      label: "no comparison yet",
      tone: "info" as const,
      summary: "Generate at least two governed PNG frames to compare continuity.",
      critical: false,
    };
  const latestAnimeCharacterReport = animeCharacterReports.at(-1) ?? null;
  const activeTruthCheck = latestAnimeCharacterReport?.truthCheck
    ?? execution?.preview_diagnostics?.anime_character_truth_check
    ?? microSequence?.preview_diagnostics?.anime_character_truth_check
    ?? prerequisiteState?.preview_diagnostics?.anime_character_truth_check
    ?? null;
  const truthChecksPassed = Boolean(activeTruthCheck?.character_pixels_generated
    && activeTruthCheck.character_primary_subject
    && activeTruthCheck.diagnostics_match_rendered_output
    && activeTruthCheck.scaffold_status === "REAL_OUTPUT_ACTIVE");
  const scaffoldFallbackInactive = Boolean(activeTruthCheck && !activeTruthCheck.fallback_primitive_dominance && activeTruthCheck.scaffold_status !== "SCAFFOLD_ACTIVE");
  const diagnosticsClear = Boolean(activeDiagnostics && diagnosticsActivity.tone !== "warn" && diagnosticsActivity.tone !== "blocked" && validationActivity.tone !== "blocked");
  const rollbackWarningsActive = diagnosticsActivity.tone === "warn" || validationActivity.tone === "warn" || Boolean(rollback?.deleted_output_targets.length);
  const workflowFacts: GuidedWorkflowFacts = {
    promptReady: form.prompt.trim().length > 0,
    subjectStyleAligned: subjectStyleConfirmed && form.subject.trim().length > 0 && form.style.trim().length > 0,
    manualApprovalEnabled: form.governance_approval,
    microSequenceGenerated: microSequence?.status === "generated" || prerequisiteState?.micro_sequence_exists === true || microSequenceGalleryCards.length > 0,
    microSequenceReviewed,
    previewRequestAccepted: execution?.status === "accepted",
    previewGenerationCompleted: previewGalleryCards.length > 0 || Boolean(latestAnimeCharacterReport?.visualReviewPackage),
    previewOutputReviewed,
    truthChecksPassed,
    scaffoldFallbackInactive,
    diagnosticsReviewed,
    diagnosticsClear,
    rollbackWarningsActive,
    activeFailureReason: error,
    finalVisualIntentMatched,
    finalTruthChecksPassed,
    finalScaffoldFallbackInactive,
    finalDiagnosticsClear,
  };
  const guidedWorkflowSteps = buildGuidedWorkflowSteps(guidedWorkflowState, workflowFacts);
  const activeGuidedTarget = getGuidedStepTarget(activeGuidedTargetStepId);
  const activeGuidedSectionId = activeGuidedTarget.workflowSectionId;
  const guidedWarningSectionIds = new Set(guidedWorkflowSteps.filter((step) => step.hasPersistentWarning || step.status === "warning" || step.status === "failed" || step.status === "blocked").map((step) => step.sectionId));
  const finalOperatorVerdict = evaluateFinalOperatorVerdict(workflowFacts);
  const governedExecutionTimeline = buildGovernedExecutionTimeline(governedExecutionState, {
    outputReviewed: previewOutputReviewed || microSequenceReviewed,
    diagnosticsReviewed,
    truthChecksPassed,
    finalVerdictReady: finalOperatorVerdict === "PASS",
  });

  function guidedSectionProps(sectionId: GuidedWorkflowSectionId) {
    const anchoredStep = activeGuidedTarget.workflowSectionId === sectionId
      ? guidedWorkflowSteps.find((step) => step.id === activeGuidedTarget.stepId)
      : guidedWorkflowSteps.find((step) => step.sectionId === sectionId && (step.isActive || step.hasPersistentWarning))
      ?? guidedWorkflowSteps.find((step) => step.sectionId === sectionId);
    return {
      guidedStepLabel: anchoredStep ? `Step ${anchoredStep.number}: ${anchoredStep.title}` : undefined,
      containsActiveStep: activeGuidedSectionId === sectionId,
      hasWorkflowWarning: guidedWarningSectionIds.has(sectionId),
    };
  }

  function handleAdvanceGuidedWorkflow() {
    const result = advanceGuidedWorkflow(guidedWorkflowState, workflowFacts);
    setGuidedWorkflowState(result.state);
    setGuidedWorkflowNotice(result.reason);
    setActiveGuidedTargetStepId(result.state.activeStepId);
  }

  function handleNavigateGuidedStep(stepId: GuidedWorkflowStepId) {
    const target = getGuidedStepTarget(stepId);
    const selectedStep = guidedWorkflowSteps.find((step) => step.id === stepId);
    if (selectedStep?.isActive || selectedStep?.isPast) {
      setGuidedWorkflowState((current) => ({ ...current, activeStepId: stepId }));
    }
    setActiveGuidedTargetStepId(stepId);
    setGuidedWorkflowNotice(target.instruction);

    requestAnimationFrame(() => {
      const section = document.getElementById(target.sectionId)
        ?? document.querySelector(target.highlightSelector)
        ?? document.querySelector(`[data-guided-section='${target.workflowSectionId}']`);
      section?.scrollIntoView({ behavior: "smooth", block: "start" });

      window.setTimeout(() => {
        const navigation = resolveGuidedStepNavigationTarget(stepId, (selector) => Boolean(document.querySelector(selector)));
        setGuidedWorkflowNotice(navigation.reason);
        const focusTarget = document.querySelector(navigation.focusSelector) as HTMLElement | null;
        if (focusTarget) {
          focusTarget.focus({ preventScroll: true });
        }
      }, 275);
    });
  }

  function isGuidedHighlightActive(highlightName: string): boolean {
    return activeGuidedTarget.highlightSelector === `[data-guided-highlight='${highlightName}']`;
  }

  const styleIntensityDisplayCells = [
    ...starterStyleIntensityCells,
    ...highProbeStyleIntensityCells.filter((probe) => !starterStyleIntensityCells.some((starter) => starter.cellId === probe.cellId)),
  ];
  const dashboardGuidedProps = guidedSectionProps("dashboard-controls");

  function handleExportRunReportPdf() {
    setMessage("Preparing operator run report PDF export. Choose Save as PDF in the print dialog.");
    window.requestAnimationFrame(() => window.print());
  }

  return (
    <main className="page-shell min-h-screen bg-mist/80">
      <style jsx global>{`
        .operator-run-report-print {
          display: none;
        }

        @media print {
          @page {
            size: A4;
            margin: 14mm;
          }

          body * {
            visibility: hidden !important;
          }

          .operator-run-report-print,
          .operator-run-report-print * {
            visibility: visible !important;
          }

          .operator-run-report-print {
            display: block !important;
            position: absolute;
            inset: 0 auto auto 0;
            width: 100%;
            padding: 0;
            background: #ffffff;
            color: #172033;
            font-family: Arial, sans-serif;
            font-size: 10.5pt;
            line-height: 1.45;
          }

          .operator-report-header {
            border-bottom: 2px solid #172033;
            margin-bottom: 14px;
            padding-bottom: 10px;
          }

          .operator-report-header p,
          .operator-report-header span {
            margin: 0;
            color: #64748b;
            font-size: 9pt;
            text-transform: uppercase;
          }

          .operator-report-header h1 {
            margin: 4px 0;
            color: #172033;
            font-size: 20pt;
          }

          .operator-report-section {
            break-inside: avoid;
            border: 1px solid #d7dee8;
            margin: 0 0 10px;
            padding: 10px;
          }

          .operator-report-section h2 {
            margin: 0 0 8px;
            color: #172033;
            font-size: 13pt;
          }

          .operator-report-kv {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 6px 14px;
            margin: 0;
          }

          .operator-report-kv div {
            break-inside: avoid;
          }

          .operator-report-kv dt {
            color: #64748b;
            font-size: 8pt;
            font-weight: 700;
            text-transform: uppercase;
          }

          .operator-report-kv dd {
            margin: 1px 0 0;
            overflow-wrap: anywhere;
          }

          .operator-report-paths,
          .operator-report-timeline {
            margin: 0;
            padding-left: 18px;
          }

          .operator-report-paths li,
          .operator-report-timeline li {
            margin-bottom: 4px;
            overflow-wrap: anywhere;
          }

          .operator-report-muted {
            color: #64748b;
            margin: 0;
          }

          .operator-report-gallery {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
          }

          .operator-report-gallery article {
            break-inside: avoid;
            border: 1px solid #d7dee8;
            padding: 8px;
          }

          .operator-report-gallery h3 {
            margin: 6px 0 2px;
            font-size: 10pt;
          }

          .operator-report-gallery p {
            margin: 2px 0;
            color: #475569;
            font-size: 8pt;
            overflow-wrap: anywhere;
          }

          .operator-report-thumb {
            align-items: center;
            background: #f1f5f9;
            display: flex;
            height: 120px;
            justify-content: center;
          }

          .operator-report-thumb img {
            height: 112px;
            max-width: 100%;
            object-fit: contain;
            width: auto;
          }
        }
      `}</style>
      <OperatorRunReport
        form={form}
        compiledRequest={compiledRequest}
        execution={execution}
        microSequence={microSequence}
        prerequisiteState={prerequisiteState}
        rollback={rollback}
        executionState={governedExecutionState}
        timeline={governedExecutionTimeline}
        finalVerdict={finalOperatorVerdict}
        message={message}
        error={error}
        activeDiagnostics={activeDiagnostics}
        latestAnimeCharacterReport={latestAnimeCharacterReport}
        animeCharacterSummary={animeCharacterSummary}
        activeTruthCheck={activeTruthCheck}
        reviewState={{
          subjectStyleConfirmed,
          microSequenceReviewed,
          previewOutputReviewed,
          diagnosticsReviewed,
          finalVisualIntentMatched,
          finalTruthChecksPassed,
          finalScaffoldFallbackInactive,
          finalDiagnosticsClear,
        }}
        previewCards={previewGalleryCards}
        microSequenceCards={microSequenceGalleryCards}
      />
      <section className="relative z-10 mx-auto max-w-6xl px-6 py-12 lg:px-10">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="section-label">Operator Surface</p>
            <h1 className="headline mt-3 text-4xl font-semibold text-ink">Governed Preview Generation</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 body-muted">
              Low-duration preview only. Low-resolution only. Manual approval required. No autonomous rendering. No long-form video yet. Rollback enabled.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleExportRunReportPdf}
              className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:-translate-y-0.5"
            >
              Export Run Report to PDF
            </button>
            <Link href="/operator" className="rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:-translate-y-0.5">
              Operator Dashboard
            </Link>
            <Link href="/" className="rounded-full border border-ocean/20 bg-ocean px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5">
              Front Door
            </Link>
          </div>
        </div>

        <OperatorGuidedWorkflow
          steps={guidedWorkflowSteps}
          activeStepRef={activeGuidedStepRef}
          notice={guidedWorkflowNotice}
          finalVerdict={finalOperatorVerdict}
          subjectStyleConfirmed={subjectStyleConfirmed}
          onSubjectStyleConfirmedChange={setSubjectStyleConfirmed}
          microSequenceReviewed={microSequenceReviewed}
          onMicroSequenceReviewedChange={setMicroSequenceReviewed}
          previewOutputReviewed={previewOutputReviewed}
          onPreviewOutputReviewedChange={setPreviewOutputReviewed}
          diagnosticsReviewed={diagnosticsReviewed}
          onDiagnosticsReviewedChange={setDiagnosticsReviewed}
          finalVisualIntentMatched={finalVisualIntentMatched}
          onFinalVisualIntentMatchedChange={setFinalVisualIntentMatched}
          finalTruthChecksPassed={finalTruthChecksPassed}
          onFinalTruthChecksPassedChange={setFinalTruthChecksPassed}
          finalScaffoldFallbackInactive={finalScaffoldFallbackInactive}
          onFinalScaffoldFallbackInactiveChange={setFinalScaffoldFallbackInactive}
          finalDiagnosticsClear={finalDiagnosticsClear}
          onFinalDiagnosticsClearChange={setFinalDiagnosticsClear}
          onAdvance={handleAdvanceGuidedWorkflow}
          onNavigateStep={handleNavigateGuidedStep}
        />

        <CollapsibleActivitySection
          sectionLabel="Dashboard Controls"
          title="Prompt, Style, Intensity, HIGH Probe, And Character Profile Controls"
          activity={capabilityHarnessActivity}
          defaultOpen={capabilityHarnessActivity.critical}
          className="mb-6"
          {...dashboardGuidedProps}
          containsActiveStep={dashboardGuidedProps.containsActiveStep || forceCharacterControlsOpen}
        >
        <section className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <article
            id="anime-character-rendering-section"
            data-guided-highlight="anime-character-rendering"
            className={`scroll-mt-6 rounded-[2rem] border p-6 shadow-float ${isGuidedHighlightActive("anime-character-rendering") ? "border-ocean/50 bg-ocean/5 ring-4 ring-ocean/15" : "border-ink/10 bg-white/80"}`}
          >
            <GuidedTargetCallout active={isGuidedHighlightActive("anime-character-rendering")} label={activeGuidedTarget.calloutLabel} instruction={activeGuidedTarget.instruction} />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="section-label">Prompt Variation Harness</p>
                <h2 className="mt-3 text-2xl font-semibold text-ink">Approved Prompt Variant Set</h2>
              </div>
              {promptVariationPlan ? <StatusPill label={`max-${promptVariationPlan.maxVariants}-variants`} tone="ok" /> : null}
            </div>
            <p className="mt-3 text-sm leading-7 body-muted">
              Operator-triggered only. Approved variants only. No humanoids, dialogue, long-form rendering, autonomous continuation, or random prompt mutation.
            </p>
            {promptVariationPlan ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {promptVariationPlan.stages.map((stage) => (
                  <StatusPill key={stage} label={stage} tone="default" />
                ))}
              </div>
            ) : null}
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {approvedPromptVariants.map((variant) => (
                <article key={variant.id} className={`rounded-[1.25rem] border p-4 ${selectedPromptVariationId === variant.id ? "border-ocean/30 bg-ocean/5" : "border-ink/10 bg-white/85"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-ink">{variant.label}</p>
                    <StatusPill label={variant.domain.toLowerCase().replaceAll("_", "-")} tone="default" />
                  </div>
                  <p className="mt-3 text-sm leading-7 body-muted">{variant.prompt}</p>
                  <div className="mt-3 text-xs uppercase tracking-[0.18em] text-slate">
                    {variant.duration_seconds}s • {variant.resolution} • {variant.continuity_priority} continuity
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => loadApprovedPromptVariant(variant)}
                      className="rounded-full border border-ink/10 bg-white px-4 py-2 text-xs font-semibold text-ink transition hover:-translate-y-0.5"
                    >
                      Load Variant
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRunPromptVariationVariant(variant.id)}
                      disabled={isPending}
                      className="rounded-full border border-ocean/20 bg-ocean px-4 py-2 text-xs font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Run Approved Variant
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </article>

          <article className="glass-card rounded-[2rem] p-6 shadow-float">
            <p className="section-label">Safety Gate</p>
            <h2 className="mt-3 text-2xl font-semibold text-ink">Prompt Safety Classifier</h2>
            <label className="mt-5 flex flex-col gap-2 rounded-[1.25rem] border border-ink/10 bg-white/80 p-4">
              <FieldLabel>Candidate Prompt</FieldLabel>
              <textarea
                value={promptVariationPrompt}
                onChange={(event) => setPromptVariationPrompt(event.target.value)}
                rows={5}
                className="rounded-xl border border-ink/10 bg-white px-3 py-3 text-sm text-ink outline-none"
                placeholder="Paste a candidate prompt to test the deterministic safety gate."
              />
            </label>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleClassifyPromptVariation}
                disabled={isPending}
                className="rounded-full border border-amber-200 bg-amber-50 px-5 py-3 text-sm font-semibold text-amber-700 transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Classify Prompt
              </button>
              {selectedPromptVariation ? (
                <button
                  type="button"
                  onClick={() => loadApprovedPromptVariant(selectedPromptVariation)}
                  className="rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink transition hover:-translate-y-0.5"
                >
                  Load Selected Variant
                </button>
              ) : null}
            </div>
            {promptVariationSafety ? (
              <div className="mt-4 space-y-3 rounded-[1.25rem] border border-ink/10 bg-white/85 p-4 text-sm leading-7 body-muted">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill label={promptVariationSafety.status} tone={promptVariationSafety.status === "APPROVED" ? "ok" : "blocked"} />
                  {promptVariationSafety.approvedDomain ? <StatusPill label={promptVariationSafety.approvedDomain.toLowerCase().replaceAll("_", "-")} tone="default" /> : null}
                </div>
                {promptVariationSafety.blockedTerms.length ? <p><strong className="text-ink">Blocked terms:</strong> {promptVariationSafety.blockedTerms.join(", ")}</p> : null}
                {promptVariationSafety.approvedTerms.length ? <p><strong className="text-ink">Approved terms:</strong> {promptVariationSafety.approvedTerms.join(", ")}</p> : null}
                {promptVariationSafety.reasons.length ? (
                  <ul className="space-y-2">
                    {promptVariationSafety.reasons.map((reason) => (
                      <li key={reason} className="rounded-[1rem] border border-ink/10 bg-mist/60 px-4 py-3">{reason}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            {promptVariationHarnessState ? (
              <div className="mt-4 rounded-[1.25rem] border border-ink/10 bg-white/85 p-4 text-sm leading-7 body-muted">
                <p><strong className="text-ink">Active variant:</strong> {promptVariationHarnessState.activeVariantLabel}</p>
                <p><strong className="text-ink">Execution status:</strong> {promptVariationHarnessState.variantExecutionStatus}</p>
                <p><strong className="text-ink">Cross-variant cohesion:</strong> {promptVariationHarnessState.crossVariantCohesionScore}/100</p>
                <p><strong className="text-ink">Cross-variant readability:</strong> {promptVariationHarnessState.crossVariantReadabilityScore}/100</p>
                <p><strong className="text-ink">Rejected variants:</strong> {promptVariationHarnessState.rejectedVariantCount}</p>
                <p><strong className="text-ink">Rollback restored latest variant:</strong> {promptVariationHarnessState.rollbackRestoredVariant ? "yes" : "no"}</p>
              </div>
            ) : null}
          </article>
        </section>

        <section className="mb-6">
          <article className="glass-card rounded-[2rem] p-6 shadow-float">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="section-label">Operator Report</p>
                <h2 className="mt-3 text-2xl font-semibold text-ink">Cross-Variant Diagnostic Summary</h2>
              </div>
              {promptVariationSummary ? <StatusPill label={promptVariationSummary.recommendedNextAction.toLowerCase().replaceAll("_", "-")} tone={promptVariationSummary.recommendedNextAction === "CONTINUE_VARIANTS" ? "ok" : promptVariationSummary.recommendedNextAction === "TUNE_RUNTIME" ? "warn" : "blocked"} /> : null}
            </div>
            {promptVariationSummary ? (
              <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                <div className="rounded-[1.25rem] border border-ink/10 bg-white/85 p-4 text-sm leading-7 body-muted">
                  <p><strong className="text-ink">Variants run:</strong> {promptVariationSummary.variantCount}</p>
                  <p><strong className="text-ink">Passed:</strong> {promptVariationSummary.passedVariantCount}</p>
                  <p><strong className="text-ink">Rejected:</strong> {promptVariationSummary.rejectedVariantCount}</p>
                  <p><strong className="text-ink">Average scene cohesion:</strong> {promptVariationSummary.averageSceneCohesion}/100</p>
                  <p><strong className="text-ink">Minimum scene cohesion:</strong> {promptVariationSummary.minimumSceneCohesion}/100</p>
                  <p><strong className="text-ink">Average transition smoothness:</strong> {promptVariationSummary.averageTransitionSmoothness}/100</p>
                  <p><strong className="text-ink">Average focus continuity:</strong> {promptVariationSummary.averageFocusContinuity}/100</p>
                  <p><strong className="text-ink">Average preview readability:</strong> {promptVariationSummary.averagePreviewReadability}/100</p>
                  <p><strong className="text-ink">Rollback pass rate:</strong> {Math.round(promptVariationSummary.rollbackPassRate * 100)}%</p>
                  {promptVariationSummary.recommendedRuntimeLayer ? <p><strong className="text-ink">Inspect runtime layer:</strong> {promptVariationSummary.recommendedRuntimeLayer}</p> : null}
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {promptVariationReports.map((report) => (
                    <article key={report.variantId} className="rounded-[1.25rem] border border-ink/10 bg-white/90 p-4 shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-ink">{report.variantLabel}</p>
                        <StatusPill label={report.executionStatus.toLowerCase()} tone={promptVariationStatusTone(report)} />
                      </div>
                      <p className="mt-2 text-xs uppercase tracking-[0.18em] text-slate">{report.domain.toLowerCase().replaceAll("_", "-")}</p>
                      <p className="mt-3 text-sm leading-7 body-muted">{report.prompt}</p>
                      <div className="mt-3 space-y-1 text-sm leading-7 body-muted">
                        <p><strong className="text-ink">Safety:</strong> {report.safetyStatus}</p>
                        {report.metrics ? <p><strong className="text-ink">Scene cohesion:</strong> {report.metrics.sceneCohesion}/100</p> : null}
                        {report.metrics ? <p><strong className="text-ink">Transition smoothness:</strong> {report.metrics.transitionSmoothness}/100</p> : null}
                        {report.metrics ? <p><strong className="text-ink">Focus continuity:</strong> {report.metrics.focusContinuity}/100</p> : null}
                        {report.metrics ? <p><strong className="text-ink">Preview readability:</strong> {report.metrics.previewReadability}/100</p> : null}
                        <p><strong className="text-ink">Rollback visible:</strong> {report.rollbackVisible ? "yes" : "no"}</p>
                        <p><strong className="text-ink">Rollback restored variant:</strong> {report.rollbackRestoredVariant ? "yes" : "no"}</p>
                        {report.recommendedRuntimeLayer ? <p><strong className="text-ink">Inspect layer:</strong> {report.recommendedRuntimeLayer}</p> : null}
                        {report.failureReason ? <p><strong className="text-ink">Failure reason:</strong> {report.failureReason}</p> : null}
                      </div>
                      {report.failedThresholds.length ? (
                        <ul className="mt-3 space-y-2 text-sm leading-7 body-muted">
                          {report.failedThresholds.map((failure) => (
                            <li key={`${report.variantId}-${failure.metric}`} className="rounded-[1rem] border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
                              {failure.metric}: {String(failure.actual)} required {failure.required} ({failure.recommendedRuntimeLayer})
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </article>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mt-5 text-sm leading-7 body-muted">Run approved prompt variants manually to build the bounded operator report.</p>
            )}
          </article>
        </section>

        <section className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <article className="glass-card rounded-[2rem] p-6 shadow-float">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="section-label">Prompt Domain Expansion</p>
                <h2 className="mt-3 text-2xl font-semibold text-ink">Approved Cinematic Domains</h2>
              </div>
              {promptDomainPlan ? <StatusPill label={`max-${promptDomainPlan.maxDomains}-domains`} tone="ok" /> : null}
            </div>
            <p className="mt-3 text-sm leading-7 body-muted">
              Domains remain operator-approved only. No humanoids, dialogue, emotional acting, story generation, long-form rendering, autonomous continuation, or unrestricted prompt generation.
            </p>
            {promptDomainPlan ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {promptDomainPlan.stages.map((stage) => (
                  <StatusPill key={stage} label={stage} tone="default" />
                ))}
              </div>
            ) : null}
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {approvedPromptDomains.map((domain) => (
                <article key={domain.id} className={`rounded-[1.25rem] border p-4 ${selectedPromptDomainId === domain.id ? "border-ocean/30 bg-ocean/5" : "border-ink/10 bg-white/85"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-ink">{domain.label}</p>
                    <StatusPill label={domain.category.toLowerCase().replaceAll("_", "-")} tone="default" />
                  </div>
                  <p className="mt-3 text-sm leading-7 body-muted">{domain.prompt}</p>
                  <div className="mt-3 text-xs uppercase tracking-[0.18em] text-slate">
                    {domain.duration_seconds}s • {domain.resolution} • {domain.continuity_priority} continuity
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => loadApprovedPromptDomain(domain)}
                      className="rounded-full border border-ink/10 bg-white px-4 py-2 text-xs font-semibold text-ink transition hover:-translate-y-0.5"
                    >
                      Load Domain
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRunPromptDomain(domain.id)}
                      disabled={isPending}
                      className="rounded-full border border-ocean/20 bg-ocean px-4 py-2 text-xs font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Run Approved Domain
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </article>

          <article className="glass-card rounded-[2rem] p-6 shadow-float">
            <p className="section-label">Domain Safety Gate</p>
            <h2 className="mt-3 text-2xl font-semibold text-ink">Prompt Domain Classifier</h2>
            <label className="mt-5 flex flex-col gap-2 rounded-[1.25rem] border border-ink/10 bg-white/80 p-4">
              <FieldLabel>Candidate Domain Prompt</FieldLabel>
              <textarea
                value={promptDomainPrompt}
                onChange={(event) => setPromptDomainPrompt(event.target.value)}
                rows={5}
                className="rounded-xl border border-ink/10 bg-white px-3 py-3 text-sm text-ink outline-none"
                placeholder="Paste a candidate domain prompt to test the deterministic safety gate."
              />
            </label>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleClassifyPromptDomain}
                disabled={isPending}
                className="rounded-full border border-amber-200 bg-amber-50 px-5 py-3 text-sm font-semibold text-amber-700 transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Classify Domain
              </button>
              {selectedPromptDomain ? (
                <button
                  type="button"
                  onClick={() => loadApprovedPromptDomain(selectedPromptDomain)}
                  className="rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink transition hover:-translate-y-0.5"
                >
                  Load Selected Domain
                </button>
              ) : null}
            </div>
            {promptDomainSafety ? (
              <div className="mt-4 space-y-3 rounded-[1.25rem] border border-ink/10 bg-white/85 p-4 text-sm leading-7 body-muted">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill label={promptDomainSafety.status} tone={promptDomainSafety.status === "APPROVED" ? "ok" : "blocked"} />
                  {promptDomainSafety.approvedDomain ? <StatusPill label={promptDomainSafety.approvedDomain.toLowerCase().replaceAll("_", "-")} tone="default" /> : null}
                </div>
                {promptDomainSafety.blockedTerms.length ? <p><strong className="text-ink">Blocked terms:</strong> {promptDomainSafety.blockedTerms.join(", ")}</p> : null}
                {promptDomainSafety.approvedTerms.length ? <p><strong className="text-ink">Approved terms:</strong> {promptDomainSafety.approvedTerms.join(", ")}</p> : null}
                {promptDomainSafety.reasons.length ? (
                  <ul className="space-y-2">
                    {promptDomainSafety.reasons.map((reason) => (
                      <li key={reason} className="rounded-[1rem] border border-ink/10 bg-mist/60 px-4 py-3">{reason}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            {promptDomainHarnessState ? (
              <div className="mt-4 rounded-[1.25rem] border border-ink/10 bg-white/85 p-4 text-sm leading-7 body-muted">
                <p><strong className="text-ink">Active domain:</strong> {promptDomainHarnessState.activeDomainLabel}</p>
                <p><strong className="text-ink">Domain category:</strong> {promptDomainHarnessState.domainCategory}</p>
                <p><strong className="text-ink">Approved domains run:</strong> {promptDomainHarnessState.approvedVariantCount}</p>
                <p><strong className="text-ink">Domain compatibility:</strong> {promptDomainHarnessState.domainCompatibilityScore}/100</p>
                <p><strong className="text-ink">Domain readability:</strong> {promptDomainHarnessState.domainReadabilityScore}/100</p>
                <p><strong className="text-ink">Rejected domains:</strong> {promptDomainHarnessState.rejectedDomainCount}</p>
                <p><strong className="text-ink">Rollback restored latest domain:</strong> {promptDomainHarnessState.rollbackRestoredDomain ? "yes" : "no"}</p>
              </div>
            ) : null}
          </article>
        </section>

        <section className="mb-6">
          <article className="glass-card rounded-[2rem] p-6 shadow-float">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="section-label">Domain Expansion Report</p>
                <h2 className="mt-3 text-2xl font-semibold text-ink">Cross-Domain Diagnostic Summary</h2>
              </div>
              {promptDomainSummary ? <StatusPill label={promptDomainSummary.recommendedNextAction.toLowerCase().replaceAll("_", "-")} tone={promptDomainSummary.recommendedNextAction === "CONTINUE_DOMAIN_EXPANSION" ? "ok" : promptDomainSummary.recommendedNextAction === "TUNE_COHESION_LAYER" ? "warn" : "blocked"} /> : null}
            </div>
            {promptDomainSummary ? (
              <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                <div className="rounded-[1.25rem] border border-ink/10 bg-white/85 p-4 text-sm leading-7 body-muted">
                  <p><strong className="text-ink">Domains run:</strong> {promptDomainSummary.testedDomainCount}</p>
                  <p><strong className="text-ink">Passed:</strong> {promptDomainSummary.passedDomainCount}</p>
                  <p><strong className="text-ink">Rejected:</strong> {promptDomainSummary.rejectedDomainCount}</p>
                  {promptDomainSummary.strongestDomain ? <p><strong className="text-ink">Strongest domain:</strong> {promptDomainSummary.strongestDomain}</p> : null}
                  {promptDomainSummary.weakestDomain ? <p><strong className="text-ink">Weakest domain:</strong> {promptDomainSummary.weakestDomain}</p> : null}
                  <p><strong className="text-ink">Average scene cohesion:</strong> {promptDomainSummary.averageSceneCohesion}/100</p>
                  <p><strong className="text-ink">Average transition smoothness:</strong> {promptDomainSummary.averageTransitionSmoothness}/100</p>
                  <p><strong className="text-ink">Average tension continuity:</strong> {promptDomainSummary.averageTensionContinuity}/100</p>
                  <p><strong className="text-ink">Average momentum continuity:</strong> {promptDomainSummary.averageMomentumContinuity}/100</p>
                  <p><strong className="text-ink">Average preview readability:</strong> {promptDomainSummary.averagePreviewReadability}/100</p>
                  <p><strong className="text-ink">Rollback pass rate:</strong> {Math.round(promptDomainSummary.rollbackPassRate * 100)}%</p>
                  {promptDomainSummary.recommendedRuntimeLayer ? <p><strong className="text-ink">Inspect runtime layer:</strong> {promptDomainSummary.recommendedRuntimeLayer}</p> : null}
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {promptDomainReports.map((report) => (
                    <article key={report.domainId} className="rounded-[1.25rem] border border-ink/10 bg-white/90 p-4 shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-ink">{report.domainLabel}</p>
                        <StatusPill label={report.executionStatus.toLowerCase()} tone={promptDomainStatusTone(report)} />
                      </div>
                      <p className="mt-2 text-xs uppercase tracking-[0.18em] text-slate">{report.domainCategory.toLowerCase().replaceAll("_", "-")}</p>
                      <p className="mt-3 text-sm leading-7 body-muted">{report.promptTemplate}</p>
                      <div className="mt-3 space-y-1 text-sm leading-7 body-muted">
                        <p><strong className="text-ink">Safety:</strong> {report.safetyStatus}</p>
                        {report.metrics ? <p><strong className="text-ink">Scene cohesion:</strong> {report.metrics.sceneCohesion}/100</p> : null}
                        {report.metrics ? <p><strong className="text-ink">Environment identity:</strong> {report.metrics.environmentIdentity}/100</p> : null}
                        {report.metrics ? <p><strong className="text-ink">Formation identity:</strong> {report.metrics.formationIdentity}/100</p> : null}
                        {report.metrics ? <p><strong className="text-ink">Reflection continuity:</strong> {report.metrics.reflectionContinuity}/100</p> : null}
                        {report.metrics ? <p><strong className="text-ink">Lighting stability:</strong> {report.metrics.lightingStability}/100</p> : null}
                        {report.strongestMetric ? <p><strong className="text-ink">Strongest metric:</strong> {report.strongestMetric}</p> : null}
                        {report.weakestMetric ? <p><strong className="text-ink">Weakest metric:</strong> {report.weakestMetric}</p> : null}
                        <p><strong className="text-ink">Rollback visible:</strong> {report.rollbackVisible ? "yes" : "no"}</p>
                        <p><strong className="text-ink">Rollback restored domain:</strong> {report.rollbackRestoredDomain ? "yes" : "no"}</p>
                        {report.recommendedRuntimeLayer ? <p><strong className="text-ink">Inspect layer:</strong> {report.recommendedRuntimeLayer}</p> : null}
                        {report.failureReason ? <p><strong className="text-ink">Failure reason:</strong> {report.failureReason}</p> : null}
                      </div>
                      {report.failedThresholds.length ? (
                        <ul className="mt-3 space-y-2 text-sm leading-7 body-muted">
                          {report.failedThresholds.map((failure) => (
                            <li key={`${report.domainId}-${failure.metric}`} className="rounded-[1rem] border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
                              {failure.metric}: {String(failure.actual)} required {failure.required} ({failure.recommendedRuntimeLayer})
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </article>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mt-5 text-sm leading-7 body-muted">Run approved prompt domains manually to build the bounded operator domain report.</p>
            )}
          </article>
        </section>

        <section className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <article className="glass-card rounded-[2rem] p-6 shadow-float">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="section-label">Visual Style Profiles</p>
                <h2 className="mt-3 text-2xl font-semibold text-ink">Approved Governed Style Set</h2>
              </div>
              {visualStylePlan ? <StatusPill label={`max-${visualStylePlan.maxStyles}-styles`} tone="ok" /> : null}
            </div>
            <p className="mt-3 text-sm leading-7 body-muted">
              Style profiles remain operator-approved only. No unrestricted style synthesis, humanoids, faces, dialogue, emotional acting, or long-form rendering.
            </p>
            {visualStylePlan ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {visualStylePlan.stages.map((stage) => (
                  <StatusPill key={stage} label={stage} tone="default" />
                ))}
              </div>
            ) : null}
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {approvedVisualStyles.map((styleProfile) => (
                <article key={styleProfile.id} className={`rounded-[1.25rem] border p-4 ${selectedVisualStyleId === styleProfile.id ? "border-ocean/30 bg-ocean/5" : "border-ink/10 bg-white/85"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-ink">{styleProfile.label}</p>
                    <StatusPill label={styleProfile.category.toLowerCase().replaceAll("_", "-")} tone="default" />
                  </div>
                  <p className="mt-3 text-sm leading-7 body-muted">{styleProfile.description}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em] text-slate">
                    {styleProfile.characteristics.map((characteristic) => (
                      <span key={`${styleProfile.id}-${characteristic}`} className="rounded-full border border-ink/10 bg-mist/60 px-3 py-1">{characteristic}</span>
                    ))}
                  </div>
                  <div className="mt-4 text-xs uppercase tracking-[0.18em] text-slate">
                    {styleProfile.duration_seconds}s • {styleProfile.resolution} • {styleProfile.continuity_priority} continuity
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => loadApprovedVisualStyle(styleProfile)}
                      className="rounded-full border border-ink/10 bg-white px-4 py-2 text-xs font-semibold text-ink transition hover:-translate-y-0.5"
                    >
                      Load Style
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRunVisualStyle(styleProfile.id)}
                      disabled={isPending}
                      className="rounded-full border border-ocean/20 bg-ocean px-4 py-2 text-xs font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Run Approved Style
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </article>

          <article className="glass-card rounded-[2rem] p-6 shadow-float">
            <p className="section-label">Style Harness State</p>
            <h2 className="mt-3 text-2xl font-semibold text-ink">Visual Style Compatibility</h2>
            {selectedVisualStyle ? (
              <div className="mt-5 rounded-[1.25rem] border border-ink/10 bg-white/85 p-4 text-sm leading-7 body-muted">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill label={selectedVisualStyle.label.toLowerCase().replaceAll("_", "-")} tone="default" />
                  <StatusPill label={selectedVisualStyle.category.toLowerCase().replaceAll("_", "-")} tone="default" />
                </div>
                <p className="mt-3"><strong className="text-ink">Style description:</strong> {selectedVisualStyle.description}</p>
                <p><strong className="text-ink">Governed preview style field:</strong> {selectedVisualStyle.style}</p>
                <p><strong className="text-ink">Baseline prompt:</strong> {selectedVisualStyle.prompt}</p>
              </div>
            ) : null}
            {visualStyleHarnessState ? (
              <div className="mt-4 rounded-[1.25rem] border border-ink/10 bg-white/85 p-4 text-sm leading-7 body-muted">
                <p><strong className="text-ink">Active style:</strong> {visualStyleHarnessState.activeStyleLabel}</p>
                <p><strong className="text-ink">Style category:</strong> {visualStyleHarnessState.styleCategory}</p>
                <p><strong className="text-ink">Approved styles run:</strong> {visualStyleReports.length}</p>
                <p><strong className="text-ink">Style compatibility:</strong> {visualStyleHarnessState.styleCompatibilityScore}/100</p>
                <p><strong className="text-ink">Style readability:</strong> {visualStyleHarnessState.styleReadabilityScore}/100</p>
                <p><strong className="text-ink">Rejected styles:</strong> {visualStyleHarnessState.rejectedStyleCount}</p>
                <p><strong className="text-ink">Rollback restored latest style:</strong> {visualStyleHarnessState.rollbackRestoredStyle ? "yes" : "no"}</p>
              </div>
            ) : (
              <p className="mt-5 text-sm leading-7 body-muted">Run approved styles manually to build the bounded style report.</p>
            )}
          </article>
        </section>

        <section className="mb-6">
          <article className="glass-card rounded-[2rem] p-6 shadow-float">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="section-label">Style Profile Report</p>
                <h2 className="mt-3 text-2xl font-semibold text-ink">Cross-Style Diagnostic Summary</h2>
              </div>
              {visualStyleSummary ? <StatusPill label={visualStyleSummary.recommendedNextAction.toLowerCase().replaceAll("_", "-")} tone={visualStyleSummary.recommendedNextAction === "CONTINUE_STYLE_EXPANSION" ? "ok" : visualStyleSummary.recommendedNextAction === "TUNE_VISUAL_LAYERS" ? "warn" : "blocked"} /> : null}
            </div>
            {visualStyleSummary ? (
              <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                <div className="rounded-[1.25rem] border border-ink/10 bg-white/85 p-4 text-sm leading-7 body-muted">
                  <p><strong className="text-ink">Styles run:</strong> {visualStyleSummary.testedStyleCount}</p>
                  <p><strong className="text-ink">Passed:</strong> {visualStyleSummary.passedStyleCount}</p>
                  <p><strong className="text-ink">Rejected:</strong> {visualStyleSummary.rejectedStyleCount}</p>
                  {visualStyleSummary.strongestStyle ? <p><strong className="text-ink">Strongest style:</strong> {visualStyleSummary.strongestStyle}</p> : null}
                  {visualStyleSummary.weakestStyle ? <p><strong className="text-ink">Weakest style:</strong> {visualStyleSummary.weakestStyle}</p> : null}
                  <p><strong className="text-ink">Average scene cohesion:</strong> {visualStyleSummary.averageSceneCohesion}/100</p>
                  <p><strong className="text-ink">Average transition smoothness:</strong> {visualStyleSummary.averageTransitionSmoothness}/100</p>
                  <p><strong className="text-ink">Average lighting stability:</strong> {visualStyleSummary.averageLightingStability}/100</p>
                  <p><strong className="text-ink">Average reflection continuity:</strong> {visualStyleSummary.averageReflectionContinuity}/100</p>
                  <p><strong className="text-ink">Average silhouette readability:</strong> {visualStyleSummary.averageSilhouetteReadability}/100</p>
                  <p><strong className="text-ink">Average preview readability:</strong> {visualStyleSummary.averagePreviewReadability}/100</p>
                  <p><strong className="text-ink">Rollback pass rate:</strong> {Math.round(visualStyleSummary.rollbackPassRate * 100)}%</p>
                  {visualStyleSummary.recommendedRuntimeLayer ? <p><strong className="text-ink">Inspect runtime layer:</strong> {visualStyleSummary.recommendedRuntimeLayer}</p> : null}
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {visualStyleReports.map((report) => (
                    <article key={report.styleId} className="rounded-[1.25rem] border border-ink/10 bg-white/90 p-4 shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-ink">{report.styleLabel}</p>
                        <StatusPill label={report.executionStatus.toLowerCase()} tone={visualStyleStatusTone(report)} />
                      </div>
                      <p className="mt-2 text-xs uppercase tracking-[0.18em] text-slate">{report.styleCategory.toLowerCase().replaceAll("_", "-")}</p>
                      <p className="mt-3 text-sm leading-7 body-muted">{report.styleDescription}</p>
                      <div className="mt-3 space-y-1 text-sm leading-7 body-muted">
                        <p><strong className="text-ink">Safety:</strong> {report.safetyStatus}</p>
                        {report.metrics ? <p><strong className="text-ink">Scene cohesion:</strong> {report.metrics.sceneCohesion}/100</p> : null}
                        {report.metrics ? <p><strong className="text-ink">Lighting stability:</strong> {report.metrics.lightingStability}/100</p> : null}
                        {report.metrics ? <p><strong className="text-ink">Reflection continuity:</strong> {report.metrics.reflectionContinuity}/100</p> : null}
                        {report.metrics ? <p><strong className="text-ink">Silhouette readability:</strong> {report.metrics.silhouetteReadability}/100</p> : null}
                        {report.metrics ? <p><strong className="text-ink">Preview readability:</strong> {report.metrics.previewReadability}/100</p> : null}
                        {report.strongestMetric ? <p><strong className="text-ink">Strongest metric:</strong> {report.strongestMetric}</p> : null}
                        {report.weakestMetric ? <p><strong className="text-ink">Weakest metric:</strong> {report.weakestMetric}</p> : null}
                        <p><strong className="text-ink">Rollback visible:</strong> {report.rollbackVisible ? "yes" : "no"}</p>
                        <p><strong className="text-ink">Rollback restored style:</strong> {report.rollbackRestoredStyle ? "yes" : "no"}</p>
                        {report.recommendedRuntimeLayer ? <p><strong className="text-ink">Inspect layer:</strong> {report.recommendedRuntimeLayer}</p> : null}
                        {report.failureReason ? <p><strong className="text-ink">Failure reason:</strong> {report.failureReason}</p> : null}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em] text-slate">
                        {report.styleCharacteristics.map((characteristic) => (
                          <span key={`${report.styleId}-${characteristic}`} className="rounded-full border border-ink/10 bg-mist/60 px-3 py-1">{characteristic}</span>
                        ))}
                      </div>
                      {report.failedThresholds.length ? (
                        <ul className="mt-3 space-y-2 text-sm leading-7 body-muted">
                          {report.failedThresholds.map((failure) => (
                            <li key={`${report.styleId}-${failure.metric}`} className="rounded-[1rem] border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
                              {failure.metric}: {String(failure.actual)} required {failure.required} ({failure.recommendedRuntimeLayer})
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </article>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mt-5 text-sm leading-7 body-muted">Run approved visual styles manually to build the bounded cross-style operator report.</p>
            )}
          </article>
        </section>

        <section className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <article className="glass-card rounded-[2rem] p-6 shadow-float">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="section-label">Style Stress Harness</p>
                <h2 className="mt-3 text-2xl font-semibold text-ink">Starter Style × Domain Cells</h2>
              </div>
              {styleStressPlan ? <StatusPill label={`max-${styleStressPlan.maxCells}-cells`} tone="ok" /> : null}
            </div>
            <p className="mt-3 text-sm leading-7 body-muted">
              Operator-triggered only. Manual cell selection only. No autonomous full-matrix execution, automatic retries, humanoids, dialogue, or long-form rendering.
            </p>
            {styleStressPlan ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {styleStressPlan.stages.map((stage) => (
                  <StatusPill key={stage} label={stage} tone="default" />
                ))}
              </div>
            ) : null}
            <div className="mt-4 rounded-[1.25rem] border border-ink/10 bg-white/85 p-4 text-sm leading-7 body-muted">
              <p><strong className="text-ink">Approved matrix cells:</strong> {approvedStyleStressCells.length}</p>
              <p><strong className="text-ink">Starter cells:</strong> {starterStyleStressCells.length}</p>
              <p><strong className="text-ink">Autoplay:</strong> disabled</p>
              <p><strong className="text-ink">Automatic retries:</strong> disabled</p>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {starterStyleStressCells.map((cell) => (
                <article key={cell.cellId} className={`rounded-[1.25rem] border p-4 ${selectedStyleStressCellId === cell.cellId ? "border-ocean/30 bg-ocean/5" : "border-ink/10 bg-white/85"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-ink">{cell.styleLabel} × {cell.domainLabel}</p>
                    <StatusPill label="starter" tone="default" />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em] text-slate">
                    <span className="rounded-full border border-ink/10 bg-mist/60 px-3 py-1">{cell.styleLabel.toLowerCase().replaceAll("_", "-")}</span>
                    <span className="rounded-full border border-ink/10 bg-mist/60 px-3 py-1">{cell.domainLabel.toLowerCase().replaceAll("_", "-")}</span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => loadApprovedStyleStressCell(cell)}
                      className="rounded-full border border-ink/10 bg-white px-4 py-2 text-xs font-semibold text-ink transition hover:-translate-y-0.5"
                    >
                      Load Cell
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRunStyleStressCell(cell.cellId)}
                      disabled={isPending}
                      className="rounded-full border border-ocean/20 bg-ocean px-4 py-2 text-xs font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Run Stress Cell
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </article>

          <article className="glass-card rounded-[2rem] p-6 shadow-float">
            <p className="section-label">Stress Harness State</p>
            <h2 className="mt-3 text-2xl font-semibold text-ink">Cross-Domain Style Stability</h2>
            {selectedStyleStressCell ? (
              <div className="mt-5 rounded-[1.25rem] border border-ink/10 bg-white/85 p-4 text-sm leading-7 body-muted">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill label={selectedStyleStressCell.styleLabel.toLowerCase().replaceAll("_", "-")} tone="default" />
                  <StatusPill label={selectedStyleStressCell.domainLabel.toLowerCase().replaceAll("_", "-")} tone="default" />
                  {selectedStyleStressCell.starter ? <StatusPill label="starter-cell" tone="ok" /> : null}
                </div>
                <p className="mt-3"><strong className="text-ink">Cell id:</strong> {selectedStyleStressCell.cellId}</p>
                <p><strong className="text-ink">Style:</strong> {selectedStyleStressCell.styleLabel}</p>
                <p><strong className="text-ink">Domain:</strong> {selectedStyleStressCell.domainLabel}</p>
                <p><strong className="text-ink">Manual selection:</strong> {selectedStyleStressCell.manualSelectionAllowed ? "required" : "blocked"}</p>
              </div>
            ) : null}
            {styleStressHarnessState ? (
              <div className="mt-4 rounded-[1.25rem] border border-ink/10 bg-white/85 p-4 text-sm leading-7 body-muted">
                <p><strong className="text-ink">Active style:</strong> {styleStressHarnessState.activeStyleId}</p>
                <p><strong className="text-ink">Active domain:</strong> {styleStressHarnessState.activeDomainId}</p>
                <p><strong className="text-ink">Active cell:</strong> {styleStressHarnessState.matrixCellId}</p>
                <p><strong className="text-ink">Cells tested:</strong> {styleStressHarnessState.testedCellCount}</p>
                <p><strong className="text-ink">Passed cells:</strong> {styleStressHarnessState.passedCellCount}</p>
                <p><strong className="text-ink">Failed cells:</strong> {styleStressHarnessState.failedCellCount}</p>
                {styleStressHarnessState.weakestStyleId ? <p><strong className="text-ink">Weakest style:</strong> {styleStressHarnessState.weakestStyleId}</p> : null}
                {styleStressHarnessState.weakestDomainId ? <p><strong className="text-ink">Weakest domain:</strong> {styleStressHarnessState.weakestDomainId}</p> : null}
                <p><strong className="text-ink">Rollback restored latest cell:</strong> {styleStressHarnessState.rollbackRestoredStressRun ? "yes" : "no"}</p>
              </div>
            ) : (
              <p className="mt-5 text-sm leading-7 body-muted">Run starter stress cells manually to compare which styles stay stable across approved cinematic domains.</p>
            )}
          </article>
        </section>

        <section className="mb-6">
          <article className="glass-card rounded-[2rem] p-6 shadow-float">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="section-label">Stress Test Report</p>
                <h2 className="mt-3 text-2xl font-semibold text-ink">Cross-Style Stress Diagnostic Summary</h2>
              </div>
              {styleStressSummary ? <StatusPill label={styleStressSummary.recommendedNextAction.toLowerCase().replaceAll("_", "-")} tone={styleStressSummary.recommendedNextAction === "CONTINUE_STYLE_TESTING" ? "ok" : styleStressSummary.recommendedNextAction === "TUNE_STYLE_PROFILE" ? "warn" : "blocked"} /> : null}
            </div>
            {styleStressSummary ? (
              <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                <div className="rounded-[1.25rem] border border-ink/10 bg-white/85 p-4 text-sm leading-7 body-muted">
                  <p><strong className="text-ink">Cells run:</strong> {styleStressSummary.testedCellCount}</p>
                  <p><strong className="text-ink">Passed:</strong> {styleStressSummary.passedCellCount}</p>
                  <p><strong className="text-ink">Failed:</strong> {styleStressSummary.failedCellCount}</p>
                  {styleStressSummary.strongestStyleId ? <p><strong className="text-ink">Strongest style:</strong> {styleStressSummary.strongestStyleId}</p> : null}
                  {styleStressSummary.weakestStyleId ? <p><strong className="text-ink">Weakest style:</strong> {styleStressSummary.weakestStyleId}</p> : null}
                  {styleStressSummary.strongestDomainId ? <p><strong className="text-ink">Strongest domain:</strong> {styleStressSummary.strongestDomainId}</p> : null}
                  {styleStressSummary.weakestDomainId ? <p><strong className="text-ink">Weakest domain:</strong> {styleStressSummary.weakestDomainId}</p> : null}
                  {styleStressSummary.strongestCellId ? <p><strong className="text-ink">Strongest cell:</strong> {styleStressSummary.strongestCellId}</p> : null}
                  {styleStressSummary.weakestCellId ? <p><strong className="text-ink">Weakest cell:</strong> {styleStressSummary.weakestCellId}</p> : null}
                  <p><strong className="text-ink">Average scene cohesion:</strong> {styleStressSummary.averageSceneCohesion}/100</p>
                  <p><strong className="text-ink">Average style readability:</strong> {styleStressSummary.averageStyleReadability}/100</p>
                  <p><strong className="text-ink">Average lighting stability:</strong> {styleStressSummary.averageLightingStability}/100</p>
                  <p><strong className="text-ink">Average reflection continuity:</strong> {styleStressSummary.averageReflectionContinuity}/100</p>
                  <p><strong className="text-ink">Pass rate:</strong> {Math.round(styleStressSummary.styleDomainPassRate * 100)}%</p>
                  <p><strong className="text-ink">Rollback pass rate:</strong> {Math.round(styleStressSummary.rollbackPassRate * 100)}%</p>
                  {styleStressSummary.recommendedRuntimeLayer ? <p><strong className="text-ink">Inspect runtime layer:</strong> {styleStressSummary.recommendedRuntimeLayer}</p> : null}
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {styleStressReports.map((report) => (
                    <article key={report.cellId} className="rounded-[1.25rem] border border-ink/10 bg-white/90 p-4 shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-ink">{report.styleLabel} × {report.domainLabel}</p>
                        <StatusPill label={report.executionStatus.toLowerCase()} tone={styleStressStatusTone(report)} />
                      </div>
                      <p className="mt-2 text-xs uppercase tracking-[0.18em] text-slate">{report.styleCategory.toLowerCase().replaceAll("_", "-")} • {report.domainCategory.toLowerCase().replaceAll("_", "-")}</p>
                      <div className="mt-3 space-y-1 text-sm leading-7 body-muted">
                        <p><strong className="text-ink">Safety:</strong> {report.safetyStatus}</p>
                        {report.compatibility ? <p><strong className="text-ink">Compatibility score:</strong> {report.compatibility.compatibilityScore}/100</p> : null}
                        {report.metrics ? <p><strong className="text-ink">Scene cohesion:</strong> {report.metrics.sceneCohesion}/100</p> : null}
                        {report.metrics ? <p><strong className="text-ink">Style cohesion:</strong> {report.metrics.styleCohesion}/100</p> : null}
                        {report.metrics ? <p><strong className="text-ink">Domain compatibility:</strong> {report.metrics.domainCompatibility}/100</p> : null}
                        {report.metrics ? <p><strong className="text-ink">Lighting stability:</strong> {report.metrics.lightingStability}/100</p> : null}
                        {report.metrics ? <p><strong className="text-ink">Reflection continuity:</strong> {report.metrics.reflectionContinuity}/100</p> : null}
                        {report.metrics ? <p><strong className="text-ink">Silhouette readability:</strong> {report.metrics.silhouetteReadability}/100</p> : null}
                        {report.metrics ? <p><strong className="text-ink">Preview readability:</strong> {report.metrics.previewReadability}/100</p> : null}
                        {report.strongestMetric ? <p><strong className="text-ink">Strongest metric:</strong> {report.strongestMetricScore !== null ? `${report.strongestMetric} (${report.strongestMetricScore})` : report.strongestMetric}</p> : null}
                        {report.weakestMetric ? <p><strong className="text-ink">Weakest metric:</strong> {report.weakestMetricScore !== null ? `${report.weakestMetric} (${report.weakestMetricScore})` : report.weakestMetric}</p> : null}
                        {report.failureClassification ? <p><strong className="text-ink">Failure class:</strong> {report.failureClassification.code}</p> : null}
                        {report.failureClassification ? <p><strong className="text-ink">Inspect layer:</strong> {report.failureClassification.inspectLayer}</p> : null}
                        <p><strong className="text-ink">Rollback visible:</strong> {report.rollbackVisible ? "yes" : "no"}</p>
                        <p><strong className="text-ink">Rollback restored cell:</strong> {report.rollbackRestoredStressRun ? "yes" : "no"}</p>
                        {report.failureReason ? <p><strong className="text-ink">Failure reason:</strong> {report.failureReason}</p> : null}
                      </div>
                      {report.failedThresholds.length ? (
                        <ul className="mt-3 space-y-2 text-sm leading-7 body-muted">
                          {report.failedThresholds.map((failure) => (
                            <li key={`${report.cellId}-${failure.metric}`} className="rounded-[1rem] border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
                              {failure.metric}: {String(failure.actual)} required {failure.required} ({failure.recommendedRuntimeLayer})
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </article>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mt-5 text-sm leading-7 body-muted">Run starter style stress cells manually to build the bounded cross-style operator report.</p>
            )}
          </article>
        </section>

        <section className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <article className="glass-card rounded-[2rem] p-6 shadow-float">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="section-label">Style Intensity Controls</p>
                <h2 className="mt-3 text-2xl font-semibold text-ink">Bounded Style × Domain × Intensity Cells</h2>
              </div>
              {styleIntensityPlan ? <StatusPill label={`max-${styleIntensityPlan.maxCells}-cells`} tone="ok" /> : null}
            </div>
            <p className="mt-3 text-sm leading-7 body-muted">
              Operator-triggered only. LOW, MEDIUM, and HIGH presets only. HIGH probes require explicit approval and never enable autonomous ramping, extreme mode, or long-form rendering.
            </p>
            {styleIntensityPlan ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {styleIntensityPlan.stages.map((stage) => (
                  <StatusPill key={stage} label={stage} tone="default" />
                ))}
              </div>
            ) : null}
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-[1.25rem] border border-ink/10 bg-white/85 p-4 text-sm leading-7 body-muted">
                <p><strong className="text-ink">Approved intensity cells:</strong> {approvedStyleIntensityCells.length}</p>
                <p><strong className="text-ink">Starter intensity cells:</strong> {starterStyleIntensityCells.length}</p>
                <p><strong className="text-ink">Guarded HIGH probes:</strong> {highProbeStyleIntensityCells.length}</p>
                <p><strong className="text-ink">Autonomous ramping:</strong> disabled</p>
                <p><strong className="text-ink">Extreme mode:</strong> blocked</p>
              </div>
              <label className="flex gap-3 rounded-[1.25rem] border border-amber-200 bg-amber-50 p-4 text-sm leading-7 text-amber-900">
                <input
                  type="checkbox"
                  checked={highIntensityApproval}
                  onChange={(event) => setHighIntensityApproval(event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-amber-300"
                />
                <span>
                  <strong className="block text-ink">HIGH Probe Approval</strong>
                  I explicitly approve a guarded HIGH-intensity probe. This does not allow autonomous ramping, unrestricted intensity values, or style profile mutation.
                </span>
              </label>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {styleIntensityPresets.map((preset) => (
                <StatusPill key={preset.level} label={`${preset.level.toLowerCase()}-${preset.value}`} tone={preset.level === "HIGH" ? "warn" : "ok"} />
              ))}
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {styleIntensityDisplayCells.map((cell) => (
                <article key={cell.cellId} className={`rounded-[1.25rem] border p-4 ${selectedStyleIntensityCellId === cell.cellId ? "border-ocean/30 bg-ocean/5" : cell.intensityLevel === "HIGH" ? "border-amber-200 bg-amber-50/80" : "border-ink/10 bg-white/85"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-ink">{cell.styleLabel} × {cell.domainLabel}</p>
                    <StatusPill label={cell.intensityLevel.toLowerCase()} tone={cell.intensityLevel === "HIGH" ? "warn" : "default"} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em] text-slate">
                    {cell.starter ? <span className="rounded-full border border-ink/10 bg-mist/60 px-3 py-1">starter</span> : null}
                    {cell.guardedHighProbe ? <span className="rounded-full border border-amber-200 bg-amber-100 px-3 py-1 text-amber-800">guarded-high-probe</span> : null}
                    <span className="rounded-full border border-ink/10 bg-mist/60 px-3 py-1">value-{cell.intensityValue}</span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => loadApprovedStyleIntensityCell(cell)}
                      className="rounded-full border border-ink/10 bg-white px-4 py-2 text-xs font-semibold text-ink transition hover:-translate-y-0.5"
                    >
                      Load Intensity
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRunStyleIntensityCell(cell.cellId)}
                      disabled={isPending || (cell.intensityLevel === "HIGH" && !highIntensityApproval)}
                      className="rounded-full border border-ocean/20 bg-ocean px-4 py-2 text-xs font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {cell.intensityLevel === "HIGH" ? "Run HIGH Probe" : "Run Intensity Cell"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </article>

          <article className="glass-card rounded-[2rem] p-6 shadow-float">
            <p className="section-label">Intensity Harness State</p>
            <h2 className="mt-3 text-2xl font-semibold text-ink">Style Intensity Boundary</h2>
            {selectedStyleIntensityCell ? (
              <div className="mt-5 rounded-[1.25rem] border border-ink/10 bg-white/85 p-4 text-sm leading-7 body-muted">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill label={selectedStyleIntensityCell.styleLabel.toLowerCase().replaceAll("_", "-")} tone="default" />
                  <StatusPill label={selectedStyleIntensityCell.domainLabel.toLowerCase().replaceAll("_", "-")} tone="default" />
                  <StatusPill label={selectedStyleIntensityCell.intensityLevel.toLowerCase()} tone={selectedStyleIntensityCell.intensityLevel === "HIGH" ? "warn" : "ok"} />
                </div>
                <p className="mt-3"><strong className="text-ink">Cell id:</strong> {selectedStyleIntensityCell.cellId}</p>
                <p><strong className="text-ink">Intensity value:</strong> {selectedStyleIntensityCell.intensityValue}</p>
                <p><strong className="text-ink">HIGH approval required:</strong> {selectedStyleIntensityCell.highProbeApprovalRequired ? "yes" : "no"}</p>
                <p><strong className="text-ink">Manual selection:</strong> {selectedStyleIntensityCell.manualSelectionAllowed ? "required" : "blocked"}</p>
              </div>
            ) : null}
            {styleIntensityHarnessState ? (
              <div className="mt-4 rounded-[1.25rem] border border-ink/10 bg-white/85 p-4 text-sm leading-7 body-muted">
                <p><strong className="text-ink">Active style:</strong> {styleIntensityHarnessState.activeStyleId}</p>
                <p><strong className="text-ink">Active domain:</strong> {styleIntensityHarnessState.activeDomainId}</p>
                <p><strong className="text-ink">Active intensity:</strong> {styleIntensityHarnessState.activeIntensityLevel} ({styleIntensityHarnessState.intensityValue})</p>
                <p><strong className="text-ink">Intensity runs tested:</strong> {styleIntensityHarnessState.testedIntensityCount}</p>
                <p><strong className="text-ink">Passed:</strong> {styleIntensityHarnessState.passedIntensityCount}</p>
                <p><strong className="text-ink">Failed:</strong> {styleIntensityHarnessState.failedIntensityCount}</p>
                {styleIntensityHarnessState.weakestIntensityLevel ? <p><strong className="text-ink">Weakest intensity:</strong> {styleIntensityHarnessState.weakestIntensityLevel}</p> : null}
                <p><strong className="text-ink">Rollback restored latest intensity run:</strong> {styleIntensityHarnessState.rollbackRestoredIntensityRun ? "yes" : "no"}</p>
              </div>
            ) : (
              <p className="mt-5 text-sm leading-7 body-muted">Run starter intensity cells manually to compare how far each approved style can be pushed inside governed preview limits.</p>
            )}
          </article>
        </section>

        <section className="mb-6">
          <article className="glass-card rounded-[2rem] p-6 shadow-float">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="section-label">Intensity Report</p>
                <h2 className="mt-3 text-2xl font-semibold text-ink">Cross-Intensity Diagnostic Summary</h2>
              </div>
              {styleIntensitySummary ? <StatusPill label={styleIntensitySummary.recommendedNextAction.toLowerCase().replaceAll("_", "-")} tone={styleIntensitySummary.recommendedNextAction === "CONTINUE_INTENSITY_TESTING" ? "ok" : styleIntensitySummary.recommendedNextAction === "TUNE_STYLE_INTENSITY" ? "warn" : "blocked"} /> : null}
            </div>
            {styleIntensitySummary ? (
              <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                <div className="rounded-[1.25rem] border border-ink/10 bg-white/85 p-4 text-sm leading-7 body-muted">
                  <p><strong className="text-ink">Intensity runs:</strong> {styleIntensitySummary.testedIntensityCount}</p>
                  <p><strong className="text-ink">Passed:</strong> {styleIntensitySummary.passedIntensityCount}</p>
                  <p><strong className="text-ink">Failed:</strong> {styleIntensitySummary.failedIntensityCount}</p>
                  {styleIntensitySummary.safestHighIntensityStyleId ? <p><strong className="text-ink">Safest HIGH style:</strong> {styleIntensitySummary.safestHighIntensityStyleId}</p> : null}
                  {styleIntensitySummary.riskiestHighIntensityStyleId ? <p><strong className="text-ink">Riskiest HIGH style:</strong> {styleIntensitySummary.riskiestHighIntensityStyleId}</p> : null}
                  {styleIntensitySummary.strongestCellId ? <p><strong className="text-ink">Strongest cell:</strong> {styleIntensitySummary.strongestCellId}</p> : null}
                  {styleIntensitySummary.weakestCellId ? <p><strong className="text-ink">Weakest cell:</strong> {styleIntensitySummary.weakestCellId}</p> : null}
                  <p><strong className="text-ink">Average scene cohesion:</strong> {styleIntensitySummary.averageSceneCohesion}/100</p>
                  <p><strong className="text-ink">Average style readability:</strong> {styleIntensitySummary.averageStyleReadability}/100</p>
                  <p><strong className="text-ink">Average lighting stability:</strong> {styleIntensitySummary.averageLightingStability}/100</p>
                  <p><strong className="text-ink">Average reflection continuity:</strong> {styleIntensitySummary.averageReflectionContinuity}/100</p>
                  <p><strong className="text-ink">Rollback pass rate:</strong> {Math.round(styleIntensitySummary.rollbackPassRate * 100)}%</p>
                  <p><strong className="text-ink">LOW lighting avg:</strong> {styleIntensitySummary.averageLightingStabilityByIntensity.LOW}/100</p>
                  <p><strong className="text-ink">MEDIUM lighting avg:</strong> {styleIntensitySummary.averageLightingStabilityByIntensity.MEDIUM}/100</p>
                  <p><strong className="text-ink">HIGH lighting avg:</strong> {styleIntensitySummary.averageLightingStabilityByIntensity.HIGH}/100</p>
                  {styleIntensitySummary.recommendedRuntimeLayer ? <p><strong className="text-ink">Inspect runtime layer:</strong> {styleIntensitySummary.recommendedRuntimeLayer}</p> : null}
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {styleIntensityReports.map((report) => (
                    <article key={report.cellId} className="rounded-[1.25rem] border border-ink/10 bg-white/90 p-4 shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-ink">{report.styleLabel} × {report.domainLabel}</p>
                        <StatusPill label={`${report.executionStatus.toLowerCase()}-${report.intensityLevel.toLowerCase()}`} tone={styleIntensityStatusTone(report)} />
                      </div>
                      <p className="mt-2 text-xs uppercase tracking-[0.18em] text-slate">{report.styleCategory.toLowerCase().replaceAll("_", "-")} • {report.domainCategory.toLowerCase().replaceAll("_", "-")}</p>
                      <div className="mt-3 space-y-1 text-sm leading-7 body-muted">
                        <p><strong className="text-ink">Safety:</strong> {report.safetyStatus}</p>
                        <p><strong className="text-ink">Intensity:</strong> {report.intensityLevel} ({report.intensityValue})</p>
                        {report.compatibility ? <p><strong className="text-ink">Compatibility score:</strong> {report.compatibility.compatibilityScore}/100</p> : null}
                        {report.metrics ? <p><strong className="text-ink">Scene cohesion:</strong> {report.metrics.sceneCohesion}/100</p> : null}
                        {report.metrics ? <p><strong className="text-ink">Style readability:</strong> {report.metrics.styleReadability}/100</p> : null}
                        {report.metrics ? <p><strong className="text-ink">Lighting stability:</strong> {report.metrics.lightingStability}/100</p> : null}
                        {report.metrics ? <p><strong className="text-ink">Reflection continuity:</strong> {report.metrics.reflectionContinuity}/100</p> : null}
                        {report.metrics ? <p><strong className="text-ink">Silhouette readability:</strong> {report.metrics.silhouetteReadability}/100</p> : null}
                        {report.metrics ? <p><strong className="text-ink">Atmosphere clarity:</strong> {report.metrics.atmosphereClarity}/100</p> : null}
                        {report.strongestMetric ? <p><strong className="text-ink">Strongest metric:</strong> {report.strongestMetricScore !== null ? `${report.strongestMetric} (${report.strongestMetricScore})` : report.strongestMetric}</p> : null}
                        {report.weakestMetric ? <p><strong className="text-ink">Weakest metric:</strong> {report.weakestMetricScore !== null ? `${report.weakestMetric} (${report.weakestMetricScore})` : report.weakestMetric}</p> : null}
                        {report.failureClassification ? <p><strong className="text-ink">Failure class:</strong> {report.failureClassification.code}</p> : null}
                        {report.failureClassification ? <p><strong className="text-ink">Inspect layer:</strong> {report.failureClassification.inspectLayer}</p> : null}
                        <p><strong className="text-ink">Rollback visible:</strong> {report.rollbackVisible ? "yes" : "no"}</p>
                        <p><strong className="text-ink">Rollback restored intensity:</strong> {report.rollbackRestoredIntensityRun ? "yes" : "no"}</p>
                        {report.failureReason ? <p><strong className="text-ink">Failure reason:</strong> {report.failureReason}</p> : null}
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mt-5 text-sm leading-7 body-muted">Run starter style intensity cells manually to build the bounded cross-intensity operator report.</p>
            )}
          </article>
        </section>

        <section className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <article className="glass-card rounded-[2rem] p-6 shadow-float">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="section-label">HIGH Probe Harness</p>
                <h2 className="mt-3 text-2xl font-semibold text-ink">Approved HIGH-Intensity Visual Probes</h2>
              </div>
              {highIntensityPlan ? <StatusPill label={`max-${highIntensityPlan.maxHighProbes}-high-probes`} tone="warn" /> : null}
            </div>
            <p className="mt-3 text-sm leading-7 body-muted">
              Explicit HIGH probes only. Each run applies deterministic visual caps, preserves rollback visibility, and requires manual approval plus separate HIGH approval.
            </p>
            {highIntensityPlan ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {highIntensityPlan.stages.map((stage) => (
                  <StatusPill key={stage} label={stage} tone="default" />
                ))}
              </div>
            ) : null}
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-[1.25rem] border border-ink/10 bg-white/85 p-4 text-sm leading-7 body-muted">
                <p><strong className="text-ink">Approved HIGH probes:</strong> {approvedHighIntensityProbes.length}</p>
                <p><strong className="text-ink">HIGH approval:</strong> {highProbeApproval ? "granted" : "required"}</p>
                <p><strong className="text-ink">Automatic repeat:</strong> blocked</p>
                <p><strong className="text-ink">Auto escalation:</strong> blocked</p>
                <p><strong className="text-ink">Runtime mutation:</strong> blocked</p>
              </div>
              <label className="flex gap-3 rounded-[1.25rem] border border-amber-200 bg-amber-50 p-4 text-sm leading-7 text-amber-900">
                <input
                  type="checkbox"
                  checked={highProbeApproval}
                  onChange={(event) => setHighProbeApproval(event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-amber-300"
                />
                <span>
                  <strong className="block text-ink">HIGH Probe Approval</strong>
                  I explicitly approve one guarded HIGH probe with visual caps, rollback preservation, and no autonomous follow-up.
                </span>
              </label>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {approvedHighIntensityProbes.map((probe) => {
                const latestReport = highIntensityReports.find((entry) => entry.probeId === probe.probeId) ?? null;
                return (
                  <article key={probe.probeId} className={`rounded-[1.25rem] border p-4 ${selectedHighIntensityProbeId === probe.probeId ? "border-ocean/30 bg-ocean/5" : "border-amber-200 bg-amber-50/80"}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-ink">{probe.styleLabel} × {probe.domainLabel}</p>
                      <StatusPill label="high" tone="warn" />
                    </div>
                    <p className="mt-2 text-xs uppercase tracking-[0.18em] text-slate">{probe.probeId.toLowerCase().replaceAll("_", "-")}</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em] text-slate">
                      <span className="rounded-full border border-amber-200 bg-amber-100 px-3 py-1 text-amber-800">approval-required</span>
                      <span className="rounded-full border border-ink/10 bg-mist/60 px-3 py-1">value-{probe.intensityValue}</span>
                      <span className="rounded-full border border-ink/10 bg-mist/60 px-3 py-1">rollback-required</span>
                    </div>
                    {latestReport ? (
                      <div className="mt-3 rounded-[1rem] border border-ink/10 bg-white/80 p-3 text-sm leading-7 body-muted">
                        <p><strong className="text-ink">Last result:</strong> {latestReport.executionStatus}</p>
                        <p><strong className="text-ink">Caps:</strong> {latestReport.visualCaps.visibleCaps.join(", ")}</p>
                        {latestReport.failureAnalysis ? <p><strong className="text-ink">Failure:</strong> {latestReport.failureAnalysis.failureType}</p> : null}
                      </div>
                    ) : null}
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => loadApprovedHighIntensityProbe(probe)}
                        className="rounded-full border border-ink/10 bg-white px-4 py-2 text-xs font-semibold text-ink transition hover:-translate-y-0.5"
                      >
                        Load HIGH Probe
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRunHighIntensityProbe(probe.probeId)}
                        disabled={isPending || !highProbeApproval || !form.governance_approval}
                        className="rounded-full border border-ocean/20 bg-ocean px-4 py-2 text-xs font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Run HIGH Probe
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </article>

          <article className="glass-card rounded-[2rem] p-6 shadow-float">
            <p className="section-label">HIGH Probe State</p>
            <h2 className="mt-3 text-2xl font-semibold text-ink">Approval, Caps, Rollback</h2>
            {selectedHighIntensityProbe ? (
              <div className="mt-5 rounded-[1.25rem] border border-ink/10 bg-white/85 p-4 text-sm leading-7 body-muted">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill label={selectedHighIntensityProbe.styleLabel.toLowerCase().replaceAll("_", "-")} tone="default" />
                  <StatusPill label={selectedHighIntensityProbe.domainLabel.toLowerCase().replaceAll("_", "-")} tone="default" />
                  <StatusPill label="high" tone="warn" />
                </div>
                <p className="mt-3"><strong className="text-ink">Probe id:</strong> {selectedHighIntensityProbe.probeId}</p>
                <p><strong className="text-ink">Cell id:</strong> {selectedHighIntensityProbe.cellId}</p>
                <p><strong className="text-ink">Approval required:</strong> {selectedHighIntensityProbe.approvalRequired ? "yes" : "no"}</p>
                <p><strong className="text-ink">Rollback required:</strong> {selectedHighIntensityProbe.rollbackRequired ? "yes" : "no"}</p>
              </div>
            ) : null}
            {highIntensityHarnessState ? (
              <div className="mt-4 rounded-[1.25rem] border border-ink/10 bg-white/85 p-4 text-sm leading-7 body-muted">
                <p><strong className="text-ink">Active style:</strong> {highIntensityHarnessState.activeStyleId}</p>
                <p><strong className="text-ink">Active domain:</strong> {highIntensityHarnessState.activeDomainId}</p>
                <p><strong className="text-ink">Approved HIGH execution:</strong> {highIntensityHarnessState.approvedHighExecution ? "yes" : "no"}</p>
                <p><strong className="text-ink">HIGH probes executed:</strong> {highIntensityHarnessState.highProbeExecutionCount}</p>
                <p><strong className="text-ink">Failed HIGH probes:</strong> {highIntensityHarnessState.failedHighProbeCount}</p>
                <p><strong className="text-ink">Rollback restored latest HIGH probe:</strong> {highIntensityHarnessState.rollbackRestoredHighProbe ? "yes" : "no"}</p>
                {highIntensityHarnessState.lastFailureType ? <p><strong className="text-ink">Last failure:</strong> {highIntensityHarnessState.lastFailureType}</p> : null}
              </div>
            ) : (
              <p className="mt-5 text-sm leading-7 body-muted">Run approved HIGH probes manually to compare how far bounded stylization can go before readability or coherence degrades.</p>
            )}
          </article>
        </section>

        <section className="mb-6">
          <article className="glass-card rounded-[2rem] p-6 shadow-float">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="section-label">HIGH Probe Report</p>
                <h2 className="mt-3 text-2xl font-semibold text-ink">High-Stylization Diagnostic Summary</h2>
              </div>
              {highIntensitySummary ? <StatusPill label={highIntensitySummary.recommendedNextAction.toLowerCase().replaceAll("_", "-")} tone={highIntensitySummary.recommendedNextAction === "CONTINUE_HIGH_PROBES" ? "ok" : highIntensitySummary.recommendedNextAction === "TUNE_VISUAL_CAPS" ? "warn" : "blocked"} /> : null}
            </div>
            {highIntensitySummary ? (
              <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                <div className="rounded-[1.25rem] border border-ink/10 bg-white/85 p-4 text-sm leading-7 body-muted">
                  <p><strong className="text-ink">HIGH probes:</strong> {highIntensitySummary.testedHighProbeCount}</p>
                  <p><strong className="text-ink">Passed:</strong> {highIntensitySummary.passedHighProbeCount}</p>
                  <p><strong className="text-ink">Failed:</strong> {highIntensitySummary.failedHighProbeCount}</p>
                  {highIntensitySummary.safestHighStyleId ? <p><strong className="text-ink">Safest HIGH style:</strong> {highIntensitySummary.safestHighStyleId}</p> : null}
                  {highIntensitySummary.riskiestHighStyleId ? <p><strong className="text-ink">Riskiest HIGH style:</strong> {highIntensitySummary.riskiestHighStyleId}</p> : null}
                  {highIntensitySummary.strongestProbeId ? <p><strong className="text-ink">Strongest probe:</strong> {highIntensitySummary.strongestProbeId}</p> : null}
                  {highIntensitySummary.weakestProbeId ? <p><strong className="text-ink">Weakest probe:</strong> {highIntensitySummary.weakestProbeId}</p> : null}
                  <p><strong className="text-ink">Average HIGH readability:</strong> {highIntensitySummary.averageHighReadability}/100</p>
                  <p><strong className="text-ink">Average silhouette preservation:</strong> {highIntensitySummary.averageHighSilhouettePreservation}/100</p>
                  <p><strong className="text-ink">Average lighting stability:</strong> {highIntensitySummary.averageHighLightingStability}/100</p>
                  <p><strong className="text-ink">Average reflection continuity:</strong> {highIntensitySummary.averageHighReflectionContinuity}/100</p>
                  <p><strong className="text-ink">Average environmental identity:</strong> {highIntensitySummary.averageHighEnvironmentalIdentity}/100</p>
                  <p><strong className="text-ink">Average transition continuity:</strong> {highIntensitySummary.averageHighTransitionContinuity}/100</p>
                  <p><strong className="text-ink">Average composition readability:</strong> {highIntensitySummary.averageHighCompositionReadability}/100</p>
                  <p><strong className="text-ink">Rollback pass rate:</strong> {Math.round(highIntensitySummary.rollbackPassRate * 100)}%</p>
                  {highIntensitySummary.recommendedRuntimeLayer ? <p><strong className="text-ink">Inspect runtime layer:</strong> {highIntensitySummary.recommendedRuntimeLayer}</p> : null}
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {highIntensityReports.map((report) => (
                    <article key={report.probeId} className="rounded-[1.25rem] border border-ink/10 bg-white/90 p-4 shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-ink">{report.styleLabel} × {report.domainLabel}</p>
                        <StatusPill label={report.executionStatus.toLowerCase()} tone={highIntensityStatusTone(report)} />
                      </div>
                      <p className="mt-2 text-xs uppercase tracking-[0.18em] text-slate">{report.probeId.toLowerCase().replaceAll("_", "-")}</p>
                      <div className="mt-3 space-y-1 text-sm leading-7 body-muted">
                        <p><strong className="text-ink">HIGH approval:</strong> {report.highProbeApproved ? "approved" : "blocked"}</p>
                        <p><strong className="text-ink">Safety caps:</strong> {report.visualCaps.visibleCaps.join(", ")}</p>
                        {report.compatibility ? <p><strong className="text-ink">Compatibility score:</strong> {report.compatibility.compatibilityScore}/100</p> : null}
                        {report.metrics ? <p><strong className="text-ink">HIGH readability:</strong> {report.metrics.highReadabilityScore}/100</p> : null}
                        {report.metrics ? <p><strong className="text-ink">Scene cohesion:</strong> {report.metrics.sceneCohesion}/100</p> : null}
                        {report.metrics ? <p><strong className="text-ink">Style readability:</strong> {report.metrics.styleReadability}/100</p> : null}
                        {report.metrics ? <p><strong className="text-ink">Silhouette readability:</strong> {report.metrics.silhouetteReadability}/100</p> : null}
                        {report.metrics ? <p><strong className="text-ink">Lighting stability:</strong> {report.metrics.lightingStability}/100</p> : null}
                        {report.metrics ? <p><strong className="text-ink">Reflection continuity:</strong> {report.metrics.reflectionContinuity}/100</p> : null}
                        {report.metrics ? <p><strong className="text-ink">Transition smoothness:</strong> {report.metrics.transitionSmoothness}/100</p> : null}
                        {report.metrics ? <p><strong className="text-ink">Preview readability:</strong> {report.metrics.previewReadability}/100</p> : null}
                        {report.strongestMetric ? <p><strong className="text-ink">Strongest metric:</strong> {report.strongestMetricScore !== null ? `${report.strongestMetric} (${report.strongestMetricScore})` : report.strongestMetric}</p> : null}
                        {report.weakestMetric ? <p><strong className="text-ink">Weakest metric:</strong> {report.weakestMetricScore !== null ? `${report.weakestMetric} (${report.weakestMetricScore})` : report.weakestMetric}</p> : null}
                        {report.failureAnalysis ? <p><strong className="text-ink">Failure class:</strong> {report.failureAnalysis.failureType}</p> : null}
                        {report.failureAnalysis ? <p><strong className="text-ink">Weakest subsystem:</strong> {report.failureAnalysis.weakestSubsystem}</p> : null}
                        {report.recoveryRecommendation ? <p><strong className="text-ink">Recovery:</strong> {report.recoveryRecommendation.recommendation}</p> : null}
                        <p><strong className="text-ink">Rollback visible:</strong> {report.rollbackVisible ? "yes" : "no"}</p>
                        <p><strong className="text-ink">Rollback restored HIGH probe:</strong> {report.rollbackRestoredHighProbe ? "yes" : "no"}</p>
                        {report.failureReason ? <p><strong className="text-ink">Failure reason:</strong> {report.failureReason}</p> : null}
                      </div>
                      {report.failedThresholds.length ? (
                        <ul className="mt-3 space-y-2 text-sm leading-7 body-muted">
                          {report.failedThresholds.map((failure) => (
                            <li key={`${report.probeId}-${failure.metric}`} className="rounded-[1rem] border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
                              {failure.metric}: {String(failure.actual)} required {failure.required} ({failure.recommendedRuntimeLayer})
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </article>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mt-5 text-sm leading-7 body-muted">Run guarded HIGH probes manually to build the high-stylization operator report.</p>
            )}
          </article>
        </section>

        <section className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <article className="glass-card rounded-[2rem] p-6 shadow-float">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="section-label">Anime Character Rendering</p>
                <h2 className="mt-3 text-2xl font-semibold text-ink">Approved Character Profiles</h2>
              </div>
              {animeCharacterPlan ? <StatusPill label={`max-${animeCharacterPlan.maxProfiles}-profiles`} tone="ok" /> : null}
            </div>
            <p className="mt-3 text-sm leading-7 body-muted">
              Single young-adult anime character only. Character approval is separate from manual preview approval. No dialogue, lip-sync, combat choreography, cast expansion, or autonomous follow-up.
            </p>
            {animeCharacterPlan ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {animeCharacterPlan.stages.map((stage) => (
                  <StatusPill key={stage} label={stage} tone="default" />
                ))}
              </div>
            ) : null}
            <label className="mt-5 flex items-start gap-3 rounded-[1.25rem] border border-coral/20 bg-white/80 p-4">
              <input
                type="checkbox"
                checked={animeCharacterApproval}
                onChange={(event) => setAnimeCharacterApproval(event.target.checked)}
                  data-guided-focus="anime-character-approval"
                className="mt-1 h-4 w-4 rounded border border-ink/10"
              />
              <span className="text-sm leading-7 body-muted">
                <strong className="block text-ink">Anime Character Approval</strong>
                I explicitly approve one governed anime character render with face readability, silhouette readability, pose readability, rollback preservation, and no autonomous continuation.
              </span>
            </label>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {approvedAnimeCharacterProfiles.map((profile) => (
                <article key={profile.id} className={`rounded-[1.25rem] border p-4 ${selectedAnimeCharacterProfileId === profile.id ? "border-ocean/30 bg-ocean/5" : "border-ink/10 bg-white/85"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-ink">{profile.label}</p>
                    <StatusPill label={profile.genderPresentation.replaceAll(" ", "-")} tone="default" />
                  </div>
                  <p className="mt-3 text-sm leading-7 body-muted">{profile.promptSubject}. {profile.outfitDescription}.</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em] text-slate">
                    {profile.visualIdentity.map((identity) => (
                      <span key={`${profile.id}-${identity}`} className="rounded-full border border-ink/10 bg-mist/60 px-3 py-1">{identity}</span>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => loadApprovedAnimeCharacter(profile)}
                      className="rounded-full border border-ink/10 bg-white px-4 py-2 text-xs font-semibold text-ink transition hover:-translate-y-0.5"
                    >
                      Load Character
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRunAnimeCharacter(profile.id)}
                      disabled={executionLocked || !animeCharacterApproval || !form.governance_approval}
                      className="rounded-full border border-ocean/20 bg-ocean px-4 py-2 text-xs font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {governedExecutionState.previewInProgress ? "Processing..." : "Render Character"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </article>

          <article className="glass-card rounded-[2rem] p-6 shadow-float">
            <p className="section-label">Character State</p>
            <h2 className="mt-3 text-2xl font-semibold text-ink">Face And Silhouette Gate</h2>
            {selectedAnimeCharacterProfile ? (
              <div className="mt-5 rounded-[1.25rem] border border-ink/10 bg-white/85 p-4 text-sm leading-7 body-muted">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill label={selectedAnimeCharacterProfile.label.toLowerCase().replaceAll("_", "-")} tone="default" />
                  <StatusPill label="single-character" tone="ok" />
                </div>
                <p className="mt-3"><strong className="text-ink">Eyes:</strong> {selectedAnimeCharacterProfile.eyeDescription}</p>
                <p><strong className="text-ink">Hair:</strong> {selectedAnimeCharacterProfile.hairDescription}</p>
                <p><strong className="text-ink">Default pose:</strong> {selectedAnimeCharacterProfile.poseDefault}</p>
                <p><strong className="text-ink">Default expression:</strong> {selectedAnimeCharacterProfile.expressionDefault}</p>
              </div>
            ) : null}
            {animeCharacterHarnessState ? (
              <div className="mt-4 rounded-[1.25rem] border border-ink/10 bg-white/85 p-4 text-sm leading-7 body-muted">
                <p><strong className="text-ink">Active profile:</strong> {animeCharacterHarnessState.activeCharacterProfileId}</p>
                <p><strong className="text-ink">Approved character execution:</strong> {animeCharacterHarnessState.approvedCharacterExecution ? "yes" : "no"}</p>
                <p><strong className="text-ink">Character renders executed:</strong> {animeCharacterHarnessState.characterRenderExecutionCount}</p>
                <p><strong className="text-ink">Failed character renders:</strong> {animeCharacterHarnessState.failedCharacterRenderCount}</p>
                <p><strong className="text-ink">Rollback restored latest character run:</strong> {animeCharacterHarnessState.rollbackRestoredCharacterRun ? "yes" : "no"}</p>
                <p><strong className="text-ink">Scaffold status:</strong> {animeCharacterHarnessState.scaffoldStatus}</p>
                <p><strong className="text-ink">Renderer path:</strong> {animeCharacterHarnessState.rendererPath}</p>
                <p><strong className="text-ink">Fallback dominance:</strong> {animeCharacterHarnessState.fallbackPrimitiveDominance ? "yes" : "no"}</p>
                <p><strong className="text-ink">User visual review ready:</strong> {animeCharacterHarnessState.visualReviewReady ? "yes" : "no"}</p>
                {animeCharacterHarnessState.lastCharacterFailureType ? <p><strong className="text-ink">Last failure:</strong> {animeCharacterHarnessState.lastCharacterFailureType}</p> : null}
              </div>
            ) : (
              <p className="mt-5 text-sm leading-7 body-muted">Render approved anime profiles manually to test how obvious character identity can become before face, silhouette, pose, or scene integration degrades.</p>
            )}
          </article>
        </section>

        </CollapsibleActivitySection>

        <section className="mb-6">
          <CollapsibleActivitySection
            sectionLabel="Anime Character Report"
            title="Character-Centered Diagnostic Summary"
            activity={animeSummaryActivity}
            defaultOpen={animeSummaryActivity.critical}
            sectionDomId="anime-character-report-section"
            {...guidedSectionProps("anime-character-report")}
          >
            <div data-guided-highlight="anime-character-report" data-guided-focus="anime-character-truth-check" tabIndex={-1} className={`mt-5 scroll-mt-6 rounded-[1.25rem] border p-4 ${guidedTargetHighlightClass(isGuidedHighlightActive("anime-character-report"))}`}>
              <GuidedTargetCallout active={isGuidedHighlightActive("anime-character-report")} label={activeGuidedTarget.calloutLabel} instruction={activeGuidedTarget.instruction} />
            {animeCharacterSummary ? (
              <div className="mb-4 flex flex-wrap gap-2">
                <StatusPill label={animeCharacterSummary.recommendedNextAction.toLowerCase().replaceAll("_", "-")} tone={animeCharacterSummary.recommendedNextAction === "CONTINUE_CHARACTER_RENDERS" ? "ok" : animeCharacterSummary.recommendedNextAction === "TUNE_CHARACTER_FRAMING" ? "warn" : "blocked"} />
                <StatusPill label={animeCharacterSummary.scaffoldStatus.toLowerCase().replaceAll("_", "-")} tone={animeCharacterSummary.scaffoldStatus === "REAL_OUTPUT_ACTIVE" ? "ok" : animeCharacterSummary.scaffoldStatus === "PARTIAL_REAL_OUTPUT" ? "warn" : "blocked"} />
              </div>
            ) : null}
            {animeCharacterSummary ? (
              <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                <div className="rounded-[1.25rem] border border-ink/10 bg-white/85 p-4 text-sm leading-7 body-muted">
                  <p><strong className="text-ink">Characters tested:</strong> {animeCharacterSummary.testedCharacterCount}</p>
                  <p><strong className="text-ink">Passed:</strong> {animeCharacterSummary.passedCharacterCount}</p>
                  <p><strong className="text-ink">Failed:</strong> {animeCharacterSummary.failedCharacterCount}</p>
                  {animeCharacterSummary.strongestCharacterProfileId ? <p><strong className="text-ink">Strongest profile:</strong> {animeCharacterSummary.strongestCharacterProfileId}</p> : null}
                  {animeCharacterSummary.weakestCharacterProfileId ? <p><strong className="text-ink">Weakest profile:</strong> {animeCharacterSummary.weakestCharacterProfileId}</p> : null}
                  <p><strong className="text-ink">Average face readability:</strong> {animeCharacterSummary.averageFaceReadability}/100</p>
                  <p><strong className="text-ink">Average silhouette clarity:</strong> {animeCharacterSummary.averageSilhouetteClarity}/100</p>
                  <p><strong className="text-ink">Average pose readability:</strong> {animeCharacterSummary.averagePoseReadability}/100</p>
                  <p><strong className="text-ink">Average anime identity:</strong> {animeCharacterSummary.averageAnimeStyleIdentity}/100</p>
                  <p><strong className="text-ink">Average scene integration:</strong> {animeCharacterSummary.averageCharacterSceneIntegration}/100</p>
                  <p><strong className="text-ink">Average focus priority:</strong> {animeCharacterSummary.averageCharacterFocusPriority}/100</p>
                  <p><strong className="text-ink">Rollback pass rate:</strong> {Math.round(animeCharacterSummary.rollbackPassRate * 100)}%</p>
                    <p><strong className="text-ink">Scaffold status:</strong> {animeCharacterSummary.scaffoldStatus}</p>
                    <p><strong className="text-ink">Visual review ready:</strong> {animeCharacterSummary.visualReviewReadyCount}</p>
                    <p><strong className="text-ink">Fallback primitive dominance:</strong> {animeCharacterSummary.fallbackPrimitiveDominanceCount}</p>
                  {animeCharacterSummary.recommendedRuntimeLayer ? <p><strong className="text-ink">Inspect runtime layer:</strong> {animeCharacterSummary.recommendedRuntimeLayer}</p> : null}
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {animeCharacterReports.map((report) => {
                    const reportActivity = buildAnimeReportActivity(report);
                    return (
                    <article key={report.characterProfileId} className="rounded-[1.25rem] border border-ink/10 bg-white/90 p-4 shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-ink">{report.characterLabel}</p>
                        <div className="flex flex-wrap gap-2">
                          <StatusPill label={report.executionStatus.toLowerCase()} tone={animeCharacterStatusTone(report)} />
                          <StatusPill label={reportActivity.label} tone={statusToneFromActivity(reportActivity.tone)} />
                        </div>
                      </div>
                      <p className="mt-2 text-xs uppercase tracking-[0.18em] text-slate">{report.characterProfileId.toLowerCase().replaceAll("_", "-")}</p>
                      <div className="mt-3 space-y-1 text-sm leading-7 body-muted">
                        <p><strong className="text-ink">Character approval:</strong> {report.characterApproved ? "approved" : "blocked"}</p>
                        <p><strong className="text-ink">Pose:</strong> {report.poseLabel}</p>
                        <p><strong className="text-ink">Expression:</strong> {report.expressionLabel}</p>
                        <details className="rounded-[1rem] border border-ink/10 bg-mist/50 p-3" open={reportActivity.critical}>
                          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.18em] text-ink">Scaffold And Truth Check</summary>
                          <div className="mt-3 space-y-1">
                            <p><strong className="text-ink">Scaffold status:</strong> {report.scaffoldStatus}</p>
                            <p><strong className="text-ink">Renderer path:</strong> {report.truthCheck.renderer_path}</p>
                            <p><strong className="text-ink">Character pixels generated:</strong> {report.truthCheck.character_pixels_generated ? "yes" : "no"}</p>
                            <p><strong className="text-ink">Character primary subject:</strong> {report.truthCheck.character_primary_subject ? "yes" : "no"}</p>
                            <p><strong className="text-ink">Fallback primitive dominance:</strong> {report.truthCheck.fallback_primitive_dominance ? "yes" : "no"}</p>
                            <p><strong className="text-ink">Diagnostics match output:</strong> {report.truthCheck.diagnostics_match_rendered_output ? "yes" : "no"}</p>
                          </div>
                        </details>
                        {report.compatibility ? <p><strong className="text-ink">Compatibility score:</strong> {report.compatibility.compatibilityScore}/100</p> : null}
                        {report.metrics ? (
                          <details className="rounded-[1rem] border border-ink/10 bg-white/70 p-3">
                            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.18em] text-ink">Validation Results</summary>
                            <div className="mt-3 space-y-1">
                              <p><strong className="text-ink">Face readability:</strong> {report.metrics.characterFaceReadability}/100</p>
                              <p><strong className="text-ink">Silhouette:</strong> {report.metrics.characterSilhouette}/100</p>
                              <p><strong className="text-ink">Pose readability:</strong> {report.metrics.characterPoseReadability}/100</p>
                              <p><strong className="text-ink">Anime identity:</strong> {report.metrics.animeStyleIdentity}/100</p>
                              <p><strong className="text-ink">Scene integration:</strong> {report.metrics.characterSceneIntegration}/100</p>
                              <p><strong className="text-ink">Focus priority:</strong> {report.metrics.characterFocusPriority}/100</p>
                            </div>
                          </details>
                        ) : null}
                        {report.failureAnalysis ? <p><strong className="text-ink">Failure class:</strong> {report.failureAnalysis.failureType}</p> : null}
                        {report.recoveryRecommendation ? <p><strong className="text-ink">Recovery:</strong> {report.recoveryRecommendation.recommendation}</p> : null}
                        <p><strong className="text-ink">Rollback visible:</strong> {report.rollbackVisible ? "yes" : "no"}</p>
                        <p><strong className="text-ink">Rollback restored character run:</strong> {report.rollbackRestoredCharacterRun ? "yes" : "no"}</p>
                        {report.visualReviewPackage ? (
                          <details className="rounded-[1rem] border border-amber-200 bg-amber-50 p-3" open={report.visualReviewPackage.reviewLabel === "USER_VISUAL_CHECK_READY"}>
                            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.18em] text-amber-800">Visual Review Package</summary>
                            <div className="mt-3 space-y-1 text-amber-800">
                              <p><strong>Visual review:</strong> {report.visualReviewPackage.reviewLabel}</p>
                              {report.visualReviewPackage.firstPngToInspect ? <p><strong>First PNG:</strong> {report.visualReviewPackage.firstPngToInspect}</p> : null}
                              {report.visualReviewPackage.gifToInspect ? <p><strong>GIF:</strong> {report.visualReviewPackage.gifToInspect}</p> : null}
                              {report.visualReviewPackage.operatorSummaryPath ? <p><strong>Review summary:</strong> {report.visualReviewPackage.operatorSummaryPath}</p> : null}
                            </div>
                          </details>
                        ) : null}
                        {report.failureReason ? <p><strong className="text-ink">Failure reason:</strong> {report.failureReason}</p> : null}
                      </div>
                    </article>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="mt-5 text-sm leading-7 body-muted">Run governed anime character renders manually to build the character-centered report.</p>
            )}
            </div>
          </CollapsibleActivitySection>
        </section>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <CollapsibleActivitySection
            sectionLabel="Execution Controls"
            title="Request Form And Preview Actions"
            activity={requestControlsActivity}
            defaultOpen={false}
            sectionDomId="execution-controls-section"
            {...guidedSectionProps("execution-controls")}
          >
            <div
              id="request-form-section"
              data-guided-highlight="request-form"
              className={`mt-5 grid scroll-mt-6 gap-4 rounded-[1.25rem] border p-4 md:grid-cols-2 ${guidedTargetHighlightClass(isGuidedHighlightActive("request-form"))}`}
            >
              <div className="md:col-span-2">
                <GuidedTargetCallout active={isGuidedHighlightActive("request-form")} label={activeGuidedTarget.calloutLabel} instruction={activeGuidedTarget.instruction} />
              </div>
              <label className="flex flex-col gap-2 rounded-[1.25rem] border border-ink/10 bg-white/80 p-4 md:col-span-2">
                <FieldLabel>Prompt</FieldLabel>
                <textarea
                  value={form.prompt}
                  onChange={(event) => updateField("prompt", event.target.value)}
                  data-guided-focus="prompt-input"
                  rows={6}
                  className="rounded-xl border border-ink/10 bg-white px-3 py-3 text-sm text-ink outline-none"
                  placeholder="Describe the governed preview clip you want to sandbox."
                />
              </label>

              <label className="flex flex-col gap-2 rounded-[1.25rem] border border-ink/10 bg-white/80 p-4">
                <FieldLabel>Subject</FieldLabel>
                <input
                  value={form.subject}
                  onChange={(event) => updateField("subject", event.target.value)}
                  data-guided-focus="subject-input"
                  className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-sm text-ink outline-none"
                  placeholder="Primary subject"
                />
              </label>

              <label className="flex flex-col gap-2 rounded-[1.25rem] border border-ink/10 bg-white/80 p-4">
                <FieldLabel>Motion</FieldLabel>
                <input
                  value={form.motion_intent}
                  onChange={(event) => updateField("motion_intent", event.target.value)}
                  className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-sm text-ink outline-none"
                  placeholder="Bounded motion intent"
                />
              </label>

              <label className="flex flex-col gap-2 rounded-[1.25rem] border border-ink/10 bg-white/80 p-4">
                <FieldLabel>Style</FieldLabel>
                <input
                  value={form.style}
                  onChange={(event) => updateField("style", event.target.value)}
                  className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-sm text-ink outline-none"
                  placeholder="Visual style"
                />
              </label>

              <label className="flex flex-col gap-2 rounded-[1.25rem] border border-ink/10 bg-white/80 p-4">
                <FieldLabel>Continuity Priority</FieldLabel>
                <select
                  value={form.continuity_priority}
                  onChange={(event) => updateField("continuity_priority", event.target.value as GovernedPreviewFormInput["continuity_priority"])}
                  className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-sm text-ink outline-none"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>

              <label className="flex flex-col gap-2 rounded-[1.25rem] border border-ink/10 bg-white/80 p-4">
                <FieldLabel>Resolution</FieldLabel>
                <select
                  value={form.resolution}
                  onChange={(event) => updateField("resolution", event.target.value)}
                  disabled
                  className="rounded-xl border border-ink/10 bg-sand px-3 py-2 text-sm text-ink outline-none disabled:cursor-not-allowed"
                >
                  <option value={GOVERNED_PREVIEW_RESOLUTION}>{GOVERNED_PREVIEW_RESOLUTION}</option>
                </select>
              </label>

              <label className="flex flex-col gap-2 rounded-[1.25rem] border border-ink/10 bg-white/80 p-4">
                <FieldLabel>Duration</FieldLabel>
                <select
                  value={String(form.duration_seconds)}
                  onChange={(event) => updateField("duration_seconds", Number(event.target.value))}
                  className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-sm text-ink outline-none"
                >
                  <option value="1">1 second</option>
                  <option value="2">2 seconds</option>
                </select>
              </label>

              <label className="flex items-start gap-3 rounded-[1.25rem] border border-ink/10 bg-white/80 p-4 md:col-span-2">
                <input
                  type="checkbox"
                  checked={form.package_gif_preview}
                  onChange={(event) => updateField("package_gif_preview", event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border border-ink/10"
                />
                <div>
                  <FieldLabel>Optional GIF Packaging</FieldLabel>
                  <p className="mt-2 text-sm leading-7 body-muted">Package a browser-friendly governed GIF inside the same sandbox directory for bounded continuity and motion inspection.</p>
                </div>
              </label>

              <label
                data-guided-highlight="manual-approval"
                className={`flex items-start gap-3 rounded-[1.25rem] border p-4 md:col-span-2 ${isGuidedHighlightActive("manual-approval") ? "border-ocean/50 bg-ocean/5 ring-4 ring-ocean/15" : "border-coral/20 bg-white/80"}`}
              >
                <input
                  type="checkbox"
                  checked={form.governance_approval}
                  onChange={(event) => updateField("governance_approval", event.target.checked)}
                  data-guided-focus="manual-approval"
                  className="mt-1 h-4 w-4 rounded border border-ink/10"
                />
                <div>
                  <GuidedTargetCallout active={isGuidedHighlightActive("manual-approval")} label={activeGuidedTarget.calloutLabel} instruction={activeGuidedTarget.instruction} />
                  <FieldLabel>Manual Approval</FieldLabel>
                  <p className="mt-2 text-sm leading-7 body-muted">I confirm this request should trigger only the governed low-duration preview sandbox with rollback available and no autonomous continuation.</p>
                </div>
              </label>
            </div>

            <div
              data-guided-highlight="execution-controls"
              className={`mt-6 flex flex-wrap gap-3 rounded-[1.25rem] border p-4 ${guidedTargetHighlightClass(isGuidedHighlightActive("execution-controls"))}`}
            >
              <div className="w-full">
                <GuidedTargetCallout active={isGuidedHighlightActive("execution-controls")} label={activeGuidedTarget.calloutLabel} instruction={activeGuidedTarget.instruction} />
              </div>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={executionLocked || !motionPreviewReady}
                data-guided-focus="generate-preview"
                className="rounded-full border border-ocean/20 bg-ocean px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {governedExecutionState.previewInProgress && governedExecutionState.activeAction === "preview" ? "Processing Preview..." : "Generate Preview"}
              </button>
              <button
                type="button"
                onClick={handleGenerateMicroSequence}
                disabled={executionLocked}
                data-guided-focus="generate-micro-sequence"
                className="rounded-full border border-amber-200 bg-amber-50 px-5 py-3 text-sm font-semibold text-amber-700 transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {governedExecutionState.microSequenceInProgress ? "Processing Micro-Sequence..." : "Generate Micro-Sequence First"}
              </button>
              <button
                type="button"
                onClick={handleRollback}
                disabled={executionLocked}
                className="rounded-full border border-coral/20 bg-coral px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {governedExecutionState.rollbackInProgress ? "Restoring Rollback..." : "Clear Preview Sandbox"}
              </button>
            </div>
            {!motionPreviewReady ? (
              <p className="mt-4 rounded-[1.25rem] border border-amber-200 bg-amber-50 p-4 text-sm leading-7 text-amber-700">
                Motion preview generation stays disabled until the governed micro-sequence exists and frame-to-frame continuity validation passes.
              </p>
            ) : null}
          </CollapsibleActivitySection>

          <CollapsibleActivitySection
            sectionLabel="Execution Status"
            title="Governed Preview Runtime State"
            activity={executionActivity}
            defaultOpen={true}
            sectionDomId="execution-status-section"
            {...guidedSectionProps("execution-status")}
          >
            <div className="mt-5 space-y-4">
              <ExecutionStatusPanel executionState={governedExecutionState} timeline={governedExecutionTimeline} />
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill label={execution?.status === "accepted" ? "request-accepted" : execution?.status ?? "idle"} tone={statusTone} />
                <StatusPill label={executionLocked ? "processing-locked" : "ready"} tone={executionLocked ? "warn" : "default"} />
                <StatusPill label={motionPreviewReady ? "prerequisite-ready" : "prerequisite-required"} tone={motionPreviewReady ? "ok" : "warn"} />
              </div>
              <p className="text-sm leading-7 body-muted">{message}</p>
              {error ? <p className="rounded-[1.25rem] border border-coral/20 bg-coral/10 p-4 text-sm text-ember">{error}</p> : null}
              {compiledRequest ? (
                <article className="rounded-[1.25rem] border border-ink/10 bg-white/80 p-4 text-sm leading-7 body-muted">
                  <p><strong className="text-ink">Governance status:</strong> {execution?.governance_status ?? (compiledRequest.manual_approval_granted ? "Approved" : "Approval missing")}</p>
                  <p><strong className="text-ink">Compiled request:</strong> {compiledRequest.request_id}</p>
                  <p><strong className="text-ink">Duration:</strong> {compiledRequest.duration_seconds}s</p>
                  <p><strong className="text-ink">Resolution:</strong> {compiledRequest.resolution}</p>
                  <p><strong className="text-ink">No autonomous continuation:</strong> {compiledRequest.autonomous_continuation_allowed ? "no" : "yes"}</p>
                </article>
              ) : null}
              {prerequisiteState ? (
                <article className="rounded-[1.25rem] border border-ink/10 bg-white/80 p-4 text-sm leading-7 body-muted">
                  <p><strong className="text-ink">Micro-sequence exists:</strong> {prerequisiteState.micro_sequence_exists ? "yes" : "no"}</p>
                  <p><strong className="text-ink">Motion preview ready:</strong> {prerequisiteState.motion_preview_ready ? "yes" : "no"}</p>
                  <p><strong className="text-ink">Continuity validation:</strong> {prerequisiteState.continuity_validation.valid ? "passed" : "blocked"}</p>
                  <p><strong className="text-ink">Continuity summary:</strong> {prerequisiteState.continuity_validation.summary}</p>
                  {prerequisiteState.preview_diagnostics ? <p><strong className="text-ink">Frame coherence:</strong> {prerequisiteState.preview_diagnostics.frame_coherence_score}/100</p> : null}
                  {prerequisiteState.preview_diagnostics ? <p><strong className="text-ink">Camera stability:</strong> {prerequisiteState.preview_diagnostics.camera_stability_score}/100</p> : null}
                  {prerequisiteState.preview_diagnostics ? <p><strong className="text-ink">Environment coherence:</strong> {prerequisiteState.preview_diagnostics.environment_coherence_score}/100</p> : null}
                </article>
              ) : null}
              {showGenerateMicroSequenceCta ? (
                <div className="rounded-[1.25rem] border border-amber-200 bg-amber-50 p-4 text-sm leading-7 text-amber-700">
                  <p className="font-semibold text-amber-800">Next step required before motion preview</p>
                  <p className="mt-2">Use the governed micro-sequence continuity preview to satisfy the prerequisite before generating a motion preview clip.</p>
                  <button
                    type="button"
                    onClick={handleGenerateMicroSequence}
                    disabled={executionLocked}
                    className="mt-4 rounded-full border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-700 transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {governedExecutionState.microSequenceInProgress ? "Processing Micro-Sequence..." : "Generate Micro-Sequence First"}
                  </button>
                </div>
              ) : null}
              {execution ? (
                <article className="rounded-[1.25rem] border border-ink/10 bg-white/80 p-4 text-sm leading-7 body-muted">
                  <p><strong className="text-ink">Sandbox path:</strong> {execution.sandbox_path ?? "not created"}</p>
                  <p><strong className="text-ink">Sandbox root:</strong> {execution.sandbox_output_root ?? "not created"}</p>
                  <p><strong className="text-ink">Manifest:</strong> {execution.manifest_file_path ?? "not created"}</p>
                  <p><strong className="text-ink">Rollback:</strong> {execution.rollback_status}</p>
                  <p><strong className="text-ink">Execution ledger:</strong> {execution.execution_ledger_state.ledger_id ?? "no ledger"} | attempts={execution.execution_ledger_state.attempt_count}</p>
                  <p><strong className="text-ink">Live workspace blocked output:</strong> {execution.live_workspace_blocked_output ? "yes" : "no"}</p>
                  <p><strong className="text-ink">Continuity validation:</strong> {execution.continuity_validation.valid ? "passed" : "blocked"}</p>
                  <p><strong className="text-ink">Continuity summary:</strong> {execution.continuity_validation.summary}</p>
                  {execution.preview_diagnostics ? <p><strong className="text-ink">Motion smoothness:</strong> {execution.preview_diagnostics.motion_smoothness_score}/100</p> : null}
                  {execution.preview_diagnostics ? <p><strong className="text-ink">Multi-object coherence:</strong> {execution.preview_diagnostics.multi_object_coherence_score}/100</p> : null}
                  {execution.preview_diagnostics ? <p><strong className="text-ink">Spacing consistency:</strong> {execution.preview_diagnostics.spacing_consistency_score}/100</p> : null}
                  {execution.preview_diagnostics ? <p><strong className="text-ink">Depth ordering:</strong> {execution.preview_diagnostics.depth_ordering_score}/100</p> : null}
                  {execution.preview_diagnostics ? <p><strong className="text-ink">Overlap avoidance:</strong> {execution.preview_diagnostics.overlap_avoidance_score}/100</p> : null}
                  {execution.preview_diagnostics ? <p><strong className="text-ink">Interaction staging:</strong> {execution.preview_diagnostics.interaction_staging_score}/100</p> : null}
                  {execution.preview_diagnostics?.camera_drift_stability_score ? <p><strong className="text-ink">Camera drift stability:</strong> {execution.preview_diagnostics.camera_drift_stability_score}/100</p> : null}
                  {execution.preview_diagnostics?.framing_persistence_score ? <p><strong className="text-ink">Framing persistence:</strong> {execution.preview_diagnostics.framing_persistence_score}/100</p> : null}
                  {execution.preview_diagnostics?.horizon_stability_score ? <p><strong className="text-ink">Horizon stability:</strong> {execution.preview_diagnostics.horizon_stability_score}/100</p> : null}
                  {execution.preview_diagnostics?.shot_transition_smoothness_score ? <p><strong className="text-ink">Shot transition smoothness:</strong> {execution.preview_diagnostics.shot_transition_smoothness_score}/100</p> : null}
                  {execution.preview_diagnostics?.composition_coherence_score ? <p><strong className="text-ink">Composition coherence:</strong> {execution.preview_diagnostics.composition_coherence_score}/100</p> : null}
                  {execution.preview_diagnostics?.camera_continuity_score ? <p><strong className="text-ink">Camera continuity:</strong> {execution.preview_diagnostics.camera_continuity_score}/100</p> : null}
                  {typeof execution.preview_diagnostics?.joint_continuity_score === "number" ? <p><strong className="text-ink">Joint continuity:</strong> {execution.preview_diagnostics.joint_continuity_score}/100</p> : null}
                  {typeof execution.preview_diagnostics?.pose_stability_score === "number" ? <p><strong className="text-ink">Pose stability:</strong> {execution.preview_diagnostics.pose_stability_score}/100</p> : null}
                  {typeof execution.preview_diagnostics?.silhouette_readability_score === "number" ? <p><strong className="text-ink">Silhouette readability:</strong> {execution.preview_diagnostics.silhouette_readability_score}/100</p> : null}
                  {typeof execution.preview_diagnostics?.entity_spatial_persistence_score === "number" ? <p><strong className="text-ink">Entity spatial persistence:</strong> {execution.preview_diagnostics.entity_spatial_persistence_score}/100</p> : null}
                  {typeof execution.preview_diagnostics?.entity_camera_framing_compatibility_score === "number" ? <p><strong className="text-ink">Entity-camera framing:</strong> {execution.preview_diagnostics.entity_camera_framing_compatibility_score}/100</p> : null}
                  {typeof execution.preview_diagnostics?.rejected_pose_transition_count === "number" ? <p><strong className="text-ink">Rejected pose transitions:</strong> {execution.preview_diagnostics.rejected_pose_transition_count}</p> : null}
                  {execution.preview_diagnostics?.active_formation_type ? <p><strong className="text-ink">Active formation:</strong> {execution.preview_diagnostics.active_formation_type}</p> : null}
                  {typeof execution.preview_diagnostics?.entity_count === "number" ? <p><strong className="text-ink">Entity count:</strong> {execution.preview_diagnostics.entity_count}</p> : null}
                  {typeof execution.preview_diagnostics?.entity_separation_score === "number" ? <p><strong className="text-ink">Entity separation:</strong> {execution.preview_diagnostics.entity_separation_score}/100</p> : null}
                  {typeof execution.preview_diagnostics?.formation_stability_score === "number" ? <p><strong className="text-ink">Formation stability:</strong> {execution.preview_diagnostics.formation_stability_score}/100</p> : null}
                  {typeof execution.preview_diagnostics?.multi_entity_silhouette_score === "number" ? <p><strong className="text-ink">Multi-entity silhouette:</strong> {execution.preview_diagnostics.multi_entity_silhouette_score}/100</p> : null}
                  {typeof execution.preview_diagnostics?.choreography_continuity_score === "number" ? <p><strong className="text-ink">Choreography continuity:</strong> {execution.preview_diagnostics.choreography_continuity_score}/100</p> : null}
                  {typeof execution.preview_diagnostics?.group_spatial_persistence_score === "number" ? <p><strong className="text-ink">Group spatial persistence:</strong> {execution.preview_diagnostics.group_spatial_persistence_score}/100</p> : null}
                  {typeof execution.preview_diagnostics?.rejected_formation_transition_count === "number" ? <p><strong className="text-ink">Rejected formation transitions:</strong> {execution.preview_diagnostics.rejected_formation_transition_count}</p> : null}
                  {typeof execution.preview_diagnostics?.rollback_restored_formation === "boolean" ? <p><strong className="text-ink">Rollback restored formation:</strong> {execution.preview_diagnostics.rollback_restored_formation ? "yes" : "no"}</p> : null}
                  {execution.preview_diagnostics?.active_beat_type ? <p><strong className="text-ink">Active beat:</strong> {execution.preview_diagnostics.active_beat_type}</p> : null}
                  {execution.preview_diagnostics?.focus_subject ? <p><strong className="text-ink">Focus subject:</strong> {execution.preview_diagnostics.focus_subject}</p> : null}
                  {typeof execution.preview_diagnostics?.emphasis_score === "number" ? <p><strong className="text-ink">Emphasis score:</strong> {execution.preview_diagnostics.emphasis_score}/100</p> : null}
                  {typeof execution.preview_diagnostics?.beat_readability_score === "number" ? <p><strong className="text-ink">Beat readability:</strong> {execution.preview_diagnostics.beat_readability_score}/100</p> : null}
                  {typeof execution.preview_diagnostics?.focus_persistence_score === "number" ? <p><strong className="text-ink">Focus persistence:</strong> {execution.preview_diagnostics.focus_persistence_score}/100</p> : null}
                  {typeof execution.preview_diagnostics?.event_focus_alignment_score === "number" ? <p><strong className="text-ink">Event focus alignment:</strong> {execution.preview_diagnostics.event_focus_alignment_score}/100</p> : null}
                  {typeof execution.preview_diagnostics?.staging_camera_compatibility_score === "number" ? <p><strong className="text-ink">Staging-camera compatibility:</strong> {execution.preview_diagnostics.staging_camera_compatibility_score}/100</p> : null}
                  {typeof execution.preview_diagnostics?.reaction_continuity_score === "number" ? <p><strong className="text-ink">Reaction continuity:</strong> {execution.preview_diagnostics.reaction_continuity_score}/100</p> : null}
                  {typeof execution.preview_diagnostics?.event_causality_score === "number" ? <p><strong className="text-ink">Event causality:</strong> {execution.preview_diagnostics.event_causality_score}/100</p> : null}
                  {typeof execution.preview_diagnostics?.camera_event_framing_score === "number" ? <p><strong className="text-ink">Camera event framing:</strong> {execution.preview_diagnostics.camera_event_framing_score}/100</p> : null}
                  {typeof execution.preview_diagnostics?.rejected_staging_transition_count === "number" ? <p><strong className="text-ink">Rejected staging transitions:</strong> {execution.preview_diagnostics.rejected_staging_transition_count}</p> : null}
                  {typeof execution.preview_diagnostics?.rejected_focus_transition_count === "number" ? <p><strong className="text-ink">Rejected focus transitions:</strong> {execution.preview_diagnostics.rejected_focus_transition_count}</p> : null}
                  {typeof execution.preview_diagnostics?.rollback_restored_staging === "boolean" ? <p><strong className="text-ink">Rollback restored staging:</strong> {execution.preview_diagnostics.rollback_restored_staging ? "yes" : "no"}</p> : null}
                  {typeof execution.preview_diagnostics?.rollback_restored_focus === "boolean" ? <p><strong className="text-ink">Rollback restored focus:</strong> {execution.preview_diagnostics.rollback_restored_focus ? "yes" : "no"}</p> : null}
                  {execution.preview_diagnostics ? <p><strong className="text-ink">Camera stability:</strong> {execution.preview_diagnostics.camera_stability_score}/100</p> : null}
                  {execution.preview_diagnostics ? <p><strong className="text-ink">Spatial continuity:</strong> {execution.preview_diagnostics.spatial_continuity_score}/100</p> : null}
                  {execution.preview_diagnostics ? <p><strong className="text-ink">Lighting consistency:</strong> {execution.preview_diagnostics.lighting_consistency_score}/100</p> : null}
                </article>
              ) : null}
              {microSequence ? (
                <article className="rounded-[1.25rem] border border-ink/10 bg-white/80 p-4 text-sm leading-7 body-muted">
                  <p><strong className="text-ink">Micro-sequence sandbox:</strong> {microSequence.sandbox_path ?? "not created"}</p>
                  <p><strong className="text-ink">Sandbox root:</strong> {microSequence.sandbox_output_root ?? "not created"}</p>
                  <p><strong className="text-ink">Continuity validation:</strong> {microSequence.continuity_validation.valid ? "passed" : "blocked"}</p>
                  <p><strong className="text-ink">Continuity summary:</strong> {microSequence.continuity_validation.summary}</p>
                  {microSequence.preview_diagnostics ? <p><strong className="text-ink">Object fidelity:</strong> {microSequence.preview_diagnostics.object_fidelity_score}/100</p> : null}
                  {microSequence.preview_diagnostics ? <p><strong className="text-ink">Environment coherence:</strong> {microSequence.preview_diagnostics.environment_coherence_score}/100</p> : null}
                  {microSequence.preview_diagnostics ? <p><strong className="text-ink">Multi-object coherence:</strong> {microSequence.preview_diagnostics.multi_object_coherence_score}/100</p> : null}
                  {microSequence.preview_diagnostics ? <p><strong className="text-ink">Spacing consistency:</strong> {microSequence.preview_diagnostics.spacing_consistency_score}/100</p> : null}
                  {microSequence.preview_diagnostics?.camera_drift_stability_score ? <p><strong className="text-ink">Camera drift stability:</strong> {microSequence.preview_diagnostics.camera_drift_stability_score}/100</p> : null}
                  {microSequence.preview_diagnostics?.framing_persistence_score ? <p><strong className="text-ink">Framing persistence:</strong> {microSequence.preview_diagnostics.framing_persistence_score}/100</p> : null}
                  {microSequence.preview_diagnostics?.shot_transition_smoothness_score ? <p><strong className="text-ink">Shot transition smoothness:</strong> {microSequence.preview_diagnostics.shot_transition_smoothness_score}/100</p> : null}
                  {typeof microSequence.preview_diagnostics?.joint_continuity_score === "number" ? <p><strong className="text-ink">Joint continuity:</strong> {microSequence.preview_diagnostics.joint_continuity_score}/100</p> : null}
                  {typeof microSequence.preview_diagnostics?.pose_stability_score === "number" ? <p><strong className="text-ink">Pose stability:</strong> {microSequence.preview_diagnostics.pose_stability_score}/100</p> : null}
                  {typeof microSequence.preview_diagnostics?.silhouette_readability_score === "number" ? <p><strong className="text-ink">Silhouette readability:</strong> {microSequence.preview_diagnostics.silhouette_readability_score}/100</p> : null}
                  {microSequence.preview_diagnostics?.active_formation_type ? <p><strong className="text-ink">Active formation:</strong> {microSequence.preview_diagnostics.active_formation_type}</p> : null}
                  {typeof microSequence.preview_diagnostics?.entity_count === "number" ? <p><strong className="text-ink">Entity count:</strong> {microSequence.preview_diagnostics.entity_count}</p> : null}
                  {typeof microSequence.preview_diagnostics?.entity_separation_score === "number" ? <p><strong className="text-ink">Entity separation:</strong> {microSequence.preview_diagnostics.entity_separation_score}/100</p> : null}
                  {typeof microSequence.preview_diagnostics?.formation_stability_score === "number" ? <p><strong className="text-ink">Formation stability:</strong> {microSequence.preview_diagnostics.formation_stability_score}/100</p> : null}
                  {typeof microSequence.preview_diagnostics?.group_spatial_persistence_score === "number" ? <p><strong className="text-ink">Group spatial persistence:</strong> {microSequence.preview_diagnostics.group_spatial_persistence_score}/100</p> : null}
                  {microSequence.preview_diagnostics?.active_beat_type ? <p><strong className="text-ink">Active beat:</strong> {microSequence.preview_diagnostics.active_beat_type}</p> : null}
                  {microSequence.preview_diagnostics?.active_focus_subject ? <p><strong className="text-ink">Active focus subject:</strong> {microSequence.preview_diagnostics.active_focus_subject}</p> : null}
                  {microSequence.preview_diagnostics?.focus_subject ? <p><strong className="text-ink">Focus subject:</strong> {microSequence.preview_diagnostics.focus_subject}</p> : null}
                  {typeof microSequence.preview_diagnostics?.emphasis_score === "number" ? <p><strong className="text-ink">Emphasis score:</strong> {microSequence.preview_diagnostics.emphasis_score}/100</p> : null}
                  {typeof microSequence.preview_diagnostics?.beat_readability_score === "number" ? <p><strong className="text-ink">Beat readability:</strong> {microSequence.preview_diagnostics.beat_readability_score}/100</p> : null}
                  {typeof microSequence.preview_diagnostics?.focus_persistence_score === "number" ? <p><strong className="text-ink">Focus persistence:</strong> {microSequence.preview_diagnostics.focus_persistence_score}/100</p> : null}
                  {microSequence.preview_diagnostics ? <p><strong className="text-ink">Interaction relationships:</strong> {microSequence.preview_diagnostics.object_relationship_summary}</p> : null}
                  {microSequence.preview_diagnostics?.shot_engine_summary ? <p><strong className="text-ink">Shot engine:</strong> {microSequence.preview_diagnostics.shot_engine_summary}</p> : null}
                  {microSequence.preview_diagnostics?.articulated_entity_summary ? <p><strong className="text-ink">Articulated entity:</strong> {microSequence.preview_diagnostics.articulated_entity_summary}</p> : null}
                  {microSequence.preview_diagnostics?.multi_entity_choreography_summary ? <p><strong className="text-ink">Multi-entity choreography:</strong> {microSequence.preview_diagnostics.multi_entity_choreography_summary}</p> : null}
                  {microSequence.preview_diagnostics?.cinematic_staging_summary ? <p><strong className="text-ink">Cinematic staging:</strong> {microSequence.preview_diagnostics.cinematic_staging_summary}</p> : null}
                  {microSequence.preview_diagnostics?.cinematic_focus_flow_summary ? <p><strong className="text-ink">Cinematic focus flow:</strong> {microSequence.preview_diagnostics.cinematic_focus_flow_summary}</p> : null}
                  {microSequence.preview_diagnostics?.cinematic_tension_curve_summary ? <p><strong className="text-ink">Cinematic tension curve:</strong> {microSequence.preview_diagnostics.cinematic_tension_curve_summary}</p> : null}
                  {microSequence.preview_diagnostics?.cinematic_momentum_flow_summary ? <p><strong className="text-ink">Cinematic momentum flow:</strong> {microSequence.preview_diagnostics.cinematic_momentum_flow_summary}</p> : null}
                  {microSequence.preview_diagnostics?.cinematic_transition_blend_summary ? <p><strong className="text-ink">Cinematic transition blend:</strong> {microSequence.preview_diagnostics.cinematic_transition_blend_summary}</p> : null}
                  {microSequence.preview_diagnostics?.cinematic_scene_cohesion_summary ? <p><strong className="text-ink">Cinematic scene cohesion:</strong> {microSequence.preview_diagnostics.cinematic_scene_cohesion_summary}</p> : null}
                  {microSequence.preview_diagnostics ? <p><strong className="text-ink">Camera profile:</strong> {microSequence.preview_diagnostics.camera_profile}</p> : null}
                  <p><strong className="text-ink">Preview cleanup after prerequisite run:</strong> {microSequence.rollback_status || "No preview cleanup actions were required."}</p>
                </article>
              ) : null}
              {rollback ? (
                <article className="rounded-[1.25rem] border border-ink/10 bg-white/80 p-4 text-sm leading-7 body-muted">
                  <p><strong className="text-ink">Rollback status:</strong> {rollback.rollback_status}</p>
                  <p><strong className="text-ink">Sandbox-only cleanup:</strong> {rollback.sandbox_limited ? "yes" : "no"}</p>
                  <p><strong className="text-ink">Clip directory:</strong> {rollback.sandbox_path ?? "none"}</p>
                </article>
              ) : null}
            </div>
          </CollapsibleActivitySection>
        </div>

        <section className="mt-6 grid gap-6 lg:grid-cols-3">
          <CollapsibleActivitySection
            sectionLabel="Micro-Sequence Frames"
            title="Prerequisite Renderer Frames"
            activity={microSequenceOutputActivity}
            defaultOpen={microSequenceOutputActivity.critical}
            sectionDomId="micro-sequence-frames-section"
            {...guidedSectionProps("micro-sequence-frames")}
          >
            <div data-guided-highlight="micro-sequence-outputs" className={`mt-5 scroll-mt-6 space-y-3 rounded-[1.25rem] border p-4 text-sm leading-7 body-muted ${guidedTargetHighlightClass(isGuidedHighlightActive("micro-sequence-outputs"))}`}>
              <GuidedTargetCallout active={isGuidedHighlightActive("micro-sequence-outputs")} label={activeGuidedTarget.calloutLabel} instruction={activeGuidedTarget.instruction} />
              {microSequenceGalleryCards.length ? (
                <div className="grid gap-4 md:grid-cols-2">
                  {microSequenceGalleryCards.map((card, cardIndex) => (
                    <article key={card.id} className="overflow-hidden rounded-[1.25rem] border border-ink/10 bg-white/90 shadow-sm">
                      <div className="aspect-square bg-mist/50">
                        <div className="relative h-full w-full">
                          <Image src={card.assetUrl} alt={card.label} width={256} height={256} unoptimized className="h-full w-full object-contain" />
                          {card.diagnostic ? (
                            <div className="absolute left-3 top-3 rounded-full bg-ink/75 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white">
                              {card.diagnostic.object_kind} • {Math.round(card.diagnostic.rotation_degrees)}deg
                            </div>
                          ) : null}
                          {card.diagnostic ? (
                            <div className="absolute bottom-3 left-3 rounded-full bg-white/90 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink shadow-sm">
                              horizon {Math.round(card.diagnostic.horizon_y)} • camera {card.diagnostic.camera_stability_score}/100
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <div className="space-y-2 p-4">
                        <p className="text-sm font-semibold text-ink">{card.label}</p>
                        <p className="text-xs uppercase tracking-[0.18em] text-slate">{card.format} • {card.source}</p>
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Shot {card.diagnostic.active_shot_type ?? "STATIC_ESTABLISHING"} • Orbit {Math.round(card.diagnostic.orbital_radius ?? 0)}px • Continuity {card.diagnostic.camera_continuity_score ?? card.diagnostic.camera_stability_score}/100</p> : null}
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Silhouette {card.diagnostic.silhouette_score}/100 • Readability {card.diagnostic.readability_score}/100</p> : null}
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Env {card.diagnostic.environment_coherence_score}/100 • Depth {card.diagnostic.spatial_depth_score}/100 • Fog {card.diagnostic.fog_density}</p> : null}
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Framing {card.diagnostic.framing_score ?? card.diagnostic.readability_score}/100 • Visibility {card.diagnostic.visibility_score ?? card.diagnostic.silhouette_score}/100 • Edge clip {card.diagnostic.edge_clipping_score ?? 100}/100</p> : null}
                        {card.diagnostic?.active_entity_type ? <p className="text-xs leading-6 text-slate">Entity {card.diagnostic.active_entity_type} • Formation {card.diagnostic.active_formation_type ?? "unset"} • Beat {card.diagnostic.active_beat_type ?? "unset"} • Count {card.diagnostic.entity_count ?? 0}</p> : null}
                        {typeof card.diagnostic?.entity_separation_score === "number" ? <p className="text-xs leading-6 text-slate">Separation {card.diagnostic.entity_separation_score}/100 • Stability {card.diagnostic.formation_stability_score ?? 0}/100 • Group persistence {card.diagnostic.group_spatial_persistence_score ?? 0}/100</p> : null}
                        {typeof card.diagnostic?.emphasis_score === "number" ? <p className="text-xs leading-6 text-slate">Focus {card.diagnostic.focus_subject ?? "unset"} • Emphasis {card.diagnostic.emphasis_score}/100 • Readability {card.diagnostic.beat_readability_score ?? 0}/100</p> : null}
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Spacing drift {card.diagnostic.spacing_drift}px • Depth {card.diagnostic.depth_ordering_status}</p> : null}
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Overlap {card.diagnostic.overlap_warning} • Stage {card.diagnostic.interaction_staging_note}</p> : null}
                        {card.diagnostic?.shot_transition_summary ? <p className="text-xs leading-6 text-slate">Transition {card.diagnostic.shot_transition_summary}</p> : null}
                        {card.diagnostic?.rollback_restored_state ? <p className="text-xs leading-6 text-slate">Rollback restored prior governed camera snapshot for this frame.</p> : null}
                        {card.diagnostic?.rollback_restored_pose ? <p className="text-xs leading-6 text-slate">Rollback restored prior governed articulated pose for this frame.</p> : null}
                        {card.diagnostic?.rollback_restored_formation ? <p className="text-xs leading-6 text-slate">Rollback restored prior governed formation state for this frame.</p> : null}
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Reactive {card.diagnostic.beacon_influence_overlay}</p> : null}
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Reflection {card.diagnostic.reflection_shadow_overlay}</p> : null}
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Response {card.diagnostic.environmental_response_overlay}</p> : null}
                        {card.diagnostic?.camera_state_overlay ? <p className="text-xs leading-6 text-slate">Camera {card.diagnostic.camera_state_overlay}</p> : null}
                        {card.diagnostic?.articulated_entity_overlay ? <p className="text-xs leading-6 text-slate">Entity state {card.diagnostic.articulated_entity_overlay}</p> : null}
                        {card.diagnostic?.multi_entity_overlay ? <p className="text-xs leading-6 text-slate">Formation state {card.diagnostic.multi_entity_overlay}</p> : null}
                        {card.diagnostic?.cinematic_staging_overlay ? <p className="text-xs leading-6 text-slate">Staging state {card.diagnostic.cinematic_staging_overlay}</p> : null}
                        {card.diagnostic?.cinematic_focus_flow_overlay ? <p className="text-xs leading-6 text-slate">Focus flow {card.diagnostic.cinematic_focus_flow_overlay}</p> : null}
                        {card.diagnostic?.cinematic_tension_curve_overlay ? <p className="text-xs leading-6 text-slate">Tension curve {card.diagnostic.cinematic_tension_curve_overlay}</p> : null}
                        {card.diagnostic?.cinematic_momentum_flow_overlay ? <p className="text-xs leading-6 text-slate">Momentum flow {card.diagnostic.cinematic_momentum_flow_overlay}</p> : null}
                        {card.diagnostic?.cinematic_transition_blend_overlay ? <p className="text-xs leading-6 text-slate">Transition blend {card.diagnostic.cinematic_transition_blend_overlay}</p> : null}
                        {card.diagnostic?.cinematic_scene_cohesion_overlay ? <p className="text-xs leading-6 text-slate">Scene cohesion {card.diagnostic.cinematic_scene_cohesion_overlay}</p> : null}
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Anchor {card.diagnostic.continuity_anchor_visualization}</p> : null}
                        <p className="text-xs leading-6 text-slate">{card.assetPath}</p>
                        <div className="flex flex-wrap gap-2">
                          <a href={card.assetUrl} target="_blank" rel="noreferrer" data-guided-focus={cardIndex === 0 ? "micro-sequence-output-first-image" : undefined} className="rounded-full border border-ocean/20 bg-ocean px-3 py-1.5 text-xs font-semibold text-white">Open</a>
                          <a href={`${card.assetUrl}&download=1`} className="rounded-full border border-ink/10 bg-white px-3 py-1.5 text-xs font-semibold text-ink">Download</a>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p>{microSequence?.sandbox_path ? "No governed micro-sequence frame files were produced for the latest prerequisite run." : "No governed micro-sequence frames are available yet."}</p>
              )}
            </div>
          </CollapsibleActivitySection>

          <CollapsibleActivitySection
            sectionLabel="Preview Outputs"
            title="Renderer Output Gallery"
            activity={rendererOutputActivity}
            defaultOpen={rendererOutputActivity.critical}
            sectionDomId="preview-outputs-section"
            {...guidedSectionProps("preview-outputs")}
          >
            <div data-guided-highlight="preview-outputs" className={`mt-5 scroll-mt-6 space-y-3 rounded-[1.25rem] border p-4 text-sm leading-7 body-muted ${guidedTargetHighlightClass(isGuidedHighlightActive("preview-outputs"))}`}>
              <GuidedTargetCallout active={isGuidedHighlightActive("preview-outputs")} label={activeGuidedTarget.calloutLabel} instruction={activeGuidedTarget.instruction} />
              {previewGalleryCards.length ? (
                <div className="grid gap-4 md:grid-cols-2">
                  {previewGalleryCards.map((card, cardIndex) => (
                    <article key={card.id} className="overflow-hidden rounded-[1.25rem] border border-ink/10 bg-white/90 shadow-sm">
                      <div className="aspect-square bg-mist/50">
                        <div className="relative h-full w-full">
                          <Image src={card.assetUrl} alt={card.label} width={256} height={256} unoptimized className="h-full w-full object-contain" />
                          {card.diagnostic ? (
                            <div className="absolute left-3 top-3 rounded-full bg-ink/75 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white">
                              {card.diagnostic.object_kind} • {Math.round(card.diagnostic.rotation_degrees)}deg
                            </div>
                          ) : null}
                          {card.diagnostic ? (
                            <div className="absolute bottom-3 left-3 rounded-full bg-white/90 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink shadow-sm">
                              center {Math.round(card.diagnostic.anchor_x)},{Math.round(card.diagnostic.anchor_y)}
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <div className="space-y-2 p-4">
                        <p className="text-sm font-semibold text-ink">{card.label}</p>
                        <p className="text-xs uppercase tracking-[0.18em] text-slate">{card.format} • {card.source}</p>
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Shot {card.diagnostic.active_shot_type ?? "STATIC_ESTABLISHING"} • Orbit {Math.round(card.diagnostic.orbital_radius ?? 0)}px • Transition {card.diagnostic.shot_transition_score ?? card.diagnostic.camera_stability_score}/100</p> : null}
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Coherence {card.diagnostic.coherence_anchor_strength}/100 • Lighting {card.diagnostic.lighting_stability_score}/100</p> : null}
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Camera {card.diagnostic.camera_stability_score}/100 • Horizon {card.diagnostic.horizon_consistency_score}/100 • Lighting consistency {card.diagnostic.lighting_consistency_score}/100</p> : null}
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Framing {card.diagnostic.framing_score ?? card.diagnostic.readability_score}/100 • Visibility {card.diagnostic.visibility_score ?? card.diagnostic.silhouette_score}/100 • Continuity {card.diagnostic.camera_continuity_score ?? card.diagnostic.camera_stability_score}/100</p> : null}
                        {card.diagnostic?.active_entity_type ? <p className="text-xs leading-6 text-slate">Entity {card.diagnostic.active_entity_type} • Formation {card.diagnostic.active_formation_type ?? "unset"} • Beat {card.diagnostic.active_beat_type ?? "unset"} • Count {card.diagnostic.entity_count ?? 0}</p> : null}
                        {typeof card.diagnostic?.entity_separation_score === "number" ? <p className="text-xs leading-6 text-slate">Separation {card.diagnostic.entity_separation_score}/100 • Stability {card.diagnostic.formation_stability_score ?? 0}/100 • Choreography {card.diagnostic.choreography_continuity_score ?? 0}/100</p> : null}
                        {typeof card.diagnostic?.emphasis_score === "number" ? <p className="text-xs leading-6 text-slate">Focus {card.diagnostic.focus_subject ?? "unset"} • Emphasis {card.diagnostic.emphasis_score}/100 • Beat readability {card.diagnostic.beat_readability_score ?? 0}/100</p> : null}
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Spacing {card.diagnostic.cube_to_beacon_distance}px • Drift {card.diagnostic.spacing_drift}px • Overlap {card.diagnostic.overlap_warning}</p> : null}
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Depth {card.diagnostic.depth_ordering_status} • Staging {card.diagnostic.interaction_staging_note}</p> : null}
                        {card.diagnostic?.shot_transition_summary ? <p className="text-xs leading-6 text-slate">Transition {card.diagnostic.shot_transition_summary}</p> : null}
                        {card.diagnostic?.rollback_restored_state ? <p className="text-xs leading-6 text-slate">Rollback restored prior governed camera snapshot for this frame.</p> : null}
                        {card.diagnostic?.rollback_restored_pose ? <p className="text-xs leading-6 text-slate">Rollback restored prior governed articulated pose for this frame.</p> : null}
                        {card.diagnostic?.rollback_restored_formation ? <p className="text-xs leading-6 text-slate">Rollback restored prior governed formation state for this frame.</p> : null}
                        {card.diagnostic?.rollback_restored_staging ? <p className="text-xs leading-6 text-slate">Rollback restored prior governed staging state for this frame.</p> : null}
                        {card.diagnostic?.rollback_restored_focus ? <p className="text-xs leading-6 text-slate">Rollback restored prior governed focus flow state for this frame.</p> : null}
                        {card.diagnostic?.rollback_restored_tension ? <p className="text-xs leading-6 text-slate">Rollback restored prior governed tension state for this frame.</p> : null}
                        {card.diagnostic?.rollback_restored_momentum ? <p className="text-xs leading-6 text-slate">Rollback restored prior governed momentum state for this frame.</p> : null}
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Influence {card.diagnostic.beacon_influence_overlay}</p> : null}
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Reflection and shadow {card.diagnostic.reflection_shadow_overlay}</p> : null}
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Environmental response {card.diagnostic.environmental_response_overlay}</p> : null}
                        {card.diagnostic?.camera_state_overlay ? <p className="text-xs leading-6 text-slate">Camera state {card.diagnostic.camera_state_overlay}</p> : null}
                        {card.diagnostic?.articulated_entity_overlay ? <p className="text-xs leading-6 text-slate">Entity state {card.diagnostic.articulated_entity_overlay}</p> : null}
                        {card.diagnostic?.multi_entity_overlay ? <p className="text-xs leading-6 text-slate">Formation state {card.diagnostic.multi_entity_overlay}</p> : null}
                        {card.diagnostic?.cinematic_staging_overlay ? <p className="text-xs leading-6 text-slate">Staging state {card.diagnostic.cinematic_staging_overlay}</p> : null}
                        {card.diagnostic?.cinematic_focus_flow_overlay ? <p className="text-xs leading-6 text-slate">Focus flow {card.diagnostic.cinematic_focus_flow_overlay}</p> : null}
                        {card.diagnostic?.cinematic_tension_curve_overlay ? <p className="text-xs leading-6 text-slate">Tension curve {card.diagnostic.cinematic_tension_curve_overlay}</p> : null}
                        {card.diagnostic?.cinematic_momentum_flow_overlay ? <p className="text-xs leading-6 text-slate">Momentum flow {card.diagnostic.cinematic_momentum_flow_overlay}</p> : null}
                        {card.diagnostic?.cinematic_transition_blend_overlay ? <p className="text-xs leading-6 text-slate">Transition blend {card.diagnostic.cinematic_transition_blend_overlay}</p> : null}
                        {card.diagnostic?.cinematic_scene_cohesion_overlay ? <p className="text-xs leading-6 text-slate">Scene cohesion {card.diagnostic.cinematic_scene_cohesion_overlay}</p> : null}
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Overlay {card.diagnostic.scene_readability_overlay}</p> : null}
                        {card.diagnostic ? <p className="text-xs leading-6 text-slate">Relationship overlay {card.diagnostic.object_relationship_overlay}</p> : null}
                        <p className="text-xs leading-6 text-slate">{card.assetPath}</p>
                        <div className="flex flex-wrap gap-2">
                          <a href={card.assetUrl} target="_blank" rel="noreferrer" data-guided-focus={cardIndex === 0 ? "preview-output-first-image" : undefined} className="rounded-full border border-ocean/20 bg-ocean px-3 py-1.5 text-xs font-semibold text-white">Open</a>
                          <a href={`${card.assetUrl}&download=1`} className="rounded-full border border-ink/10 bg-white px-3 py-1.5 text-xs font-semibold text-ink">Download</a>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p>No governed preview files are available yet.</p>
              )}
            </div>
          </CollapsibleActivitySection>

          <CollapsibleActivitySection
            sectionLabel="Frame Comparison"
            title="Continuity Comparison"
            activity={comparisonActivity}
            defaultOpen={false}
            {...guidedSectionProps("frame-comparison")}
          >
            <div className="mt-5 space-y-3 text-sm leading-7 body-muted">
              {comparisonCards.length === 2 ? (
                <div className="grid gap-4 md:grid-cols-2">
                  {comparisonCards.map((card) => (
                    <article key={`compare-${card.id}`} className="overflow-hidden rounded-[1.25rem] border border-ink/10 bg-white/90 shadow-sm">
                      <div className="aspect-square bg-mist/50">
                        <Image src={card.assetUrl} alt={card.label} width={256} height={256} unoptimized className="h-full w-full object-contain" />
                      </div>
                      <div className="p-4">
                        <p className="text-sm font-semibold text-ink">{card.label}</p>
                        <p className="text-xs uppercase tracking-[0.18em] text-slate">{card.source}</p>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p>Generate at least two governed PNG frames to compare continuity side by side.</p>
              )}
            </div>
          </CollapsibleActivitySection>
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-1">
          <CollapsibleActivitySection
            sectionLabel="Governed Diagnostics"
            title="Diagnostics Activity"
            activity={diagnosticsActivity}
            defaultOpen={false}
            sectionDomId="diagnostics-section"
            className="lg:col-span-3"
            {...guidedSectionProps("governed-diagnostics")}
          >
            <div data-guided-highlight="diagnostics" data-guided-focus="diagnostics-panel" tabIndex={-1} className={`mt-5 scroll-mt-6 rounded-[1.25rem] border p-4 ${guidedTargetHighlightClass(isGuidedHighlightActive("diagnostics"))}`}>
              <GuidedTargetCallout active={isGuidedHighlightActive("diagnostics")} label={activeGuidedTarget.calloutLabel} instruction={activeGuidedTarget.instruction} />
              {latestAnimeCharacterReport ? <CharacterDiagnosticsOverview report={latestAnimeCharacterReport} /> : null}
              {activeDiagnostics ? <DiagnosticsOverview diagnostics={activeDiagnostics} /> : <p className="text-sm leading-7 body-muted">No diagnostics are available yet. Generate and review outputs before completing this step.</p>}
            </div>
          </CollapsibleActivitySection>

          <CollapsibleActivitySection
            sectionLabel="Blockers And Rollback"
            title="Validation And Sandbox Recovery"
            activity={validationActivity}
            defaultOpen={validationActivity.critical}
            {...guidedSectionProps("blockers-rollback")}
          >
            <div className="mt-5 space-y-3 text-sm leading-7 body-muted">
              {prerequisiteState?.continuity_validation.blockers.length ? (
                <ul className="space-y-2">
                  {prerequisiteState.continuity_validation.blockers.map((blocker) => (
                    <li key={`continuity-${blocker}`} className="rounded-[1rem] border border-amber-200 bg-amber-50 px-4 py-3 text-amber-700">{blocker}</li>
                  ))}
                </ul>
              ) : null}
              {execution?.blockers.length ? (
                <ul className="space-y-2">
                  {execution.blockers.map((blocker) => (
                    <li key={blocker} className="rounded-[1rem] border border-coral/20 bg-coral/10 px-4 py-3 text-ember">{blocker}</li>
                  ))}
                </ul>
              ) : (
                <p>No active preview blockers are recorded.</p>
              )}
              {rollback?.deleted_output_targets.length ? (
                <ul className="space-y-2">
                  {rollback.deleted_output_targets.map((target) => (
                    <li key={target} className="rounded-[1rem] border border-ink/10 bg-white/80 px-4 py-3">{target}</li>
                  ))}
                </ul>
              ) : (
                <p>Rollback stays limited to preview sandbox outputs only.</p>
              )}
            </div>
          </CollapsibleActivitySection>
        </section>
      </section>
    </main>
  );
}

function ReportSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="operator-report-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function ReportKeyValueList({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="operator-report-kv">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ReportPathList({ paths, emptyLabel }: { paths: string[]; emptyLabel: string }) {
  if (!paths.length) {
    return <p className="operator-report-muted">{emptyLabel}</p>;
  }

  return (
    <ul className="operator-report-paths">
      {paths.map((path) => (
        <li key={path}>{path}</li>
      ))}
    </ul>
  );
}

function ReportGallery({ cards }: { cards: PreviewGalleryCard[] }) {
  if (!cards.length) {
    return <p className="operator-report-muted">No preview frame or GIF references are available yet.</p>;
  }

  return (
    <div className="operator-report-gallery">
      {cards.map((card) => (
        <article key={`report-${card.id}`}>
          <div className="operator-report-thumb">
            <Image src={card.assetUrl} alt={card.label} width={160} height={160} unoptimized />
          </div>
          <h3>{card.label}</h3>
          <p>{card.format.toUpperCase()} | {card.source}</p>
          <p>{card.assetPath}</p>
        </article>
      ))}
    </div>
  );
}

type OperatorRunReportProps = {
  form: GovernedPreviewFormInput;
  compiledRequest: GovernedPreviewRequest | null;
  execution: GovernedPreviewExecutionResult | null;
  microSequence: GovernedPreviewMicroSequenceResult | null;
  prerequisiteState: GovernedPreviewPrerequisiteState | null;
  rollback: GovernedPreviewRollbackResult | null;
  executionState: GovernedExecutionState;
  timeline: GovernedExecutionTimelineItem[];
  finalVerdict: FinalOperatorVerdict;
  message: string;
  error: string | null;
  activeDiagnostics: CinematicGovernedPreviewDiagnostics | null;
  latestAnimeCharacterReport: AnimeCharacterReport | null;
  animeCharacterSummary: AnimeCharacterDiagnosticSummary | null;
  activeTruthCheck: AnimeCharacterReport["truthCheck"] | CinematicGovernedPreviewDiagnostics["anime_character_truth_check"] | null;
  reviewState: {
    subjectStyleConfirmed: boolean;
    microSequenceReviewed: boolean;
    previewOutputReviewed: boolean;
    diagnosticsReviewed: boolean;
    finalVisualIntentMatched: boolean;
    finalTruthChecksPassed: boolean;
    finalScaffoldFallbackInactive: boolean;
    finalDiagnosticsClear: boolean;
  };
  previewCards: PreviewGalleryCard[];
  microSequenceCards: PreviewGalleryCard[];
};

function OperatorRunReport({
  form,
  compiledRequest,
  execution,
  microSequence,
  prerequisiteState,
  rollback,
  executionState,
  timeline,
  finalVerdict,
  message,
  error,
  activeDiagnostics,
  latestAnimeCharacterReport,
  animeCharacterSummary,
  activeTruthCheck,
  reviewState,
  previewCards,
  microSequenceCards,
}: OperatorRunReportProps) {
  const allArtifactPaths = uniqueStrings([
    ...executionState.exportedArtifactPaths,
    ...(execution?.generated_preview_references ?? []),
    ...(microSequence?.generated_frame_references ?? []),
    ...(prerequisiteState?.generated_frame_references ?? []),
    latestAnimeCharacterReport?.visualReviewPackage?.firstPngToInspect,
    latestAnimeCharacterReport?.visualReviewPackage?.gifToInspect,
    latestAnimeCharacterReport?.visualReviewPackage?.manifestPath,
    latestAnimeCharacterReport?.visualReviewPackage?.diagnosticsPath,
    latestAnimeCharacterReport?.visualReviewPackage?.operatorSummaryPath,
  ]);
  const blockers = uniqueStrings([
    ...(execution?.blockers ?? []),
    ...(microSequence?.blockers ?? []),
    ...(prerequisiteState?.continuity_validation.blockers ?? []),
  ]);
  const previewReferences = [...microSequenceCards, ...previewCards];
  const scaffoldStatus = activeTruthCheck?.scaffold_status
    ?? latestAnimeCharacterReport?.scaffoldStatus
    ?? animeCharacterSummary?.scaffoldStatus
    ?? "not evaluated";
  const fallbackDominance = activeTruthCheck?.fallback_primitive_dominance
    ?? latestAnimeCharacterReport?.truthCheck.fallback_primitive_dominance
    ?? null;

  return (
    <div className="operator-run-report-print" aria-label="Printable operator run report">
      <header className="operator-report-header">
        <p>AI-E Operator Run Report</p>
        <h1>Governed Preview Generation Review</h1>
        <span>Generated {new Date().toLocaleString()}</span>
      </header>

      <ReportSection title="Request Summary">
        <ReportKeyValueList items={[
          { label: "Prompt", value: form.prompt || "not provided" },
          { label: "Subject", value: form.subject || "not provided" },
          { label: "Motion intent", value: form.motion_intent || "not provided" },
          { label: "Style", value: form.style || "not provided" },
          { label: "Duration", value: `${form.duration_seconds}s` },
          { label: "Resolution", value: form.resolution },
          { label: "Continuity priority", value: form.continuity_priority },
          { label: "Manual approval", value: formatBoolean(form.governance_approval) },
          { label: "GIF packaging requested", value: formatBoolean(form.package_gif_preview) },
          { label: "Compiled request", value: compiledRequest?.request_id ?? "not compiled" },
          { label: "Operator message", value: message },
          { label: "Current error", value: error ?? "none" },
        ]} />
      </ReportSection>

      <ReportSection title="Execution Lifecycle">
        <ReportKeyValueList items={[
          { label: "Current phase", value: getGovernedExecutionPhaseLabel(executionState.currentPhase) },
          { label: "Active action", value: actionRenderMode(executionState.activeAction) },
          { label: "Active request", value: executionState.activeRequestId ?? "none" },
          { label: "Started", value: formatDateTime(executionState.executionStartedAt) },
          { label: "Finished", value: formatDateTime(executionState.executionFinishedAt) },
          { label: "Status message", value: executionState.statusMessage },
          { label: "Next action", value: executionState.nextActionRecommendation },
          { label: "Render completed", value: formatBoolean(executionState.renderCompleted) },
          { label: "Render rejected", value: formatBoolean(executionState.renderRejected) },
          { label: "Render failed", value: formatBoolean(executionState.renderFailed) },
          { label: "Failure reason", value: executionState.failureReason ?? "none" },
        ]} />
        <ol className="operator-report-timeline">
          {timeline.map((item) => (
            <li key={`report-timeline-${item.id}`}>
              <strong>{item.label}</strong> [{item.status}] {item.detail}
            </li>
          ))}
        </ol>
      </ReportSection>

      <ReportSection title="Output Artifact Paths">
        <ReportPathList paths={allArtifactPaths} emptyLabel="No output artifact paths are recorded yet." />
      </ReportSection>

      <ReportSection title="Visual Review Status">
        <ReportKeyValueList items={[
          { label: "Subject/style confirmed", value: formatBoolean(reviewState.subjectStyleConfirmed) },
          { label: "Micro-sequence reviewed", value: formatBoolean(reviewState.microSequenceReviewed) },
          { label: "Preview output reviewed", value: formatBoolean(reviewState.previewOutputReviewed) },
          { label: "Diagnostics reviewed", value: formatBoolean(reviewState.diagnosticsReviewed) },
          { label: "Visual intent matched", value: formatBoolean(reviewState.finalVisualIntentMatched) },
          { label: "Truth checks passed", value: formatBoolean(reviewState.finalTruthChecksPassed) },
          { label: "Scaffold/fallback inactive", value: formatBoolean(reviewState.finalScaffoldFallbackInactive) },
          { label: "Diagnostics clear", value: formatBoolean(reviewState.finalDiagnosticsClear) },
          { label: "Visual review package", value: latestAnimeCharacterReport?.visualReviewPackage?.reviewLabel ?? "not ready" },
        ]} />
      </ReportSection>

      <ReportSection title="Scaffold Status">
        <ReportKeyValueList items={[
          { label: "Scaffold status", value: scaffoldStatus },
          { label: "Renderer path", value: activeTruthCheck?.renderer_path ?? latestAnimeCharacterReport?.truthCheck.renderer_path ?? "not evaluated" },
          { label: "Character pixels generated", value: activeTruthCheck ? formatBoolean(activeTruthCheck.character_pixels_generated) : "not evaluated" },
          { label: "Character primary subject", value: activeTruthCheck ? formatBoolean(activeTruthCheck.character_primary_subject) : "not evaluated" },
          { label: "Fallback primitive dominance", value: fallbackDominance === null ? "not evaluated" : formatBoolean(fallbackDominance) },
          { label: "Diagnostics match output", value: activeTruthCheck ? formatBoolean(activeTruthCheck.diagnostics_match_rendered_output) : "not evaluated" },
          { label: "Anime summary fallback count", value: animeCharacterSummary?.fallbackPrimitiveDominanceCount ?? "not evaluated" },
        ]} />
      </ReportSection>

      <ReportSection title="Diagnostics">
        <ReportKeyValueList items={[
          { label: "Diagnostics present", value: formatBoolean(Boolean(activeDiagnostics)) },
          { label: "Recognizable object", value: activeDiagnostics?.recognizable_object ?? "not recorded" },
          { label: "Active entity", value: activeDiagnostics?.active_entity_type ?? "not recorded" },
          { label: "Active formation", value: activeDiagnostics?.active_formation_type ?? "not recorded" },
          { label: "Active beat", value: activeDiagnostics?.active_beat_type ?? "not recorded" },
          { label: "Active focus", value: activeDiagnostics?.active_focus_subject ?? activeDiagnostics?.focus_subject ?? "not recorded" },
          { label: "Frame coherence", value: activeDiagnostics ? `${activeDiagnostics.frame_coherence_score}/100` : "not recorded" },
          { label: "Camera stability", value: activeDiagnostics ? `${activeDiagnostics.camera_stability_score}/100` : "not recorded" },
          { label: "Scene overlay", value: activeDiagnostics?.scene_readability_overlay ?? "not recorded" },
        ]} />
        <ReportPathList paths={activeDiagnostics?.artifact_diagnostics ?? []} emptyLabel="No artifact diagnostics are recorded." />
      </ReportSection>

      <ReportSection title="Rollback Info">
        <ReportKeyValueList items={[
          { label: "Execution rollback state", value: executionState.rollbackInProgress ? "restoring" : executionState.activeAction === "rollback" && executionState.renderCompleted ? "complete" : "idle" },
          { label: "Preview rollback status", value: execution?.rollback_status ?? microSequence?.rollback_status ?? "not recorded" },
          { label: "Rollback result", value: rollback?.rollback_status ?? "not run" },
          { label: "Rollback sandbox", value: rollback?.sandbox_path ?? executionState.sandboxPath ?? execution?.sandbox_path ?? microSequence?.sandbox_path ?? "not recorded" },
          { label: "Sandbox limited", value: rollback ? formatBoolean(rollback.sandbox_limited) : "not recorded" },
        ]} />
        <ReportPathList paths={rollback?.deleted_output_targets ?? []} emptyLabel="No rollback cleanup targets are recorded." />
      </ReportSection>

      <ReportSection title="Final Verdict">
        <ReportKeyValueList items={[
          { label: "Final operator verdict", value: finalVerdict },
          { label: "Preview status", value: execution?.status ?? "not run" },
          { label: "Micro-sequence status", value: microSequence?.status ?? "not run" },
          { label: "Continuity valid", value: formatBoolean(execution?.continuity_validation.valid ?? microSequence?.continuity_validation.valid ?? prerequisiteState?.continuity_validation.valid ?? false) },
          { label: "Active blockers", value: blockers.length ? blockers.join(", ") : "none" },
        ]} />
      </ReportSection>

      <ReportSection title="Preview Frame And GIF References">
        <ReportGallery cards={previewReferences} />
      </ReportSection>
    </div>
  );
}