import path from "node:path";

import {
  buildGovernedSandboxScaffold,
  resolveGovernedSandboxPath,
  type BuildGovernedSandboxScaffoldInput,
  type GovernedSandboxSafePath,
  type GovernedSandboxScaffold,
} from "./sandboxExecutionBoundary";

export type SandboxCommandAllowedCategory =
  | "node_tooling"
  | "npm_script"
  | "test_runner"
  | "lint"
  | "build"
  | "git_readonly"
  | "project_diagnostics";

export type SandboxCommandDeniedCategory =
  | "invalid_request"
  | "unsupported_command"
  | "destructive_filesystem_operation"
  | "unrestricted_shell_passthrough"
  | "network_operation"
  | "credential_token_inspection"
  | "privilege_escalation"
  | "global_package_installation"
  | "system_level_mutation"
  | "outside_sandbox_workspace"
  | "production_workspace_mutation"
  | "unsafe_command_syntax";

export type SandboxCommandCategory = SandboxCommandAllowedCategory | SandboxCommandDeniedCategory | "unknown";

export type SandboxCommandAllowReason =
  | "allowed_node_tooling_command"
  | "allowed_npm_script_command"
  | "allowed_project_test_command"
  | "allowed_project_lint_command"
  | "allowed_project_build_command"
  | "allowed_git_readonly_command"
  | "allowed_project_diagnostics_command";

export type SandboxCommandDenyReason =
  | "empty_command"
  | "default_deny"
  | "unsupported_command"
  | "destructive_filesystem_operation"
  | "unrestricted_shell_passthrough"
  | "network_operation"
  | "credential_token_inspection"
  | "privilege_escalation"
  | "global_package_installation"
  | "system_level_mutation"
  | "outside_sandbox_workspace"
  | "production_workspace_mutation"
  | "shell_control_operator"
  | "wildcard_or_control_character"
  | "path_traversal";

export type SandboxCommandReason = SandboxCommandAllowReason | SandboxCommandDenyReason;

export type SandboxCommandWarning = {
  code: string;
  message: string;
  token?: string;
};

export type SandboxCommandValidationError = {
  code: SandboxCommandDenyReason;
  message: string;
  token?: string;
};

export type SandboxCommandAllowlistPolicy = {
  manifestVersion: "EXEC-0043-D";
  defaultDecision: "deny";
  allowedCategories: SandboxCommandAllowedCategory[];
  deniedCategories: SandboxCommandDeniedCategory[];
  allowedNpmScripts: string[];
  allowedGitReadOnlySubcommands: string[];
  deniedExecutableNames: string[];
};

export type SandboxCommandValidationRequest = BuildGovernedSandboxScaffoldInput & {
  scaffold?: GovernedSandboxScaffold;
  command: string;
  args?: string[];
  workingDirectory?: string;
  requiresApproval?: boolean;
  policy?: SandboxCommandAllowlistPolicy;
};

export type SandboxCommandValidationResult = {
  manifestVersion: "EXEC-0043-D";
  sandboxId: string;
  createdAt: string;
  command: string;
  commandTokens: string[];
  normalizedCommand: string;
  category: SandboxCommandCategory;
  allowed: boolean;
  reason: SandboxCommandReason;
  requiresApproval: boolean;
  sandboxOnly: true;
  dryRun: true;
  workingDirectory: GovernedSandboxSafePath;
  warnings: SandboxCommandWarning[];
  errors: SandboxCommandValidationError[];
  safetyBoundary: {
    commandValidationOnly: true;
    commandExecutionEnabled: false;
    processSpawnEnabled: false;
    shellPassthroughEnabled: false;
    networkExecutionEnabled: false;
    productionWorkspaceMutationEnabled: false;
    automaticRuntimeExecution: false;
    humanApprovalBoundaryPreserved: true;
  };
};

type AllowDecision = {
  category: SandboxCommandAllowedCategory;
  reason: SandboxCommandAllowReason;
};

