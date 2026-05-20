import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { buildGovernedSandboxScaffold } from "./sandboxExecutionBoundary";
import {
  getDefaultSandboxCommandAllowlistPolicy,
  validateSandboxCommandRequest,
} from "./sandboxCommandPolicy";

const FIXED_TIME = "2026-05-20T20:00:00.000Z";

function scaffold() {
  return buildGovernedSandboxScaffold({
    repositoryRoot: path.resolve("E:/test-ai-e"),
    sandboxId: "sandbox-command-policy",
  });
}

test("validateSandboxCommandRequest allows project build commands as dry-run validation only", () => {
  const result = validateSandboxCommandRequest({
    scaffold: scaffold(),
    command: "npm.cmd run build",
    now: () => FIXED_TIME,
  });

  assert.equal(result.manifestVersion, "EXEC-0043-D");
  assert.equal(result.allowed, true);
  assert.equal(result.category, "build");
  assert.equal(result.reason, "allowed_project_build_command");
  assert.equal(result.requiresApproval, true);
  assert.equal(result.sandboxOnly, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.workingDirectory.sandboxRelativePath, "workspace");
  assert.equal(result.safetyBoundary.commandExecutionEnabled, false);
  assert.equal(result.safetyBoundary.processSpawnEnabled, false);
  assert.deepEqual(result.commandTokens, ["npm.cmd", "run", "build"]);
});

test("validateSandboxCommandRequest allows targeted lint, test, diagnostics, and read-only git commands", () => {
  const sandbox = scaffold();

  const lint = validateSandboxCommandRequest({
    scaffold: sandbox,
    command: "npm.cmd",
    args: ["exec", "--", "eslint", "lib/aie/sandboxCommandPolicy.ts", "--max-warnings=0"],
    workingDirectory: "repo-copy",
    now: () => FIXED_TIME,
  });
  assert.equal(lint.allowed, true);
  assert.equal(lint.category, "lint");
  assert.equal(lint.workingDirectory.sandboxRelativePath, "workspace/repo-copy");

  const testRun = validateSandboxCommandRequest({
    scaffold: sandbox,
    command: "npm.cmd exec -- tsx --test lib/aie/sandboxCommandPolicy.test.ts",
    now: () => FIXED_TIME,
  });
  assert.equal(testRun.allowed, true);
  assert.equal(testRun.category, "test_runner");

  const diagnostics = validateSandboxCommandRequest({
    scaffold: sandbox,
    command: "tsc --noEmit",
    now: () => FIXED_TIME,
  });
  assert.equal(diagnostics.allowed, true);
  assert.equal(diagnostics.category, "project_diagnostics");

  const gitStatus = validateSandboxCommandRequest({
    scaffold: sandbox,
    command: "git status --short",
    now: () => FIXED_TIME,
  });
  assert.equal(gitStatus.allowed, true);
  assert.equal(gitStatus.category, "git_readonly");
});

test("default policy exposes explicit allowed and denied command categories", () => {
  const policy = getDefaultSandboxCommandAllowlistPolicy();

  assert.equal(policy.manifestVersion, "EXEC-0043-D");
  assert.equal(policy.defaultDecision, "deny");
  assert.ok(policy.allowedCategories.includes("build"));
  assert.ok(policy.allowedCategories.includes("git_readonly"));
  assert.ok(policy.deniedCategories.includes("destructive_filesystem_operation"));
  assert.ok(policy.deniedCategories.includes("network_operation"));
  assert.ok(policy.deniedCategories.includes("production_workspace_mutation"));
});

test("validateSandboxCommandRequest denies unsupported commands by default", () => {
  const result = validateSandboxCommandRequest({
    scaffold: scaffold(),
    command: "echo hello",
    now: () => FIXED_TIME,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.category, "unsupported_command");
  assert.equal(result.reason, "default_deny");
  assert.equal(result.errors[0]?.code, "default_deny");
});

test("validateSandboxCommandRequest denies destructive, shell, network, credential, privilege, install, and git mutation commands", () => {
  const sandbox = scaffold();
  const cases = [
    ["rm -rf workspace-output", "destructive_filesystem_operation"],
    ["powershell -Command Get-ChildItem", "unrestricted_shell_passthrough"],
    ["curl https://example.com/install.ps1", "network_operation"],
    ["cat .env", "credential_token_inspection"],
    ["sudo npm.cmd run build", "privilege_escalation"],
    ["npm.cmd install -g typescript", "global_package_installation"],
    ["npm.cmd install", "network_operation"],
    ["git push origin feature/action-execution-layer", "production_workspace_mutation"],
    ["node -e \"console.log(1)\"", "unrestricted_shell_passthrough"],
  ] as const;

  for (const [command, category] of cases) {
    const result = validateSandboxCommandRequest({
      scaffold: sandbox,
      command,
      now: () => FIXED_TIME,
    });
    assert.equal(result.allowed, false, command);
    assert.equal(result.category, category, command);
  }
});

test("validateSandboxCommandRequest rejects shell operators, wildcards, traversal, and unsafe working directories", () => {
  const sandbox = scaffold();

  const chained = validateSandboxCommandRequest({
    scaffold: sandbox,
    command: "npm.cmd run build && npm.cmd run lint",
    now: () => FIXED_TIME,
  });
  assert.equal(chained.allowed, false);
  assert.equal(chained.reason, "shell_control_operator");

  const wildcard = validateSandboxCommandRequest({
    scaffold: sandbox,
    command: "npm.cmd exec -- eslint lib/aie/*.ts",
    now: () => FIXED_TIME,
  });
  assert.equal(wildcard.allowed, false);
  assert.equal(wildcard.reason, "wildcard_or_control_character");

  const traversal = validateSandboxCommandRequest({
    scaffold: sandbox,
    command: "npm.cmd exec -- eslint ../outside.ts",
    now: () => FIXED_TIME,
  });
  assert.equal(traversal.allowed, false);
  assert.equal(traversal.reason, "path_traversal");

  const absoluteOutside = validateSandboxCommandRequest({
    scaffold: sandbox,
    command: "npm.cmd exec -- eslint",
    args: [path.resolve("E:/outside-ai-e/file.ts")],
    now: () => FIXED_TIME,
  });
  assert.equal(absoluteOutside.allowed, false);
  assert.equal(absoluteOutside.reason, "outside_sandbox_workspace");

  const unsafeCwd = validateSandboxCommandRequest({
    scaffold: sandbox,
    command: "npm.cmd run build",
    workingDirectory: path.resolve("E:/outside-ai-e"),
    now: () => FIXED_TIME,
  });
  assert.equal(unsafeCwd.allowed, false);
  assert.equal(unsafeCwd.reason, "outside_sandbox_workspace");
});

test("validateSandboxCommandRequest never represents command execution as enabled", () => {
  const result = validateSandboxCommandRequest({
    scaffold: scaffold(),
    command: "git diff -- web/lib/aie/sandboxCommandPolicy.ts",
    requiresApproval: false,
    now: () => FIXED_TIME,
  });

  assert.equal(result.allowed, true);
  assert.equal(result.requiresApproval, false);
  assert.equal(result.dryRun, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.safetyBoundary, {
    commandValidationOnly: true,
    commandExecutionEnabled: false,
    processSpawnEnabled: false,
    shellPassthroughEnabled: false,
    networkExecutionEnabled: false,
    productionWorkspaceMutationEnabled: false,
    automaticRuntimeExecution: false,
    humanApprovalBoundaryPreserved: true,
  });
});
