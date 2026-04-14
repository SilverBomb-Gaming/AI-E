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

const GENERIC_SCENARIO_TOKENS = new Set([
  "unity",
  "gameobject",
  "transform",
  "component",
  "components",
  "object",
  "objects",
  "script",
  "scripts",
  "scene",
  "scenes",
  "project",
  "player",
  "manager",
  "monoBehaviour",
  "monobehaviour",
  "prefab",
  "console",
  "error",
  "warning",
]);

function trimSentence(value: string, maxLength: number): string {
  const normalized = normalizeText(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function dedupeLines(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(value);
  }

  return result;
}

function splitIntoClauses(value: string): string[] {
  return value
    .split(/[.!?\n;]+/)
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
}

function inferUserIntent(input: AnalysisInput): string {
  const combined = [input.problemDescription, input.errorMessage, input.context, input.codeSnippet]
    .map((value) => normalizeText(value))
    .join(" ")
    .toLowerCase();

  if (/(move|movement|jump|dash|walk|run|locomotion|controller)/.test(combined)) {
    return "movement / locomotion";
  }
  if (/(button|canvas|panel|hud|menu|ui|tooltip|inventory ui)/.test(combined)) {
    return "UI flow / player interface";
  }
  if (/(enemy|spawn|wave|ai|navmesh|pathfind|patrol)/.test(combined)) {
    return "enemy behavior / spawning";
  }
  if (/(animator|animation|state machine|blend tree)/.test(combined)) {
    return "animation state flow";
  }
  if (/(camera|cinemachine|follow|lookat)/.test(combined)) {
    return "camera behavior";
  }
  if (/(input|key|mouse|controller|gamepad)/.test(combined)) {
    return "input handling";
  }
  if (/(save|load|serialize|json|playerprefs)/.test(combined)) {
    return "save / load state";
  }
  if (/(rigidbody|collider|trigger|physics|raycast)/.test(combined)) {
    return "physics interaction";
  }

  return "general gameplay or runtime behavior";
}

function inferPrimarySymptom(input: AnalysisInput): string {
  const candidates = [input.problemDescription, input.errorMessage, input.context]
    .map((value) => normalizeText(value))
    .filter(Boolean);

  for (const candidate of candidates) {
    const firstClause = splitIntoClauses(candidate)[0];
    if (firstClause) {
      return trimSentence(firstClause, 140);
    }
  }

  return "No primary symptom stated.";
}

function extractScenarioAnchors(input: AnalysisInput): string[] {
  const rawTexts = [input.problemDescription, input.errorMessage, input.context, input.codeSnippet]
    .map((value) => String(value ?? ""));

  const candidates = rawTexts.flatMap((text) => {
    const quoted = Array.from(text.matchAll(/"([^"]{2,40})"|'([^']{2,40})'/g)).map(
      (match) => match[1] ?? match[2] ?? "",
    );
    const identifiers = Array.from(text.matchAll(/\b[A-Z][A-Za-z0-9_]{2,30}\b/g)).map((match) => match[0]);
    return [...quoted, ...identifiers];
  });

  return dedupeLines(
    candidates
      .map((value) => normalizeText(value))
      .filter((value) => value.length >= 3 && value.length <= 40)
      .filter((value) => !GENERIC_SCENARIO_TOKENS.has(value.toLowerCase()))
      .map((value) => trimSentence(value, 40)),
  ).slice(0, 4);
}

function inferUnitySurface(input: AnalysisInput): string {
  const combined = [input.problemDescription, input.errorMessage, input.context, input.codeSnippet]
    .map((value) => normalizeText(value))
    .join(" ")
    .toLowerCase();

  if (/(nullreference|missingreference|serializefield|reference not set|prefab)/.test(combined)) {
    return "runtime references / prefab wiring";
  }
  if (/(cs\d{4}|namespace|assembly definition|compile|cannot convert|method|signature)/.test(combined)) {
    return "compile-time API or assembly boundaries";
  }
  if (/(build failed|gradle|il2cpp|addressables|player build|android|ios)/.test(combined)) {
    return "build pipeline or platform packaging";
  }
  if (/(shader|material|urp|hdrp|lighting|pink|render pipeline)/.test(combined)) {
    return "rendering / pipeline configuration";
  }
  if (/(rigidbody|collider|trigger|raycast|physics)/.test(combined)) {
    return "physics / collision flow";
  }
  if (/(fps|stutter|lag|memory|gc|spike|performance)/.test(combined)) {
    return "performance hotspots";
  }

  return "general Unity runtime behavior";
}

