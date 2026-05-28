import React from 'react';

export default function ReceiptPanel({ view }: { view: any }) {
  return (
    <div className="p-4 bg-white rounded shadow-sm">
      <h3 className="font-semibold mb-2">Receipt</h3>
      <div className="text-sm">
        <div><strong>Receipt ID:</strong> {view.receiptId || '—'}</div>
        <div><strong>Proposal ID:</strong> {view.proposalId || '—'}</div>
        <div><strong>Sandbox ID:</strong> {view.sandboxId || '—'}</div>
        <div><strong>Rollback Ready:</strong> {view.rollbackReady ? 'YES' : 'NO'}</div>
        <div><strong>Replay Protected:</strong> {view.replayAttempt ? 'REPLAY ATTEMPTED' : 'REPLAY PROTECTED'}</div>
        <div><strong>Mutated Files:</strong>
          <ul className="list-disc ml-5">
            {(view.mutatedFiles || []).map((f: string) => <li key={f}>{f}</li>)}
          </ul>
        </div>
      </div>
    </div>
  );
}
