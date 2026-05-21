// Governed Task Intake — client-side proposal generation (no runtime, no execution)
// All proposals are SEEDED / SIMULATED. executionAllowed is always false.

export type GovernedOperationRuntime = "openclaw" | "claude_code" | "codex" | "human" | "unknown";
export type GovernedOperationCategory =
  | "gameplay_fix"
  | "code_refactor"
  | "ui_update"
  | "test_review"
  | "asset_patch"
  | "regression_review"
  | "general";

export type GovernedOperationProposal = {
  proposalId: string;
  request: string;
  category: GovernedOperationCategory;
  runtime: GovernedOperationRuntime;
  estimatedAffectedFiles: string[];
  commandPolicy: Array<{ rule: string; status: "allowed" | "blocked" }>;
  laneState: "approval_pending";
  executionAllowed: false;
  dryRun: true;
  sandboxRequired: true;
  snapshotRequired: true;
  approvalRequired: true;
  governanceNote: string;
  proposedAt: string;
  source: "SEEDED" | "SIMULATED" | "GOVERNED PREVIEW";
};

export function getRuntimeLabel(runtime: GovernedOperationRuntime): string {
  const labels: Record<GovernedOperationRuntime, string> = {
    openclaw:    "OpenClaw (Game Dev)",
    claude_code: "Claude Code (Review / Refactor)",
    codex:       "Codex (Testing / Implementation)",
    human:       "Human (Manual Review)",
    unknown:     "Unknown (Unassigned)",
  };
  return labels[runtime];
}

export function getCategoryLabel(category: GovernedOperationCategory): string {
  const labels: Record<GovernedOperationCategory, string> = {
    gameplay_fix:      "Gameplay Fix",
    code_refactor:     "Code Refactor",
    ui_update:         "UI Update",
    test_review:       "Test Review",
    asset_patch:       "Asset Patch",
    regression_review: "Regression Review",
    general:           "General",
  };
  return labels[category];
}

// ---- Keyword routing ----

function inferRuntime(text: string): GovernedOperationRuntime {
  const lower = text.toLowerCase();
  if (/\b(enemy|patrol|spawn|collider|navmesh|physics|unity|prefab|animation|game)\b/.test(lower)) return "openclaw";
  if (/\b(test|spec|coverage|assert|jest|mocha|vitest|lint|ci)\b/.test(lower)) return "codex";
  if (/\b(refactor|review|rename|extract|cleanup|component|hook|type|interface|api)\b/.test(lower)) return "claude_code";
  if (/\b(manual|human|review|approve|check)\b/.test(lower)) return "human";
  return "claude_code"; // safe default
}

function inferCategory(text: string): GovernedOperationCategory {
  const lower = text.toLowerCase();
  if (/\b(enemy|patrol|fall|physics|game|navmesh|spawn|collider)\b/.test(lower)) return "gameplay_fix";
  if (/\b(refactor|rename|extract|cleanup|restructure|reorganize)\b/.test(lower)) return "code_refactor";
  if (/\b(ui|button|style|layout|component|modal|dashboard|page)\b/.test(lower)) return "ui_update";
  if (/\b(test|spec|coverage|assert|jest|vitest|lint)\b/.test(lower)) return "test_review";
  if (/\b(asset|sprite|texture|prefab|scene|unity)\b/.test(lower)) return "asset_patch";
  if (/\b(regression|broke|broken|revert|rollback|regression)\b/.test(lower)) return "regression_review";
  return "general";
}

function estimateAffectedFiles(text: string, category: GovernedOperationCategory): string[] {
  const lower = text.toLowerCase();
  const files: string[] = [];

  if (category === "gameplay_fix" || /\benemy\b/.test(lower))    files.push("Assets/Scripts/BasicEnemy.cs");
  if (/\bfall\b/.test(lower))                                     files.push("Assets/Scripts/FallRecovery.cs");
  if (/\bplayer\b/.test(lower))                                   files.push("Assets/Scripts/SimpleKeyboardPlayerMover.cs");
  if (/\bcamera\b/.test(lower))                                   files.push("Assets/Scripts/CameraFollow.cs");
  if (/\bscene\b/.test(lower))                                    files.push("Assets/Scenes/EnemyAIDemo.unity");
  if (/\boperator\b/.test(lower))                                 files.push("web/app/operator/OperatorDashboardClient.tsx");
  if (/\bpreview\b/.test(lower))                                  files.push("web/app/operator/preview/GovernedExecutionPreviewClient.tsx");
  if (/\bdashboard\b/.test(lower))                                files.push("web/frontend/ui/governed-operations-dashboard/GovernedOperationsDashboard.tsx");
  if (category === "code_refactor")                               files.push("web/lib/aie/governedOperationLane.ts");
  if (category === "test_review" || /\btest\b/.test(lower))      files.push("web/frontend/ui/governed-operations-dashboard/governedOperationsDashboardModel.test.ts");

  if (files.length === 0) files.push("(files to be determined after governance validation)");
  return files;
}

const BASE_COMMAND_POLICY: Array<{ rule: string; status: "allowed" | "blocked" }> = [
  { rule: "Shell execution",            status: "blocked" },
  { rule: "Network requests",           status: "blocked" },
  { rule: "File write outside sandbox", status: "blocked" },
  { rule: "Git commits",                status: "blocked" },
  { rule: "Recursive agent invocation", status: "blocked" },
  { rule: "File read in sandbox",       status: "allowed" },
  { rule: "Patch preview generation",   status: "allowed" },
  { rule: "Lint validation (read-only)",status: "allowed" },
];

let _proposalCounter = 0;

export function generateGovernedOperationProposal(
  request: string,
  options?: { now?: () => string },
): GovernedOperationProposal {
  const proposedAt = options?.now?.() ?? new Date().toISOString();
  const category = inferCategory(request);
  const runtime = inferRuntime(request);
  const estimatedAffectedFiles = estimateAffectedFiles(request, category);
  _proposalCounter += 1;
  const proposalId = `proposal-sim-${String(_proposalCounter).padStart(3, "0")}`;

  return {
    proposalId,
    request,
    category,
    runtime,
    estimatedAffectedFiles,
    commandPolicy: BASE_COMMAND_POLICY,
    laneState: "approval_pending",
    executionAllowed: false,
    dryRun: true,
    sandboxRequired: true,
    snapshotRequired: true,
    approvalRequired: true,
    proposedAt,
    source: "SIMULATED",
    governanceNote:
      "GOVERNED PREVIEW — SIMULATED — This proposal was generated client-side via keyword matching. " +
      "No runtime has been invoked. No execution has occurred or will occur without explicit operator approval. " +
      "All proposals remain in dry-run governance state. Human operator approval is required before any execution.",
  };
}
