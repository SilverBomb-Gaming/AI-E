import type { PlanRiskLevel, OperatorRequest } from "./operatorLightPlanner";
import {
  refineConversationalIntent,
  type ConversationalRefinementRequest,
  type ConversationalRefinementResult,
} from "./conversationalIntentRefinement";
import {
  scoreIntentConfidence,
  type IntentConfidenceResult,
} from "./intentConfidenceScoring";
import {
  normalizeUserInput,
  type IntentNormalizationResult,
} from "./intentNormalization";
import {
  buildToneAdaptationGuidance,
  type ToneAdaptationResult,
} from "./conversationalToneAdaptation";
import {
  getContextAugmentedRequest,
  summarizeSessionContext,
  type SessionContext,
} from "./sessionContextMemory";
import {
  startConversationalLoop,
  type ConversationalLoopResult,
  type ConversationalLoopSession,
} from "./multiTurnConversationalLoop";

export type ConversationalReadinessStatus =
  | "ready_for_planning"
  | "needs_clarification"
  | "needs_review"
  | "blocked";

export type ConversationalReadinessBlocker = {
  code:
    | "missing-normalized-input"
    | "confidence-below-threshold"
    | "critical-ambiguity"
    | "missing-planner-request"
    | "missing-tone-guidance"
    | "session-context-conflict"
    | "unsafe-request"
    | "unbounded-autonomy"
    | "critical-missing-information";
  severity: "clarification" | "review" | "blocked";
  message: string;
  recommended_next_action: "ask-follow-up" | "needs-review" | "block" | "create-plan";
};

export type ConversationalReadinessSignal = {
  signal:
    | "normalized-input-available"
    | "confidence-ready"
    | "confidence-partial"
    | "critical-ambiguity"
    | "planner-request-available"
    | "tone-guidance-available"
    | "session-context-considered"
    | "session-context-aligned"
    | "session-context-conflict"
    | "risk-high"
    | "risk-blocked";
  value: boolean;
  message: string;
};

export type PlannerReadinessPacket = {
  readiness_id: string;
  created_at: string;
  original_request: string;
  normalized_input: string;
  interpreted_intent: string;
  planner_ready_request: OperatorRequest | null;
  confidence_score: number;
  ambiguity_score: number;
  completeness_score: number;
  tone_guidance: ToneAdaptationResult;
  session_context_summary: string;
  missing_information: string[];
  assumptions: string[];
  risk_level: PlanRiskLevel;
  next_action: string;
  explanation: string;
};

export type ConversationalReadinessInput = ConversationalRefinementRequest & {
  createdAt?: string;
  sessionContext?: SessionContext;
  normalizationResult?: IntentNormalizationResult;
  refinementResult?: ConversationalRefinementResult;
  loopResult?: ConversationalLoopResult;
  toneGuidance?: ToneAdaptationResult;
  confidenceResult?: IntentConfidenceResult;
};

export type ConversationalReadinessResult = {
  readiness_id: string;
  created_at: string;
  status: ConversationalReadinessStatus;
  original_request: string;
  normalized_input: string;
  interpreted_intent: string;
  planner_ready_request: OperatorRequest | null;
  confidence_score: number;
  ambiguity_score: number;
  completeness_score: number;
  risk_level: PlanRiskLevel;
  next_action: string;
  explanation: string;
  missing_information: string[];
  assumptions: string[];
  blockers: ConversationalReadinessBlocker[];
  signals: ConversationalReadinessSignal[];
  tone_guidance: ToneAdaptationResult;
  session_context_summary: string;
  session_context_considered: boolean;
  session_context_conflict: boolean;
  normalization_result: IntentNormalizationResult;
  refinement_result: ConversationalRefinementResult;
  confidence_result: IntentConfidenceResult;
  loop_session: ConversationalLoopSession;
  planner_readiness_packet: PlannerReadinessPacket;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36) || "readiness";
}

function buildReadinessId(request: string, createdAt: string): string {
  return `readiness-${createdAt.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000"}-${slugify(request)}`;
}

function hasAnyKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function deriveTarget(text: string): string {
  const normalized = normalizeText(text).toLowerCase();

  if (hasAnyKeyword(normalized, ["enemy", "enemies", "ai", "grenade"])) {
    return "enemies";
  }

  if (hasAnyKeyword(normalized, ["combat", "weapon", "weapons"])) {
    return "combat";
  }

  if (hasAnyKeyword(normalized, ["movement", "jump", "controls", "traversal"])) {
    return "movement";
  }

  if (hasAnyKeyword(normalized, ["visual", "visuals", "graphics", "art"])) {
    return "visuals";
  }

  if (hasAnyKeyword(normalized, ["docs", "documentation", "readme", "tests"])) {
    return "maintenance";
  }

  return "general";
}

function computeContextAlignment(context: SessionContext | undefined, rawRequest: string, normalizedInput: string): {
  considered: boolean;
  aligned: boolean;
  conflict: boolean;
  assumptions: string[];
  summary: string;
} {
  if (!context) {
    return {
      considered: true,
      aligned: false,
      conflict: false,
      assumptions: [],
      summary: "No active session context was provided.",
    };
  }

  const summary = summarizeSessionContext(context);
  const combined = `${normalizeText(rawRequest)} ${normalizeText(normalizedInput)}`.toLowerCase();
  const target = deriveTarget(combined);
  const lastTarget = deriveTarget(context.last_planner_ready_request ?? context.recent_intents[0]?.interpreted_intent ?? "");
  const referencesPriorContext = hasAnyKeyword(combined, ["same", "again", "like before", "that again", "same as before"]);
  const aligned = target !== "general" && context.recurring_targets.includes(target);
  const conflict = referencesPriorContext && target !== "general" && lastTarget !== "general" && target !== lastTarget;
  const assumptions: string[] = [];

  if (aligned && context.last_planner_ready_request) {
    assumptions.push(`Session context aligns with current target: ${target}.`);
    assumptions.push(`Recent planner-ready precedent: ${context.last_planner_ready_request}`);
  }

  if (conflict) {
    assumptions.push(`Current request references prior context but shifts target from ${lastTarget} to ${target}.`);
  }

  return {
    considered: true,
    aligned,
    conflict,
    assumptions,
    summary,
  };
}

function buildConfidenceResult(
  refinement: ConversationalRefinementResult,
  loopSession: ConversationalLoopSession,
  contextAlignment: { aligned: boolean; conflict: boolean },
): IntentConfidenceResult {
  const base = scoreIntentConfidence({
    original_request: loopSession.original_request,
    interpreted_intent: refinement.interpreted_intent,
    clarity_score: refinement.clarity_score,
    follow_up_questions: refinement.follow_up_questions,
    missing_information: refinement.missing_information,
    ambiguity_flags: refinement.ambiguity_flags,
    answers: loopSession.answers.map((answer) => ({ answer: answer.answer })),
    questions: loopSession.questions.map((question) => ({ prompt: question.prompt, answered: question.answered })),
    planner_ready_request: loopSession.planner_ready_request?.rawRequest ?? refinement.planner_ready_request,
    should_create_plan: refinement.should_create_plan,
    risk_level: refinement.risk_level,
  });

  const confidenceBonus = contextAlignment.aligned ? 0.06 : 0;
  const completenessBonus = contextAlignment.aligned ? 0.05 : 0;
  const ambiguityPenalty = contextAlignment.conflict ? 0.12 : 0;
  const ambiguityScore = clamp01(base.ambiguity_score + ambiguityPenalty);
  const completenessScore = clamp01(base.completeness_score + completenessBonus);
  const confidenceScore = clamp01(base.confidence_score + confidenceBonus - ambiguityPenalty);
  const ambiguityFlags = unique([
    ...base.ambiguity_flags,
    ...(contextAlignment.conflict ? ["conflicting-signals" as const] : []),
  ]);

  return {
    ...base,
    ambiguity_score: ambiguityScore,
    completeness_score: completenessScore,
    confidence_score: confidenceScore,
    ambiguity_flags: ambiguityFlags,
    breakdown: {
      ...base.breakdown,
      completeness_component: completenessScore,
      inverse_ambiguity_component: clamp01(1 - ambiguityScore),
      explanation: [
        ...base.breakdown.explanation,
        ...(contextAlignment.aligned ? ["session context alignment bonus applied"] : []),
        ...(contextAlignment.conflict ? ["session context conflict penalty applied"] : []),
      ],
    },
    decision_reason: base.decision_reason,
  };
}

