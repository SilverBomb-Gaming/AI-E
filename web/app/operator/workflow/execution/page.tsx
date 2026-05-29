import React from 'react';
import OperatorWorkflowCard from '../../../../components/operator/OperatorWorkflowCard';
import { loadSandboxWorkflowView, OperatorWorkflowView } from '../../../../lib/aie/operatorWorkflowView';

export default function OperatorWorkflowExecutionPage() {
  let view: OperatorWorkflowView | null = null;
  try {
    // Load synchronously on the server. Guard against any unexpected runtime errors.
    view = loadSandboxWorkflowView();
  } catch (err) {
    // swallow here — we'll render a clear fallback below instead of crashing the route
    // Keep `view` null to indicate failure to load data.
    // eslint-disable-next-line no-console
    console.error('Failed to load sandbox workflow view:', err);
    view = null;
  }

  if (!view) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-4">Operator Console — Workflow Execution</h1>
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded">
          <h2 className="font-semibold">No workflow data available</h2>
          <p className="text-sm mt-2">The Operator UI could not load execution receipts. This may indicate missing sandbox artifacts or a temporary filesystem access issue. The page will not crash; please check the sandbox receipts under <code>.ai-e/sandboxes/</code>.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mx-auto max-w-7xl">
        <h1 className="text-3xl font-bold mb-6">Operator Console — Workflow Execution</h1>
        <OperatorWorkflowCard view={view} />
      </div>
    </div>
  );
}
