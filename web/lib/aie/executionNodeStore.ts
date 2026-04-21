import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { normalizeExecutionNodeDescriptor, type ExecutionNodeDescriptor } from "./executionNode";

function isTestRuntime(): boolean {
  return process.env.NODE_ENV === "test"
    || process.argv.includes("--test")
    || process.execArgv.includes("--test")
    || process.argv.some((value) => /\.test\.[cm]?[jt]sx?$/i.test(value));
}

function getDefaultExecutionNodeStoreDirectory(): string {
  const cwd = process.cwd();
  const baseDirectory = path.basename(cwd).toLowerCase() === "web" ? path.resolve(cwd, "..") : cwd;
  return isTestRuntime()
    ? path.join(baseDirectory, "runner_artifacts", "execution_nodes", `test-${process.pid}`)
    : path.join(baseDirectory, "runner_artifacts", "execution_nodes");
}

export function getExecutionNodeStoreDirectory(): string {
  const configuredDirectory = process.env.AIE_EXECUTION_NODE_REGISTRY_DIR?.trim();
  return configuredDirectory || getDefaultExecutionNodeStoreDirectory();
}

function ensureExecutionNodeStoreDirectory(): string {
  const directory = getExecutionNodeStoreDirectory();
  mkdirSync(directory, { recursive: true });
  return directory;
}

function getExecutionNodeFilePath(nodeId: string): string {
  return path.join(getExecutionNodeStoreDirectory(), `${nodeId}.json`);
}

export function writeStoredExecutionNode(node: ExecutionNodeDescriptor): ExecutionNodeDescriptor {
  const normalized = normalizeExecutionNodeDescriptor(node);
  ensureExecutionNodeStoreDirectory();
  writeFileSync(getExecutionNodeFilePath(normalized.id), `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

export function removeStoredExecutionNode(nodeId: string): void {
  rmSync(getExecutionNodeFilePath(nodeId), { force: true });
}

export function listStoredExecutionNodes(): ExecutionNodeDescriptor[] {
  const directory = ensureExecutionNodeStoreDirectory();

  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => {
      try {
        const raw = readFileSync(path.join(directory, entry.name), "utf8");
        return normalizeExecutionNodeDescriptor(JSON.parse(raw));
      } catch {
        return null;
      }
    })
    .filter((node): node is ExecutionNodeDescriptor => node !== null);
}

export function clearStoredExecutionNodes(): void {
  const directory = getExecutionNodeStoreDirectory();
  if (!existsSync(directory)) {
    return;
  }

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }

    rmSync(path.join(directory, entry.name), { force: true });
  }
}