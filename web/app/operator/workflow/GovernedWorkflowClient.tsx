"use client";

import { useState } from "react";

// =====================================================================================
// LOCAL TYPES (mirror server-side GovernedWorkflowResult without importing server code)
// =====================================================================================

type WorkflowLifecycleState =
  | "queued"
  | "authorization_verified"
  | "replay_verified"
  | "workflow_started"
  | "feature_patch_running"
  | "feature_patch_completed"
  | "gameplay_config_running"
  | "gameplay_config_completed"
  | "rollback_chain_created"
  | "receipt_aggregation_completed"
  | "completed"
  | "replay_rejected"
  | "failed";

type WorkflowLifecycleRecord = {
  state: WorkflowLifecycleState;
  timestamp: string;
  message?: string;
};

type WorkflowMutationStep = {
  stepIndex: number;
  stepId: string;
  operationRequest: string;
  dispatchId: string;
  invocationId: string;
  sandboxId: string;
  outcome: string;
  affectedFiles: string[];
  receiptId: string;
};

type WorkflowRollbackStep = {
  stepIndex: number;
  stepId: string;
  affectedFiles: string[];
  beforeSnapshotId: string;
  afterSnapshotId: string;
  diffSummary: string;
  restorationReady: boolean;
};

type WorkflowStepReceiptSummary = {
  dispatchId: string;
  invocationId: string;
  receiptId: string;
  affectedFiles: string[];
  outcome: string;
};

type WorkflowReceiptAggregation = {
  aggregationId: string;
  workflowId: string;
  proposalId: string;
  operatorId: string;
  sandboxId: string;
  sandboxRootPath: string;
  featurePatchMutation: WorkflowStepReceiptSummary;
  gameplayConfigMutation: WorkflowStepReceiptSummary;
  totalAffectedFiles: string[];
  dispatchReferences: string[];
  rollbackChainReferences: string[];
  runtimeIds: string[];
  aggregatedAt: string;
};

type GovernedWorkflowResult = {
  manifestVersion: "EXEC-0052-H";
  outcome: "completed" | "failed" | "replay_rejected";
  workflowId: string;
  proposalId: string;
  operatorId: string;
  sandboxId: string;
  sandboxRootPath: string;
  lifecycle: WorkflowLifecycleRecord[];
  mutationChain: { steps: WorkflowMutationStep[]; totalFilesAffected: string[]; completedAt: string };
  rollbackChain: { steps: WorkflowRollbackStep[]; rollbackReady: boolean; createdAt: string };
  receiptAggregation: WorkflowReceiptAggregation;
  executedAt: string;
  durationMs: number;
  error?: string;
  proposalReplayRejectionReceipt?: {
    proposalId: string;
    originalDispatchId: string;
    originalSandboxId: string;
    replayRejectionReason: string;
    attemptedAt: string;
  };
};

// =====================================================================================
// CONSTANTS
// =====================================================================================

const APPROVAL_TOKEN = "operator-approved";
const ORDERED_LIFECYCLE_STATES: WorkflowLifecycleState[] = [
  "queued",
  "authorization_verified",
  "replay_verified",
  "workflow_started",
  "feature_patch_running",
  "feature_patch_completed",
  "gameplay_config_running",
  "gameplay_config_completed",
  "rollback_chain_created",
  "receipt_aggregation_completed",
  "completed",
];

const LIFECYCLE_LABELS: Record<WorkflowLifecycleState, string> = {
  queued: "Queued",
  authorization_verified: "Authorization Verified",
  replay_verified: "Replay Verified",
  workflow_started: "Workflow Started",
  feature_patch_running: "Feature Patch Running",
  feature_patch_completed: "Feature Patch Completed",
  gameplay_config_running: "Gameplay Config Running",
  gameplay_config_completed: "Gameplay Config Completed",
  rollback_chain_created: "Rollback Chain Created",
  receipt_aggregation_completed: "Receipt Aggregation Completed",
  completed: "Completed",
  replay_rejected: "Replay Rejected",
  failed: "Failed",
};

// =====================================================================================
// HELPERS
// =====================================================================================

function makeProposalId(): string {
  return `proposal-${Date.now()}-exec0052h`;
}

