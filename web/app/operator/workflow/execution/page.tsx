import React from 'react';
import OperatorWorkflowCard from '../../../../components/operator/OperatorWorkflowCard';
import { loadSandboxWorkflowView } from '../../../../lib/aie/operatorWorkflowView';

export default function OperatorWorkflowExecutionPage() {
  const view = loadSandboxWorkflowView();

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Operator Console — Workflow Execution</h1>
      <OperatorWorkflowCard view={view} />
    </div>
  );
}
