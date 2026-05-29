import React from 'react';
import WorkflowTimeline from './WorkflowTimeline';
import WorkflowControls from './WorkflowControls';
import ReceiptPanel from './ReceiptPanel';
import RollbackPanel from './RollbackPanel';
import ReplayVisualization from './ReplayVisualization';

export default function OperatorWorkflowCard({ view }: { view: any }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
      <div className="lg:col-span-2">
        <div className="flex flex-col md:flex-row md:justify-between md:items-start mb-4">
          <div className="flex flex-wrap items-center gap-3 mb-3 md:mb-0">
            <span className="px-2 py-1 bg-yellow-100 text-xs rounded font-semibold">SANDBOX ONLY</span>
            <span className="px-2 py-1 bg-green-100 text-xs rounded font-semibold">REAL EXECUTION</span>
          </div>
          <div className="w-full md:w-1/2">
            <WorkflowControls proposalId={view.proposalId} sandboxId={view.sandboxId} />
          </div>
        </div>
        <WorkflowTimeline lifecycle={view.lifecycle} />
        <div className="mt-5 p-6 bg-white rounded shadow-sm">
          <h3 className="font-semibold text-lg">Workflow Summary</h3>
          <div className="text-sm mt-3 leading-relaxed whitespace-pre-wrap">{view.summary || '—'}</div>
          <div className="text-sm mt-4"><strong>Mutations:</strong></div>
          <div className="mt-2 bg-gray-50 p-3 rounded overflow-auto">
            <ul className="list-disc ml-5">
              {(view.mutatedFiles || []).map((f: string) => (
                <li key={f}><code className="font-mono text-sm break-all">{f}</code></li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      <aside className="space-y-4">
        <ReceiptPanel view={view} />
        <RollbackPanel view={view} />
        <ReplayVisualization replay={view.replayAttempt} />
      </aside>
    </div>
  );
}
