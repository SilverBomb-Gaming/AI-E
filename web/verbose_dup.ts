import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

async function runVerbose() {
  const logicModule = await import(pathToFileURL(resolve(process.cwd(), "components/analysisResultLogic.ts")).href);
  const { deriveAnalysisResultSignals } = logicModule;

  const problem = "Sprint speed flickers after I added a stamina limiter. The limiter writes run speed in Update, but the locomotion controller also writes speed later in the same frame, so movement keeps bouncing between two values.";
  const response = await fetch("http://localhost:3000/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ problemDescription: problem }),
  });
  const result = await response.json();
  const derived = deriveAnalysisResultSignals({ result, problemDescription: problem, isRefined: false });
  
  console.log(JSON.stringify({
    what_happened: result.what_happened,
    signals: {
      mode: derived.recommendedDebuggingMode,
      confidence: derived.confidenceLevel
    }
  }, null, 2));
}
runVerbose().catch(e => { console.error(e); process.exit(1); });
