export interface OperatorViewSnapshot {
  timestamp: string;
  nodes: {
    id: string;
    status: "healthy" | "unhealthy";
    readiness: number;
    lastHealthCheck: string;
  }[];
  summary: {
    totalNodes: number;
    readyNodes: number;
    unhealthyNodes: number;
  };
  routing: {
    lastSimulation: string | null;
    candidates: {
      nodeId: string;
      score: number;
    }[];
    selectedNode: string | null;
  };
  dispatch: {
    recent: {
      intent: string;
      targetNode: string;
      result: "simulated" | "blocked";
      timestamp: string;
    }[];
  };
  safety: {
    readOnly: true;
    executionEnabled: false;
  };
}