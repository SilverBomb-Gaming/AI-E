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
  // Resolve possible repository root locations. Next server may run with cwd at `/web`.
  const cwd = process.cwd();
  const candidates = [cwd, path.resolve(cwd, '..'), path.resolve(cwd, '..', '..')];
  let receiptsDir = '';
  for (const c of candidates) {
    const candidate = path.join(c, '.ai-e', 'sandboxes', sandboxId, 'receipts');
    if (fs.existsSync(candidate)) {
      receiptsDir = candidate;
      break;
    }
  }
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
    if (!receiptsDir) return result;

    // Helper: find first matching file by prefix
    const files = fs.readdirSync(receiptsDir);
    const find = (pattern: RegExp) => files.find((f) => pattern.test(f));

    const receiptFile = find(/^receipt-.*executed.*\.json$/) || find(/^receipt-.*\.json$/);
    if (receiptFile) {
      const receipt = JSON.parse(fs.readFileSync(path.join(receiptsDir, receiptFile), 'utf8'));
      result.receiptId = typeof receipt.receiptId === 'string' ? receipt.receiptId : '';
      result.proposalId = typeof receipt.manifestVersion === 'string' ? receipt.manifestVersion : result.proposalId;
      // Prefer sandboxRelativePath if present for concise listing
      const affected = Array.isArray(receipt.affectedFiles) ? receipt.affectedFiles : [];
      result.mutatedFiles = affected
        .map((f: any) => f && (f.path?.sandboxRelativePath || f.path?.relativePath || f.path?.absolutePath || ''))
        .filter((x: any) => typeof x === 'string' && x.length > 0);
      // expose createdAt if present
      if (receipt.createdAt) result.lifecycle = [{ step: 'queued', at: String(receipt.createdAt) }];
    }

    const lifecycleFile = find(/^lifecycle-trace.*\.json$/);
    if (lifecycleFile) {
      const lifecycleRaw = JSON.parse(fs.readFileSync(path.join(receiptsDir, lifecycleFile), 'utf8'));
      // lifecycle files may store lifecycle under the root or nested field
      let candidate = lifecycleRaw.lifecycle || lifecycleRaw.trace || lifecycleRaw;
      // Normalize to array of {step, at}
      if (Array.isArray(candidate)) {
        const allowed: WorkflowStep[] = [
          'queued',
          'authorization_verified',
          'replay_verified',
          'dispatching',
          'running_step_1',
          'running_step_2',
          'running_step_3',
          'completed',
          'replay_rejected'
        ];
        result.lifecycle = candidate
          .map((it: any) => ({ step: String(it.step || it.status || ''), at: String(it.at || it.time || it.timestamp || '') }))
          .filter((it: any) => it.step && it.at && allowed.includes(it.step as WorkflowStep)) as { step: WorkflowStep; at: string }[];
      }
    }

    const summaryFile = find(/^workflow-summary.*\.json$/) || find(/^summary.*\.json$/);
    if (summaryFile) {
      const summary = JSON.parse(fs.readFileSync(path.join(receiptsDir, summaryFile), 'utf8'));
      result.summary = typeof summary.summary === 'string' ? summary.summary : (Array.isArray(summary.steps) ? summary.steps.join('\n') : JSON.stringify(summary));
    }

    const rollbackFile = find(/^rollback-metadata.*\.json$/);
    if (rollbackFile) {
      const rb = JSON.parse(fs.readFileSync(path.join(receiptsDir, rollbackFile), 'utf8'));
      result.rollbackReady = !!rb.rollbackReady || !!rb.rollbackActions || false;
    }

    const replayFile = find(/^replay-attempt.*\.json$/) || find(/^replay.*\.json$/);
    if (replayFile) {
      const raw = JSON.parse(fs.readFileSync(path.join(receiptsDir, replayFile), 'utf8'));
      // Normalize common fields
      result.replayAttempt = {
        result: raw.result || raw.status || '',
        reason: raw.reason || raw.message || '',
        attemptedAt: raw.attemptedAt || raw.at || raw.timestamp || ''
      };
    }
  } catch (err) {
    // swallow — UI will show missing data
    // eslint-disable-next-line no-console
    console.error('operatorWorkflowView load error:', err);
  }

  return result;
}
