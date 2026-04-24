type PlannerDomain = "gameplay" | "maintenance" | "planning" | "generic";

export type PlanRiskLevel = "low" | "medium" | "high" | "blocked";

export type ExecutionStep = {
  phase: "planning" | "implementation" | "follow-up";
  title: string;
  details: string;
  status: "ready" | "assumption-based" | "blocked";
};

export type ValidationStep = {
  type: "automated" | "manual-review" | "playtest";
  title: string;
  details: string;
  required: boolean;
};

export type GitCommitPlan = {
  branch: string;
  commit_message: string;
  stage_only: string[];
  github_procedure: string[];
  push_required: boolean;
};

export type OperatorRequest = {
  rawRequest: string;
  projectName?: string;
  repoName?: string;
  repoRoot?: string;
  branchName?: string;
  operatorContext?: string[];
  knownConstraints?: string[];
};

export type OperatorPlan = {
  interpreted_goal: string;
  assumptions: string[];
  missing_information: string[];
  risk_level: PlanRiskLevel;
  repo_targets: string[];
  execution_steps: ExecutionStep[];
  validation_steps: ValidationStep[];
  git_commit_plan: GitCommitPlan;
  playtest_required: boolean;
  next_operator_decision: string;
};

type PlannerSignals = {
  normalizedRequest: string;
  domain: PlannerDomain;
  mentionsEnemy: boolean;
  mentionsGrenade: boolean;
  mentionsGameplay: boolean;
  mentionsMaintenance: boolean;
  mentionsPlanner: boolean;
  mentionsTests: boolean;
  mentionsDocs: boolean;
  mentionsBug: boolean;
  mentionsAutonomous: boolean;
  mentionsDestructiveAction: boolean;
  mentionsBroadScope: boolean;
  containsVagueLanguage: boolean;
  requestTooShort: boolean;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAnyKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "operator-light-plan";
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function inferSignals(request: OperatorRequest): PlannerSignals {
  const normalizedRequest = normalizeText(request.rawRequest).toLowerCase();
  const combinedContext = [
    normalizedRequest,
    ...(request.operatorContext ?? []).map((item) => normalizeText(item).toLowerCase()),
    ...(request.knownConstraints ?? []).map((item) => normalizeText(item).toLowerCase()),
    normalizeText(request.projectName).toLowerCase(),
    normalizeText(request.repoName).toLowerCase(),
  ].join(" ");

  const mentionsEnemy = hasAnyKeyword(combinedContext, ["enemy", "enemies", "ai bot", "npc"]);
  const mentionsGrenade = hasAnyKeyword(combinedContext, ["grenade", "explosion", "blast", "explosive"]);
  const mentionsGameplay = hasAnyKeyword(combinedContext, [
    "gameplay",
    "enemy",
    "grenade",
    "combat",
    "weapon",
    "jump",
    "movement",
    "checkpoint",
    "platformer",
    "scene",
    "playtest",
    "controller",
    "level",
  ]);
  const mentionsMaintenance = hasAnyKeyword(combinedContext, [
    "readme",
    "docs",
    "documentation",
    "test",
    "lint",
    "cleanup",
    "dependency",
    "upgrade",
    "maintenance",
    "parser",
    "queue",
  ]);
  const mentionsPlanner = hasAnyKeyword(combinedContext, [
    "planner",
    "planning layer",
    "execution packet",
    "handoff",
    "operator-light",
    "intent",
    "workflow",
    "orchestration",
  ]);
  const mentionsTests = hasAnyKeyword(combinedContext, ["test", "tests", "pytest", "unit test", "playmode"]);
  const mentionsDocs = hasAnyKeyword(combinedContext, ["readme", "docs", "documentation"]);
  const mentionsBug = hasAnyKeyword(combinedContext, ["bug", "broken", "fix", "issue", "regression", "error"]);
  const mentionsAutonomous = hasAnyKeyword(combinedContext, ["autonomous", "automatically", "without review", "self-run", "auto-apply"]);
  const mentionsDestructiveAction = hasAnyKeyword(combinedContext, ["delete", "remove", "rewrite", "migrate", "force push", "replace entire", "wipe"]);
  const mentionsBroadScope = hasAnyKeyword(combinedContext, ["repo-wide", "entire repo", "whole repo", "everywhere", "all files", "entire codebase"]);
  const containsVagueLanguage = hasAnyKeyword(normalizedRequest, ["better", "smarter", "improve", "enhance", "clean up", "optimize", "fix it", "stuff"]);
  const requestTooShort = normalizedRequest.split(" ").filter(Boolean).length <= 3;

  const domain: PlannerDomain = mentionsGameplay
    ? "gameplay"
    : mentionsPlanner
      ? "planning"
      : mentionsMaintenance
        ? "maintenance"
        : "generic";

  return {
    normalizedRequest,
    domain,
    mentionsEnemy,
    mentionsGrenade,
    mentionsGameplay,
    mentionsMaintenance,
    mentionsPlanner,
    mentionsTests,
    mentionsDocs,
    mentionsBug,
    mentionsAutonomous,
    mentionsDestructiveAction,
    mentionsBroadScope,
    containsVagueLanguage,
    requestTooShort,
  };
}

function buildInterpretedGoal(request: OperatorRequest, signals: PlannerSignals): string {
  if (signals.domain === "gameplay" && signals.mentionsEnemy && signals.mentionsGrenade) {
    return "Plan a bounded gameplay improvement pass for enemy behavior and grenade interactions without directly mutating code from the rough request.";
  }

  if (signals.domain === "gameplay") {
    return "Plan a bounded gameplay implementation slice for the requested behavior change, anchored to concrete scripts, scenes, and validation steps before coding.";
  }

  if (signals.domain === "maintenance") {
    return "Plan a focused repo maintenance pass with scoped documentation, test, and implementation targets before any edits are executed.";
  }

  if (signals.domain === "planning") {
    return "Plan a planning-layer expansion that converts rough operator intent into a deterministic downstream execution packet.";
  }

  if (signals.mentionsBug) {
    return "Plan a bounded bug-fix investigation that identifies the failing surface, affected files, and validation path before implementation.";
  }

  return `Plan a staged execution packet for: ${normalizeText(request.rawRequest)}.`;
}

function buildAssumptions(request: OperatorRequest, signals: PlannerSignals): string[] {
  const assumptions: string[] = [];

  if (request.projectName) {
    assumptions.push(`Assume the target project is ${request.projectName}.`);
  } else if (signals.domain === "gameplay") {
    assumptions.push("Assume the request targets the active gameplay repo or scene rather than the AI-E planning layer itself.");
  } else {
    assumptions.push("Assume the active repo is AI-E and changes should stay inside the current planning/tooling surface.");
  }

  if (request.repoName) {
    assumptions.push(`Assume the primary repo target is ${request.repoName}.`);
  }

  if (signals.mentionsDocs || signals.mentionsTests || signals.domain === "maintenance") {
    assumptions.push("Assume existing documentation and tests define the current contract and must be updated together when behavior changes.");
  }

  assumptions.push("Do not execute code changes directly from this rough request; inspect first and turn approved scope into a staged handoff.");

  if (signals.domain === "gameplay") {
    assumptions.push("Treat gameplay-affecting work as playtest-sensitive even when automated checks pass.");
  }

  return unique(assumptions);
}

function buildMissingInformation(request: OperatorRequest, signals: PlannerSignals): string[] {
  const missing: string[] = [];

  if (!signals.normalizedRequest) {
    missing.push("The operator request is empty.");
  }

  if (signals.requestTooShort && signals.mentionsBug) {
    missing.push("The failing behavior, error output, or file anchor is not provided.");
  }

  if (/^fix (the )?bug[.!]?$/i.test(signals.normalizedRequest)) {
    missing.push("The exact bug, repro steps, and impacted subsystem are not specified.");
  }

  if (signals.domain === "gameplay" && signals.containsVagueLanguage) {
    if (signals.mentionsEnemy) {
      missing.push("The exact enemy behavior change is not specified.");
    }
    if (signals.mentionsGrenade) {
      missing.push("The exact grenade behavior, damage model, or reaction scope is not specified.");
    }
    if (!request.projectName && !request.repoName) {
      missing.push("The target gameplay repo, scene, or feature slice is not named.");
    }
  }

  if ((signals.mentionsAutonomous || signals.mentionsDestructiveAction || signals.mentionsBroadScope)) {
    missing.push("Explicit human approval boundaries for destructive, repo-wide, or autonomous changes are required.");
    missing.push("The allowed file or subsystem scope is not narrow enough for safe execution.");
  }

  if (signals.domain === "generic" && signals.requestTooShort) {
    missing.push("The request needs a clearer target subsystem, file surface, or outcome definition.");
  }

  return unique(missing);
}

function determineRiskLevel(signals: PlannerSignals, missingInformation: string[]): PlanRiskLevel {
  if (!signals.normalizedRequest || missingInformation.some((item) => /empty|exact bug|clearer target subsystem/i.test(item))) {
    return "blocked";
  }

  if (signals.mentionsAutonomous || signals.mentionsDestructiveAction || signals.mentionsBroadScope) {
    return "blocked";
  }

  if (signals.domain === "gameplay" && missingInformation.length > 0) {
    return "medium";
  }

  if (signals.domain === "gameplay") {
    return "medium";
  }

  if (signals.domain === "maintenance" || signals.domain === "planning") {
    return signals.containsVagueLanguage ? "medium" : "low";
  }

  return missingInformation.length > 0 ? "high" : "medium";
}

function buildRepoTargets(request: OperatorRequest, signals: PlannerSignals): string[] {
  const targets: string[] = [];

  if (signals.domain === "planning") {
    targets.push("web/lib/aie planning modules");
    targets.push("web/lib/aie planner unit tests");
    targets.push("README.md");
  }

  if (signals.mentionsEnemy) {
    targets.push("enemy AI scripts");
  }

  if (signals.mentionsGrenade) {
    targets.push("grenade gameplay scripts");
  }

  if (signals.domain === "gameplay") {
    targets.push("gameplay scenes or test levels");
    targets.push("playmode or gameplay validation tests");
  }

  if (signals.mentionsDocs) {
    targets.push("README.md");
  }

  if (signals.mentionsTests) {
    targets.push("matching unit or integration tests");
  }

  if (signals.mentionsMaintenance && !signals.mentionsTests) {
    targets.push("affected utility or maintenance modules");
  }

  if (signals.mentionsBug && targets.length === 0) {
    targets.push("failing subsystem once identified from logs or repro steps");
  }

  if (request.repoRoot) {
    targets.push(`repo root: ${request.repoRoot}`);
  }

  return unique(targets.length ? targets : ["active repo surface to be clarified during planning"]);
}

function buildExecutionSteps(
  interpretedGoal: string,
  repoTargets: string[],
  riskLevel: PlanRiskLevel,
  missingInformation: string[],
): ExecutionStep[] {
  const implementationStatus: ExecutionStep["status"] = riskLevel === "blocked"
    ? "blocked"
    : missingInformation.length > 0
      ? "assumption-based"
      : "ready";

  return [
    {
      phase: "planning",
      title: "Inspect the current surface and anchor the request",
      details: `Translate the rough request into concrete subsystems, files, and constraints across: ${repoTargets.join(", ")}. Goal: ${interpretedGoal}`,
      status: "ready",
    },
    {
      phase: "implementation",
      title: "Prepare a bounded implementation packet",
      details: riskLevel === "blocked"
        ? `Do not implement yet. First resolve: ${missingInformation.join(" ")}`
        : missingInformation.length > 0
          ? `Proceed only with safe assumptions while keeping implementation narrow, reviewable, and explicitly tied to the clarified targets. Open questions: ${missingInformation.join(" ")}`
          : "Convert the approved scope into file-level tasks for downstream Codex/Copilot execution without widening beyond the anchored slice.",
      status: implementationStatus,
    },
    {
      phase: "follow-up",
      title: "Return operator-ready handoff and decision point",
      details: "Summarize assumptions, blockers, validation expectations, and the exact approval needed before any autonomous execution integration.",
      status: riskLevel === "blocked" ? "blocked" : "ready",
    },
  ];
}

function buildValidationSteps(
  signals: PlannerSignals,
  riskLevel: PlanRiskLevel,
  missingInformation: string[],
  playtestRequired: boolean,
): ValidationStep[] {
  const steps: ValidationStep[] = [
    {
      type: "manual-review",
      title: "Review the generated packet before implementation",
      details: "Verify the plan is structured, scoped, blocker-aware, and still planning-first rather than over-eager execution.",
      required: true,
    },
    {
      type: "automated",
      title: "Run targeted existing tests and any new unit coverage",
      details: signals.domain === "planning"
        ? "Run the focused planner unit tests plus the existing targeted lib/aie test suite if available."
        : "Run the narrowest existing automated checks tied to the planned implementation slice, then add/update tests for the new behavior.",
      required: true,
    },
  ];

  if (playtestRequired) {
    steps.push({
      type: "playtest",
      title: "Run human playtesting for gameplay-affecting behavior",
      details: "Confirm the requested behavior in the target scene or gameplay loop, and treat remote-input limitations separately from binding or logic failures.",
      required: true,
    });
  }

  if (riskLevel === "blocked" || missingInformation.length > 0) {
    steps.push({
      type: "manual-review",
      title: "Re-run the planner after missing information is clarified",
      details: "Confirm the revised packet resolves blockers without widening scope or bypassing approval boundaries.",
      required: true,
    });
  }

  return steps;
}

function buildBranchName(request: OperatorRequest, interpretedGoal: string): string {
  if (request.branchName) {
    return request.branchName;
  }

  return `feat/operator-light-${slugify(interpretedGoal)}`;
}

function buildStageOnlyTargets(signals: PlannerSignals, repoTargets: string[]): string[] {
  const stageOnly: string[] = [];

  if (signals.domain === "planning") {
    stageOnly.push("planner implementation files");
  }

  if (repoTargets.some((target) => /test/i.test(target))) {
    stageOnly.push("matching tests");
  }

  if (repoTargets.some((target) => /readme|docs/i.test(target))) {
    stageOnly.push("README or documentation updates tied to the change");
  }

  stageOnly.push("only files directly referenced by the approved plan");

  return unique(stageOnly);
}

function buildCommitMessage(signals: PlannerSignals, interpretedGoal: string): string {
  if (signals.domain === "planning") {
    return "feat(planning): add operator-light execution planner";
  }

  if (signals.domain === "maintenance") {
    return `chore(repo): ${slugify(interpretedGoal).replace(/-/g, " ")}`;
  }

  return `feat(planning): stage ${slugify(interpretedGoal).replace(/-/g, " ")}`;
}

function buildGitCommitPlan(
  request: OperatorRequest,
  signals: PlannerSignals,
  interpretedGoal: string,
  repoTargets: string[],
): GitCommitPlan {
  const branch = buildBranchName(request, interpretedGoal);

  return {
    branch,
    commit_message: buildCommitMessage(signals, interpretedGoal),
    stage_only: buildStageOnlyTargets(signals, repoTargets),
    github_procedure: [
      "Check branch and working tree state before touching files.",
      `Create or switch to ${branch}.`,
      "Implement only the approved scope and keep planning, implementation, validation, commit, and follow-up separated.",
      "Run targeted verification before staging files.",
      "Stage only implementation files, matching tests, and documentation tied to this plan.",
      "Commit with the suggested focused message after validation passes.",
      `Push ${branch} to GitHub and open or update the pull request with a summary of assumptions, validation, and remaining operator decisions.`,
    ],
    push_required: true,
  };
}

function determinePlaytestRequired(signals: PlannerSignals): boolean {
  return signals.domain === "gameplay" || hasAnyKeyword(signals.normalizedRequest, ["feel", "balance", "ui", "controller"]);
}

function buildNextOperatorDecision(
  riskLevel: PlanRiskLevel,
  signals: PlannerSignals,
  missingInformation: string[],
  playtestRequired: boolean,
): string {
  if (riskLevel === "blocked") {
    return `Provide the missing scope and approval boundary before implementation: ${missingInformation[0] ?? "clarify the blocked request."}`;
  }

  if (playtestRequired) {
    return "Approve the narrow implementation slice and identify the required playtest owner, scene, or validation session before execution starts.";
  }

  if (missingInformation.length > 0) {
    return `Approve the inspection-first assumptions or answer the remaining open question first: ${missingInformation[0]}`;
  }

  if (signals.domain === "planning") {
    return "Approve the planning-layer scope so implementation can proceed without wiring it into autonomous execution yet.";
  }

  return "Approve the bounded implementation packet and keep downstream execution limited to the scoped files and validation plan.";
}

export function createOperatorLightPlan(request: OperatorRequest): OperatorPlan {
  const signals = inferSignals(request);
  const interpretedGoal = buildInterpretedGoal(request, signals);
  const assumptions = buildAssumptions(request, signals);
  const missingInformation = buildMissingInformation(request, signals);
  const riskLevel = determineRiskLevel(signals, missingInformation);
  const repoTargets = buildRepoTargets(request, signals);
  const playtestRequired = determinePlaytestRequired(signals);

  return {
    interpreted_goal: interpretedGoal,
    assumptions,
    missing_information: missingInformation,
    risk_level: riskLevel,
    repo_targets: repoTargets,
    execution_steps: buildExecutionSteps(interpretedGoal, repoTargets, riskLevel, missingInformation),
    validation_steps: buildValidationSteps(signals, riskLevel, missingInformation, playtestRequired),
    git_commit_plan: buildGitCommitPlan(request, signals, interpretedGoal, repoTargets),
    playtest_required: playtestRequired,
    next_operator_decision: buildNextOperatorDecision(riskLevel, signals, missingInformation, playtestRequired),
  };
}