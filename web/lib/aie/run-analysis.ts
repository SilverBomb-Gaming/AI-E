import { spawn } from "node:child_process";
import path from "node:path";

import type { AnalysisInput, FreeAnalysisResponse } from "@/lib/aie/types";

type BackendError = Error & { statusCode?: number };

function buildBackendUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  return `${trimmed}/analyze`;
}

async function callRemoteBackend(input: AnalysisInput): Promise<FreeAnalysisResponse> {
  const backendUrl = process.env.AIE_ANALYSIS_BACKEND_URL;
  if (!backendUrl) {
    throw new Error("Missing AIE_ANALYSIS_BACKEND_URL.");
  }

  const response = await fetch(buildBackendUrl(backendUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
    cache: "no-store",
  });

  if (!response.ok) {
    const error = new Error("Remote analysis backend failed.") as BackendError;
    error.statusCode = response.status;
    throw error;
  }

  return (await response.json()) as FreeAnalysisResponse;
}

async function callLocalPythonAdapter(input: AnalysisInput): Promise<FreeAnalysisResponse> {
  const pythonBinary =
    process.env.AIE_PYTHON_BIN ||
    (process.platform === "win32"
      ? path.join(process.cwd(), "..", ".venv", "Scripts", "python.exe")
      : "python3");

  const scriptPath = path.join(process.cwd(), "..", "analysis_service", "run_free_analysis.py");

  return await new Promise<FreeAnalysisResponse>((resolve, reject) => {
    const child = spawn(pythonBinary, [scriptPath], {
      cwd: path.join(process.cwd(), ".."),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let didTimeout = false;

    const timeout = setTimeout(() => {
      didTimeout = true;
      child.kill();
    }, 20_000);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (didTimeout) {
        reject(new Error("Local analysis timed out."));
        return;
      }
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Local analysis exited with code ${code}.`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as FreeAnalysisResponse);
      } catch {
        reject(new Error("Local analysis returned invalid JSON."));
      }
    });

    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}

export async function runAnalysis(input: AnalysisInput): Promise<FreeAnalysisResponse> {
  if (process.env.AIE_ANALYSIS_BACKEND_URL) {
    return await callRemoteBackend(input);
  }

  return await callLocalPythonAdapter(input);
}