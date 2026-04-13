import type { AnalysisInput, FreeAnalysisResponse } from "@/lib/aie/types";

type BackendError = Error & { statusCode?: number };

function buildBackendUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  return `${trimmed}/analyze`;
}

function normalizeText(value: string | undefined): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function classifyIssue(input: AnalysisInput):
  | "reference"
  | "compile"
  | "build"
  | "performance"
  | "rendering"
  | "physics"
  | "general" {
  const combined = [input.problemDescription, input.errorMessage, input.context, input.codeSnippet]
    .map((value) => normalizeText(value))
    .join(" ")
    .toLowerCase();

  if (/(nullreference|missingreference|prefab|serializefield|reference not set)/.test(combined)) {
    return "reference";
  }
  if (/(namespace|assembly definition|cannot convert|cs\d{4}|type or namespace)/.test(combined)) {
    return "compile";
  }
  if (/(build failed|gradle|il2cpp|player build|addressables build)/.test(combined)) {
    return "build";
  }
  if (/(fps|stutter|lag|memory|gc|spike|performance)/.test(combined)) {
    return "performance";
  }
  if (/(shader|material|pink|render pipeline|urp|hdrp|lighting)/.test(combined)) {
    return "rendering";
  }
  if (/(rigidbody|collider|trigger|raycast|physics)/.test(combined)) {
    return "physics";
  }
  return "general";
}

