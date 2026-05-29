import React from 'react';

export default function ReceiptPanel({ view }: { view: any }) {
  return (
    <div className="p-4 bg-white rounded shadow-sm">
      <h3 className="font-semibold mb-3">Receipt</h3>
      <div className="text-sm space-y-2">
        <div>
          <div className="text-xs text-gray-500">Receipt ID</div>
          <div className="mt-1 font-mono text-sm bg-gray-50 p-2 rounded overflow-auto break-all">{view.receiptId || '—'}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Proposal ID</div>
          <div className="mt-1 font-mono text-sm bg-gray-50 p-2 rounded overflow-auto break-all">{view.proposalId || '—'}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Sandbox ID</div>
          <div className="mt-1 font-mono text-sm bg-gray-50 p-2 rounded overflow-auto break-all">{view.sandboxId || '—'}</div>
        </div>
        <div className="flex items-center gap-2">
          <div className={`px-2 py-1 rounded text-xs ${view.rollbackReady ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>Rollback: {view.rollbackReady ? 'YES' : 'NO'}</div>
          <div className="text-xs text-gray-500">{view.replayAttempt ? 'REPLAY ATTEMPTED' : 'REPLAY PROTECTED'}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Mutated Files</div>
          <div className="mt-1 bg-gray-50 p-2 rounded overflow-auto">
            <ul className="list-disc ml-5">
              {(view.mutatedFiles || []).map((f: string) => <li key={f}><code className="font-mono text-sm">{f}</code></li>)}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
