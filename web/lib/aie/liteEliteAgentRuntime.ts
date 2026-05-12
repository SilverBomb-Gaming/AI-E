import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type LiteEliteAgentRole = "repo-maintainer" | "test-runner" | "unity-task-planner" | "documentation-updater" | "qa-verifier";
export type LiteEliteAgentStatus = "idle" | "planning" | "awaiting_approval" | "running" | "blocked" | "completed" | "failed";
export type LiteEliteAgentScaffoldStatus = "AIE_LITE_ELITE_AGENT_PHASE1_REAL_BOUNDED_EXECUTOR" | "AIE_LITE_ELITE_AGENT_PHASE1_BLOCKED_NO_EXECUTION";
export type LiteEliteTaskRiskLevel = "low" | "medium" | "high";

export type LiteEliteAgent = {
  agentId: string;
  name: string;
  role: LiteEliteAgentRole;
  allowedPaths: string[];
  blockedPaths: string[];
  allowedCommands: string[];
  maxSteps: number;
  status: LiteEliteAgentStatus;
  currentTask?: LiteEliteTaskContract;
  lastPlan?: LiteEliteExecutionPlan;
  lastRunSummary?: LiteEliteRunSummary;
  scaffoldStatus: LiteEliteAgentScaffoldStatus;
};

export type LiteEliteFileChange = {
  path: string;
  content: string;
  mode?: "overwrite";
  description?: string;
};

export type LiteEliteTaskContract = {
  taskId: string;
  title: string;
  userGoal: string;
  repoScope: string;
  allowedPaths: string[];
  forbiddenPaths: string[];
  expectedOutputs: string[];
  verificationCommands: string[];
  riskLevel: LiteEliteTaskRiskLevel;
  requiresHumanApprovalBeforeWrite: boolean;
  approvedForWrite?: boolean;
  filesToInspect?: string[];
  requestedChanges?: LiteEliteFileChange[];
};

export type LiteEliteExecutionPlan = {
  taskId: string;
  steps: string[];
  filesToInspect: string[];
  plannedChanges: LiteEliteFileChange[];
  verificationCommands: string[];
  requiresApprovalBeforeWrite: boolean;
  maxSteps: number;
};

export type LiteEliteInspectedFile = {
  path: string;
  contentHash: string;
  size: number;
  exists: boolean;
};

export type LiteEliteCommandResult = {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  skipped: boolean;
  blockedReason?: string;
};

export type LiteEliteRunLogEntry = {
  stage: "task_received" | "scope_validated" | "files_inspected" | "plan_generated" | "approval_required" | "files_changed" | "verification_run" | "blocked" | "completed";
  message: string;
  at: string;
};

export type LiteEliteRunSummary = {
  taskId: string;
  agentId: string;
  status: LiteEliteAgentStatus;
  scaffoldStatus: LiteEliteAgentScaffoldStatus;
  filesInspected: LiteEliteInspectedFile[];
  planGenerated: LiteEliteExecutionPlan;
  filesChanged: string[];
  commandsRun: LiteEliteCommandResult[];
  failures: string[];
  unresolvedBlockers: string[];
  nextRecommendedTask: string;
  truthfulCapabilityBoundary: string;
  runLog: LiteEliteRunLogEntry[];
};

export type LiteEliteRunResult = {
  agent: LiteEliteAgent;
  summary: LiteEliteRunSummary;
};

type RuntimeFileSystem = {
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<void>;
  mkdir(dirPath: string): Promise<void>;
  stat(filePath: string): Promise<{ size: number }>;
};

type RuntimeCommandRunner = (command: string, cwd: string) => Promise<LiteEliteCommandResult>;

type RunOptions = {
  repoRoot?: string;
  now?: () => string;
  fileSystem?: RuntimeFileSystem;
  commandRunner?: RuntimeCommandRunner;
  onBeforeWrite?: (filePath: string) => Promise<void> | void;
};

const defaultFileSystem: RuntimeFileSystem = {
  async readFile(filePath: string) {
    return fs.readFile(filePath, "utf8");
  },
  async writeFile(filePath: string, content: string) {
    await fs.writeFile(filePath, content, "utf8");
  },
  async mkdir(dirPath: string) {
    await fs.mkdir(dirPath, { recursive: true });
  },
  async stat(filePath: string) {
    const stat = await fs.stat(filePath);
    return { size: stat.size };
  },
};

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function isPathWithin(candidate: string, scope: string): boolean {
  const normalizedCandidate = normalizeRelativePath(candidate);
  const normalizedScope = normalizeRelativePath(scope).replace(/\/$/, "");
  return normalizedCandidate === normalizedScope || normalizedCandidate.startsWith(`${normalizedScope}/`);
}

