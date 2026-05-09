import type { HighIntensityApprovalSnapshot } from "./governedHighIntensityState";

export type HighIntensityApprovalInput = {
  governanceApproval: boolean;
  highProbeApproval: boolean;
};

export function buildHighIntensityApprovalSnapshot(input: HighIntensityApprovalInput): HighIntensityApprovalSnapshot {
  return {
    governanceApproval: input.governanceApproval,
    highProbeApproval: input.highProbeApproval,
    approvedHighExecution: input.governanceApproval === true && input.highProbeApproval === true,
    approvalRequired: true,
    approvalScope: "single-high-probe",
    automaticRepeatAllowed: false,
    automaticEscalationAllowed: false,
    crossRunPersistenceAllowed: false,
  };
}

export function validateHighIntensityApproval(input: HighIntensityApprovalInput): {
  approved: boolean;
  failureReason: string | null;
  recommendedRuntimeLayer: string | null;
} {
  if (!input.governanceApproval) {
    return {
      approved: false,
      failureReason: "Manual preview governance approval is required before any HIGH probe can execute.",
      recommendedRuntimeLayer: "operator governance approval",
    };
  }

  if (!input.highProbeApproval) {
    return {
      approved: false,
      failureReason: "HIGH probes require explicit operator HIGH approval before preview execution.",
      recommendedRuntimeLayer: "operator high-intensity approval",
    };
  }

  return {
    approved: true,
    failureReason: null,
    recommendedRuntimeLayer: null,
  };
}
