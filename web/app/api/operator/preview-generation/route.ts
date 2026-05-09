import { NextResponse } from "next/server";

import {
  executeGovernedPreviewMicroSequenceRequest,
  executeGovernedPreviewRequest,
  readGovernedPreviewPrerequisiteState,
  rollbackGovernedPreviewSandbox,
} from "@/lib/aie/governedPreviewGeneration";
import {
  compileGovernedPreviewRequest,
  type GovernedPreviewFormInput,
} from "@/lib/aie/governedPreviewGenerationContract";
import {
  buildGovernedPromptVariationHarnessState,
  buildPromptVariationExecutionPlan,
  classifyGovernedPromptVariationPrompt,
  listGovernedPromptVariationVariants,
  runGovernedPromptVariationVariant,
  summarizeGovernedPromptVariationReports,
} from "@/lib/aie/promptVariation/governedPromptVariationHarness";
import {
  getApprovedPromptVariantById,
  type ApprovedPromptVariant,
} from "@/lib/aie/promptVariation/approvedPromptVariants";
import type { PromptVariationVariantReport } from "@/lib/aie/promptVariation/promptVariationHarnessState";
import {
  buildGovernedPromptDomainHarnessState,
  buildPromptDomainExecutionPlan,
  classifyGovernedPromptDomainPrompt,
  listGovernedPromptDomains,
  runGovernedPromptDomainById,
  summarizeGovernedPromptDomainReports,
} from "@/lib/aie/promptDomains/governedPromptDomainExpansion";
import {
  getApprovedPromptDomainTemplateById,
  type ApprovedPromptDomainTemplate,
} from "@/lib/aie/promptDomains/approvedPromptDomainTemplates";
import type { PromptDomainReport } from "@/lib/aie/promptDomains/governedPromptDomainRegistry";
import {
  buildGovernedVisualStyleHarnessState,
  buildVisualStyleExecutionPlan,
  listGovernedVisualStyleProfiles,
  runGovernedVisualStyleProfileById,
  summarizeGovernedVisualStyleReports,
} from "@/lib/aie/styleProfiles/governedVisualStyleProfiles";
import {
  getApprovedVisualStyleProfileById,
  type ApprovedVisualStyleProfile,
} from "@/lib/aie/styleProfiles/approvedVisualStyleProfiles";
import type { VisualStyleReport } from "@/lib/aie/styleProfiles/governedVisualStyleRegistry";
import {
  buildGovernedStyleStressHarnessState,
  buildStyleStressExecutionPlan,
  listGovernedStyleStressCells,
  listGovernedStyleStressStarterCells,
  runGovernedStyleStressCellById,
  summarizeGovernedStyleStressReports,
} from "@/lib/aie/styleStress/governedStyleStressHarness";
import { getStyleStressCellResources } from "@/lib/aie/styleStress/styleDomainMatrix";
import type { StyleStressReport } from "@/lib/aie/styleStress/governedStyleStressState";
import {
  buildGovernedStyleIntensityControlsState,
  buildStyleIntensityExecutionPlan,
  listGovernedStyleIntensityCells,
  listGovernedStyleIntensityHighProbeCells,
  listGovernedStyleIntensityPresets,
  listGovernedStyleIntensityStarterCells,
  runGovernedStyleIntensityCellById,
  summarizeGovernedStyleIntensityReports,
} from "@/lib/aie/styleIntensity/governedStyleIntensityControls";
import { getStyleDomainIntensityCellResources } from "@/lib/aie/styleIntensity/styleDomainIntensityMatrix";
import { describeStyleIntensityPreset } from "@/lib/aie/styleIntensity/styleIntensityPresets";
import type { StyleIntensityReport } from "@/lib/aie/styleIntensity/governedStyleIntensityState";
import {
  buildGovernedHighIntensityHarnessState,
  buildHighIntensityExecutionPlan,
  getHighIntensityProbeFormInput,
  listGovernedHighIntensityProbeCells,
  runGovernedHighIntensityProbeById,
  summarizeGovernedHighIntensityReports,
} from "@/lib/aie/highIntensity/governedHighProbeHarness";
import type { HighIntensityReport } from "@/lib/aie/highIntensity/governedHighIntensityState";