function makeAuthorization(proposalId: string) {
  return {
    authorityToken: APPROVAL_TOKEN,
    approvedBy: "operator",
    approvedAt: new Date().toISOString(),
    proposalId,
    operationRequest: "governed-multi-step-workflow",
  };
}

function lifecycleStateColor(state: WorkflowLifecycleState): string {
  if (state === "completed") return "#22c55e";
  if (state === "failed" || state === "replay_rejected") return "#ef4444";
  if (
    state === "feature_patch_running" ||
    state === "gameplay_config_running"
  ) return "#f59e0b";
  return "#60a5fa";
}

function outcomeColor(outcome: string): string {
  if (outcome === "completed") return "#22c55e";
  if (outcome === "failed" || outcome === "replay_rejected") return "#ef4444";
  return "#f59e0b";
}

// =====================================================================================
// SUB-COMPONENTS
// =====================================================================================

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 10px",
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: 1,
      background: color,
      color: "#000",
    }}>
      {label}
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", letterSpacing: 2, marginBottom: 8, textTransform: "uppercase" }}>
      {children}
    </div>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: "#111",
      border: "1px solid #222",
      borderRadius: 6,
      padding: "16px 20px",
      marginBottom: 16,
      ...style,
    }}>
      {children}
    </div>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontFamily: "monospace", fontSize: 12, color: "#d1d5db" }}>
      {children}
    </span>
  );
}

