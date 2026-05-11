export type ProjectStateFactKind =
  | "source_file"
  | "test_file"
  | "documentation"
  | "unity_scene"
  | "unity_script"
  | "configuration"
  | "generated_artifact"
  | "unknown";

export type ProjectStateFact = {
  path: string;
  kind: ProjectStateFactKind;
  verified: boolean;
  summary: string;
};

export type ProjectStateInspectionInput = {
  projectRootLabel: string;
  requestedScope: string;
  facts: ProjectStateFact[];
  maxFacts?: number;
};

export type ProjectStateInspectionResult = {
  layerId: "PROJECT_STATE_INSPECTION_PHASE1";
  projectRootLabel: string;
  requestedScope: string;
  boundedFactLimit: number;
  inspectedFacts: ProjectStateFact[];
  omittedFactCount: number;
  verifiedFacts: ProjectStateFact[];
  unverifiedFacts: ProjectStateFact[];
  planningSignals: string[];
  executionTriggered: false;
  mutationPerformed: false;
  truthfulnessWarnings: string[];
};

const defaultBoundedFactLimit = 12;

function normalizeFact(fact: ProjectStateFact): ProjectStateFact {
  return {
    path: fact.path.trim(),
    kind: fact.kind,
    verified: fact.verified,
    summary: fact.summary.trim(),
  };
}

function planningSignalFor(fact: ProjectStateFact): string {
  const verificationLabel = fact.verified ? "verified" : "unverified";
  return `${verificationLabel} ${fact.kind}: ${fact.path} - ${fact.summary}`;
}

export function inspectProjectState(input: ProjectStateInspectionInput): ProjectStateInspectionResult {
  const boundedFactLimit = Math.max(1, Math.min(input.maxFacts ?? defaultBoundedFactLimit, defaultBoundedFactLimit));
  const inspectedFacts = input.facts.slice(0, boundedFactLimit).map(normalizeFact);
  const verifiedFacts = inspectedFacts.filter((fact) => fact.verified);
  const unverifiedFacts = inspectedFacts.filter((fact) => !fact.verified);

  return {
    layerId: "PROJECT_STATE_INSPECTION_PHASE1",
    projectRootLabel: input.projectRootLabel,
    requestedScope: input.requestedScope,
    boundedFactLimit,
    inspectedFacts,
    omittedFactCount: Math.max(0, input.facts.length - inspectedFacts.length),
    verifiedFacts,
    unverifiedFacts,
    planningSignals: inspectedFacts.map(planningSignalFor),
    executionTriggered: false,
    mutationPerformed: false,
    truthfulnessWarnings: [
      "Project inspection reports only supplied or previously inspected facts; it does not execute scans by itself.",
      "Verified and unverified facts must remain separated in downstream planning.",
      "Inspection output may inform plans, but it does not edit files, run Unity, run tests, or claim implementation.",
    ],
  };
}