export const runtime = "nodejs";

const SAFE_ERROR_MESSAGE = "We couldn't complete governed preview generation right now. Please try again.";
const PROMPT_VARIATION_UNSAFE_EXAMPLE = "A humanoid character speaks to the drones in a long dialogue scene.";
const PROMPT_DOMAIN_UNSAFE_EXAMPLE = "A human pilot gives spoken orders to armed drones during a long battle sequence.";

function normalizeContinuityPriority(value: unknown): GovernedPreviewFormInput["continuity_priority"] {
  return value === "low" || value === "high" ? value : "medium";
}

function normalizeGenerateInput(value: unknown): GovernedPreviewFormInput | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  return {
    prompt: typeof candidate.prompt === "string" ? candidate.prompt : "",
    subject: typeof candidate.subject === "string" ? candidate.subject : "",
    motion_intent: typeof candidate.motion_intent === "string" ? candidate.motion_intent : "",
    style: typeof candidate.style === "string" ? candidate.style : "",
    duration_seconds: typeof candidate.duration_seconds === "number"
      ? candidate.duration_seconds
      : Number(candidate.duration_seconds ?? Number.NaN),
    resolution: typeof candidate.resolution === "string" ? candidate.resolution : "720p",
    continuity_priority: normalizeContinuityPriority(candidate.continuity_priority),
    governance_approval: candidate.governance_approval === true,
    package_gif_preview: candidate.package_gif_preview !== false,
  };
}

