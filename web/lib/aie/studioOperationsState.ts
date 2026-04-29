export type StudioOperationsStatus =
  | "nominal"
  | "needs_attention"
  | "blocked"
  | "recovering"
  | "paused"
  | "overloaded";

export type StudioResourcePressure = "low" | "medium" | "high" | "critical";

export type StudioPriorityWorkItem = {
  id: string;
  title: string;
  kind: "goal" | "review" | "delivery" | "session" | "chain";
  priority: "critical" | "high" | "medium" | "low";
  status: string;
  summary: string;
};

export type StudioRiskSeverity = "high" | "medium" | "low";

export type StudioRiskItem = {
  id: string;
  source: string;
  severity: StudioRiskSeverity;
  summary: string;
};

export type StudioRecommendedOperatorAction = {
  action: string;
  priority: "high" | "medium" | "low";
  reason: string;
};

export type StudioOperationsState = {
  studio_status: StudioOperationsStatus;
  health_score: number;
  active_session_count: number;
  blocked_session_count: number;
  paused_session_count: number;
  pending_review_count: number;
  active_delivery_count: number;
  pending_delivery_count: number;
  active_chain_count: number;
  blocked_chain_count: number;
  resource_pressure: StudioResourcePressure;
  top_priority_work: StudioPriorityWorkItem[];
  recent_risks: StudioRiskItem[];
  recommended_operator_actions: StudioRecommendedOperatorAction[];
  last_updated_at: string;
};

export type StudioRiskAcknowledgement = {
  risk_id: string;
  acknowledged_at: string;
};