function buildSignals(params: {
  normalizedInput: string;
  confidence: IntentConfidenceResult;
  tone: ToneAdaptationResult;
  context: { considered: boolean; aligned: boolean; conflict: boolean };
  plannerReadyRequest: OperatorRequest | null;
  riskLevel: PlanRiskLevel;
}): ConversationalReadinessSignal[] {
  return [
    {
      signal: "normalized-input-available",
      value: Boolean(params.normalizedInput),
      message: params.normalizedInput ? "Normalized input is available." : "Normalized input is missing.",
    },
    {
      signal: params.confidence.confidence_score >= 0.8 ? "confidence-ready" : "confidence-partial",
      value: params.confidence.confidence_score >= 0.8,
      message: `Confidence score is ${params.confidence.confidence_score}.`,
    },
    {
      signal: "critical-ambiguity",
      value: params.confidence.ambiguity_score >= 0.55 || params.confidence.critical_missing_fields.length > 0,
      message: `Ambiguity score is ${params.confidence.ambiguity_score}; critical missing fields: ${params.confidence.critical_missing_fields.join(", ") || "none"}.`,
    },
    {
      signal: "planner-request-available",
      value: Boolean(params.plannerReadyRequest),
      message: params.plannerReadyRequest ? "Planner-ready request is available." : "Planner-ready request is missing.",
    },
    {
      signal: "tone-guidance-available",
      value: Boolean(params.tone?.response_mode),
      message: params.tone?.response_mode ? `Tone guidance is available in ${params.tone.response_mode} mode.` : "Tone guidance is missing.",
    },
    {
      signal: "session-context-considered",
      value: params.context.considered,
      message: params.context.considered ? "Session context was considered." : "Session context was not considered.",
    },
    {
      signal: "session-context-aligned",
      value: params.context.aligned,
      message: params.context.aligned ? "Current request aligns with recent session context." : "Current request does not rely on aligned session context.",
    },
    {
      signal: "session-context-conflict",
      value: params.context.conflict,
      message: params.context.conflict ? "Current request conflicts with referenced prior session context." : "No session context conflict detected.",
    },
    {
      signal: params.riskLevel === "blocked" ? "risk-blocked" : "risk-high",
      value: params.riskLevel === "high" || params.riskLevel === "blocked",
      message: `Risk level is ${params.riskLevel}.`,
    },
  ];
}

export function listConversationalReadinessBlockers(input: ConversationalReadinessInput): ConversationalReadinessBlocker[] {
  const result = evaluateConversationalReadiness(input);
  return result.blockers;
}