function isUnsafePath(value: string): boolean {
  const normalized = normalizeRelativePath(value);
  return !normalized || path.isAbsolute(value) || normalized.startsWith("../") || normalized.includes("/../") || normalized.includes("..\\");
}

function assertAllowedPath(relativePath: string, allowedPaths: string[], blockedPaths: string[]): string | undefined {
  if (isUnsafePath(relativePath)) {
    return `Unsafe or non-relative path rejected: ${relativePath}`;
  }
  if (blockedPaths.some((blockedPath) => isPathWithin(relativePath, blockedPath))) {
    return `Path is blocked by agent or task policy: ${relativePath}`;
  }
  if (!allowedPaths.some((allowedPath) => isPathWithin(relativePath, allowedPath))) {
    return `Path is outside allowed scope: ${relativePath}`;
  }
  return undefined;
}

function mergeUnique(values: string[]): string[] {
  return Array.from(new Set(values.map(normalizeRelativePath).filter(Boolean)));
}

function cloneAgent(agent: LiteEliteAgent): LiteEliteAgent {
  return JSON.parse(JSON.stringify(agent)) as LiteEliteAgent;
}

function logEntry(now: () => string, stage: LiteEliteRunLogEntry["stage"], message: string): LiteEliteRunLogEntry {
  return { stage, message, at: now() };
}

function createDefaultPlan(agent: LiteEliteAgent, task: LiteEliteTaskContract): LiteEliteExecutionPlan {
  const plannedChanges = task.requestedChanges ?? [];
  const filesToInspect = mergeUnique([
    ...(task.filesToInspect ?? []),
    ...plannedChanges.map((change) => change.path),
  ]);
  const steps = [
    "Validate task scope against agent and task path policy.",
    "Inspect allowed files only.",
    "Generate a bounded execution plan.",
    task.requiresHumanApprovalBeforeWrite || task.riskLevel !== "low" ? "Require explicit approval before writing." : "Apply controlled edits if requested and inside scope.",
    "Run allowlisted verification commands.",
    "Report changed files, failures, blockers, and next step truthfully.",
  ];

  return {
    taskId: task.taskId,
    steps: steps.slice(0, agent.maxSteps),
    filesToInspect,
    plannedChanges,
    verificationCommands: task.verificationCommands,
    requiresApprovalBeforeWrite: task.requiresHumanApprovalBeforeWrite || task.riskLevel !== "low",
    maxSteps: agent.maxSteps,
  };
}

function defaultCommandRunner(agent: LiteEliteAgent): RuntimeCommandRunner {
  return async (command: string, cwd: string): Promise<LiteEliteCommandResult> => {
    if (!agent.allowedCommands.includes(command)) {
      return {
        command,
        exitCode: 1,
        stdout: "",
        stderr: "",
        skipped: true,
        blockedReason: `Command is not allowlisted for this agent: ${command}`,
      };
    }

    const [executable, ...args] = command.split(" ").filter(Boolean);
    if (!executable) {
      return { command, exitCode: 1, stdout: "", stderr: "", skipped: true, blockedReason: "Empty command rejected." };
    }

    try {
      const result = await execFileAsync(executable, args, { cwd, timeout: 120_000, windowsHide: true });
      return { command, exitCode: 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "", skipped: false };
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string; code?: number; message?: string };
      return {
        command,
        exitCode: typeof failure.code === "number" ? failure.code : 1,
        stdout: failure.stdout ?? "",
        stderr: failure.stderr ?? failure.message ?? "Command failed.",
        skipped: false,
      };
    }
  };
}

function createSummary(params: {
  agent: LiteEliteAgent;
  task: LiteEliteTaskContract;
  status: LiteEliteAgentStatus;
  scaffoldStatus: LiteEliteAgentScaffoldStatus;
  inspected: LiteEliteInspectedFile[];
  plan: LiteEliteExecutionPlan;
  filesChanged: string[];
  commandsRun: LiteEliteCommandResult[];
  failures: string[];
  blockers: string[];
  runLog: LiteEliteRunLogEntry[];
}): LiteEliteRunSummary {
  return {
    taskId: params.task.taskId,
    agentId: params.agent.agentId,
    status: params.status,
    scaffoldStatus: params.scaffoldStatus,
    filesInspected: params.inspected,
    planGenerated: params.plan,
    filesChanged: params.filesChanged,
    commandsRun: params.commandsRun,
    failures: params.failures,
    unresolvedBlockers: params.blockers,
    nextRecommendedTask: params.blockers.length > 0
      ? "Resolve the blocker or narrow the task scope before another bounded run."
      : "Review the run report, then decide whether to approve a follow-up bounded task.",
    truthfulCapabilityBoundary: "AI-E-lite Phase 1 is a bounded local executor with operator-scoped paths, approval gates, and verification reporting. It does not provide unrestricted repo control or unattended operation.",
    runLog: params.runLog,
  };
}

