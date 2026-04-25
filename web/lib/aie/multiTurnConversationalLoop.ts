import type { OperatorRequest } from "./operatorLightPlanner";
import {
  computeConfidenceScore,
  determineNextAction as determineAdaptiveNextAction,
  type AdaptiveStopReason,
  type QuestionNecessity,
  type QuestionPriority,
} from "./adaptiveConversationalLogic";
import {
  convertRefinementToPlannerRequest,
  refineConversationalIntent,
  type ConversationalRefinementRequest,
  type ConversationalRefinementResult,
  type UserLevelEstimate,
} from "./conversationalIntentRefinement";
import { normalizeUserInput } from "./intentNormalization";

export type ConversationalLoopStatus =
  | "awaiting_clarification"
  | "planner_ready"
  | "blocked"
  | "needs_review";

export type ConversationalLoopNextAction =
  | "ask-follow-up"
  | "await-answer"
  | "create-plan"
  | "block"
  | "needs-review";

export type ConversationalLoopQuestion = {
  question_id: string;
  prompt: string;
  asked_at: string;
  answered: boolean;
};

export type ConversationalLoopAnswer = {
  question_id: string;
  answer: string;
  answered_at: string;
};

export type ConversationalLoopTurn = {
  turn_id: string;
  speaker: "user" | "ai-e" | "system";
  kind: "request" | "question" | "answer" | "interpretation" | "status";
  content: string;
  created_at: string;
};

export type ConversationalLoopBlocker = {
  code:
    | "risky_autonomy"
    | "broad_scope"
    | "missing_information"
    | "needs_review"
    | "invalid_answer";
  message: string;
  recommended_next_action: ConversationalLoopNextAction;
};

export type ConversationalLoopSession = {
  session_id: string;
  created_at: string;
  updated_at: string;
  original_request: string;
  current_interpretation: string;
  user_level_estimate: UserLevelEstimate;
  clarity_score: number;
  confidence_score: number;
  ambiguity_score: number;
  completeness_score: number;
  question_necessity: QuestionNecessity;
  question_priority: QuestionPriority;
  stop_reason: AdaptiveStopReason;
  decision_reason: string;
  missing_information: string[];
  questions: ConversationalLoopQuestion[];
  answers: ConversationalLoopAnswer[];
  transcript: ConversationalLoopTurn[];
  planner_ready_request: OperatorRequest | null;
  status: ConversationalLoopStatus;
  next_action: ConversationalLoopNextAction;
  blockers: ConversationalLoopBlocker[];
  source_request: ConversationalRefinementRequest;
  latest_refinement: ConversationalRefinementResult;
};

export type ConversationalLoopInput = ConversationalRefinementRequest & {
  createdAt?: string;
  sessionId?: string;
  existingRefinement?: ConversationalRefinementResult;
};

export type ConversationalLoopResult = {
  session: ConversationalLoopSession;
  planner_ready_request: OperatorRequest | null;
  status: ConversationalLoopStatus;
  next_action: ConversationalLoopNextAction;
};

type QuestionAnswerInput = {
  question_id?: string;
  answer: string;
  answeredAt?: string;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36) || "conversation";
}

function sanitizeTimestamp(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
}

function buildSessionId(request: string, createdAt: string): string {
  return `conversation-loop-${sanitizeTimestamp(createdAt)}-${slugify(request)}`;
}

function buildQuestionId(prompt: string, index: number): string {
  return `loop-question-${index + 1}-${slugify(prompt)}`;
}