function buildSignalSummary(input: AnalysisInput): string[] {
  const scenarioAnchors = extractScenarioAnchors(input);

  return [
    `Primary symptom: ${inferPrimarySymptom(input)}`,
    `User intent area: ${inferUserIntent(input)}`,
    `Likely failure surface: ${inferUnitySurface(input)}`,
    scenarioAnchors.length > 0
      ? `Scenario anchors: ${scenarioAnchors.join(", ")}`
      : "Scenario anchors: none extracted from the report",
    normalizeText(input.errorMessage)
      ? `Concrete error available: ${trimSentence(input.errorMessage ?? "", 140)}`
      : "Concrete error available: no",
    normalizeText(input.codeSnippet)
      ? `Code snippet provided: yes (${Math.min(normalizeText(input.codeSnippet).length, 220)} chars of signal)`
      : "Code snippet provided: no",
    normalizeText(input.context)
      ? `Extra context: ${trimSentence(input.context ?? "", 140)}`
      : "Extra context: no",
  ];
}

function normalizeModelList(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    const cleaned = dedupeLines(
      value
      .map((entry) => normalizeText(String(entry ?? "")))
      .filter(Boolean)
      .map((entry) => trimSentence(entry, 180)),
    ).slice(0, 5);
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
      trimSentence(String(payload.whatHappened ?? ""), 220) ||
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

const DIRECT_FIX_STEP_PATTERN = /^(?:temporarily\s+)?(move|change|rewrite|switch|remove|replace|modify|yield)\b/i;

function ensureConfirmationFirstStep(response: FreeAnalysisResponse): FreeAnalysisResponse {
  const firstStep = response.what_to_do_next[0];
  if (!firstStep || !DIRECT_FIX_STEP_PATTERN.test(firstStep)) {
    return response;
  }

  let rewrittenStep = normalizeText(firstStep)
    .replace(/^temporarily\b/i, "Temporarily")
    .replace(/\bto (?:see|check|confirm) if\b/i, "and confirm whether")
    .replace(/\bto confirm whether\b/i, "and confirm whether")
    .replace(/\bto ensure\b.*$/i, "and see whether the issue changes")
    .replace(/\.$/, "");

  if (!/^temporarily\b/i.test(rewrittenStep)) {
    rewrittenStep = rewrittenStep.replace(/^([A-Z])/, (_, letter: string) => `Temporarily ${letter.toLowerCase()}`);
  }

  if (!/\b(confirm|observe|check)\b/i.test(rewrittenStep)) {
    rewrittenStep = `${rewrittenStep} and see whether the issue changes`;
  }

  rewrittenStep = trimSentence(`${rewrittenStep}.`, 180);

  return {
    ...response,
    what_to_do_next: [rewrittenStep, ...response.what_to_do_next.slice(1)],
  };
}

function buildOpenAISystemPrompt(): string {
  return [
    "You are an expert Unity debugging assistant.",
    "Analyze Unity bugs, runtime failures, editor errors, build problems, render issues, and gameplay blockers.",
    "Act like a senior Unity engineer doing a first debugging pass on a real project report.",
    "Your job is to identify the single most likely cause of the issue and guide the user to verify and fix it.",
    "Return specific, non-generic advice grounded in the provided issue details.",
    "Be decisive and practical.",
    "Tie your diagnosis directly to the described behavior, object names, systems, or runtime symptoms from the report.",
    "Your diagnosis must explain a cause-to-effect chain: what is wrong, why it produces the symptom, and what that affects.",
    "Do not return paragraphs of generic troubleshooting.",
    "Do not give broad checklists.",
    "Do not suggest large refactors or architecture changes.",
    "Return exactly ONE primary likely cause.",
    "Do not list alternatives, secondary causes, or multiple equal possibilities.",
    "Do not hedge with phrases like 'could be', 'might be', 'possibly', or similar.",
    "Do not attribute the issue to multiple tunable parameters (e.g., gravity, force, speed, mass). If multiple parameters could explain the symptom, choose the single most likely root cause and commit to it. Do not present parameter adjustment as a diagnosis.",
    "Prefer structural or logical causes (e.g., overwritten velocity, incorrect condition, missing reference) over parameter tuning unless the input explicitly indicates a parameter misconfiguration.",
    "Do not infer a specific tunable parameter (e.g., mass, drag, gravity, force) from the presence or introduction of a component. If the input only indicates that a component (such as Rigidbody2D) was added or changed, diagnose the most likely structural or logic issue introduced by that change (e.g., conflicting movement systems, overwritten values, incorrect update usage), not internal parameter settings. Only diagnose a parameter misconfiguration if the input explicitly references that parameter or clearly indicates a tuning issue.",
    "If a code snippet is provided, you must prioritize diagnosing issues caused by the code itself (e.g., overwritten values, execution order, conflicting logic, incorrect update usage) before considering external factors such as component settings or parameter values.",
    "Do not ignore clear failure patterns in the code in favor of general parameter-based explanations.",
    "When the code shows a likely interaction issue (e.g., a value being set every frame and also modified elsewhere), treat that as the primary cause over any parameter or configuration explanation.",
    "Use Unity-specific reasoning when relevant: prefab references, serialized fields, scene wiring, MonoBehaviour lifecycle, assembly definitions, packages, player settings, build targets, shaders, URP/HDRP, colliders, Rigidbody state, triggers, Profiler, and console errors.",
    "If the report contains an error string, code snippet, or context, anchor your reasoning to those signals instead of giving generic Unity advice.",
    "The next steps must feel like a practical debugging sequence that a Unity developer can execute in order.",
    "Respond with JSON only using this exact shape:",
    '{"whatHappened":"...","whatMatters":["..."],"whatToDoNext":["...","...","..."]}',
    "Rules:",
    "- whatHappened: state the single most likely underlying issue in the project, not the symptom",
    "- whatHappened must include a cause -> effect explanation, not just a description",
    "- whatHappened must reference at least one specific object, script, or system mentioned in the input if any are present",
    "- whatHappened must not stop at a broad category like physics, rendering, or references; it must name the specific likely failure inside that category",
    "- Avoid generic phrases like 'a GameObject', 'an object', or 'something' when concrete names are available",
    "- If scenario anchors are provided, you MUST reference at least one of them in whatHappened unless it is clearly irrelevant",
    "- whatMatters: justify why this is the most likely cause using only clues from the user's input",
    "- whatMatters: the first item should reinforce the primary cause, and the remaining items can support or validate it",
    "- whatMatters: prefer the explanation that accounts for the symptom with the fewest assumptions",
    "- whatMatters: do not introduce speculative systems or unrelated mechanics",
    "- whatToDoNext: provide 3 to 5 ordered steps that directly verify, isolate, or disprove the suspected cause",
    "- whatToDoNext: step 1 must be the single fastest, highest-signal confirmation check for the primary diagnosis",
    "- whatToDoNext: step 1 must directly verify or falsify the primary diagnosis before broader debugging or fix work",
    "- whatToDoNext: if the diagnosis is code-level, step 1 should inspect, log, compare, or temporarily isolate the exact interaction that would prove that code path is responsible",
    "- whatToDoNext: step 1 must be a confirmation action, not the final fix",
    "- whatToDoNext: do not use step 1 to tell the user to implement the solution permanently",
    "- whatToDoNext: prefer reversible checks in step 1 such as temporarily disabling a behavior, logging a value, inspecting a live reference, or comparing before/after state",
    "- whatToDoNext: later steps can deepen isolation or validate the fix, but they must follow the confirmation check rather than replace it",
    "- whatToDoNext: if the primary diagnosis is structural or code-level, keep the remaining steps focused on that same cause instead of drifting into parameter tuning or unrelated fallback checks",
    "- whatToDoNext: do not suggest mass, drag, gravity, force, jumpForce, or similar tuning checks unless the input explicitly points to that parameter as evidence",
    "- whatToDoNext: every step must be specific to the issue described, not generic maintenance advice",
    "- Avoid vague advice like 'check your code' or 'debug further'",
    "- Avoid generic advice like 'Check the Inspector', 'Look at logs', or 'Verify everything is set correctly'",
    "- Avoid filler phrases like 'there may be an issue' or 'consider investigating'",
    "- If object names, systems, or symptoms are present, mention them directly instead of replacing them with generic nouns",
    "- Prefer imperative next steps such as inspect, verify, reproduce, compare, isolate, rebuild, or profile",
    "- Do not name a cause unless there is at least one concrete reason from the input to suspect it",
    "- The diagnosis must explain the observed behavior better than other possibilities",
    "- Keep the output short, high-signal, and product-ready",
    "- Assume the reader wants the fastest safe path to isolate the Unity issue",
  ].join(" ");
}

function buildOpenAIUserPrompt(input: AnalysisInput): string {
  const scenarioAnchors = extractScenarioAnchors(input);

  return [
    "Analyze this Unity issue report.",
    "Identify the single most likely cause supported by the evidence below.",
    "Do not list alternative causes or equal hypotheses.",
    "Base your diagnosis only on evidence present in the report.",
    "Your answer should feel like it is reacting to this specific scenario, not to a generic Unity bug template.",
    "",
    "Issue report:",
    `- Problem description: ${normalizeText(input.problemDescription) || "None provided."}`,
    `- Error message: ${normalizeText(input.errorMessage) || "None provided."}`,
    `- Code snippet: ${normalizeText(input.codeSnippet) || "None provided."}`,
    `- Context: ${normalizeText(input.context) || "None provided."}`,
    "",
    "Scenario framing:",
    `- Primary symptom: ${inferPrimarySymptom(input)}`,
    `- User intent area: ${inferUserIntent(input)}`,
    `- Scenario anchors: ${scenarioAnchors.length > 0 ? scenarioAnchors.join(", ") : "None extracted."}`,
    ...(scenarioAnchors.length > 0 ? [`- Preferred anchor: ${scenarioAnchors[0]}`] : []),
    `- Likely failure surface: ${inferUnitySurface(input)}`,
    "",
    "High-signal summary:",
    ...buildSignalSummary(input).map((line) => `- ${line}`),
    "",
    "Output requirements:",
    "- Make whatHappened a concrete Unity root-cause diagnosis, not a symptom summary",
    "- Mention the most relevant object, system, or behavior from the report if one is available",
    "- You must incorporate at least one scenario anchor into your diagnosis if any are present",
    "- Do not stop at a broad subsystem label; name the specific likely fault inside it",
    "- Explain the cause -> effect chain: what is wrong, why it causes the behavior, and what that affects",
    "- Make whatMatters justify this diagnosis using only clues from the report",
    "- Make whatToDoNext a short step-by-step debugging sequence that directly tests the suspected cause",
    "- The first whatToDoNext item must read like the one thing a senior engineer would check first before doing anything else",
    "- Make the first whatToDoNext item a concrete confirmation step, not a generic fix suggestion",
    "- Make the first whatToDoNext item reversible and diagnostic, so it proves the cause before asking for a lasting code change",
    "- Keep the later whatToDoNext items on the same likely cause instead of drifting into parameter tuning unless the report explicitly mentions that parameter",
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

  return ensureConfirmationFirstStep(toFreeAnalysisResponse(parsed));
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