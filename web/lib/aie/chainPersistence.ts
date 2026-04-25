import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AutonomousTaskChain } from "./autonomousTaskChain";
import type { ChainCheckpoint } from "./autonomousChainRecovery";
import type { ApprovalState } from "./approvalFreshness";

export type ChainPersistenceRecord = {
  chain_id: string;
  created_at: string;
  last_updated_at: string;
  last_completed_step_index: number;
  checkpoint_snapshot: ChainCheckpoint;
  approval_state: ApprovalState[];
  validation_snapshot: {
    status: "validation_passed" | "validation_failed" | "validation_needs_review" | "validation_blocked";
    recommendation: "keep_changes" | "rollback" | "review_required";
    validated_at: string | null;
  };
  context_snapshot: {
    chain_status: AutonomousTaskChain["status"];
    current_step_index: number;
    stale_after_ms: number;
    chain_updated_at: string;
    validation_completed_at: string | null;
  };
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function getChainPersistenceDirectory(): string {
  const configuredDirectory = process.env.AIE_CHAIN_STATE_DIR?.trim();
  if (configuredDirectory) {
    return configuredDirectory;
  }

  return path.resolve(process.cwd(), "..", "runner_artifacts", "autonomous_chains");
}

async function ensureChainPersistenceDirectory(): Promise<string> {
  const directory = getChainPersistenceDirectory();
  await mkdir(directory, { recursive: true });
  return directory;
}

function getChainStateFilePath(chainId: string): string {
  return path.join(getChainPersistenceDirectory(), `${chainId}.json`);
}

export async function persistChainState(record: ChainPersistenceRecord): Promise<ChainPersistenceRecord> {
  await ensureChainPersistenceDirectory();
  await writeFile(getChainStateFilePath(record.chain_id), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return record;
}

export async function loadChainState(chainId: string): Promise<ChainPersistenceRecord | null> {
  try {
    const raw = await readFile(getChainStateFilePath(chainId), "utf8");
    return JSON.parse(raw) as ChainPersistenceRecord;
  } catch {
    return null;
  }
}

export function createChainPersistenceRecord(input: {
  chain: AutonomousTaskChain;
  checkpoint: ChainCheckpoint;
  approvalState: ApprovalState[];
  validationSnapshot?: ChainPersistenceRecord["validation_snapshot"];
  contextStaleAfterMs?: number;
  updatedAt?: string;
}): ChainPersistenceRecord {
  const updatedAt = normalizeText(input.updatedAt) || new Date().toISOString();
  return {
    chain_id: input.chain.chain_id,
    created_at: input.chain.created_at,
    last_updated_at: updatedAt,
    last_completed_step_index: input.checkpoint.last_completed_step_index,
    checkpoint_snapshot: input.checkpoint,
    approval_state: input.approvalState,
    validation_snapshot: input.validationSnapshot ?? {
      status: input.checkpoint.validation_snapshot.status,
      recommendation: input.checkpoint.validation_snapshot.recommendation,
      validated_at: updatedAt,
    },
    context_snapshot: {
      chain_status: input.chain.status,
      current_step_index: input.chain.current_step_index,
      stale_after_ms: input.contextStaleAfterMs ?? 60 * 60 * 1000,
      chain_updated_at: updatedAt,
      validation_completed_at: input.validationSnapshot?.validated_at ?? updatedAt,
    },
  };
}

export function summarizePersistenceState(record: ChainPersistenceRecord): string {
  return [
    `Chain id: ${record.chain_id}`,
    `Last updated: ${record.last_updated_at}`,
    `Last completed step index: ${record.last_completed_step_index}`,
    `Validation status: ${record.validation_snapshot.status}`,
    `Chain status: ${record.context_snapshot.chain_status}`,
  ].join("\n");
}

export { getChainPersistenceDirectory };