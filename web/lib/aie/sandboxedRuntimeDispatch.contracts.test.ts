// AI-E GOVERNED DISPATCH CONTRACT VALIDATION TESTS (EXEC-0051-A)
// This file validates the contract types/interfaces for bounded dispatch, approval, sandbox mutation, runtime invocation, rollback, and receipt.
// NO runtime execution, NO backend wiring, NO shell, NO production mutation.

import {
  GovernedExecutionApproval,
  ApprovalVerificationResult,
  ApprovalAuthorityToken,
  GovernedSandboxMutationScope,
  AllowedMutationPath,
  SandboxMutationValidationResult,
  GovernedRuntimeDispatchContract,
  RuntimeInvocationBoundary,
  RuntimeDispatchResult,
  DispatchLifecycleRecord,
  GovernedRollbackContract,
  RollbackMetadata,
  RollbackVerificationResult,
  GovernedDispatchReceiptContract,
  DispatchEvidenceRecord
} from './sandboxedRuntimeDispatch';

// Minimal type-level contract validation (compile-time only)
const approval: GovernedExecutionApproval = {
  authorityToken: 'token' as ApprovalAuthorityToken,
  approvedBy: 'operator1',
  approvedAt: new Date().toISOString(),
  proposalId: 'proposal-123',
  operationRequest: 'run sandboxed task'
};

const approvalVerification: ApprovalVerificationResult = {
  valid: true,
  reason: undefined,
  checkedAt: new Date().toISOString(),
  authorityToken: approval.authorityToken
};

const mutationScope: GovernedSandboxMutationScope = {
  allowedPaths: [{ sandboxRelativePath: 'sandbox/file.txt', description: 'Test file' }],
  forbiddenPaths: ['sandbox/forbidden.txt'],
  enforceBoundaries: true
};

const mutationValidation: SandboxMutationValidationResult = {
  valid: true,
  attemptedPath: 'sandbox/file.txt',
  reason: undefined,
  checkedAt: new Date().toISOString()
};

const invocationBoundary: RuntimeInvocationBoundary = {
  timeoutMs: 10000,
  maxStdoutBytes: 1024,
  maxStderrBytes: 1024,
  allowShell: false,
  allowNetwork: false,
  allowProductionMutation: false
};

const lifecycle: DispatchLifecycleRecord[] = [
  { state: 'awaiting_approval', timestamp: new Date().toISOString() }
];

const dispatchContract: GovernedRuntimeDispatchContract = {
  dispatchId: 'dispatch-001',
  runtime: 'node',
  operationRequest: 'echo hello',
  approval,
  mutationScope,
  invocationBoundary,
  lifecycle
};

const dispatchResult: RuntimeDispatchResult = {
  dispatchId: 'dispatch-001',
  startedAt: new Date().toISOString(),
  completedAt: new Date().toISOString(),
  outcome: 'completed',
  stdout: 'hello',
  stderr: [],
  error: undefined
};

const rollbackMetadata: RollbackMetadata = {
  changedFiles: ['sandbox/file.txt'],
  diffSummary: 'Added file.txt',
  createdAt: new Date().toISOString()
};

const rollbackVerification: RollbackVerificationResult = {
  valid: true,
  reason: undefined,
  checkedAt: new Date().toISOString()
};

const rollbackContract: GovernedRollbackContract = {
  rollbackReady: true,
  beforeSnapshotId: 'snap-001',
  afterSnapshotId: 'snap-002',
  rollbackMetadata,
  verification: rollbackVerification
};

const evidence: DispatchEvidenceRecord = {
  changedFiles: ['sandbox/file.txt'],
  diffEntries: [],
  beforeSnapshotId: 'snap-001',
  afterSnapshotId: 'snap-002',
  mutationScope,
  approval
};

const receiptContract: GovernedDispatchReceiptContract = {
  receiptId: 'receipt-001',
  dispatchId: 'dispatch-001',
  issuedAt: new Date().toISOString(),
  issuedBy: 'operator1',
  evidence,
  lifecycle,
  atomic: true
};

// If this file type-checks, the contract is structurally valid.
export {};
