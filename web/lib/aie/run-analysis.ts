import type { AnalysisInput, FreeAnalysisResponse } from "@/lib/aie/types";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o-mini";

function normalizeText(value: string | undefined): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeJsonText(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("```") && trimmed.endsWith("```")) {
    return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }
  return trimmed;
}

type OpenAIAnalysisResponse = {
  whatHappened?: unknown;
  whatMatters?: unknown;
  whatToDoNext?: unknown;
};

function normalizeModelList(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    const cleaned = value
      .map((entry) => normalizeText(String(entry ?? "")))
      .filter(Boolean)
      .slice(0, 5);
    return cleaned.length > 0 ? cleaned : fallback;
  }

  const singleValue = normalizeText(String(value ?? ""));
  if (singleValue) {
    return [singleValue, ...fallback].slice(0, 5);
  }

  return fallback;
}

function toFreeAnalysisResponse(payload: OpenAIAnalysisResponse): FreeAnalysisResponse {
  return {
    what_happened:
      normalizeText(String(payload.whatHappened ?? "")) ||
      "AI-E found enough signal to outline the Unity issue, but the root cause still needs a closer debugging pass.",
    what_matters: normalizeModelList(payload.whatMatters, [
      "The issue description contains enough signal to narrow the likely failure surface.",
      "The highest-signal fix should be validated before any broad refactor.",
      "The next steps are ordered to reduce guesswork and isolate the blocker quickly.",
    ]),
    what_to_do_next: normalizeModelList(payload.whatToDoNext, [
      "Reproduce the issue with the smallest scene or prefab setup that still fails.",
      "Inspect the first high-signal dependency, import, or runtime boundary named in the report.",
      "Validate one bounded fix before widening the change into adjacent systems.",
    ]),
    upgrade_hint:
      "Upgrade for guided debugging workflows, richer follow-up, saved results, and a deeper issue breakdown.",
  };
}

function buildOpenAISystemPrompt(): string {
  return [
    "You are an expert Unity debugging assistant.",
    "Analyze Unity bugs, runtime failures, editor errors, build problems, render issues, and gameplay blockers.",
    "Return specific, non-generic advice grounded in the provided issue details.",
    "Do not return paragraphs of generic troubleshooting.",
    "Respond with JSON only using this exact shape:",
    '{"whatHappened":"...","whatMatters":["..."],"whatToDoNext":["...","...","..."]}',
    "Rules:",
    "- whatHappened: one concise diagnosis summary",
    "- whatMatters: 3 to 5 concrete observations about the likely fault line",
    "- whatToDoNext: 3 to 5 ordered, bounded next debugging steps",
    "- Avoid vague advice like 'check your code' or 'debug further'",
    "- Assume the reader wants the fastest safe path to isolate the Unity issue",
  ].join(" ");
}

function buildOpenAIUserPrompt(input: AnalysisInput): string {
  return [
    `Problem: ${normalizeText(input.problemDescription) || "None provided."}`,
    `Code: ${normalizeText(input.codeSnippet) || "None provided."}`,
    `Error: ${normalizeText(input.errorMessage) || "None provided."}`,
    `Context: ${normalizeText(input.context) || "None provided."}`,
  ].join("\n");
}

async function callOpenAIAnalysis(input: AnalysisInput): Promise<FreeAnalysisResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY.");
  }

  console.log("[aie/run-analysis] using openai analysis", {
    model: OPENAI_MODEL,
    problemDescriptionLength: input.problemDescription.length,
    hasCodeSnippet: Boolean(normalizeText(input.codeSnippet)),
    hasErrorMessage: Boolean(normalizeText(input.errorMessage)),
    hasContext: Boolean(normalizeText(input.context)),
  });

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.2,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "unity_analysis",
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["whatHappened", "whatMatters", "whatToDoNext"],
            properties: {
              whatHappened: {
                type: "string",
              },
              whatMatters: {
                type: "array",
                minItems: 3,
                maxItems: 5,
                items: {
                  type: "string",
                },
              },
              whatToDoNext: {
                type: "array",
                minItems: 3,
                maxItems: 5,
                items: {
                  type: "string",
                },
              },
            },
          },
        },
      },
      messages: [
        {
          role: "system",
          content: buildOpenAISystemPrompt(),
        },
        {
          role: "user",
          content: buildOpenAIUserPrompt(input),
        },
      ],
    }),
    cache: "no-store",
  });

  console.log("[run_analysis] OpenAI response received");

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`OpenAI request failed with status ${response.status}: ${bodyText.slice(0, 400)}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned an empty analysis response.");
  }

  let parsed: OpenAIAnalysisResponse;
  try {
    parsed = JSON.parse(normalizeJsonText(content)) as OpenAIAnalysisResponse;
    console.log("[run_analysis] JSON parsed successfully");
  } catch (error) {
    throw new Error(
      `OpenAI returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return toFreeAnalysisResponse(parsed);
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

export async function runAnalysis(input: AnalysisInput): Promise<FreeAnalysisResponse> {
  console.log("[run_analysis] API key exists:", !!process.env.OPENAI_API_KEY);

  if (process.env.OPENAI_API_KEY) {
    try {
      console.log("[run_analysis] attempting OpenAI call");
      return await callOpenAIAnalysis(input);
    } catch (error) {
      console.error("[run_analysis] OpenAI failed", error);
      console.error("[aie/run-analysis] openai analysis failed; falling back", {
        model: OPENAI_MODEL,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
      });
    }
  }

  console.warn("[run_analysis] using fallback analysis");
  console.log("[aie/run-analysis] using fallback demo analysis", {
    reason: process.env.OPENAI_API_KEY ? "openai_failed" : "missing_openai_api_key",
    problemDescriptionLength: input.problemDescription.length,
    hasCodeSnippet: Boolean(normalizeText(input.codeSnippet)),
    hasErrorMessage: Boolean(normalizeText(input.errorMessage)),
    hasContext: Boolean(normalizeText(input.context)),
  });

  return buildFallbackAnalysis(input);
}