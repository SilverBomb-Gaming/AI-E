import type { OperatorRequest } from "./operatorLightPlanner";
import {
  convertRefinementToPlannerRequest,
  refineConversationalIntent,
  type ConversationalRefinementRequest,
  type ConversationalRefinementResult,
  type UserLevelEstimate,
} from "./conversationalIntentRefinement";

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

function deriveNextAction(refinement: ConversationalRefinementResult, status: ConversationalLoopStatus): ConversationalLoopNextAction {
  if (status === "planner_ready") {
    return "create-plan";
  }

  if (status === "blocked") {
    return "block";
  }

  if (status === "needs_review") {
    return "needs-review";
  }

  return refinement.follow_up_questions.length > 0 ? "ask-follow-up" : "await-answer";
}

function createPlannerReadyRequest(
  session: ConversationalLoopSession,
  refinement: ConversationalRefinementResult,
): OperatorRequest | null {
  return convertRefinementToPlannerRequest(refinement, {
    ...session.source_request,
    rawRequest: buildComposedRequest(session),
  });
}

function appendEvaluationTranscript(
  transcript: ConversationalLoopTurn[],
  refinement: ConversationalRefinementResult,
  status: ConversationalLoopStatus,
  nextAction: ConversationalLoopNextAction,
  createdAt: string,
): ConversationalLoopTurn[] {
  const nextTranscript = [...transcript];
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
  const composedRequest = buildComposedRequest(session);
  const refinement = refineConversationalIntent({
    ...session.source_request,
    rawRequest: composedRequest,
  });
  const status = deriveStatus(refinement);
  const nextAction = deriveNextAction(refinement, status);
  const questions = createLoopQuestions(refinement.follow_up_questions, timestamp, session.questions).map((question) => ({
    ...question,
    answered: session.answers.some((answer) => answer.question_id === question.question_id),
  }));

  const nextSession: ConversationalLoopSession = {
    ...session,
    updated_at: timestamp,
    current_interpretation: refinement.interpreted_intent,
    user_level_estimate: refinement.user_level_estimate,
    clarity_score: refinement.clarity_score,
    confidence_score: refinement.confidence_score,
    missing_information: [...refinement.missing_information],
    questions,
    planner_ready_request: status === "planner_ready" ? createPlannerReadyRequest(session, refinement) : null,
    status,
    next_action: nextAction,
    blockers: buildBlockers(refinement),
    latest_refinement: refinement,
    transcript: appendEvaluationTranscript(session.transcript, refinement, status, nextAction, timestamp),
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
  const baseRefinement = input.existingRefinement ?? refineConversationalIntent(input);
  const status = deriveStatus(baseRefinement);
  const nextAction = deriveNextAction(baseRefinement, status);
  const questions = createLoopQuestions(baseRefinement.follow_up_questions, createdAt);
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
    confidence_score: baseRefinement.confidence_score,
    missing_information: [...baseRefinement.missing_information],
    questions,
    answers: [],
    transcript,
    planner_ready_request: status === "planner_ready"
      ? convertRefinementToPlannerRequest(baseRefinement, input)
      : null,
    status,
    next_action: nextAction,
    blockers: buildBlockers(baseRefinement),
    source_request: {
      rawRequest: normalizeText(input.rawRequest),
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
    answeredLines.length > 0 ? `Answers: ${answeredLines.join(" | ")}` : "Answers: none.",
    unansweredQuestions.length > 0 ? `Open questions: ${unansweredQuestions.join(" | ")}` : "Open questions: none.",
    session.planner_ready_request ? `Planner-ready request: ${session.planner_ready_request.rawRequest}` : "Planner-ready request: none.",
    session.blockers.length > 0 ? `Blockers: ${session.blockers.map((blocker) => blocker.message).join(" | ")}` : "Blockers: none.",
  ].join("\n");
}