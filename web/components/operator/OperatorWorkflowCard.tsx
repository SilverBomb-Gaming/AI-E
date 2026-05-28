import React from 'react';
import WorkflowTimeline from './WorkflowTimeline';
import ReceiptPanel from './ReceiptPanel';
import RollbackPanel from './RollbackPanel';
import ReplayVisualization from './ReplayVisualization';

export default function OperatorWorkflowCard({ view }: { view: any }) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="col-span-2">
        <div className="mb-4"><span className="px-2 py-1 bg-yellow-100 rounded">SANDBOX ONLY</span> <span className="px-2 py-1 bg-green-100 rounded">REAL EXECUTION</span></div>
        <WorkflowTimeline lifecycle={view.lifecycle} />
        <div className="mt-4 p-4 bg-white rounded shadow-sm">
          <h3 className="font-semibold">Workflow Summary</h3>
          <div className="text-sm mt-2">{view.summary || '—'}</div>
          <div className="text-sm mt-2"><strong>Mutations:</strong></div>
          <ul className="list-disc ml-5">
            {(view.mutatedFiles || []).map((f: string) => <li key={f}>{f}</li>)}
          </ul>
        </div>
      </div>
      <div>
        <ReceiptPanel view={view} />
        <div className="mt-4"><RollbackPanel view={view} /></div>
        <div className="mt-4"><ReplayVisualization replay={view.replayAttempt} /></div>
      </div>
    </div>
  );
}
