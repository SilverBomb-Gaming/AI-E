import React from 'react';

export default function RollbackPanel({ view }: { view: any }) {
  return (
    <div className="p-4 bg-white rounded shadow-sm">
      <h3 className="font-semibold mb-3">Rollback</h3>
      <div className="text-sm space-y-2">
        <div className="flex items-center gap-3">
          <div className={`px-2 py-1 rounded text-sm font-semibold ${view.rollbackReady ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>{view.rollbackReady ? 'ROLLBACK READY' : 'ROLLBACK NOT READY'}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Snapshot References</div>
          <ul className="list-disc ml-5 mt-1">
            <li><code className="font-mono text-sm">before-snapshot-20260526.json</code></li>
            <li><code className="font-mono text-sm">after-snapshot-20260526.json</code></li>
          </ul>
        </div>
        <div>
          <div className="text-xs text-gray-500">Rollback Metadata</div>
          <div className="mt-1 font-mono text-sm bg-gray-50 p-2 rounded overflow-auto">receipts/rollback-metadata-EXEC-0052-H.json</div>
        </div>
      </div>
    </div>
  );
}