type DenyDecision = {
  category: SandboxCommandDeniedCategory;
  reason: SandboxCommandDenyReason;
  message: string;
  token?: string;
};

const DEFAULT_ALLOWED_NPM_SCRIPTS = [
  "build",
  "lint",
  "test",
  "test:trace",
  "test:trace:safe",
  "readiness",
  "trace:readiness",
];

const DEFAULT_GIT_READONLY_SUBCOMMANDS = [
  "branch",
  "diff",
  "grep",
  "log",
  "ls-files",
  "remote",
  "rev-parse",
  "show",
  "status",
];

const DEFAULT_DENIED_EXECUTABLES = [
  "bash",
  "cmd",
  "cmd.exe",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
  "sh",
  "sudo",
  "runas",
];

const SHELL_CONTROL_PATTERN = /(^|\s)(&&|\|\||;|\||>|<|2>|>>|<<)($|\s)|[`]|\$\(/;
const UNSAFE_TOKEN_PATTERN = /[\x00-\x1F*?<>|]/;
const CREDENTIAL_PATTERN = /(^|[/\\=.-])(\.env|id_rsa|credential|credentials|secret|secrets|token|tokens|api[_-]?key)([/\\=.-]|$)/i;

export function getDefaultSandboxCommandAllowlistPolicy(): SandboxCommandAllowlistPolicy {
  return {
    manifestVersion: "EXEC-0043-D",
    defaultDecision: "deny",
    allowedCategories: [
      "node_tooling",
      "npm_script",
      "test_runner",
      "lint",
      "build",
      "git_readonly",
      "project_diagnostics",
    ],
    deniedCategories: [
      "invalid_request",
      "unsupported_command",
      "destructive_filesystem_operation",
      "unrestricted_shell_passthrough",
      "network_operation",
      "credential_token_inspection",
      "privilege_escalation",
      "global_package_installation",
      "system_level_mutation",
      "outside_sandbox_workspace",
      "production_workspace_mutation",
      "unsafe_command_syntax",
    ],
    allowedNpmScripts: [...DEFAULT_ALLOWED_NPM_SCRIPTS],
    allowedGitReadOnlySubcommands: [...DEFAULT_GIT_READONLY_SUBCOMMANDS],
    deniedExecutableNames: [...DEFAULT_DENIED_EXECUTABLES],
  };
}

function tokenizeCommand(command: string, args?: string[]): string[] {
  if (args) {
    return [command, ...args].map((token) => token.trim()).filter(Boolean);
  }

  const matches = command.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return matches.map((token) => token.replace(/^["']|["']$/g, "").trim()).filter(Boolean);
}

function normalizeExecutableName(executable: string): string {
  const name = path.basename(executable).toLowerCase();
  return name.endsWith(".cmd") || name.endsWith(".exe") ? name.replace(/\.(cmd|exe)$/i, "") : name;
}

function normalizedCommand(tokens: string[]): string {
  return tokens.join(" ");
}

function tokenHasTraversal(token: string): boolean {
  return token.replace(/\\/g, "/").split(/[\/=]/).some((segment) => segment === "..");
}

function isNetworkToken(token: string): boolean {
  return /^https?:\/\//i.test(token) || /^git\+https?:\/\//i.test(token);
}

function pathCandidateFromToken(token: string): string {
  if (token.includes("=")) {
    return token.slice(token.indexOf("=") + 1);
  }

  return token;
}

function tokenLooksLikePath(token: string): boolean {
  const candidate = pathCandidateFromToken(token);
  return candidate.includes("/") || candidate.includes("\\") || path.isAbsolute(candidate);
}

function npmScriptCategory(scriptName: string): AllowDecision {
  if (scriptName === "build") {
    return { category: "build", reason: "allowed_project_build_command" };
  }
  if (scriptName === "lint") {
    return { category: "lint", reason: "allowed_project_lint_command" };
  }
  if (scriptName === "test" || scriptName.startsWith("test:")) {
    return { category: "test_runner", reason: "allowed_project_test_command" };
  }

  return { category: "project_diagnostics", reason: "allowed_project_diagnostics_command" };
}

function npmExecCategory(tokens: string[]): AllowDecision | null {
  const execTarget = tokens[2] === "--" ? tokens[3] : tokens[2];
  if (!execTarget) {
    return null;
  }

  const normalizedTarget = normalizeExecutableName(execTarget);
  if (normalizedTarget === "eslint") {
    return { category: "lint", reason: "allowed_project_lint_command" };
  }
  if (normalizedTarget === "tsx" && tokens.includes("--test")) {
    return { category: "test_runner", reason: "allowed_project_test_command" };
  }
  if (normalizedTarget === "tsc" && tokens.includes("--noEmit")) {
    return { category: "project_diagnostics", reason: "allowed_project_diagnostics_command" };
  }

  return null;
}

function gitReadOnlyAllowed(tokens: string[], policy: SandboxCommandAllowlistPolicy): boolean {
  const subcommand = tokens[1] ?? "status";
  if (!policy.allowedGitReadOnlySubcommands.includes(subcommand)) {
    return false;
  }
  if (subcommand === "branch") {
    return tokens.slice(2).every((token) => ["--show-current", "--list", "-vv", "-v"].includes(token));
  }
  if (subcommand === "remote") {
    return tokens.length === 2 || tokens[2] === "-v";
  }

  return !tokens.some((token) => token === "--output" || token.startsWith("--output="));
}

function classifyAllowedCommand(tokens: string[], policy: SandboxCommandAllowlistPolicy): AllowDecision | null {
  const executable = normalizeExecutableName(tokens[0] ?? "");

  if (executable === "npm") {
    const action = tokens[1];
    if (action === "--version" || action === "-v") {
      return { category: "node_tooling", reason: "allowed_node_tooling_command" };
    }
    if (action === "run" && tokens[2] && policy.allowedNpmScripts.includes(tokens[2])) {
      const decision = npmScriptCategory(tokens[2]);
      return decision.category === "project_diagnostics"
        ? { ...decision, reason: "allowed_npm_script_command" }
        : decision;
    }
    if (action === "exec") {
      return npmExecCategory(tokens);
    }
  }

  if (executable === "node" && ["--version", "-v", "--test"].includes(tokens[1] ?? "")) {
    return tokens[1] === "--test"
      ? { category: "test_runner", reason: "allowed_project_test_command" }
      : { category: "node_tooling", reason: "allowed_node_tooling_command" };
  }

  if (executable === "tsx" && tokens.includes("--test")) {
    return { category: "test_runner", reason: "allowed_project_test_command" };
  }

  if (executable === "eslint") {
    return { category: "lint", reason: "allowed_project_lint_command" };
  }

  if (executable === "tsc" && tokens.includes("--noEmit")) {
    return { category: "project_diagnostics", reason: "allowed_project_diagnostics_command" };
  }

  if (executable === "git" && gitReadOnlyAllowed(tokens, policy)) {
    return { category: "git_readonly", reason: "allowed_git_readonly_command" };
  }

  return null;
}

function firstSafetyDenial(tokens: string[], rawCommand: string, policy: SandboxCommandAllowlistPolicy): DenyDecision | null {
  if (tokens.length === 0) {
    return { category: "invalid_request", reason: "empty_command", message: "A sandbox command request must include a command." };
  }

  const executable = normalizeExecutableName(tokens[0] ?? "");
  if (SHELL_CONTROL_PATTERN.test(rawCommand)) {
    return { category: "unsafe_command_syntax", reason: "shell_control_operator", message: "Shell control operators are not allowed in sandbox command validation." };
  }
  if (policy.deniedExecutableNames.includes(executable)) {
    return { category: executable === "sudo" || executable === "runas" ? "privilege_escalation" : "unrestricted_shell_passthrough", reason: executable === "sudo" || executable === "runas" ? "privilege_escalation" : "unrestricted_shell_passthrough", message: "Unrestricted shell passthrough and privilege wrappers are denied.", token: tokens[0] };
  }

  for (const token of tokens) {
    if (UNSAFE_TOKEN_PATTERN.test(token)) {
      return { category: "unsafe_command_syntax", reason: "wildcard_or_control_character", message: "Command tokens may not contain wildcard or control characters.", token };
    }
    if (tokenHasTraversal(token)) {
      return { category: "outside_sandbox_workspace", reason: "path_traversal", message: "Command tokens may not contain path traversal segments.", token };
    }
    if (isNetworkToken(token)) {
      return { category: "network_operation", reason: "network_operation", message: "Network command targets are denied by the sandbox command policy.", token };
    }
    if (CREDENTIAL_PATTERN.test(token)) {
      return { category: "credential_token_inspection", reason: "credential_token_inspection", message: "Credential, token, or secret inspection is denied.", token };
    }
  }

  if (["rm", "del", "erase", "rmdir", "rd", "remove-item"].includes(executable)) {
    return { category: "destructive_filesystem_operation", reason: "destructive_filesystem_operation", message: "Destructive filesystem commands are denied.", token: tokens[0] };
  }
  if (["curl", "wget", "iwr", "invoke-webrequest", "ssh", "scp", "ftp"].includes(executable)) {
    return { category: "network_operation", reason: "network_operation", message: "Network tools are denied in sandbox command validation.", token: tokens[0] };
  }
  if (["reg", "sc", "net", "setx", "icacls", "chmod", "chown", "mount"].includes(executable)) {
    return { category: "system_level_mutation", reason: "system_level_mutation", message: "System-level mutation commands are denied.", token: tokens[0] };
  }
  if (executable === "npm" && tokens.includes("-g") && ["install", "add", "update"].includes(tokens[1] ?? "")) {
    return { category: "global_package_installation", reason: "global_package_installation", message: "Global package installation is denied.", token: normalizedCommand(tokens) };
  }
  if (executable === "npm" && ["install", "add", "ci", "update", "publish", "login"].includes(tokens[1] ?? "")) {
    return { category: "network_operation", reason: "network_operation", message: "Package installation, publishing, and login commands are denied.", token: normalizedCommand(tokens) };
  }
  if (executable === "git" && ["add", "commit", "push", "pull", "fetch", "merge", "rebase", "reset", "clean", "rm", "checkout", "switch"].includes(tokens[1] ?? "")) {
    return { category: "production_workspace_mutation", reason: "production_workspace_mutation", message: "Only git read-only inspection commands are allowed.", token: normalizedCommand(tokens) };
  }
  if (executable === "node" && ["-e", "--eval"].includes(tokens[1] ?? "")) {
    return { category: "unrestricted_shell_passthrough", reason: "unrestricted_shell_passthrough", message: "Inline eval-style command execution is denied.", token: normalizedCommand(tokens) };
  }

  return null;
}

function pathSafetyDenial(tokens: string[], scaffold: GovernedSandboxScaffold): DenyDecision | null {
  for (const token of tokens.slice(1)) {
    if (!tokenLooksLikePath(token) || isNetworkToken(token)) {
      continue;
    }

    const candidate = pathCandidateFromToken(token);
    try {
      resolveGovernedSandboxPath(scaffold, candidate, "workspace");
    } catch (error) {
      return {
        category: "outside_sandbox_workspace",
        reason: "outside_sandbox_workspace",
        message: error instanceof Error ? error.message : "Command path argument is outside the sandbox workspace.",
        token,
      };
    }
  }

  return null;
}

function deniedResult(input: {
  scaffold: GovernedSandboxScaffold;
  createdAt: string;
  command: string;
  tokens: string[];
  workingDirectory: GovernedSandboxSafePath;
  denial: DenyDecision;
  requiresApproval: boolean;
}): SandboxCommandValidationResult {
  return {
    manifestVersion: "EXEC-0043-D",
    sandboxId: input.scaffold.sandboxId,
    createdAt: input.createdAt,
    command: input.command,
    commandTokens: input.tokens,
    normalizedCommand: normalizedCommand(input.tokens),
    category: input.denial.category,
    allowed: false,
    reason: input.denial.reason,
    requiresApproval: input.requiresApproval,
    sandboxOnly: true,
    dryRun: true,
    workingDirectory: input.workingDirectory,
    warnings: [],
    errors: [{
      code: input.denial.reason,
      message: input.denial.message,
      token: input.denial.token,
    }],
    safetyBoundary: {
      commandValidationOnly: true,
      commandExecutionEnabled: false,
      processSpawnEnabled: false,
      shellPassthroughEnabled: false,
      networkExecutionEnabled: false,
      productionWorkspaceMutationEnabled: false,
      automaticRuntimeExecution: false,
      humanApprovalBoundaryPreserved: true,
    },
  };
}

export function validateSandboxCommandRequest(input: SandboxCommandValidationRequest): SandboxCommandValidationResult {
  const policy = input.policy ?? getDefaultSandboxCommandAllowlistPolicy();
  const scaffold = input.scaffold ?? buildGovernedSandboxScaffold(input);
  const createdAt = input.now?.() ?? new Date().toISOString();
  const tokens = tokenizeCommand(input.command, input.args);
  const rawCommand = input.args ? [input.command, ...input.args].join(" ") : input.command;
  const workspaceRoot = resolveGovernedSandboxPath(scaffold, ".", "workspace");
  const requiresApproval = input.requiresApproval ?? true;

  let workingDirectory = workspaceRoot;
  try {
    workingDirectory = resolveGovernedSandboxPath(scaffold, input.workingDirectory ?? ".", "workspace");
  } catch (error) {
    return deniedResult({
      scaffold,
      createdAt,
      command: rawCommand,
      tokens,
      workingDirectory,
      requiresApproval,
      denial: {
        category: "outside_sandbox_workspace",
        reason: "outside_sandbox_workspace",
        message: error instanceof Error ? error.message : "Command working directory is outside the sandbox workspace.",
        token: input.workingDirectory,
      },
    });
  }

  const safetyDenial = firstSafetyDenial(tokens, rawCommand, policy) ?? pathSafetyDenial(tokens, scaffold);
  if (safetyDenial) {
    return deniedResult({
      scaffold,
      createdAt,
      command: rawCommand,
      tokens,
      workingDirectory,
      requiresApproval,
      denial: safetyDenial,
    });
  }

  const allowDecision = classifyAllowedCommand(tokens, policy);
  if (!allowDecision) {
    return deniedResult({
      scaffold,
      createdAt,
      command: rawCommand,
      tokens,
      workingDirectory,
      requiresApproval,
      denial: {
        category: "unsupported_command",
        reason: "default_deny",
        message: "Sandbox command policy denies commands unless they match an explicit allowlist entry.",
        token: tokens[0],
      },
    });
  }

  return {
    manifestVersion: "EXEC-0043-D",
    sandboxId: scaffold.sandboxId,
    createdAt,
    command: rawCommand,
    commandTokens: tokens,
    normalizedCommand: normalizedCommand(tokens),
    category: allowDecision.category,
    allowed: true,
    reason: allowDecision.reason,
    requiresApproval,
    sandboxOnly: true,
    dryRun: true,
    workingDirectory,
    warnings: [],
    errors: [],
    safetyBoundary: {
      commandValidationOnly: true,
      commandExecutionEnabled: false,
      processSpawnEnabled: false,
      shellPassthroughEnabled: false,
      networkExecutionEnabled: false,
      productionWorkspaceMutationEnabled: false,
      automaticRuntimeExecution: false,
      humanApprovalBoundaryPreserved: true,
    },
  };
}