export function createLiteEliteAgent(input?: Partial<LiteEliteAgent>): LiteEliteAgent {
  return {
    agentId: input?.agentId ?? "lite-elite-repo-maintainer-01",
    name: input?.name ?? "AI-E Lite Elite Repo Maintainer",
    role: input?.role ?? "repo-maintainer",
    allowedPaths: input?.allowedPaths ?? ["runner_artifacts/lite_elite_agent"],
    blockedPaths: input?.blockedPaths ?? [".git", "node_modules", "web/node_modules", ".env", "web/.env", "package-lock.json"],
    allowedCommands: input?.allowedCommands ?? ["git diff --name-only"],
    maxSteps: Math.max(1, Math.min(input?.maxSteps ?? 7, 10)),
    status: input?.status ?? "idle",
    currentTask: input?.currentTask,
    lastPlan: input?.lastPlan,
    lastRunSummary: input?.lastRunSummary,
    scaffoldStatus: input?.scaffoldStatus ?? "AIE_LITE_ELITE_AGENT_PHASE1_REAL_BOUNDED_EXECUTOR",
  };
}

export async function runLiteEliteAgentTask(agentInput: LiteEliteAgent, task: LiteEliteTaskContract, options?: RunOptions): Promise<LiteEliteRunResult> {
  const agent = cloneAgent(agentInput);
  const repoRoot = options?.repoRoot ?? process.cwd();
  const now = options?.now ?? (() => new Date().toISOString());
  const fileSystem = options?.fileSystem ?? defaultFileSystem;
  const commandRunner = options?.commandRunner ?? defaultCommandRunner(agent);
  const runLog: LiteEliteRunLogEntry[] = [];
  const failures: string[] = [];
  const blockers: string[] = [];
  const inspected: LiteEliteInspectedFile[] = [];
  const filesChanged: string[] = [];
  const commandsRun: LiteEliteCommandResult[] = [];

  agent.status = "planning";
  agent.currentTask = task;
  runLog.push(logEntry(now, "task_received", `Task received: ${task.title}`));

  const combinedAllowedPaths = task.allowedPaths.length > 0
    ? mergeUnique(task.allowedPaths.filter((taskPath) => agent.allowedPaths.some((agentPath) => isPathWithin(taskPath, agentPath))))
    : mergeUnique(agent.allowedPaths);
  const combinedBlockedPaths = mergeUnique([...agent.blockedPaths, ...task.forbiddenPaths]);
  const plan = createDefaultPlan(agent, task);
  agent.lastPlan = plan;

  if (plan.steps.length >= agent.maxSteps && agent.maxSteps < 6) {
    blockers.push(`Max step limit reached before full execution loop could run: ${agent.maxSteps}`);
    runLog.push(logEntry(now, "blocked", blockers[blockers.length - 1]!));
    const summary = createSummary({ agent, task, status: "blocked", scaffoldStatus: "AIE_LITE_ELITE_AGENT_PHASE1_BLOCKED_NO_EXECUTION", inspected, plan, filesChanged, commandsRun, failures, blockers, runLog });
    agent.status = "blocked";
    agent.lastRunSummary = summary;
    return { agent, summary };
  }

  const scopedPaths = mergeUnique([...plan.filesToInspect, ...plan.plannedChanges.map((change) => change.path)]);
  for (const relativePath of scopedPaths) {
    const blockedReason = assertAllowedPath(relativePath, combinedAllowedPaths, combinedBlockedPaths);
    if (blockedReason) {
      blockers.push(blockedReason);
    }
  }

  if (blockers.length > 0) {
    runLog.push(logEntry(now, "blocked", blockers.join(" | ")));
    const summary = createSummary({ agent, task, status: "blocked", scaffoldStatus: "AIE_LITE_ELITE_AGENT_PHASE1_BLOCKED_NO_EXECUTION", inspected, plan, filesChanged, commandsRun, failures, blockers, runLog });
    agent.status = "blocked";
    agent.lastRunSummary = summary;
    return { agent, summary };
  }

  runLog.push(logEntry(now, "scope_validated", `Allowed scope validated for ${combinedAllowedPaths.join(", ")}`));

  const inspectedContent = new Map<string, string>();
  for (const relativePath of plan.filesToInspect) {
    const absolutePath = path.join(repoRoot, normalizeRelativePath(relativePath));
    try {
      const content = await fileSystem.readFile(absolutePath);
      inspectedContent.set(normalizeRelativePath(relativePath), content);
      const stat = await fileSystem.stat(absolutePath);
      inspected.push({ path: normalizeRelativePath(relativePath), contentHash: hashContent(content), size: stat.size, exists: true });
    } catch {
      inspectedContent.set(normalizeRelativePath(relativePath), "");
      inspected.push({ path: normalizeRelativePath(relativePath), contentHash: hashContent(""), size: 0, exists: false });
    }
  }
  runLog.push(logEntry(now, "files_inspected", `${inspected.length} file(s) inspected inside allowed scope.`));
  runLog.push(logEntry(now, "plan_generated", `${plan.steps.length} bounded step(s) generated.`));

  const writesRequested = plan.plannedChanges.length > 0;
  const approvalRequired = plan.requiresApprovalBeforeWrite;
  if (writesRequested && approvalRequired && task.approvedForWrite !== true) {
    blockers.push("Human approval is required before controlled writes for this task.");
    runLog.push(logEntry(now, "approval_required", blockers[blockers.length - 1]!));
    const summary = createSummary({ agent, task, status: "awaiting_approval", scaffoldStatus: "AIE_LITE_ELITE_AGENT_PHASE1_BLOCKED_NO_EXECUTION", inspected, plan, filesChanged, commandsRun, failures, blockers, runLog });
    agent.status = "awaiting_approval";
    agent.lastRunSummary = summary;
    return { agent, summary };
  }

  agent.status = "running";

  for (const change of plan.plannedChanges) {
    const relativePath = normalizeRelativePath(change.path);
    const absolutePath = path.join(repoRoot, relativePath);
    const contentAtInspection = inspectedContent.get(relativePath) ?? "";
    if (options?.onBeforeWrite) {
      await options.onBeforeWrite(absolutePath);
    }
    let currentContent = "";
    try {
      currentContent = await fileSystem.readFile(absolutePath);
    } catch {
      currentContent = "";
    }
    if (currentContent !== contentAtInspection) {
      const conflict = `Conflict detected before writing ${relativePath}; file changed after inspection.`;
      blockers.push(conflict);
      runLog.push(logEntry(now, "blocked", conflict));
      continue;
    }
    await fileSystem.mkdir(path.dirname(absolutePath));
    await fileSystem.writeFile(absolutePath, change.content);
    filesChanged.push(relativePath);
  }

  if (filesChanged.length > 0) {
    runLog.push(logEntry(now, "files_changed", `${filesChanged.length} file(s) changed: ${filesChanged.join(", ")}`));
  }

  for (const command of task.verificationCommands) {
    if (!agent.allowedCommands.includes(command)) {
      const result: LiteEliteCommandResult = { command, exitCode: 1, stdout: "", stderr: "", skipped: true, blockedReason: `Command is not allowlisted for this agent: ${command}` };
      commandsRun.push(result);
      failures.push(result.blockedReason!);
      continue;
    }
    const result = await commandRunner(command, repoRoot);
    commandsRun.push(result);
    if (result.exitCode !== 0 || result.blockedReason) {
      failures.push(result.blockedReason ?? `Verification command failed: ${command}`);
    }
  }
  runLog.push(logEntry(now, "verification_run", `${commandsRun.length} verification command(s) recorded.`));

  const status: LiteEliteAgentStatus = blockers.length > 0 ? "blocked" : failures.length > 0 ? "failed" : "completed";
  const scaffoldStatus: LiteEliteAgentScaffoldStatus = status === "completed" ? "AIE_LITE_ELITE_AGENT_PHASE1_REAL_BOUNDED_EXECUTOR" : "AIE_LITE_ELITE_AGENT_PHASE1_BLOCKED_NO_EXECUTION";
  runLog.push(logEntry(now, status === "completed" ? "completed" : "blocked", `Run finished with status ${status}.`));

  const summary = createSummary({ agent, task, status, scaffoldStatus, inspected, plan, filesChanged, commandsRun, failures, blockers, runLog });
  agent.status = status;
  agent.lastRunSummary = summary;
  return { agent, summary };
}
