// AI-E GOVERNED PROPOSAL REPLAY REGISTRY (EXEC-0052-F)
//
// Proposal-scoped replay protection layer. Enforces that each proposal (identified
// by proposalId + approvalToken + operationRequest fingerprint) can only execute once,
// regardless of sandbox identity, runtime identity, or dispatch identity.
//
// Three independent replay guards:
//   1. Exact fingerprint match (proposalId + approvalToken + operationRequest)
//   2. ProposalId-only match (catches cross-sandbox replay with same proposal)
//   3. ApprovalToken-only match (catches token reuse across different operations)
//
// The existing sandbox-scoped replay protection in dispatchAuthorizationBoundary
// is preserved and complementary — this is an additional governance layer on top.
//
// Module-level singleton: proposalReplayRegistry (in-memory, per-server-process lifecycle)
//
// NO child_process. NO shell. NO spawn/exec/execFile. NO network.
// NO production mutation. NO autonomous continuation. Human authority final.

// =====================================================================================
// TYPES
// =====================================================================================

export type ProposalExecutionFingerprint = string & { readonly __fingerprint: unique symbol };

export type ProposalExecutionRecord = {
  fingerprint: ProposalExecutionFingerprint;
  proposalId: string;
  approvalToken: string;
  operationRequest: string;
  sandboxId: string;
  dispatchId: string;
  invocationId: string;
  runtimeType: string;
  adapterId: string;
  outcome: "completed" | "failed" | "timeout";
  executedAt: string;
  operatorId: string;
};

export type ProposalReplayVerificationResult = {
  isReplay: boolean;
  fingerprint: ProposalExecutionFingerprint;
  existingRecord?: ProposalExecutionRecord;
  checkedAt: string;
  reason?: string;
};

export type ProposalReplayRejectionReceipt = {
  proposalId: string;
  originalDispatchId: string;
  originalSandboxId: string;
  originalRuntimeType: string;
  replayRejectionReason: string;
  attemptedAt: string;
  operatorId: string;
  replayFingerprint: ProposalExecutionFingerprint;
};

export type GovernedProposalReplayRegistry = {
  records: Map<ProposalExecutionFingerprint, ProposalExecutionRecord>;
  proposalIds: Set<string>;
};

// =====================================================================================
// FACTORY
// =====================================================================================

export function createGovernedProposalReplayRegistry(): GovernedProposalReplayRegistry {
  return {
    records: new Map(),
    proposalIds: new Set(),
  };
}

export const proposalReplayRegistry: GovernedProposalReplayRegistry = createGovernedProposalReplayRegistry();

// =====================================================================================
// FINGERPRINT
// =====================================================================================

export function createProposalExecutionFingerprint(params: {
  proposalId: string;
  approvalToken: string;
  operationRequest: string;
}): ProposalExecutionFingerprint {
  return `${params.proposalId}::${params.approvalToken}::${params.operationRequest}` as ProposalExecutionFingerprint;
}

// =====================================================================================
// VERIFICATION
// =====================================================================================

export function verifyProposalNotReplayed(
  registry: GovernedProposalReplayRegistry,
  params: {
    proposalId: string;
    approvalToken: string;
    operationRequest: string;
  },
  now?: string,
): ProposalReplayVerificationResult {
  const checkedAt = now ?? new Date().toISOString();
  const fingerprint = createProposalExecutionFingerprint(params);

  const byFingerprint = registry.records.get(fingerprint);
  if (byFingerprint) {
    return {
      isReplay: true,
      fingerprint,
      existingRecord: byFingerprint,
      checkedAt,
      reason: "proposal-fingerprint-already-executed",
    };
  }

  if (registry.proposalIds.has(params.proposalId)) {
    const existing = [...registry.records.values()].find((r) => r.proposalId === params.proposalId);
    return {
      isReplay: true,
      fingerprint,
      existingRecord: existing,
      checkedAt,
      reason: "proposal-id-already-executed",
    };
  }

  return { isReplay: false, fingerprint, checkedAt };
}

// =====================================================================================
// RECORD EXECUTION
// =====================================================================================

export function recordProposalExecution(
  registry: GovernedProposalReplayRegistry,
  record: ProposalExecutionRecord,
): void {
  registry.records.set(record.fingerprint, record);
  registry.proposalIds.add(record.proposalId);
}

// =====================================================================================
// REPLAY REJECTION RECEIPT
// =====================================================================================

export function makeProposalReplayRejectionReceipt(params: {
  proposalId: string;
  originalRecord: ProposalExecutionRecord;
  attemptedAt: string;
  operatorId: string;
  replayFingerprint: ProposalExecutionFingerprint;
  reason: string;
}): ProposalReplayRejectionReceipt {
  return {
    proposalId: params.proposalId,
    originalDispatchId: params.originalRecord.dispatchId,
    originalSandboxId: params.originalRecord.sandboxId,
    originalRuntimeType: params.originalRecord.runtimeType,
    replayRejectionReason: params.reason,
    attemptedAt: params.attemptedAt,
    operatorId: params.operatorId,
    replayFingerprint: params.replayFingerprint,
  };
}
