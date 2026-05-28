import React from 'react';

export default function RollbackPanel({ view }: { view: any }) {
  return (
    <div className="p-4 bg-white rounded shadow-sm">
      <h3 className="font-semibold mb-2">Rollback</h3>
      <div className="text-sm">
        <div><strong>Rollback Ready:</strong> {view.rollbackReady ? 'YES' : 'NO'}</div>
        <div><strong>Snapshot References:</strong></div>
        <ul className="list-disc ml-5">
          <li>before-snapshot-20260526.json</li>
          <li>after-snapshot-20260526.json</li>
        </ul>
        <div className="mt-2"><strong>Rollback Metadata:</strong> receipts/rollback-metadata-EXEC-0052-H.json</div>
      </div>
    </div>
  );
}
