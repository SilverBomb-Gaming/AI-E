// Script: Simulate EXEC-0052-H workflow lifecycle inside sandbox
// NOTE: This script is safe to run locally. It only reads/writes inside .ai-e sandbox folder.

const fs = require('fs');
const path = require('path');

const sandboxRoot = path.join(__dirname, '..', '.ai-e', 'sandboxes', 'sandbox-EXEC-0052-H-execution');
const receiptsDir = path.join(sandboxRoot, 'receipts');

function loadJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function runLifecycle() {
  const receipt = loadJSON(path.join(receiptsDir, 'receipt-20260526-executed.json'));
  const summary = loadJSON(path.join(receiptsDir, 'workflow-summary-EXEC-0052-H.json'));
  const rollback = loadJSON(path.join(receiptsDir, 'rollback-metadata-EXEC-0052-H.json'));

  const lifecycle = [
    'queued',
    'authorization_verified',
    'replay_verified',
    'dispatching',
    'running_step_1',
    'running_step_2',
    'running_step_3',
    'completed'
  ];

  const trace = lifecycle.map((s, i) => ({ step: s, at: new Date(Date.now() + i * 10).toISOString() }));

  const out = {
    proposalId: summary.proposalId || 'EXEC-0052-H',
    receiptId: receipt.receiptId,
    sandboxId: receipt.sandboxId,
    lifecycle: trace,
    mutatedFiles: receipt.affectedFiles.map(f => f.path.relativePath)
  };

  fs.writeFileSync(path.join(receiptsDir, 'lifecycle-trace-20260526.json'), JSON.stringify(out, null, 2));
  console.log('Wrote lifecycle trace.');

  // Produce a replay attempt record: the system must reject replays with same proposal identity
  const replayAttempt = {
    proposalId: out.proposalId,
    attemptedAt: new Date().toISOString(),
    result: 'replay_rejected',
    reason: 'Proposal identity already executed; operator must reset identity to replay.'
  };
  fs.writeFileSync(path.join(receiptsDir, 'replay-attempt-20260526.json'), JSON.stringify(replayAttempt, null, 2));
  console.log('Wrote replay attempt (replay_rejected).');

  // If operator resets identity, create a reset marker file to allow re-run (simulated)
  const resetMarker = path.join(receiptsDir, 'reset-proposal-identity.marker');
  if (fs.existsSync(resetMarker)) {
    const reRun = Object.assign({}, out, { replay: 'allowed_after_reset', replayAt: new Date().toISOString() });
    fs.writeFileSync(path.join(receiptsDir, 'lifecycle-trace-20260526-replay.json'), JSON.stringify(reRun, null, 2));
    console.log('Reset marker found — wrote replay lifecycle trace.');
  } else {
    console.log('No reset marker present — replay remains rejected.');
  }
}

if (require.main === module) runLifecycle();