function LifecycleTimeline({
  lifecycle,
  outcome,
}: {
  lifecycle: WorkflowLifecycleRecord[];
  outcome: string;
}) {
  const seenStates = new Set(lifecycle.map((r) => r.state));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {ORDERED_LIFECYCLE_STATES.map((state) => {
        const record = lifecycle.find((r) => r.state === state);
        const isDone = seenStates.has(state);
        const isFailed = outcome === "failed" || outcome === "replay_rejected";

        return (
          <div key={state} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <div style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              marginTop: 3,
              flexShrink: 0,
              background: isDone
                ? (state === "completed" && !isFailed ? "#22c55e" : lifecycleStateColor(state))
                : "#374151",
              border: isDone ? "none" : "1px solid #4b5563",
            }} />
            <div>
              <div style={{
                fontSize: 12,
                color: isDone ? "#f3f4f6" : "#6b7280",
                fontWeight: isDone ? 600 : 400,
              }}>
                {LIFECYCLE_LABELS[state]}
              </div>
              {record?.message && (
                <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
                  {record.message}
                </div>
              )}
            </div>
          </div>
        );
      })}
      {/* Extra states for replay_rejected / failed */}
      {lifecycle.filter((r) => r.state === "replay_rejected" || r.state === "failed").map((r) => (
        <div key={r.state + r.timestamp} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{
            width: 12, height: 12, borderRadius: "50%", marginTop: 3, flexShrink: 0,
            background: "#ef4444",
          }} />
          <div>
            <div style={{ fontSize: 12, color: "#ef4444", fontWeight: 700 }}>
              {LIFECYCLE_LABELS[r.state]}
            </div>
            {r.message && (
              <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>{r.message}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function MutationChainPanel({ steps, totalFiles }: {
  steps: WorkflowMutationStep[];
  totalFiles: string[];
}) {
  return (
    <Card>
      <SectionTitle>Mutation Chain</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {steps.map((step) => (
          <div key={step.stepId} style={{
            borderLeft: "2px solid #3b82f6",
            paddingLeft: 12,
          }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
              <Badge label={`STEP ${step.stepIndex + 1}`} color="#1d4ed8" />
              <Badge label={step.outcome.toUpperCase()} color={outcomeColor(step.outcome)} />
            </div>
            <div style={{ fontSize: 12, color: "#d1d5db", marginBottom: 4 }}>
              <strong>Operation:</strong> {step.operationRequest}
            </div>
            <div style={{ fontSize: 11, color: "#9ca3af" }}>
              Dispatch: <Mono>{step.dispatchId}</Mono>
            </div>
            <div style={{ fontSize: 11, color: "#9ca3af" }}>
              Invocation: <Mono>{step.invocationId}</Mono>
            </div>
            <div style={{ fontSize: 11, color: "#9ca3af" }}>
              Receipt: <Mono>{step.receiptId || "—"}</Mono>
            </div>
            {step.affectedFiles.length > 0 && (
              <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
                Files: {step.affectedFiles.map((f) => (
                  <Mono key={f}>{f} </Mono>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {totalFiles.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #222" }}>
          <div style={{ fontSize: 11, color: "#9ca3af" }}>
            Total affected: {totalFiles.map((f) => <Mono key={f}>{f} </Mono>)}
          </div>
        </div>
      )}
    </Card>
  );
}

function RollbackChainPanel({ steps, rollbackReady }: {
  steps: WorkflowRollbackStep[];
  rollbackReady: boolean;
}) {
  return (
    <Card>
      <SectionTitle>Rollback Chain</SectionTitle>
      <div style={{ marginBottom: 10 }}>
        <Badge
          label={rollbackReady ? "ROLLBACK READY" : "NOT READY"}
          color={rollbackReady ? "#22c55e" : "#6b7280"}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {steps.map((step) => (
          <div key={step.stepId} style={{
            borderLeft: "2px solid #22c55e",
            paddingLeft: 12,
          }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
              <Badge label={`STEP ${step.stepIndex + 1}`} color="#166534" />
              {step.restorationReady && <Badge label="RESTORATION READY" color="#22c55e" />}
            </div>
            <div style={{ fontSize: 11, color: "#9ca3af" }}>
              Step ID: <Mono>{step.stepId}</Mono>
            </div>
            <div style={{ fontSize: 11, color: "#9ca3af" }}>
              Diff: <Mono>{step.diffSummary || "—"}</Mono>
            </div>
            <div style={{ fontSize: 11, color: "#9ca3af" }}>
              Before snapshot: <Mono>{step.beforeSnapshotId}</Mono>
            </div>
            <div style={{ fontSize: 11, color: "#9ca3af" }}>
              After snapshot: <Mono>{step.afterSnapshotId}</Mono>
            </div>
            {step.affectedFiles.length > 0 && (
              <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
                Files: {step.affectedFiles.map((f) => <Mono key={f}>{f} </Mono>)}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function ReceiptAggregationPanel({ agg }: { agg: WorkflowReceiptAggregation }) {
  return (
    <Card>
      <SectionTitle>Aggregated Workflow Receipt</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px", marginBottom: 12 }}>
        {[
          ["Aggregation ID", agg.aggregationId],
          ["Workflow ID", agg.workflowId],
          ["Proposal ID", agg.proposalId],
          ["Operator ID", agg.operatorId],
          ["Sandbox ID", agg.sandboxId],
          ["Aggregated At", agg.aggregatedAt],
        ].map(([label, val]) => (
          <div key={label}>
            <span style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1 }}>{label}: </span>
            <Mono>{val}</Mono>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {[
          { label: "Step A — Feature Patch", data: agg.featurePatchMutation },
          { label: "Step B — Gameplay Config", data: agg.gameplayConfigMutation },
        ].map(({ label, data }) => (
          <div key={label} style={{ paddingLeft: 12, borderLeft: "2px solid #3b82f6" }}>
            <div style={{ fontSize: 11, color: "#60a5fa", fontWeight: 700, marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 11, color: "#9ca3af" }}>Dispatch: <Mono>{data.dispatchId || "—"}</Mono></div>
            <div style={{ fontSize: 11, color: "#9ca3af" }}>Receipt: <Mono>{data.receiptId || "—"}</Mono></div>
            <div style={{ fontSize: 11, color: "#9ca3af" }}>Outcome: <Mono>{data.outcome}</Mono></div>
            {data.affectedFiles.length > 0 && (
              <div style={{ fontSize: 11, color: "#9ca3af" }}>
                Files: {data.affectedFiles.map((f) => <Mono key={f}>{f} </Mono>)}
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #222", fontSize: 11, color: "#9ca3af" }}>
        <div>Dispatch refs: {agg.dispatchReferences.map((d) => <Mono key={d}>{d} </Mono>)}</div>
        <div>Rollback refs: {agg.rollbackChainReferences.map((r) => <Mono key={r}>{r} </Mono>)}</div>
        <div>Runtime IDs: {agg.runtimeIds.map((r) => <Mono key={r}>{r} </Mono>)}</div>
        <div>Total affected: {agg.totalAffectedFiles.length > 0
          ? agg.totalAffectedFiles.map((f) => <Mono key={f}>{f} </Mono>)
          : <Mono>—</Mono>}
        </div>
      </div>
    </Card>
  );
}

function ReplayRejectionPanel({ receipt }: {
  receipt: NonNullable<GovernedWorkflowResult["proposalReplayRejectionReceipt"]>;
}) {
  return (
    <Card style={{ borderColor: "#7f1d1d" }}>
      <SectionTitle>Replay Rejection Receipt</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "#9ca3af" }}>
        <div>Proposal ID: <Mono>{receipt.proposalId}</Mono></div>
        <div>Original Dispatch: <Mono>{receipt.originalDispatchId}</Mono></div>
        <div>Original Sandbox: <Mono>{receipt.originalSandboxId}</Mono></div>
        <div>Rejection Reason: <span style={{ fontFamily: "monospace", fontSize: 12, color: "#ef4444" }}>{receipt.replayRejectionReason}</span></div>
        <div>Attempted At: <Mono>{receipt.attemptedAt}</Mono></div>
      </div>
    </Card>
  );
}

// =====================================================================================
// MAIN CLIENT COMPONENT
// =====================================================================================

export function GovernedWorkflowClient() {
  const [proposalId, setProposalId] = useState<string>(() => makeProposalId());
  const [dispatchState, setDispatchState] = useState<"idle" | "running" | "done">("idle");
  const [result, setResult] = useState<GovernedWorkflowResult | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  async function handleExecuteWorkflow() {
    setDispatchState("running");
    setResult(null);
    setApiError(null);

    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    try {
      const res = await fetch("/api/operator/sandbox-workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposalId,
          approvalToken: APPROVAL_TOKEN,
          authorization: makeAuthorization(proposalId),
          expiresAt,
          operatorId: "operator",
        }),
      });
      const data = await res.json() as GovernedWorkflowResult | { error: string };
      if (!res.ok || "error" in data) {
        setApiError(("error" in data && typeof data.error === "string") ? data.error : "Unknown API error");
        setDispatchState("done");
        return;
      }
      setResult(data as GovernedWorkflowResult);
      setDispatchState("done");
    } catch (err) {
      setApiError(err instanceof Error ? err.message : String(err));
      setDispatchState("done");
    }
  }

  function handleReset() {
    setProposalId(makeProposalId());
    setResult(null);
    setApiError(null);
    setDispatchState("idle");
  }

  const isRunning = dispatchState === "running";
  const outcome = result?.outcome;

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0a0a",
      color: "#f3f4f6",
      fontFamily: "system-ui, sans-serif",
      padding: "32px 24px",
      maxWidth: 900,
      margin: "0 auto",
    }}>

      {/* Header badges */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        <Badge label="REAL EXECUTION" color="#dc2626" />
        <Badge label="EXEC-0052-H" color="#1d4ed8" />
        <Badge label="SANDBOX ONLY" color="#d97706" />
        <Badge label="REPLAY PROTECTED" color="#7c3aed" />
      </div>

      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4, marginTop: 0 }}>
        AI-E Governed Multi-Step Sandbox Workflow
      </h1>
      <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 28 }}>
        First governed sequential sandbox patch workflow · EXEC-0052-H ·
        Step A: Feature Patch · Step B: Gameplay Config
      </div>

      {/* Proposal identity */}
      <Card>
        <SectionTitle>Proposal Identity</SectionTitle>
        <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 10 }}>
          Workflow ID: <Mono>auto-generated on execution</Mono>
        </div>
        <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 14 }}>
          Proposal ID: <Mono>{proposalId}</Mono>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={handleExecuteWorkflow}
            disabled={isRunning}
            style={{
              padding: "10px 22px",
              background: isRunning ? "#374151" : "#1d4ed8",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: isRunning ? "not-allowed" : "pointer",
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {isRunning ? "Executing Workflow…" : "Approve & Execute Workflow"}
          </button>
          <button
            onClick={handleReset}
            disabled={isRunning}
            style={{
              padding: "10px 18px",
              background: "transparent",
              color: "#9ca3af",
              border: "1px solid #374151",
              borderRadius: 6,
              cursor: isRunning ? "not-allowed" : "pointer",
              fontSize: 13,
            }}
          >
            Reset Proposal Identity
          </button>
        </div>
      </Card>

      {/* API error */}
      {apiError && (
        <Card style={{ borderColor: "#7f1d1d" }}>
          <SectionTitle>API Error</SectionTitle>
          <div style={{ color: "#ef4444", fontSize: 13 }}>{apiError}</div>
        </Card>
      )}

      {/* Outcome summary */}
      {result && (
        <Card style={{
          borderColor: outcome === "completed" ? "#166534"
            : outcome === "replay_rejected" ? "#7f1d1d"
            : "#78350f",
        }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
            <Badge
              label={outcome === "completed" ? "WORKFLOW COMPLETED"
                : outcome === "replay_rejected" ? "REPLAY REJECTED"
                : "WORKFLOW FAILED"}
              color={outcomeColor(outcome ?? "failed")}
            />
            <span style={{ fontSize: 11, color: "#6b7280" }}>{result.durationMs}ms</span>
          </div>
          <div style={{ fontSize: 11, color: "#9ca3af", display: "flex", flexDirection: "column", gap: 3 }}>
            <div>Workflow ID: <Mono>{result.workflowId}</Mono></div>
            <div>Proposal ID: <Mono>{result.proposalId}</Mono></div>
            <div>Sandbox ID: <Mono>{result.sandboxId}</Mono></div>
            <div>Operator ID: <Mono>{result.operatorId}</Mono></div>
            <div>Executed At: <Mono>{result.executedAt}</Mono></div>
          </div>
          {result.error && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#ef4444" }}>{result.error}</div>
          )}
        </Card>
      )}

      {/* Lifecycle timeline */}
      {result && (
        <Card>
          <SectionTitle>Workflow Lifecycle</SectionTitle>
          <LifecycleTimeline lifecycle={result.lifecycle} outcome={outcome ?? "failed"} />
        </Card>
      )}

      {/* Replay rejection receipt */}
      {result?.proposalReplayRejectionReceipt && (
        <ReplayRejectionPanel receipt={result.proposalReplayRejectionReceipt} />
      )}

      {/* Mutation chain */}
      {result && outcome === "completed" && result.mutationChain.steps.length > 0 && (
        <MutationChainPanel
          steps={result.mutationChain.steps}
          totalFiles={result.mutationChain.totalFilesAffected}
        />
      )}

      {/* Rollback chain */}
      {result && outcome === "completed" && result.rollbackChain.steps.length > 0 && (
        <RollbackChainPanel
          steps={result.rollbackChain.steps}
          rollbackReady={result.rollbackChain.rollbackReady}
        />
      )}

      {/* Aggregated receipt */}
      {result && outcome === "completed" && (
        <ReceiptAggregationPanel agg={result.receiptAggregation} />
      )}

      {/* Affected files summary */}
      {result && outcome === "completed" && result.mutationChain.totalFilesAffected.length > 0 && (
        <Card>
          <SectionTitle>Affected Files</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {result.mutationChain.totalFilesAffected.map((f) => (
              <div key={f} style={{ fontSize: 12, color: "#d1d5db" }}>
                <span style={{ color: "#22c55e", marginRight: 8 }}>●</span>
                <Mono>{f}</Mono>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Safety boundary footer */}
      <div style={{
        marginTop: 32,
        paddingTop: 16,
        borderTop: "1px solid #1f2937",
        fontSize: 10,
        color: "#4b5563",
        lineHeight: 1.8,
      }}>
        <strong style={{ color: "#6b7280" }}>Safety Boundary (EXEC-0052-H):</strong><br />
        Sandbox-scoped only · No shell execution · No network access · No production mutation ·
        No autonomous continuation · No recursive orchestration · Human authority final ·
        Operator approval required · Replay protected · Rollback ready
      </div>
    </div>
  );
}
