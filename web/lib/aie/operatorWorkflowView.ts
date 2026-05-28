import fs from 'fs';
import path from 'path';

export type WorkflowStep =
  | 'queued'
  | 'authorization_verified'
  | 'replay_verified'
  | 'dispatching'
  | 'running_step_1'
  | 'running_step_2'
  | 'running_step_3'
  | 'completed'
  | 'replay_rejected';

export interface OperatorWorkflowView {
  proposalId: string;
  receiptId: string;
  sandboxId: string;
  lifecycle?: Array<{ step: WorkflowStep; at: string }>;
  mutatedFiles?: string[];
  summary?: string;
  rollbackReady?: boolean;
  replayAttempt?: { result: string; reason: string; attemptedAt: string } | null;
}

export function loadSandboxWorkflowView(sandboxId = 'sandbox-EXEC-0052-H-execution'): OperatorWorkflowView {
  const root = process.cwd();
  const receiptsDir = path.join(root, '.ai-e', 'sandboxes', sandboxId, 'receipts');
  const result: OperatorWorkflowView = {
    proposalId: 'EXEC-0052-H',
    receiptId: '',
    sandboxId,
    lifecycle: [],
    mutatedFiles: [],
    summary: '',
    rollbackReady: false,
    replayAttempt: null
  };

  try {
    const receiptPath = path.join(receiptsDir, 'receipt-20260526-executed.json');
    if (fs.existsSync(receiptPath)) {
      const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      result.receiptId = receipt.receiptId || '';
      result.proposalId = receipt.plannedActions && receipt.plannedActions.length ? 'EXEC-0052-H' : result.proposalId;
      result.mutatedFiles = (receipt.affectedFiles || []).map((f: any) => f.path.relativePath);
    }

    const lifecyclePath = path.join(receiptsDir, 'lifecycle-trace-20260526.json');
    if (fs.existsSync(lifecyclePath)) {
      const lifecycle = JSON.parse(fs.readFileSync(lifecyclePath, 'utf8'));
      result.lifecycle = lifecycle.lifecycle || [];
    }

    const summaryPath = path.join(receiptsDir, 'workflow-summary-EXEC-0052-H.json');
    if (fs.existsSync(summaryPath)) {
      const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
      result.summary = summary.summary || '';
    }

    const rollbackPath = path.join(receiptsDir, 'rollback-metadata-EXEC-0052-H.json');
    if (fs.existsSync(rollbackPath)) {
      const rb = JSON.parse(fs.readFileSync(rollbackPath, 'utf8'));
      result.rollbackReady = !!rb.rollbackReady;
    }

    const replayPath = path.join(receiptsDir, 'replay-attempt-20260526.json');
    if (fs.existsSync(replayPath)) {
      result.replayAttempt = JSON.parse(fs.readFileSync(replayPath, 'utf8'));
    }
  } catch (err) {
    // swallow — UI will show missing data
  }

  return result;
}