function buildFallbackAnalysis(input: AnalysisInput): FreeAnalysisResponse {
  const issueType = classifyIssue(input);
  const hasCodeSnippet = Boolean(normalizeText(input.codeSnippet));
  const hasErrorMessage = Boolean(normalizeText(input.errorMessage));
  const hasContext = Boolean(normalizeText(input.context));

  const happenedByType: Record<typeof issueType, string> = {
    reference:
      "AI-E sees a likely runtime reference-path problem: a scene object, prefab dependency, or serialized field is probably missing or arriving too late during initialization.",
    compile:
      "AI-E sees a likely compile or API-contract issue: a type, namespace, assembly boundary, or method signature no longer matches what this Unity project expects.",
    build:
      "AI-E sees a likely build-pipeline issue: the project appears to hit a packaging, platform, or player-build failure rather than a pure gameplay bug.",
    performance:
      "AI-E sees a likely performance bottleneck: the main issue looks tied to frame spikes, memory churn, or a costly runtime loop instead of a single hard exception.",
    rendering:
      "AI-E sees a likely rendering or pipeline mismatch: the visible failure points to materials, shaders, lighting, or render-pipeline configuration.",
    physics:
      "AI-E sees a likely physics or collision problem: the blocker appears connected to colliders, Rigidbody state, trigger flow, or scene interaction timing.",
    general:
      "AI-E found enough signal to outline the Unity issue and narrow the first debugging pass to a bounded failure surface.",
  };

  const typeSpecificMatters: Record<typeof issueType, string[]> = {
    reference: [
      "Reference-path failures are usually local to one prefab chain, scene object, or initialization boundary, so the first fix should stay narrow.",
      "Changing multiple managers or prefabs at once will make it harder to confirm which missing reference actually caused the break.",
    ],
    compile: [
      "Compiler and API-shape failures usually come from one contract drift, so broad refactors are likely noise until the first error is resolved.",
      "The top compiler error matters more than downstream cascades because later failures are often side effects.",
    ],
    build: [
      "Build failures often differ from editor-only behavior, so the failing platform config or packaging step matters more than generic runtime debugging.",
      "A single package, plugin, or player-setting mismatch can block the whole build even when scenes still run locally.",
    ],
    performance: [
      "Performance fixes should start from one reproducible hotspot, not from a broad optimization sweep across the whole project.",
      "Frame spikes and memory churn often hide in one heavy update loop, allocation path, or renderer step.",
    ],
    rendering: [
      "Rendering issues can look global on screen even when the true cause is one material, shader keyword, or render-pipeline asset mismatch.",
      "Changing multiple visual systems at once will make it harder to confirm whether the pipeline asset or a single shader variant is at fault.",
    ],
    physics: [
      "Physics issues usually depend on one concrete interaction path, so a minimal reproduction matters more than changing broader gameplay logic.",
      "Collider setup, Rigidbody state, and trigger timing should be validated before rewriting adjacent movement systems.",
    ],
    general: [
      "The issue description contains enough signal to narrow the likely failure area before any broad refactor or retry.",
      "The next pass should stay bounded so one fix can be validated before adjacent systems are touched.",
    ],
  };

  const matters = [
    hasErrorMessage
      ? "A concrete error or warning is present, which gives the first debugging pass a higher-signal starting point."
      : "The report still has enough context for a bounded first-pass analysis, even without a concrete error string.",
    ...(hasCodeSnippet
      ? ["A focused code snippet is available, so one narrow execution path can be checked before widening the search."]
      : ["A small reproduction path will matter more than a broad code search on the first pass."]),
    ...(hasContext
      ? ["Extra project context is available, which lowers the chance of treating this as a generic Unity issue."]
      : ["Adding scene or package context later will make the second pass more precise if the first fix does not hold."]),
    ...typeSpecificMatters[issueType],
  ].slice(0, 5);

  const nextStepsByType: Record<typeof issueType, string[]> = {
    reference: [
      "Inspect the first scene object or prefab path mentioned in the report and verify its serialized references.",
      "Reproduce the issue in the smallest possible scene to confirm whether initialization order is the trigger.",
      "Validate one reference fix before changing neighboring prefabs, managers, or scene wiring.",
    ],
    compile: [
      "Start with the first compiler error and verify the exact namespace, assembly definition, or method signature it expects.",
      "Fix the highest-signal contract mismatch before editing multiple call sites.",
      "Rebuild after the first bounded fix to separate the true blocker from cascade errors.",
    ],
    build: [
      "Inspect the first failing build stage and identify whether it belongs to packages, player settings, or asset processing.",
      "Compare the failing build target against the editor setup that still works locally.",
      "Validate one bounded build fix before rotating packages or platform-wide settings.",
    ],
    performance: [
      "Capture one reproducible spike or hotspot in the Profiler before changing gameplay systems broadly.",
      "Inspect the highest-cost update, allocation, or rendering step tied to the slowdown.",
      "Validate one optimization in isolation and compare the impact before stacking more changes.",
    ],
    rendering: [
      "Inspect the first material, shader, or render-pipeline asset directly tied to the visible failure.",
      "Check whether the issue is scene-local or pipeline-wide before editing unrelated visual systems.",
      "Validate one bounded shader or material fix and rerun the affected scene before widening the search.",
    ],
    physics: [
      "Reproduce the collision or trigger failure in a minimal scene with the same Rigidbody and collider setup.",
      "Inspect the first collider, trigger callback, or movement interaction that should have fired but did not.",
      "Validate one bounded physics fix before rewriting broader movement or gameplay systems.",
    ],
    general: [
      "Reproduce the issue with the smallest scene, prefab, or script path that still fails.",
      "Inspect the first high-signal dependency, import, or runtime boundary named in the report.",
      "Validate one bounded fix before widening the change into adjacent systems.",
    ],
  };

  return {
    what_happened: happenedByType[issueType],
    what_matters: matters,
    what_to_do_next: nextStepsByType[issueType],
    upgrade_hint:
      "Upgrade for guided debugging workflows, richer follow-up, saved results, and a deeper issue breakdown.",
  };
}

async function callRemoteBackend(input: AnalysisInput): Promise<FreeAnalysisResponse> {
  const backendUrl = process.env.AIE_ANALYSIS_BACKEND_URL;
  if (!backendUrl) {
    throw new Error("Missing AIE_ANALYSIS_BACKEND_URL.");
  }

  console.log("[aie/run-analysis] using external backend", {
    backendUrl,
    problemDescriptionLength: input.problemDescription.length,
  });

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

export async function runAnalysis(input: AnalysisInput): Promise<FreeAnalysisResponse> {
  if (process.env.AIE_ANALYSIS_BACKEND_URL) {
    return await callRemoteBackend(input);
  }

  console.log("[aie/run-analysis] using fallback demo analysis", {
    reason: "missing_backend_url",
    problemDescriptionLength: input.problemDescription.length,
    hasCodeSnippet: Boolean(normalizeText(input.codeSnippet)),
    hasErrorMessage: Boolean(normalizeText(input.errorMessage)),
    hasContext: Boolean(normalizeText(input.context)),
  });

  return buildFallbackAnalysis(input);
}