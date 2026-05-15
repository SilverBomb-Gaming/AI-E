console.log("Starting test script...");
import crypto from "crypto";
import { normalizeExecutionGoal } from "./lib/aie/executionSession";

async function test() {
  try {
    console.log("Normalizing goal...");
    const goal = normalizeExecutionGoal("test problem");
    console.log("Goal normalized:", goal);
    
    console.log("Trying fetch...");
    const res = await fetch("http://localhost:3000/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "test", stepIndex: 1, history: [] })
    });
    console.log("Fetch status:", res.status);
    const data = await res.json();
    console.log("Data received:", !!data);
  } catch (e) {
    console.error("Test error:", e);
  }
}
test();
