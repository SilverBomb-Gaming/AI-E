const fs = require('fs');
const path = require('path');
const assert = require('assert');

const sandboxRoot = path.join(__dirname, '..', '.ai-e', 'sandboxes', 'sandbox-EXEC-0052-H-execution');
const receiptsDir = path.join(sandboxRoot, 'receipts');

function loadJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function main() {
  const receipt = loadJSON(path.join(receiptsDir, 'receipt-20260526-executed.json'));
  assert.strictEqual(receipt.sandboxId, 'sandbox-EXEC-0052-H-execution');

  const after = loadJSON(path.join(receiptsDir, 'after-snapshot-20260526.json'));
  assert.ok(after.files.some(f => f.relativePath.includes('gameplayHelpers.cs')));

  const summary = loadJSON(path.join(receiptsDir, 'workflow-summary-EXEC-0052-H.json'));
  assert.strictEqual(summary.proposalId, 'EXEC-0052-H');

  const cfg = loadJSON(path.join(sandboxRoot, 'workspace', 'sandboxGameplayConfig.json'));
  assert.strictEqual(cfg.gameplay.staminaRegenRate, 1.0);

  console.log('All EXEC-0052-H checks passed.');
}

if (require.main === module) main();