function buildTurnId(kind: ConversationalLoopTurn["kind"], createdAt: string, index: number): string {
  return `loop-turn-${kind}-${sanitizeTimestamp(createdAt)}-${index + 1}`;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function toTranscriptTurn(
  speaker: ConversationalLoopTurn["speaker"],
  kind: ConversationalLoopTurn["kind"],
  content: string,
  createdAt: string,
  index: number,
): ConversationalLoopTurn {
  return {
    turn_id: buildTurnId(kind, createdAt, index),
    speaker,
    kind,
    content,
    created_at: createdAt,
  };
}

function rewriteAnswer(questionPrompt: string, answer: string): string {
  const normalizedAnswer = normalizeText(answer);
  const lowerPrompt = questionPrompt.toLowerCase();
  const lowerAnswer = normalizedAnswer.toLowerCase();

  if (!normalizedAnswer) {
    return "";
  }

  if (lowerPrompt.includes("which part should improve first")) {
    return `Focus first on ${lowerAnswer.replace(/ first$/i, "")}.`;
  }

  if (lowerPrompt.includes("what should enemies do better first") && (lowerAnswer.includes("grenade") || lowerAnswer.includes("explosion") || lowerAnswer.includes("blows up"))) {
    return "Enemies should react smarter when grenade blows up.";
  }

  if (lowerPrompt.includes("what should enemies do better first")) {
    return `Enemy improvement focus: ${normalizedAnswer}.`;
  }

  if (lowerPrompt.includes("should we start with combat feel")) {
    return `Start with ${normalizedAnswer}.`;
  }

  return `Clarification: ${normalizedAnswer}.`;
}

function buildComposedRequest(session: ConversationalLoopSession): string {
  const answerFragments = session.answers
    .map((answer) => {
      const question = session.questions.find((item) => item.question_id === answer.question_id);
      return rewriteAnswer(question?.prompt ?? "", answer.answer);
    })
    .filter(Boolean);

  return normalizeText([
    session.original_request,
    ...answerFragments,
  ].join(" "));
}

function buildNormalizedRequest(rawRequest: string): string {
  return normalizeUserInput(rawRequest).normalized_input;
}

function createLoopQuestions(
  prompts: string[],
  createdAt: string,
  existingQuestions: ConversationalLoopQuestion[] = [],
): ConversationalLoopQuestion[] {
  const existingPrompts = new Set(existingQuestions.map((question) => question.prompt));
  const newQuestions = prompts
    .filter((prompt) => !existingPrompts.has(prompt))
    .slice(0, 3)
    .map((prompt, index) => ({
      question_id: buildQuestionId(prompt, existingQuestions.length + index),
      prompt,
      asked_at: createdAt,
      answered: false,
    }));

  return [...existingQuestions, ...newQuestions].slice(0, 3);
}

function buildAdaptiveSnapshot(
  sessionLike: Pick<ConversationalLoopSession, "clarity_score" | "confidence_score" | "missing_information" | "answers" | "questions" | "latest_refinement">,
  refinement: ConversationalRefinementResult,
) {
  return {
    clarity_score: sessionLike.clarity_score,
    confidence_score: sessionLike.confidence_score,
    missing_information: [...refinement.missing_information],
    answers: sessionLike.answers.map((answer) => ({ answer: answer.answer })),
    questions: sessionLike.questions.map((question) => ({ prompt: question.prompt, answered: question.answered })),
    latest_refinement: {
      risk_level: refinement.risk_level,
      follow_up_questions: [...refinement.follow_up_questions],
      planner_ready_request: refinement.planner_ready_request,
      should_create_plan: refinement.should_create_plan,
      ambiguity_flags: [...refinement.ambiguity_flags],
      missing_information: [...refinement.missing_information],
      clarity_score: refinement.clarity_score,
      confidence_score: refinement.confidence_score,
    },
  };
}

function buildBlockers(refinement: ConversationalRefinementResult): ConversationalLoopBlocker[] {
  const blockers: ConversationalLoopBlocker[] = [];

  if (refinement.ambiguity_flags.includes("risky-autonomy")) {
    blockers.push({
      code: "risky_autonomy",
      message: "The request asks for unsafe or overnight autonomous execution without a safe bounded first task.",
      recommended_next_action: "block",
    });
  }

  if (refinement.ambiguity_flags.includes("broad-scope")) {
    blockers.push({
      code: "broad_scope",
      message: "The request is still too broad to turn into one safe planner-ready task.",
      recommended_next_action: "needs-review",
    });
  }

  if (refinement.missing_information.length > 0 && !refinement.should_create_plan) {
    blockers.push({
      code: "missing_information",
      message: refinement.missing_information.join(" "),
      recommended_next_action: refinement.risk_level === "high" ? "needs-review" : "ask-follow-up",
    });
  }

  return blockers;
}

function deriveStatus(refinement: ConversationalRefinementResult): ConversationalLoopStatus {
  if (refinement.risk_level === "high" || refinement.risk_level === "blocked") {
    return refinement.ambiguity_flags.includes("risky-autonomy") ? "blocked" : "needs_review";
  }

  if (refinement.should_create_plan && refinement.planner_ready_request) {
    return "planner_ready";
  }

  return "awaiting_clarification";
}

function createPlannerReadyRequest(
  session: ConversationalLoopSession,
  refinement: ConversationalRefinementResult,
  stopReason: AdaptiveStopReason,
): OperatorRequest | null {
  const converted = convertRefinementToPlannerRequest(refinement, {
    ...session.source_request,
    rawRequest: buildComposedRequest(session),
  });

  if (converted) {
    return converted;
  }

  if (!stopReason || refinement.risk_level === "high" || refinement.risk_level === "blocked") {
    return null;
  }

  return {
    rawRequest: `Create a narrow first-pass plan for: ${refinement.interpreted_intent}. Proceed with explicit assumptions for unresolved details and preserve required validation.`,
    projectName: session.source_request.projectName,
    repoName: session.source_request.repoName,
    repoRoot: session.source_request.repoRoot,
    branchName: session.source_request.branchName,
    operatorContext: unique([
      ...(session.source_request.operatorContext ?? []),
      `Original user request: ${session.original_request}`,
      `Current interpretation: ${refinement.interpreted_intent}`,
      `Proceeding with assumptions because: ${stopReason}`,
    ]),
    knownConstraints: unique([
      ...(session.source_request.knownConstraints ?? []),
      ...refinement.missing_information,
      `Proceed using bounded assumptions after conversational stop condition: ${stopReason}.`,
    ]),
  };
}

function appendEvaluationTranscript(
  transcript: ConversationalLoopTurn[],
  newQuestions: string[],
  refinement: ConversationalRefinementResult,
  status: ConversationalLoopStatus,
  nextAction: ConversationalLoopNextAction,
  createdAt: string,
): ConversationalLoopTurn[] {
  const nextTranscript = [...transcript];
  newQuestions.forEach((question) => {
    nextTranscript.push(
      toTranscriptTurn("ai-e", "question", question, createdAt, nextTranscript.length),
    );
  });
  nextTranscript.push(
    toTranscriptTurn("system", "interpretation", refinement.interpreted_intent, createdAt, nextTranscript.length),
    toTranscriptTurn("system", "status", `Status: ${status}. Next action: ${nextAction}.`, createdAt, nextTranscript.length + 1),
  );
  return nextTranscript;
}

export function evaluateConversationalLoop(
  session: ConversationalLoopSession,
  updatedAt?: string,
): ConversationalLoopResult {
  const timestamp = normalizeText(updatedAt) || new Date().toISOString();
  const composedRequest = buildNormalizedRequest(buildComposedRequest(session));
  const refinement = refineConversationalIntent({
    ...session.source_request,
    rawRequest: composedRequest,
  });
  const adaptiveDecision = determineAdaptiveNextAction(
    buildAdaptiveSnapshot(session, refinement),
    session.clarity_score,
  );

  let status: ConversationalLoopStatus = deriveStatus(refinement);
  let nextAction: ConversationalLoopNextAction = "await-answer";

  if (refinement.risk_level === "high" || refinement.risk_level === "blocked") {
    status = refinement.ambiguity_flags.includes("risky-autonomy") ? "blocked" : "needs_review";
    nextAction = status === "blocked" ? "block" : "needs-review";
  } else if (adaptiveDecision.proceed_to_planning) {
    status = "planner_ready";
    nextAction = "create-plan";
  } else if (adaptiveDecision.should_ask_follow_up && adaptiveDecision.selected_follow_up_question) {
    status = "awaiting_clarification";
    nextAction = "ask-follow-up";
  }

  const selectedQuestion = adaptiveDecision.should_ask_follow_up && adaptiveDecision.selected_follow_up_question
    ? [adaptiveDecision.selected_follow_up_question]
    : [];
  const previousPromptSet = new Set(session.questions.map((question) => question.prompt));
  const questions = createLoopQuestions(selectedQuestion, timestamp, session.questions).map((question) => ({
    ...question,
    answered: session.answers.some((answer) => answer.question_id === question.question_id),
  }));
  const newQuestionPrompts = questions
    .filter((question) => !previousPromptSet.has(question.prompt))
    .map((question) => question.prompt);

  const nextSession: ConversationalLoopSession = {
    ...session,
    updated_at: timestamp,
    current_interpretation: refinement.interpreted_intent,
    user_level_estimate: refinement.user_level_estimate,
    clarity_score: refinement.clarity_score,
    confidence_score: computeConfidenceScore(buildAdaptiveSnapshot(session, refinement)),
    ambiguity_score: adaptiveDecision.ambiguity_score,
    completeness_score: adaptiveDecision.completeness_score,
    question_necessity: adaptiveDecision.question_necessity,
    question_priority: adaptiveDecision.question_priority,
    stop_reason: adaptiveDecision.stop_reason,
    decision_reason: adaptiveDecision.decision_reason,
    missing_information: [...refinement.missing_information],
    questions,
    planner_ready_request: status === "planner_ready" ? createPlannerReadyRequest(session, refinement, adaptiveDecision.stop_reason) : null,
    status,
    next_action: nextAction,
    blockers: buildBlockers(refinement),
    latest_refinement: refinement,
    transcript: appendEvaluationTranscript(session.transcript, newQuestionPrompts, refinement, status, nextAction, timestamp),
  };

  return {
    session: nextSession,
    planner_ready_request: nextSession.planner_ready_request,
    status: nextSession.status,
    next_action: nextSession.next_action,
  };
}

export function startConversationalLoop(
  input: ConversationalLoopInput,
): ConversationalLoopResult {
  const createdAt = normalizeText(input.createdAt) || new Date().toISOString();
  const normalizedStartRequest = buildNormalizedRequest(input.rawRequest);
  const baseRefinement = input.existingRefinement ?? refineConversationalIntent({
    ...input,
    rawRequest: normalizedStartRequest,
  });
  const adaptiveDecision = determineAdaptiveNextAction(buildAdaptiveSnapshot({
    clarity_score: baseRefinement.clarity_score,
    confidence_score: baseRefinement.confidence_score,
    missing_information: [...baseRefinement.missing_information],
    answers: [],
    questions: [],
    latest_refinement: baseRefinement,
  }, baseRefinement));

  let status: ConversationalLoopStatus = deriveStatus(baseRefinement);
  let nextAction: ConversationalLoopNextAction = "await-answer";

  if (baseRefinement.risk_level === "high" || baseRefinement.risk_level === "blocked") {
    status = baseRefinement.ambiguity_flags.includes("risky-autonomy") ? "blocked" : "needs_review";
    nextAction = status === "blocked" ? "block" : "needs-review";
  } else if (adaptiveDecision.proceed_to_planning) {
    status = "planner_ready";
    nextAction = "create-plan";
  } else if (adaptiveDecision.should_ask_follow_up && adaptiveDecision.selected_follow_up_question) {
    status = "awaiting_clarification";
    nextAction = "ask-follow-up";
  }

  const selectedQuestions = adaptiveDecision.should_ask_follow_up && adaptiveDecision.selected_follow_up_question
    ? [adaptiveDecision.selected_follow_up_question]
    : [];
  const questions = createLoopQuestions(selectedQuestions, createdAt);
  const transcript: ConversationalLoopTurn[] = [
    toTranscriptTurn("user", "request", normalizeText(input.rawRequest), createdAt, 0),
    ...questions.map((question, index) => toTranscriptTurn("ai-e", "question", question.prompt, createdAt, index + 1)),
    toTranscriptTurn("system", "interpretation", baseRefinement.interpreted_intent, createdAt, questions.length + 1),
    toTranscriptTurn("system", "status", `Status: ${status}. Next action: ${nextAction}.`, createdAt, questions.length + 2),
  ];

  const session: ConversationalLoopSession = {
    session_id: input.sessionId ?? buildSessionId(input.rawRequest, createdAt),
    created_at: createdAt,
    updated_at: createdAt,
    original_request: normalizeText(input.rawRequest),
    current_interpretation: baseRefinement.interpreted_intent,
    user_level_estimate: baseRefinement.user_level_estimate,
    clarity_score: baseRefinement.clarity_score,
    confidence_score: adaptiveDecision.confidence_score,
    ambiguity_score: adaptiveDecision.ambiguity_score,
    completeness_score: adaptiveDecision.completeness_score,
    question_necessity: adaptiveDecision.question_necessity,
    question_priority: adaptiveDecision.question_priority,
    stop_reason: adaptiveDecision.stop_reason,
    decision_reason: adaptiveDecision.decision_reason,
    missing_information: [...baseRefinement.missing_information],
    questions,
    answers: [],
    transcript,
    planner_ready_request: status === "planner_ready"
      ? (convertRefinementToPlannerRequest(baseRefinement, input) ?? {
        rawRequest: `Create a narrow first-pass plan for: ${baseRefinement.interpreted_intent}. Proceed with explicit assumptions for unresolved details and preserve required validation.`,
        projectName: input.projectName,
        repoName: input.repoName,
        repoRoot: input.repoRoot,
        branchName: input.branchName,
        operatorContext: unique([
          ...(input.operatorContext ?? []),
          `Original user request: ${normalizeText(input.rawRequest)}`,
          `Current interpretation: ${baseRefinement.interpreted_intent}`,
          `Proceeding with assumptions because: ${adaptiveDecision.stop_reason ?? "confidence_sufficient"}`,
        ]),
        knownConstraints: unique([
          ...(input.knownConstraints ?? []),
          ...baseRefinement.missing_information,
          `Proceed using bounded assumptions after conversational stop condition: ${adaptiveDecision.stop_reason ?? "confidence_sufficient"}.`,
        ]),
      })
      : null,
    status,
    next_action: nextAction,
    blockers: buildBlockers(baseRefinement),
    source_request: {
      rawRequest: normalizedStartRequest,
      projectName: input.projectName,
      repoName: input.repoName,
      repoRoot: input.repoRoot,
      branchName: input.branchName,
      operatorContext: input.operatorContext ? unique([...input.operatorContext]) : undefined,
      knownConstraints: input.knownConstraints ? unique([...input.knownConstraints]) : undefined,
    },
    latest_refinement: baseRefinement,
  };

  return {
    session,
    planner_ready_request: session.planner_ready_request,
    status: session.status,
    next_action: session.next_action,
  };
}

export function answerConversationalLoopQuestion(
  session: ConversationalLoopSession,
  input: QuestionAnswerInput,
): ConversationalLoopResult {
  const timestamp = normalizeText(input.answeredAt) || new Date().toISOString();
  const unresolvedQuestion = input.question_id
    ? session.questions.find((question) => question.question_id === input.question_id)
    : session.questions.find((question) => !session.answers.some((answer) => answer.question_id === question.question_id));

  if (!unresolvedQuestion || !normalizeText(input.answer)) {
    const nextSession: ConversationalLoopSession = {
      ...session,
      updated_at: timestamp,
      blockers: [
        ...session.blockers,
        {
          code: "invalid_answer",
          message: "A non-empty clarification answer tied to a valid question is required.",
          recommended_next_action: "await-answer",
        },
      ],
      transcript: [
        ...session.transcript,
        toTranscriptTurn("system", "status", "Status: awaiting_clarification. Next action: await-answer.", timestamp, session.transcript.length),
      ],
      next_action: "await-answer",
      status: "awaiting_clarification",
      ambiguity_score: session.ambiguity_score,
      completeness_score: session.completeness_score,
      question_necessity: session.question_necessity,
      question_priority: session.question_priority,
      stop_reason: session.stop_reason,
      decision_reason: session.decision_reason,
    };

    return {
      session: nextSession,
      planner_ready_request: nextSession.planner_ready_request,
      status: nextSession.status,
      next_action: nextSession.next_action,
    };
  }

  const answer: ConversationalLoopAnswer = {
    question_id: unresolvedQuestion.question_id,
    answer: normalizeText(input.answer),
    answered_at: timestamp,
  };

  const answeredQuestions = session.questions.map((question) => (
    question.question_id === unresolvedQuestion.question_id
      ? { ...question, answered: true }
      : question
  ));

  const nextSession: ConversationalLoopSession = {
    ...session,
    updated_at: timestamp,
    questions: answeredQuestions,
    answers: [...session.answers, answer],
    transcript: [
      ...session.transcript,
      toTranscriptTurn("user", "answer", answer.answer, timestamp, session.transcript.length),
    ],
    blockers: session.blockers.filter((blocker) => blocker.code !== "invalid_answer"),
  };

  return evaluateConversationalLoop(nextSession, timestamp);
}

export function summarizeConversationalLoop(session: ConversationalLoopSession): string {
  const unansweredQuestions = session.questions.filter((question) => !question.answered).map((question) => question.prompt);
  const answeredLines = session.answers.map((answer) => {
    const question = session.questions.find((item) => item.question_id === answer.question_id);
    return `${question?.prompt ?? "Question"} -> ${answer.answer}`;
  });

  return [
    `Conversation session: ${session.session_id}`,
    `Status: ${session.status}`,
    `Next action: ${session.next_action}`,
    `Original request: ${session.original_request}`,
    `Current interpretation: ${session.current_interpretation}`,
    `Clarity: ${session.clarity_score}`,
    `Confidence: ${session.confidence_score}`,
    `Ambiguity: ${session.ambiguity_score}`,
    `Completeness: ${session.completeness_score}`,
    `Question necessity: ${session.question_necessity}`,
    `Question priority: ${session.question_priority}`,
    `Stop reason: ${session.stop_reason ?? "none"}`,
    `Decision reason: ${session.decision_reason}`,
    answeredLines.length > 0 ? `Answers: ${answeredLines.join(" | ")}` : "Answers: none.",
    unansweredQuestions.length > 0 ? `Open questions: ${unansweredQuestions.join(" | ")}` : "Open questions: none.",
    session.planner_ready_request ? `Planner-ready request: ${session.planner_ready_request.rawRequest}` : "Planner-ready request: none.",
    session.blockers.length > 0 ? `Blockers: ${session.blockers.map((blocker) => blocker.message).join(" | ")}` : "Blockers: none.",
  ].join("\n");
}