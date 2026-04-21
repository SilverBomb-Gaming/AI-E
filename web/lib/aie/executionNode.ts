import type { ExecutionActionPreview } from "./types";

export type ExecutionNodeMode = "web" | "headless" | "local-node";

export type ExecutionNodeCapability =
  | "inspection"
  | "validation-check"
  | "file-write"
  | "test-run"
  | "repo-scan";

export type ExecutionNodeDescriptor = {
  id: string;
  label: string;
  mode: ExecutionNodeMode;
  capabilities: ExecutionNodeCapability[];
  cwd?: string;
  allowedRoots?: string[];
  active: boolean;
  busy: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ExecutionNodeActionPolicyCheck = {
  allowed: boolean;
  reason?: string;
};

type CreateExecutionNodeDescriptorParams = {
  id?: string;
  label?: string;
  mode: ExecutionNodeMode;
  capabilities: ExecutionNodeCapability[];
  cwd?: string;
  allowedRoots?: string[];
  active?: boolean;
  busy?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

const CAPABILITY_ORDER: ExecutionNodeCapability[] = [
  "inspection",
  "validation-check",
  "file-write",
  "test-run",
  "repo-scan",
];

export const DEFAULT_RUNTIME_EXECUTION_NODE_CAPABILITIES: ExecutionNodeCapability[] = [...CAPABILITY_ORDER];

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function createTimestamp(): string {
  return new Date().toISOString();
}

function slugify(value: string): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function normalizeCapabilities(capabilities: ExecutionNodeCapability[]): ExecutionNodeCapability[] {
  const seen = new Set<ExecutionNodeCapability>();

  for (const capability of capabilities) {
    if (CAPABILITY_ORDER.includes(capability)) {
      seen.add(capability);
    }
  }

  return CAPABILITY_ORDER.filter((capability) => seen.has(capability));
}

function normalizePathForMatch(value: unknown): string {
  return normalizeText(value)
    .replace(/\\+/g, "/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "")
    .toLowerCase();
}

function isPathWithinAllowedRoots(targetPath: string, allowedRoots: string[]): boolean {
  const normalizedTargetPath = normalizePathForMatch(targetPath);
  return allowedRoots
    .map((root) => normalizePathForMatch(root))
    .filter(Boolean)
    .some((root) => normalizedTargetPath === root || normalizedTargetPath.startsWith(`${root}/`));
}

function buildExecutionNodeId(params: { mode: ExecutionNodeMode; cwd?: string; label?: string }): string {
  const seed = slugify(params.cwd || params.label || params.mode) || params.mode;
  return `aie-node-${params.mode}-${seed}`;
}

export function summarizeExecutionNodeCapabilities(capabilities: ExecutionNodeCapability[]): string {
  const normalized = normalizeCapabilities(capabilities);
  return normalized.length ? normalized.join(", ") : "no capabilities";
}

export function supportsExecutionNodeCapabilities(
  node: ExecutionNodeDescriptor,
  requestedCapabilities: ExecutionNodeCapability[],
): boolean {
  const normalizedRequestedCapabilities = normalizeCapabilities(requestedCapabilities);
  return normalizedRequestedCapabilities.every((capability) => node.capabilities.includes(capability));
}

export function summarizeExecutionNodePolicy(node: ExecutionNodeDescriptor): string {
  const roots = (node.allowedRoots ?? []).filter(Boolean);
  const availability = node.active ? (node.busy ? "busy" : "active") : "inactive";
  return roots.length
    ? `${node.id} availability=${availability} roots=${roots.join(",")}`
    : `${node.id} availability=${availability} roots=unbounded-lab`;
}

export function validateExecutionActionForNode(
  node: ExecutionNodeDescriptor,
  action: ExecutionActionPreview | undefined,
): ExecutionNodeActionPolicyCheck {
  if (!action) {
    return {
      allowed: false,
      reason: `Execution node ${node.id} rejected a missing action payload.`,
    };
  }

  const targetPath = normalizeText(action.metadata?.targetPath);
  const requestedAllowedRoot = normalizeText(action.metadata?.allowedRoot);
  const allowedRoots = (node.allowedRoots ?? []).filter(Boolean);

  if (!allowedRoots.length) {
    return { allowed: true };
  }

  if (requestedAllowedRoot && !isPathWithinAllowedRoots(requestedAllowedRoot, allowedRoots)) {
    return {
      allowed: false,
      reason: `Execution node ${node.id} rejected allowed root ${requestedAllowedRoot} outside ${allowedRoots.join(", ")}.`,
    };
  }

  if (targetPath && !isPathWithinAllowedRoots(targetPath, allowedRoots)) {
    return {
      allowed: false,
      reason: `Execution node ${node.id} rejected target path ${targetPath} outside ${allowedRoots.join(", ")}.`,
    };
  }

  return { allowed: true };
}

export function createExecutionNodeDescriptor(params: CreateExecutionNodeDescriptorParams): ExecutionNodeDescriptor {
  const timestamp = params.updatedAt || createTimestamp();
  const normalizedCapabilities = normalizeCapabilities(params.capabilities);

  return {
    id: normalizeText(params.id) || buildExecutionNodeId(params),
    label: normalizeText(params.label) || `AI-E ${params.mode}`,
    mode: params.mode,
    capabilities: normalizedCapabilities,
    cwd: normalizeText(params.cwd) || undefined,
    allowedRoots: (params.allowedRoots ?? []).map((item) => normalizeText(item)).filter(Boolean),
    active: params.active !== false,
    busy: params.busy === true,
    createdAt: params.createdAt || timestamp,
    updatedAt: timestamp,
  };
}

export function getExecutionNodeCapabilitiesForAction(action: ExecutionActionPreview | undefined): ExecutionNodeCapability[] {
  const actionType = normalizeText(action?.type || action?.metadata?.sourceActionType);

  switch (actionType) {
    case "inspection":
      return ["inspection", "repo-scan"];
    case "validation-check":
      return ["validation-check", "repo-scan"];
    case "file-write":
      return ["file-write"];
    case "test-run":
      return ["test-run"];
    default:
      return [];
  }
}

export function deriveExecutionNodeMode(runtimeMode: string | undefined): ExecutionNodeMode {
  if (runtimeMode === "headless") {
    return "headless";
  }

  if (runtimeMode === "local") {
    return "local-node";
  }

  return "web";
}

export function createRuntimeExecutionNodeDescriptor(params: {
  runtimeMode?: string;
  cwd?: string;
  allowedRoots?: string[];
  label?: string;
  capabilities?: ExecutionNodeCapability[];
}): ExecutionNodeDescriptor {
  const mode = deriveExecutionNodeMode(params.runtimeMode);
  const defaultLabel = mode === "local-node" ? "AI-E Local Node" : mode === "headless" ? "AI-E Headless Node" : "AI-E Web Node";

  return createExecutionNodeDescriptor({
    mode,
    cwd: params.cwd,
    allowedRoots: params.allowedRoots,
    label: params.label || defaultLabel,
    capabilities: params.capabilities ?? DEFAULT_RUNTIME_EXECUTION_NODE_CAPABILITIES,
  });
}