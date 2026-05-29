"use client";

import { useState } from "react";

export default function WorkflowControls({ proposalId, sandboxId }: { proposalId?: string; sandboxId?: string }) {
  const [status, setStatus] = useState<string>("IDLE");
  const [message, setMessage] = useState<string | null>(null);

  const APPROVAL_TOKEN = "operator-approved";

  async function runWorkflow() {
    setStatus("RUNNING");
    setMessage(null);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    try {
      const res = await fetch("/api/operator/sandbox-workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposalId: proposalId || `proposal-${Date.now()}-exec0052h`,
          approvalToken: APPROVAL_TOKEN,
          authorization: {
            authorityToken: APPROVAL_TOKEN,
            approvedBy: "operator",
            approvedAt: new Date().toISOString(),
            proposalId: proposalId || `proposal-${Date.now()}-exec0052h`,
            operationRequest: "governed-multi-step-workflow",
          },
          expiresAt,
          operatorId: "operator",
          sandboxId: sandboxId,
        }),
      });
      const data = await res.json();
      if (!res.ok || data?.error) {
        setStatus("FAILED");
        setMessage(typeof data?.error === "string" ? data.error : "Execution failed");
        return;
      }
      setStatus(data.outcome === "completed" ? "COMPLETED" : data.outcome?.toUpperCase() || "DONE");
      // Refresh the page to load new receipts and timeline
      window.location.reload();
    } catch (err) {
      setStatus("FAILED");
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  function refresh() {
    setStatus("REFRESHING");
    window.location.reload();
  }

  async function resetProposalIdentity() {
    setStatus("RESETTING");
    setMessage(null);
    try {
      const res = await fetch("/api/operator/reset-proposal-identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sandboxId: sandboxId }),
      });
      const data = await res.json();
      if (!res.ok || data?.error) {
        setStatus("FAILED");
        setMessage(typeof data?.error === "string" ? data.error : "Reset failed");
        return;
      }
      setStatus("RESET_DONE");
      // reload to reflect reset state
      window.location.reload();
    } catch (err) {
      setStatus("FAILED");
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 mb-4">
      <div className="flex items-center gap-3">
        <button onClick={runWorkflow} className="px-3 py-2 bg-blue-600 text-white rounded font-semibold" disabled={status === "RUNNING" || status === "RESETTING"}>
          {status === "RUNNING" ? "Running…" : "RUN WORKFLOW"}
        </button>
        <button onClick={refresh} className="px-3 py-2 bg-gray-200 text-gray-900 rounded" disabled={status === "RUNNING"}>
          REFRESH
        </button>
        <button onClick={resetProposalIdentity} className="px-3 py-2 bg-yellow-500 text-black rounded font-semibold" disabled={status === "RUNNING" || status === "RESETTING"}>
          RESET PROPOSAL IDENTITY
        </button>
      </div>
      <div className="text-sm text-gray-600">
        <div>Status: <span className="font-mono">{status}</span></div>
        {message && <div className="text-xs text-red-600">{message}</div>}
      </div>
    </div>
  );
}