export function evaluateConversationalReadiness(input: ConversationalReadinessInput): ConversationalReadinessResult {
  const createdAt = normalizeText(input.createdAt) || new Date().toISOString();
  const readinessId = buildReadinessId(input.rawRequest, createdAt);
  const normalization = input.normalizationResult ?? normalizeUserInput(input.rawRequest);
  const contextAppliedRequest = input.sessionContext
    ? getContextAugmentedRequest(input.sessionContext, {
      ...input,
      rawRequest: normalization.normalized_input,
    })
    : {
      ...input,
      rawRequest: normalization.normalized_input,
    };
  const refinement = input.refinementResult ?? refineConversationalIntent(contextAppliedRequest);
  const loopResult = input.loopResult ?? startConversationalLoop({
    ...contextAppliedRequest,
    createdAt,
    existingRefinement: refinement,
  });
  const contextAlignment = computeContextAlignment(input.sessionContext, input.rawRequest, normalization.normalized_input);
  const confidence = input.confidenceResult ?? buildConfidenceResult(refinement, loopResult.session, contextAlignment);
  const tone = input.toneGuidance ?? loopResult.session.tone_adaptation ?? buildToneAdaptationGuidance({
    rawRequest: input.rawRequest,
    normalizedInput: normalization.normalized_input,
    user_level_estimate: refinement.user_level_estimate,
    confidence_score: confidence.confidence_score,
    clarity_score: refinement.clarity_score,
    ambiguity_flags: refinement.ambiguity_flags,
    risk_level: refinement.risk_level,
    should_create_plan: refinement.should_create_plan,
    current_interpretation: refinement.interpreted_intent,
  });

  const signals = buildSignals({
    normalizedInput: normalization.normalized_input,
    confidence,
    tone,
    context: contextAlignment,
    plannerReadyRequest: loopResult.planner_ready_request,
    riskLevel: refinement.risk_level,
  });

  const broadImpactRequested = hasAnyKeyword(
    `${normalizeText(input.rawRequest)} ${normalizeText(normalization.normalized_input)}`.toLowerCase(),
    ["whole game", "across the whole game", "entire repo", "global", "everywhere", "all movement"],
  );

  const reviewRequiredByRisk = contextAlignment.conflict
    || refinement.risk_level === "high"
    || (refinement.risk_level === "medium" && (broadImpactRequested || Boolean(loopResult.planner_ready_request)))
    || loopResult.status === "needs_review"
    || confidence.ambiguity_flags.includes("broad-scope")
    || confidence.ambiguity_flags.includes("conflicting-signals");

  const blockers: ConversationalReadinessBlocker[] = [];

  if (!normalization.normalized_input) {
    blockers.push({
      code: "missing-normalized-input",
      severity: "clarification",
      message: "The request could not be normalized into a usable conversational intent.",
      recommended_next_action: "ask-follow-up",
    });
  }

  if (refinement.risk_level === "blocked" || confidence.ambiguity_flags.includes("risky-autonomy")) {
    blockers.push({
      code: confidence.ambiguity_flags.includes("risky-autonomy") ? "unbounded-autonomy" : "unsafe-request",
      severity: "blocked",
      message: "The request is unsafe or asks for uncontrolled autonomy, so it cannot proceed to planning.",
      recommended_next_action: "block",
    });
  }

  if (contextAlignment.conflict) {
    blockers.push({
      code: "session-context-conflict",
      severity: "review",
      message: "The request references prior context but appears to conflict with the most recent session target.",
      recommended_next_action: "needs-review",
    });
  }

  if (confidence.critical_missing_fields.length > 0) {
    blockers.push({
      code: "critical-missing-information",
      severity: reviewRequiredByRisk ? "review" : "clarification",
      message: `Critical missing information remains: ${confidence.critical_missing_fields.join(", ")}.`,
      recommended_next_action: reviewRequiredByRisk ? "needs-review" : "ask-follow-up",
    });
  }

  if (confidence.ambiguity_score >= 0.55 && refinement.risk_level !== "blocked") {
    blockers.push({
      code: "critical-ambiguity",
      severity: reviewRequiredByRisk ? "review" : "clarification",
      message: `Ambiguity ${confidence.ambiguity_score} is still too high for safe planning.`,
      recommended_next_action: reviewRequiredByRisk ? "needs-review" : "ask-follow-up",
    });
  }

  if (confidence.confidence_score < 0.8 && refinement.risk_level !== "blocked") {
    blockers.push({
      code: "confidence-below-threshold",
      severity: reviewRequiredByRisk ? "review" : "clarification",
      message: `Confidence ${confidence.confidence_score} is below the planning threshold.`,
      recommended_next_action: reviewRequiredByRisk ? "needs-review" : "ask-follow-up",
    });
  }

  if (!loopResult.planner_ready_request && refinement.risk_level !== "blocked") {
    blockers.push({
      code: "missing-planner-request",
      severity: reviewRequiredByRisk ? "review" : "clarification",
      message: "A planner-ready request is not available yet.",
      recommended_next_action: reviewRequiredByRisk ? "needs-review" : "ask-follow-up",
    });
  }

  if (!tone.response_mode) {
    blockers.push({
      code: "missing-tone-guidance",
      severity: "clarification",
      message: "Tone guidance was not produced for the conversational result.",
      recommended_next_action: "ask-follow-up",
    });
  }

  let status: ConversationalReadinessStatus = "needs_clarification";
  if (blockers.some((blocker) => blocker.severity === "blocked")) {
    status = "blocked";
  } else if (reviewRequiredByRisk) {
    status = "needs_review";
  } else if (
    normalization.normalized_input
    && confidence.confidence_score >= 0.75
    && confidence.ambiguity_score < 0.55
    && refinement.risk_level !== "high"
    && refinement.risk_level !== "blocked"
    && confidence.critical_missing_fields.length === 0
    && loopResult.planner_ready_request
    && Boolean(tone.response_mode)
    && contextAlignment.considered
  ) {
    status = "ready_for_planning";
  }

  const assumptions = unique([
    ...contextAlignment.assumptions,
    ...confidence.non_critical_missing_fields.map((item) => `Non-critical detail remains: ${item}`),
    ...(status === "ready_for_planning" && confidence.non_critical_missing_fields.length > 0
      ? ["Proceed with bounded assumptions for non-critical missing details."]
      : []),
  ]);

  const nextAction = status === "ready_for_planning"
    ? "create-plan"
    : status === "blocked"
      ? "block"
      : status === "needs_review"
        ? "needs-review"
        : "ask-follow-up";

  const explanation = status === "ready_for_planning"
    ? `Request is ready for planning because normalized input, confidence (${confidence.confidence_score}), planner-ready request, tone guidance, and session context consideration all meet the readiness threshold.`
    : status === "blocked"
      ? `Request is blocked because safety or uncontrolled-autonomy conditions prevent a bounded planning handoff.`
      : status === "needs_review"
        ? `Request needs review because risk, context conflict, or broader repo impact prevents an automatic planning-ready decision.`
        : `Request still needs clarification because confidence (${confidence.confidence_score}) or ambiguity (${confidence.ambiguity_score}) is not strong enough for safe planning.`;

  const plannerReadinessPacket: PlannerReadinessPacket = {
    readiness_id: readinessId,
    created_at: createdAt,
    original_request: normalizeText(input.rawRequest),
    normalized_input: normalization.normalized_input,
    interpreted_intent: refinement.interpreted_intent,
    planner_ready_request: loopResult.planner_ready_request,
    confidence_score: confidence.confidence_score,
    ambiguity_score: confidence.ambiguity_score,
    completeness_score: confidence.completeness_score,
    tone_guidance: tone,
    session_context_summary: contextAlignment.summary,
    missing_information: [...refinement.missing_information],
    assumptions,
    risk_level: refinement.risk_level,
    next_action: nextAction,
    explanation,
  };

  return {
    readiness_id: readinessId,
    created_at: createdAt,
    status,
    original_request: normalizeText(input.rawRequest),
    normalized_input: normalization.normalized_input,
    interpreted_intent: refinement.interpreted_intent,
    planner_ready_request: loopResult.planner_ready_request,
    confidence_score: confidence.confidence_score,
    ambiguity_score: confidence.ambiguity_score,
    completeness_score: confidence.completeness_score,
    risk_level: refinement.risk_level,
    next_action: nextAction,
    explanation,
    missing_information: [...refinement.missing_information],
    assumptions,
    blockers,
    signals,
    tone_guidance: tone,
    session_context_summary: contextAlignment.summary,
    session_context_considered: contextAlignment.considered,
    session_context_conflict: contextAlignment.conflict,
    normalization_result: normalization,
    refinement_result: refinement,
    confidence_result: confidence,
    loop_session: loopResult.session,
    planner_readiness_packet: plannerReadinessPacket,
  };
}

export function buildPlannerReadinessPacket(input: ConversationalReadinessInput): PlannerReadinessPacket {
  return evaluateConversationalReadiness(input).planner_readiness_packet;
}

export function summarizeConversationalReadiness(result: ConversationalReadinessResult): string {
  return [
    `Readiness: ${result.status}`,
    `Original request: ${result.original_request}`,
    `Normalized input: ${result.normalized_input}`,
    `Interpreted intent: ${result.interpreted_intent}`,
    `Confidence: ${result.confidence_score}`,
    `Ambiguity: ${result.ambiguity_score}`,
    `Completeness: ${result.completeness_score}`,
    `Risk level: ${result.risk_level}`,
    `Next action: ${result.next_action}`,
    `Tone mode: ${result.tone_guidance.response_mode}`,
    `Session context considered: ${result.session_context_considered}`,
    `Blockers: ${result.blockers.map((blocker) => blocker.message).join(" | ") || "none"}`,
    `Explanation: ${result.explanation}`,
  ].join("\n");
}