import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

async function runVerbose() {
  const logicModule = await import(pathToFileURL(resolve(process.cwd(), "components/analysisResultLogic.ts")).href);
  const { deriveAnalysisResultSignals } = logicModule;

  const response = await fetch("http://localhost:3000/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ problemDescription: "After refactoring the wall-jump handoff, the player only sticks on shallow slopes right after a dash. The symptom appears immediately when that movement handoff runs, while the rest of movement feels normal." }),
  });
  const result = await response.json();
  const derived = deriveAnalysisResultSignals({ result, problemDescription: "After refactoring the wall-jump handoff...", isRefined: false });
  
  console.log(JSON.stringify({
    what_happened: result.what_happened,
    what_matters: result.what_matters,
    what_to_do_next_count: result.what_to_do_next?.length,
    signals: {
      mode: derived.recommendedDebuggingMode,
      confidence: derived.confidenceLevel,
      alignedSignalCount: derived.alignedSignalCount,
      hasChain: !!derived.supervisedActionChain
    }
  }, null, 2));
}
runVerbose().catch(e => { console.error(e); process.exit(1); });
