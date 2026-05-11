export type DevelopmentOutcomeStatus = "completed" | "failed" | "blocked" | "partially_completed";

export type DevelopmentOutcomeRecord = {
  outcomeId: string;
  layerId: string;
  taskSummary: string;
  status: DevelopmentOutcomeStatus;
  validationSummary: string;
  lessons: string[];
  reviewed: boolean;
  createdAt: string;
};

export type RetrospectiveSummary = {
  layerId: "OUTCOME_LEARNING_AND_RETROSPECTIVE_MEMORY_PHASE1";
  totalOutcomes: number;
  reviewedOutcomeCount: number;
  unreviewedOutcomeCount: number;
  statusCounts: Record<DevelopmentOutcomeStatus, number>;
  advisoryLessons: string[];
  unreviewedOutcomeWarnings: string[];
  behaviorMutationAllowed: false;
  executionTriggered: false;
  truthfulnessWarnings: string[];
};

const emptyStatusCounts: Record<DevelopmentOutcomeStatus, number> = {
  completed: 0,
  failed: 0,
  blocked: 0,
  partially_completed: 0,
};

export function summarizeDevelopmentOutcomes(outcomes: DevelopmentOutcomeRecord[]): RetrospectiveSummary {
  const statusCounts = outcomes.reduce<Record<DevelopmentOutcomeStatus, number>>((counts, outcome) => ({
    ...counts,
    [outcome.status]: counts[outcome.status] + 1,
  }), { ...emptyStatusCounts });
  const reviewedOutcomes = outcomes.filter((outcome) => outcome.reviewed);
  const unreviewedOutcomes = outcomes.filter((outcome) => !outcome.reviewed);
  const advisoryLessons = reviewedOutcomes.flatMap((outcome) => outcome.lessons.map((lesson) => `${outcome.layerId}: ${lesson}`));

  return {
    layerId: "OUTCOME_LEARNING_AND_RETROSPECTIVE_MEMORY_PHASE1",
    totalOutcomes: outcomes.length,
    reviewedOutcomeCount: reviewedOutcomes.length,
    unreviewedOutcomeCount: unreviewedOutcomes.length,
    statusCounts,
    advisoryLessons,
    unreviewedOutcomeWarnings: unreviewedOutcomes.map((outcome) => `${outcome.outcomeId} is unreviewed and must not change planning or execution behavior.`),
    behaviorMutationAllowed: false,
    executionTriggered: false,
    truthfulnessWarnings: [
      "Outcome learning is advisory until reviewed explicitly.",
      "Unreviewed outcomes must not mutate ranking, planning, execution, or approval behavior.",
      "This retrospective layer records and summarizes outcomes only; it does not execute tasks or alter code.",
    ],
  };
}