function normalizeTextInput(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeBoolean(value: unknown): boolean {
  return value === true;
}

function normalizePromptVariationHistory(value: unknown): PromptVariationVariantReport[] {
  return Array.isArray(value) ? value as PromptVariationVariantReport[] : [];
}

function normalizePromptDomainHistory(value: unknown): PromptDomainReport[] {
  return Array.isArray(value) ? value as PromptDomainReport[] : [];
}

function normalizeVisualStyleHistory(value: unknown): VisualStyleReport[] {
  return Array.isArray(value) ? value as VisualStyleReport[] : [];
}

function normalizeStyleStressHistory(value: unknown): StyleStressReport[] {
  return Array.isArray(value) ? value as StyleStressReport[] : [];
}

function normalizeStyleIntensityHistory(value: unknown): StyleIntensityReport[] {
  return Array.isArray(value) ? value as StyleIntensityReport[] : [];
}

function normalizeHighIntensityHistory(value: unknown): HighIntensityReport[] {
  return Array.isArray(value) ? value as HighIntensityReport[] : [];
}

function buildVariantFormInput(variant: ApprovedPromptVariant, governanceApproval: boolean): GovernedPreviewFormInput {
  return {
    prompt: variant.prompt,
    subject: variant.subject,
    motion_intent: variant.motion_intent,
    style: variant.style,
    duration_seconds: variant.duration_seconds,
    resolution: variant.resolution,
    continuity_priority: variant.continuity_priority,
    governance_approval: governanceApproval,
    package_gif_preview: variant.package_gif_preview,
  };
}

function buildDomainFormInput(domain: ApprovedPromptDomainTemplate, governanceApproval: boolean): GovernedPreviewFormInput {
  return {
    prompt: domain.prompt,
    subject: domain.subject,
    motion_intent: domain.motion_intent,
    style: domain.style,
    duration_seconds: domain.duration_seconds,
    resolution: domain.resolution,
    continuity_priority: domain.continuity_priority,
    governance_approval: governanceApproval,
    package_gif_preview: domain.package_gif_preview,
  };
}

function buildStyleFormInput(styleProfile: ApprovedVisualStyleProfile, governanceApproval: boolean): GovernedPreviewFormInput {
  return {
    prompt: styleProfile.prompt,
    subject: styleProfile.subject,
    motion_intent: styleProfile.motion_intent,
    style: styleProfile.style,
    duration_seconds: styleProfile.duration_seconds,
    resolution: styleProfile.resolution,
    continuity_priority: styleProfile.continuity_priority,
    governance_approval: governanceApproval,
    package_gif_preview: styleProfile.package_gif_preview,
  };
}

function buildStyleStressFormInput(cellId: string, governanceApproval: boolean): GovernedPreviewFormInput | null {
  const resources = getStyleStressCellResources(cellId);
  if (!resources) {
    return null;
  }

  const { styleProfile, domain } = resources;
  return {
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
    governance_approval: governanceApproval,
    package_gif_preview: styleProfile.package_gif_preview || domain.package_gif_preview,
  };
}

function buildStyleIntensityFormInput(cellId: string, governanceApproval: boolean): GovernedPreviewFormInput | null {
  const resources = getStyleDomainIntensityCellResources(cellId);
  if (!resources) {
    return null;
  }

  const { styleProfile, domain, preset } = resources;
  return {
    prompt: domain.prompt,
    subject: domain.subject,
    motion_intent: domain.motion_intent,
    style: `${styleProfile.style}; ${styleProfile.characteristics.join(", ")}; governed ${preset.level.toLowerCase()} intensity; ${describeStyleIntensityPreset(preset)}`,
    duration_seconds: Math.min(styleProfile.duration_seconds, domain.duration_seconds),
    resolution: styleProfile.resolution,
    continuity_priority: styleProfile.continuity_priority === "high" || domain.continuity_priority === "high"
      ? "high"
      : styleProfile.continuity_priority === "medium" || domain.continuity_priority === "medium"
        ? "medium"
        : "low",
    governance_approval: governanceApproval,
    package_gif_preview: styleProfile.package_gif_preview || domain.package_gif_preview,
  };
}

function buildPromptVariationPayload() {
  const variants = listGovernedPromptVariationVariants();
  return {
    variants,
    executionPlan: buildPromptVariationExecutionPlan(variants.map((entry) => entry.id)),
    unsafePromptExample: PROMPT_VARIATION_UNSAFE_EXAMPLE,
  };
}

function buildPromptDomainPayload() {
  const domains = listGovernedPromptDomains();
  return {
    domains,
    executionPlan: buildPromptDomainExecutionPlan(domains.map((entry) => entry.id)),
    unsafePromptExample: PROMPT_DOMAIN_UNSAFE_EXAMPLE,
  };
}

function buildVisualStylePayload() {
  const styles = listGovernedVisualStyleProfiles();
  return {
    styles,
    executionPlan: buildVisualStyleExecutionPlan(styles.map((entry) => entry.id)),
  };
}

function buildStyleStressPayload() {
  const cells = listGovernedStyleStressCells();
  return {
    cells,
    starterCells: listGovernedStyleStressStarterCells(),
    executionPlan: buildStyleStressExecutionPlan(cells.map((entry) => entry.cellId)),
  };
}

function buildStyleIntensityPayload() {
  const cells = listGovernedStyleIntensityCells();
  return {
    presets: listGovernedStyleIntensityPresets(),
    cells,
    starterCells: listGovernedStyleIntensityStarterCells(),
    highProbeCells: listGovernedStyleIntensityHighProbeCells(),
    executionPlan: buildStyleIntensityExecutionPlan(cells.map((entry) => entry.cellId)),
  };
}

function buildHighIntensityPayload() {
  const probes = listGovernedHighIntensityProbeCells();
  return {
    probes,
    executionPlan: buildHighIntensityExecutionPlan(probes.map((entry) => entry.probeId)),
  };
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return { message: String(error) };
}

export async function GET() {
  try {
    const prerequisiteState = await readGovernedPreviewPrerequisiteState();
    return NextResponse.json({
      prerequisiteState,
      promptVariation: buildPromptVariationPayload(),
      promptDomain: buildPromptDomainPayload(),
      visualStyle: buildVisualStylePayload(),
      styleStress: buildStyleStressPayload(),
      styleIntensity: buildStyleIntensityPayload(),
      highIntensity: buildHighIntensityPayload(),
    });
  } catch (error) {
    console.error("[api/operator/preview-generation] status failed", serializeError(error));
    return NextResponse.json({ error: SAFE_ERROR_MESSAGE }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = body.action === "rollback"
      ? "rollback"
      : body.action === "generate-micro-sequence"
        ? "generate-micro-sequence"
        : body.action === "classify-prompt-variation"
          ? "classify-prompt-variation"
          : body.action === "classify-prompt-domain"
            ? "classify-prompt-domain"
          : body.action === "run-prompt-variation-variant"
            ? "run-prompt-variation-variant"
            : body.action === "run-prompt-domain"
              ? "run-prompt-domain"
              : body.action === "run-visual-style-profile"
                ? "run-visual-style-profile"
                : body.action === "run-style-stress-cell"
                  ? "run-style-stress-cell"
                  : body.action === "run-style-intensity-cell"
                    ? "run-style-intensity-cell"
                    : body.action === "run-high-intensity-probe"
                      ? "run-high-intensity-probe"
        : body.action === "status"
          ? "status"
          : "generate";

    if (action === "status") {
      const prerequisiteState = await readGovernedPreviewPrerequisiteState();
      return NextResponse.json({ prerequisiteState, promptVariation: buildPromptVariationPayload(), promptDomain: buildPromptDomainPayload(), visualStyle: buildVisualStylePayload(), styleStress: buildStyleStressPayload(), styleIntensity: buildStyleIntensityPayload(), highIntensity: buildHighIntensityPayload() });
    }

    if (action === "rollback") {
      const rollback = await rollbackGovernedPreviewSandbox();
      return NextResponse.json({ rollback });
    }

    if (action === "classify-prompt-variation") {
      const prompt = normalizeTextInput(body.prompt);
      return NextResponse.json({
        safety: classifyGovernedPromptVariationPrompt(prompt),
        promptVariation: buildPromptVariationPayload(),
      });
    }

    if (action === "classify-prompt-domain") {
      const prompt = normalizeTextInput(body.prompt);
      return NextResponse.json({
        safety: classifyGovernedPromptDomainPrompt(prompt),
        promptDomain: buildPromptDomainPayload(),
      });
    }

    if (action === "run-prompt-variation-variant") {
      const variantId = normalizeTextInput(body.variantId).trim().toUpperCase();
      const governanceApproval = normalizeBoolean(body.governanceApproval);
      const approvedVariants = listGovernedPromptVariationVariants();
      const variant = getApprovedPromptVariantById(variantId);

      if (!variant) {
        return NextResponse.json({ error: "An approved prompt variant is required." }, { status: 400 });
      }

      const report = await runGovernedPromptVariationVariant({
        variantId,
        governanceApproval,
        variantIndex: Math.max(approvedVariants.findIndex((entry) => entry.id === variantId), 0) + 1,
        totalVariants: approvedVariants.length,
        rejectedVariantCount: normalizePromptVariationHistory(body.priorReports).filter((entry) => entry.safetyStatus === "REJECTED").length,
      });
      const reports = [
        ...normalizePromptVariationHistory(body.priorReports).filter((entry) => entry.variantId !== report.variantId),
        report,
      ].sort((left, right) => left.variantIndex - right.variantIndex);

      return NextResponse.json({
        compiledRequest: compileGovernedPreviewRequest(buildVariantFormInput(variant, governanceApproval)),
        report,
        reports,
        reportSummary: summarizeGovernedPromptVariationReports(reports),
        harnessState: buildGovernedPromptVariationHarnessState(reports),
        prerequisiteState: report.prerequisiteAfter ?? report.prerequisiteBefore,
        promptVariation: buildPromptVariationPayload(),
      });
    }

    if (action === "run-prompt-domain") {
      const domainId = normalizeTextInput(body.domainId).trim().toUpperCase();
      const governanceApproval = normalizeBoolean(body.governanceApproval);
      const approvedDomains = listGovernedPromptDomains();
      const domain = getApprovedPromptDomainTemplateById(domainId);

      if (!domain) {
        return NextResponse.json({ error: "An approved prompt domain is required." }, { status: 400 });
      }

      const report = await runGovernedPromptDomainById({
        domainId,
        governanceApproval,
        domainIndex: Math.max(approvedDomains.findIndex((entry) => entry.id === domainId), 0) + 1,
        totalDomains: approvedDomains.length,
        rejectedDomainCount: normalizePromptDomainHistory(body.priorReports).filter((entry) => entry.safetyStatus === "REJECTED").length,
      });
      const reports = [
        ...normalizePromptDomainHistory(body.priorReports).filter((entry) => entry.domainId !== report.domainId),
        report,
      ].sort((left, right) => left.domainIndex - right.domainIndex);

      return NextResponse.json({
        compiledRequest: compileGovernedPreviewRequest(buildDomainFormInput(domain, governanceApproval)),
        report,
        reports,
        reportSummary: summarizeGovernedPromptDomainReports(reports),
        harnessState: buildGovernedPromptDomainHarnessState(reports),
        prerequisiteState: report.prerequisiteAfter ?? report.prerequisiteBefore,
        promptDomain: buildPromptDomainPayload(),
      });
    }

    if (action === "run-visual-style-profile") {
      const styleId = normalizeTextInput(body.styleId).trim().toUpperCase();
      const governanceApproval = normalizeBoolean(body.governanceApproval);
      const approvedStyles = listGovernedVisualStyleProfiles();
      const styleProfile = getApprovedVisualStyleProfileById(styleId);

      if (!styleProfile) {
        return NextResponse.json({ error: "An approved visual style profile is required." }, { status: 400 });
      }

      const report = await runGovernedVisualStyleProfileById({
        styleId,
        governanceApproval,
        styleIndex: Math.max(approvedStyles.findIndex((entry) => entry.id === styleId), 0) + 1,
        totalStyles: approvedStyles.length,
        rejectedStyleCount: normalizeVisualStyleHistory(body.priorReports).filter((entry) => entry.safetyStatus === "REJECTED").length,
      });
      const reports = [
        ...normalizeVisualStyleHistory(body.priorReports).filter((entry) => entry.styleId !== report.styleId),
        report,
      ].sort((left, right) => left.styleIndex - right.styleIndex);

      return NextResponse.json({
        compiledRequest: compileGovernedPreviewRequest(buildStyleFormInput(styleProfile, governanceApproval)),
        report,
        reports,
        reportSummary: summarizeGovernedVisualStyleReports(reports),
        harnessState: buildGovernedVisualStyleHarnessState(reports),
        prerequisiteState: report.prerequisiteAfter ?? report.prerequisiteBefore,
        visualStyle: buildVisualStylePayload(),
      });
    }

    if (action === "run-style-stress-cell") {
      const cellId = normalizeTextInput(body.cellId).trim().toUpperCase();
      const governanceApproval = normalizeBoolean(body.governanceApproval);
      const approvedCells = listGovernedStyleStressCells();
      const cell = approvedCells.find((entry) => entry.cellId === cellId);
      const formInput = buildStyleStressFormInput(cellId, governanceApproval);

      if (!cell || !formInput) {
        return NextResponse.json({ error: "An approved style stress matrix cell is required." }, { status: 400 });
      }

      const report = await runGovernedStyleStressCellById({
        cellId,
        governanceApproval,
        cellIndex: Math.max(approvedCells.findIndex((entry) => entry.cellId === cellId), 0) + 1,
        totalCells: approvedCells.length,
        rejectedCellCount: normalizeStyleStressHistory(body.priorReports).filter((entry) => entry.safetyStatus === "REJECTED").length,
      });
      const reports = [
        ...normalizeStyleStressHistory(body.priorReports).filter((entry) => entry.cellId !== report.cellId),
        report,
      ].sort((left, right) => left.cellIndex - right.cellIndex);

      return NextResponse.json({
        compiledRequest: compileGovernedPreviewRequest(formInput),
        report,
        reports,
        reportSummary: summarizeGovernedStyleStressReports(reports),
        harnessState: buildGovernedStyleStressHarnessState(reports),
        prerequisiteState: report.prerequisiteAfter ?? report.prerequisiteBefore,
        styleStress: buildStyleStressPayload(),
      });
    }

    if (action === "run-style-intensity-cell") {
      const cellId = normalizeTextInput(body.cellId).trim().toUpperCase();
      const governanceApproval = normalizeBoolean(body.governanceApproval);
      const highIntensityApproval = normalizeBoolean(body.highIntensityApproval);
      const approvedCells = listGovernedStyleIntensityCells();
      const cell = approvedCells.find((entry) => entry.cellId === cellId);
      const formInput = buildStyleIntensityFormInput(cellId, governanceApproval);

      if (!cell || !formInput) {
        return NextResponse.json({ error: "An approved style intensity matrix cell is required." }, { status: 400 });
      }

      const report = await runGovernedStyleIntensityCellById({
        cellId,
        governanceApproval,
        highIntensityApproval,
        cellIndex: Math.max(approvedCells.findIndex((entry) => entry.cellId === cellId), 0) + 1,
        totalCells: approvedCells.length,
        rejectedIntensityCount: normalizeStyleIntensityHistory(body.priorReports).filter((entry) => entry.safetyStatus === "REJECTED").length,
      });
      const reports = [
        ...normalizeStyleIntensityHistory(body.priorReports).filter((entry) => entry.cellId !== report.cellId),
        report,
      ].sort((left, right) => left.cellIndex - right.cellIndex);

      return NextResponse.json({
        compiledRequest: compileGovernedPreviewRequest(formInput),
        report,
        reports,
        reportSummary: summarizeGovernedStyleIntensityReports(reports),
        harnessState: buildGovernedStyleIntensityControlsState(reports),
        prerequisiteState: report.prerequisiteAfter ?? report.prerequisiteBefore,
        styleIntensity: buildStyleIntensityPayload(),
      });
    }

    if (action === "run-high-intensity-probe") {
      const probeId = normalizeTextInput(body.probeId).trim().toUpperCase();
      const governanceApproval = normalizeBoolean(body.governanceApproval);
      const highProbeApproval = normalizeBoolean(body.highProbeApproval);
      const approvedProbes = listGovernedHighIntensityProbeCells();
      const probe = approvedProbes.find((entry) => entry.probeId === probeId);
      const formInput = getHighIntensityProbeFormInput(probeId, governanceApproval);

      if (!probe || !formInput) {
        return NextResponse.json({ error: "An approved HIGH-intensity probe is required." }, { status: 400 });
      }

      const priorReports = normalizeHighIntensityHistory(body.priorReports);
      const report = await runGovernedHighIntensityProbeById({
        probeId,
        governanceApproval,
        highProbeApproval,
        probeIndex: Math.max(approvedProbes.findIndex((entry) => entry.probeId === probeId), 0) + 1,
        totalProbes: approvedProbes.length,
        failedHighProbeCount: priorReports.filter((entry) => !entry.pass).length,
        priorReports,
      });
      const reports = [
        ...priorReports.filter((entry) => entry.probeId !== report.probeId),
        report,
      ].sort((left, right) => left.probeIndex - right.probeIndex);

      return NextResponse.json({
        compiledRequest: compileGovernedPreviewRequest(formInput),
        report,
        reports,
        reportSummary: summarizeGovernedHighIntensityReports(reports),
        harnessState: buildGovernedHighIntensityHarnessState(reports),
        prerequisiteState: report.prerequisiteAfter ?? report.prerequisiteBefore,
        highIntensity: buildHighIntensityPayload(),
      });
    }

    const input = normalizeGenerateInput(body.input);
    if (!input) {
      return NextResponse.json({ error: "A governed preview request is required." }, { status: 400 });
    }

    const compiledRequest = compileGovernedPreviewRequest(input);

    if (action === "generate-micro-sequence") {
      const microSequence = await executeGovernedPreviewMicroSequenceRequest(compiledRequest);
      return NextResponse.json({ compiledRequest, microSequence, prerequisiteState: microSequence.prerequisite_state });
    }

    const execution = await executeGovernedPreviewRequest(compiledRequest);
    return NextResponse.json({ compiledRequest, execution, prerequisiteState: execution.prerequisite_state });
  } catch (error) {
    console.error("[api/operator/preview-generation] request failed", serializeError(error));
    return NextResponse.json({ error: SAFE_ERROR_MESSAGE }, { status: 500 });
  }
}