import { deriveAnalysisResultSignals } from './components/analysisResultLogic';
import type { FreeAnalysisResponse } from './lib/aie/types';

async function test() {
    const result: FreeAnalysisResponse = {
        what_happened: "test",
        what_matters: ["test"],
        what_to_do_next: ["test"],
        upgrade_hint: "test",
        proposedAction: "test",
        expectedOutcome: "test",
    };

    try {
        console.log("Testing with current contract shape:");
        deriveAnalysisResultSignals({ result });
        console.log("Success with current contract shape");
    } catch (error) {
        console.log("Fail current contract:", error instanceof Error ? error.message : String(error));
    }

    try {
        console.log("Testing with current contract shape and prompt context:");
        deriveAnalysisResultSignals({ result, problemDescription: "test problem" });
        console.log("Success with current contract shape and prompt context");
    } catch (error) {
        console.log("Fail current contract with prompt context:", error instanceof Error ? error.message : String(error));
    }
}

test();
