import type { AnalysisInput, FreeAnalysisResponse } from "@/lib/aie/types";
import { attachDryRunActionProposal } from "./executionBridge";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o-mini";

function normalizeText(value: string | null | undefined): string {
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

type CanonicalMode = "isolation" | "instrumentation" | "timing" | "duplicate-writer" | "ownership" | null;

type FollowUpContext = {
  attemptedStep: string | null;
  observation: string | null;
};

const DUPLICATE_WRITER_SIGNAL_PATTERN =
  /\b(?:duplicate writers?|multiple scripts writing|two scripts writing|both write|both writing|same frame|overwrit(?:e|es|ing)|bouncing between two values|written from two places|same value|same [a-z]+ value|writing the same [a-z]+ value)\b/i;
const OWNERSHIP_SIGNAL_PATTERN =
  /\b(?:ownership|owner|reference handoff|spawned projectile|spawned object|reads from another reference|wrong reference|stale reference|lost reference|target reference|null target|no target)\b/i;
const TIMING_SIGNAL_PATTERN =
  /\b(?:initialization(?:-order)?|execution order|order of execution|awake|start\b|onenable|scene load|bootstrap|loaded before|loaded after|initial state)\b/i;
const INSTRUMENTATION_SIGNAL_PATTERN =
  /\b(?:no clear console error|checks are too sparse|add logging|focused logging|instrument(?:ation)?|trace\b|track whether|before or after registration|observe lifecycle timing)\b/i;
const ISOLATION_SIGNAL_PATTERN =
  /\b(?:appears immediately when|right after|tied to that handoff|rest of .* feels normal|same handoff|same subsystem|single subsystem|isolate only|compare the behavior immediately)\b/i;
const MESSY_MULTI_SYSTEM_PATTERN =
  /\b(?:touched .* and .* and .*|multiple systems?|mixed together|everything feels mixed together|not sure where to start|all at once|late-night pass|a bunch of)\b/i;
const FOLLOW_UP_CONTEXT_PATTERN = /After trying (?:step \d+|the current step)(?: \((.*?)\))?:\s*(.+)$/i;
const HARD_NO_CHANGE_PATTERN = /\b(?:nothing changed|changed nothing|no change|did nothing|no effect|unchanged|same issue|same behavior)\b/i;
const PARTIAL_PROGRESS_PATTERN = /\b(?:rarer|reduced|less severe|less often|partially|improved?.*still|still appears|still happens once|still present)\b/i;
const STRONG_CONFIRMATION_PATTERN =
  /\b(?:cleanly tracks|tracks the symptom|brings? .* back|same .* drives the symptom|same .* keeps matching|consistently reproduces|confirms? the cause|only appears while|removes? .* completely)\b/i;
const HARD_RESOLUTION_PATTERN = /\b(?:fix(?:es|ed) it|works? normally again|behaves? normally again|homing works normally again|gone now)\b/i;

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
  const combined = [input.problemDescription, input.errorMessage, input.context, input.codeSnippet, input.actionResult]
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
  const rawTexts = [input.problemDescription, input.errorMessage, input.context, input.codeSnippet, input.actionResult]
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
  const combined = [input.problemDescription, input.errorMessage, input.context, input.codeSnippet, input.actionResult]
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
    normalizeText(input.goal)
      ? `Session goal: ${trimSentence(input.goal ?? "", 140)}`
      : "Session goal: no",
    Number.isInteger(input.stepIndex)
      ? `Session step: ${input.stepIndex}`
      : "Session step: no",
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
    normalizeText(input.actionResult)
      ? `Action result: ${trimSentence(input.actionResult ?? "", 140)}`
      : "Action result: no",
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

function extractFollowUpContext(input: AnalysisInput): FollowUpContext {
  const match = input.problemDescription.match(FOLLOW_UP_CONTEXT_PATTERN);
  if (!match) {
    const actionResult = normalizeText(input.actionResult);
    return {
      attemptedStep: null,
      observation: actionResult || null,
    };
  }

  return {
    attemptedStep: normalizeText(match[1]),
    observation: normalizeText(match[2]),
  };
}

function trimFocusLabel(value: string | null | undefined): string | null {
  const trimmed = normalizeText(value)
    .replace(
      /^(?:i|we)\s+(?:temporarily\s+)?(?:disabled?|disabling|disable|bypassed?|bypassing|bypass|turned off|turn off|removed?|removing|remove|forced?|forcing|force|restored?|restoring|restore|isolated?|isolating|isolate|passed?|passing)\s+(?:the\s+)?/i,
      "",
    )
    .replace(/^(?:this now confirms\s+|this confirms\s+)?(?:the\s+)?cause\s*:\s*/i, "")
    .replace(/^(?:the\s+)?failing path\s*:\s*/i, "")
    .replace(/^(?:the|a|an|same)\s+/i, "")
    .replace(/\b(?:now|still|cleanly|consistently|immediately|directly)\b/gi, " ")
    .replace(/\b(?:tracks?|drives?|brings?|keeps?|matching|confirm(?:s|ed)?|reproduc(?:e|es|ed))\b.*$/i, "")
    .replace(/\b(?:in|inside|within|during|while|because|when)\b.*$/i, "")
    .replace(/[.?!,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return trimmed || null;
}

function canonicalizeObservationFocus(params: {
  lever: string | null;
  mode: CanonicalMode;
  combined: string;
}): string | null {
  const trimmedLever = trimFocusLabel(params.lever);
  if (!trimmedLever) {
    return null;
  }

  const leverTokenCount = trimmedLever.split(/\s+/).length;
  if (/\b(?:i|we|you|they|it)\b/i.test(trimmedLever) || leverTokenCount > 6) {
    return null;
  }

  if (params.mode === "duplicate-writer") {
    if (/cutscene zoom/i.test(trimmedLever) || /cutscene zoom/i.test(params.combined)) {
      return "cutscene zoom writer";
    }

    if (/combat zoom/i.test(trimmedLever) || /combat zoom/i.test(params.combined)) {
      return "combat zoom writer";
    }

    if (!/\b(?:writer|zoom|camera|path|value|script)\b/i.test(trimmedLever)) {
      return null;
    }

    return trimmedLever;
  }

  if (params.mode === "ownership") {
    if (!/\b(?:owner|ownership|reference|target|handoff|path)\b/i.test(trimmedLever)) {
      return null;
    }

    return trimmedLever;
  }

  return trimmedLever;
}

function extractLeverPhrase(text: string | null | undefined): string | null {
  const normalized = normalizeText(text);
  if (!normalized) {
    return null;
  }

  const patterns = [
    /(?:but|while)\s+(?:disabling|disable|isolating|isolate|bypassing|bypass|turning off|turn off|forcing|force|restoring|restore)\s+(?:the\s+)?([^,.]+?)\s+(?:removes?|removed|fixes?|fixed|stops?|stop|makes?|make|brings?|brought|tracks?|keeps? matching)/i,
    /(?:disabling|disable|isolating|isolate|bypassing|bypass|turning off|turn off|forcing|force|restoring|restore|passing)\s+(?:the\s+)?([^,.]+?)\s+(?:changed nothing|had no effect|fixes?|fixed|removes?|removed|stops?|stop|tracks?|brings?)/i,
    /\b(?:same\s+)?([A-Za-z][A-Za-z0-9_-]*(?:\s+[A-Za-z][A-Za-z0-9_-]*){0,4}\s+(?:handoff|speed sync|binding|reference|transition|writer|controller|limiter|projectile|script))\b/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      return trimFocusLabel(match[1]);
    }
  }

  return null;
}

function inferCanonicalMode(params: { input: AnalysisInput; response: FreeAnalysisResponse }): CanonicalMode {
  const inputCombined = [
    params.input.problemDescription,
    params.input.errorMessage,
    params.input.context,
    params.input.codeSnippet,
  ]
    .map((value) => normalizeText(value))
    .join(" ");

  const combined = [
    inputCombined,
    params.response.what_happened,
    ...params.response.what_matters,
    ...params.response.what_to_do_next,
  ]
    .map((value) => normalizeText(value))
    .join(" ");

  if (
    MESSY_MULTI_SYSTEM_PATTERN.test(params.input.problemDescription) &&
    !DUPLICATE_WRITER_SIGNAL_PATTERN.test(combined) &&
    !OWNERSHIP_SIGNAL_PATTERN.test(combined) &&
    !TIMING_SIGNAL_PATTERN.test(combined)
  ) {
    return null;
  }

  if (DUPLICATE_WRITER_SIGNAL_PATTERN.test(inputCombined)) {
    return "duplicate-writer";
  }

  if (INSTRUMENTATION_SIGNAL_PATTERN.test(inputCombined)) {
    return "instrumentation";
  }

  if (OWNERSHIP_SIGNAL_PATTERN.test(inputCombined)) {
    return "ownership";
  }

  if (TIMING_SIGNAL_PATTERN.test(inputCombined)) {
    return "timing";
  }

  if (ISOLATION_SIGNAL_PATTERN.test(inputCombined)) {
    return "isolation";
  }

  if (DUPLICATE_WRITER_SIGNAL_PATTERN.test(combined)) {
    return "duplicate-writer";
  }

  if (INSTRUMENTATION_SIGNAL_PATTERN.test(combined)) {
    return "instrumentation";
  }

  if (OWNERSHIP_SIGNAL_PATTERN.test(combined)) {
    return "ownership";
  }

  if (TIMING_SIGNAL_PATTERN.test(combined)) {
    return "timing";
  }

  if (ISOLATION_SIGNAL_PATTERN.test(combined)) {
    return "isolation";
  }

  return null;
}

function inferFocusLabel(params: {
  input: AnalysisInput;
  response: FreeAnalysisResponse;
  mode: CanonicalMode;
  followUp: FollowUpContext;
}): string {
  const combined = [
    params.followUp.observation,
    params.followUp.attemptedStep,
    params.input.problemDescription,
    params.response.what_happened,
    ...params.response.what_to_do_next,
  ]
    .map((value) => normalizeText(value))
    .join(" ");
  const scenarioAnchor = extractScenarioAnchors(params.input)[0] ?? null;
  const observationLever = canonicalizeObservationFocus({
    lever: extractLeverPhrase(params.followUp.observation),
    mode: params.mode,
    combined,
  });

  if (observationLever && (params.mode === "duplicate-writer" || params.mode === "ownership")) {
    return observationLever;
  }

  if (/wall-jump handoff/i.test(combined)) {
    return "wall-jump handoff";
  }

  if (/animator speed sync/i.test(combined)) {
    return "Animator speed sync handoff";
  }

  if (/cutscene zoom/i.test(combined)) {
    return params.mode === "duplicate-writer" ? "cutscene zoom writer" : "cutscene zoom path";
  }

  switch (params.mode) {
    case "duplicate-writer":
      if (/speed/i.test(combined)) {
        return "same speed value";
      }
      if (/state/i.test(combined)) {
        return "same state value";
      }
      return "same shared value";
    case "ownership":
      if (/target/i.test(combined)) {
        return "target reference handoff";
      }
      return "ownership/reference handoff";
    case "timing":
      if (/hud/i.test(combined) && /playerstats/i.test(combined)) {
        return "HUD binding before PlayerStats initializes";
      }
      return "initialization boundary";
    case "instrumentation":
      if (/registration/i.test(combined)) {
        return "registration handoff";
      }
      return scenarioAnchor ? `${scenarioAnchor} handoff` : "exact failing handoff";
    case "isolation":
      if (/wall-jump handoff/i.test(combined)) {
        return "wall-jump handoff";
      }
      if (/animator speed sync/i.test(combined)) {
        return "Animator speed sync handoff";
      }
      return scenarioAnchor ? trimFocusLabel(scenarioAnchor) ?? "same suspect subsystem" : "same suspect subsystem";
    default:
      return scenarioAnchor ? trimFocusLabel(scenarioAnchor) ?? "same issue path" : "same issue path";
  }
}

function buildModeDiagnosis(params: { mode: CanonicalMode; focus: string; input: AnalysisInput }): string | null {
  switch (params.mode) {
    case "duplicate-writer":
      return `This is a duplicate writer conflict: two systems are writing the same value through ${params.focus}, so the later write overwrites the earlier write and the symptom flips between two states.`;
    case "ownership":
      return `This is an ownership/reference handoff issue: one object stores the needed target, but ${params.focus} reads the wrong or stale target path, so the spawned behavior runs without the intended target.`;
    case "timing":
      return `This is an initialization-order issue: ${params.focus} is being read before the upstream state is ready, so the first frame uses stale or default data and the later lifecycle pass corrects it.`;
    case "instrumentation":
      return `The failure is still centered on ${params.focus}, and the next pass should instrument that exact handoff so you can see whether the signal is lost before or after the failing boundary.`;
    case "isolation":
      return `This is a single-subsystem isolation case: ${params.focus} is the failing path because the symptom starts when that path runs and the rest of the surrounding system stays normal.`;
    default:
      return null;
  }
}

function buildContradictionDiagnosis(params: { focus: string; alternateFocus: string | null }): string {
  const alternateFocus = params.alternateFocus ?? "the alternate path";
  return `The previous hypothesis is contradicted. ${alternateFocus} is now the more likely cause because the earlier step did not affect the issue, while the alternate lever changes the symptom immediately.`;
}

function isRepeatedConfirmationObservation(observation: string): boolean {
  return /\b(?:still|keeps? matching|repeated|again|continues? to reproduce|confirmed behavior)\b/i.test(
    observation,
  );
}

function buildConfirmationDiagnosis(params: { focus: string; observation: string; mode: CanonicalMode }): string {
  if (HARD_RESOLUTION_PATTERN.test(params.observation)) {
    return `${params.focus} is confirmed as the failing path: the latest change fixes the issue and returns the behavior to normal.`;
  }

  if (params.mode === "duplicate-writer") {
    if (isRepeatedConfirmationObservation(params.observation)) {
      return `${params.focus} continues to reproduce the same confirmed duplicate-writer conflict under repeated validation. The same overwrite path keeps matching, the symptom returns on the same writer toggle, and the diagnosis should stay bounded to this writer conflict.`;
    }

    return `${params.focus} is now confirmed as the duplicate-writer cause: the same overwrite path cleanly tracks the symptom, consistently reproduces the issue, and the repeated check keeps matching the expected writer conflict.`;
  }

  if (isRepeatedConfirmationObservation(params.observation)) {
    return `${params.focus} continues to reproduce the same confirmed behavior under repeated validation. The same path cleanly tracks the symptom, consistently reproduces the issue, and the repeated check keeps matching the expected path.`;
  }

  return `${params.focus} is now confirmed as the cause: the same path cleanly tracks the symptom, consistently reproduces the issue, and the repeated check keeps matching the expected path.`;
}

function buildCanonicalMatters(params: {
  mode: CanonicalMode;
  focus: string;
  followUp: FollowUpContext;
  alternateFocus: string | null;
}): string[] {
  if (params.followUp.observation && HARD_NO_CHANGE_PATTERN.test(params.followUp.observation) && params.alternateFocus) {
    return [
      `The previous step did not affect the issue, which explicitly contradicts the earlier hypothesis.`,
      `${params.alternateFocus} is now the stronger candidate because the symptom shifts when that path changes.`,
      `The next pass should stay on the contradicted branch until one bounded check either cleanly reproduces or disproves it.`,
    ];
  }

  if (params.followUp.observation && STRONG_CONFIRMATION_PATTERN.test(params.followUp.observation) && !PARTIAL_PROGRESS_PATTERN.test(params.followUp.observation)) {
    return [
      `The latest observation cleanly tracks the same cause instead of widening to a different system.`,
      `That repeated confirmation is strong enough to treat ${params.focus} as the leading driver, not just a loose correlation.`,
      `The next step should stay on the same cause one more bounded check before widening or rewriting adjacent systems.`,
    ];
  }

  switch (params.mode) {
    case "duplicate-writer":
      return [
        `Two systems are writing the same value, which is a duplicate writer conflict rather than a tuning problem.`,
        `The symptom bounces because the later write overwrites the earlier write in the same frame or state transition.`,
        `One bounded before/after isolation check should show which writer actually owns the failing path.`,
      ];
    case "ownership":
      return [
        `One object stores the target, but another object reads the wrong or stale target path, which points to an ownership/reference handoff issue.`,
        `The failure only needs one broken handoff path to produce a no-target or stale-target result.`,
        `The next pass should validate the exact handoff before changing adjacent gameplay systems.`,
      ];
    case "timing":
      return [
        `The dependent read is happening on the wrong lifecycle boundary, so the first frame is using data before initialization completes.`,
        `This is an execution-order problem, not a broad subsystem mystery.`,
        `A single lifecycle comparison should confirm whether the early read is the real trigger.`,
      ];
    case "instrumentation":
      return [
        `The missing signal is most likely being lost at one concrete handoff, registration point, or state transition.`,
        `The current evidence is specific enough to instrument one path instead of broadening to generic debugging.`,
        `Focused logging should show whether the value, event, or reference disappears before or after the failing boundary.`,
      ];
    case "isolation":
      return [
        `The symptom is tightly coupled to one bounded path instead of the whole subsystem.`,
        `That makes a single before/after isolation check higher signal than a broad refactor.`,
        `If the same path moves the symptom immediately, the diagnosis should stay on that path until it is disproved.`,
      ];
    default:
      return [];
  }
}

function buildCanonicalSteps(params: {
  mode: CanonicalMode;
  focus: string;
  followUp: FollowUpContext;
  alternateFocus: string | null;
}): string[] {
  if (params.followUp.observation && HARD_NO_CHANGE_PATTERN.test(params.followUp.observation) && params.alternateFocus) {
    return [
      `Temporarily isolate only ${params.alternateFocus} and compare whether the symptom changes immediately before and after that step.`,
      `Log the before/after state on ${params.alternateFocus} so you can confirm the previous hypothesis is contradicted and this alternate path is the real driver.`,
      `Keep the next pass on ${params.alternateFocus} until one bounded check cleanly reproduces or disproves that branch.`,
    ];
  }

  if (params.followUp.observation && STRONG_CONFIRMATION_PATTERN.test(params.followUp.observation) && !PARTIAL_PROGRESS_PATTERN.test(params.followUp.observation)) {
    return [
      `Temporarily disable ${params.focus} and compare whether the same symptom changes immediately before and after.`,
      `Restore ${params.focus} immediately after that check and confirm the same symptom comes back on that same path.`,
      `If the same result repeats again, keep the diagnosis bounded to ${params.focus} instead of widening to unrelated systems.`,
    ];
  }

  switch (params.mode) {
    case "duplicate-writer":
      return [
        `Temporarily disable one writer at a time and compare whether the same value still changes in the same frame.`,
        `Log the shared value where each writer sets it so you can see which system writes first and which one overwrites it.`,
        `Keep a single owning write path for that value, then rerun the same case to confirm the duplicate writer conflict is gone.`,
      ];
    case "ownership":
      return [
        `Inspect the exact reference handoff and compare the source reference against the one the spawned object actually reads.`,
        `Log the reference immediately when the object is spawned and again when it first uses that reference.`,
        `Pass the same owned reference through one clear handoff path, then rerun the same case to confirm the ownership/reference issue is gone.`,
      ];
    case "timing":
      return [
        `Temporarily delay the dependent binding until after the upstream state initializes and compare the behavior before and after.`,
        `Log Awake, OnEnable, and Start once for the involved objects so you can confirm the execution order around the failure.`,
        `Keep the dependent read on the correct lifecycle boundary, then rerun the same load path to confirm the initialization-order issue is gone.`,
      ];
    case "instrumentation":
      return [
        `Add focused logging around ${params.focus} and compare the values or events immediately before and after the failure point.`,
        `Log only the branch, registration point, or state transition that should prove whether the signal is lost before or after the handoff.`,
        `Keep the logs on the same path until one branch contradicts the hypothesis, then narrow to that branch instead of widening the search.`,
      ];
    case "isolation":
      return [
        `Temporarily disable only ${params.focus} and compare the behavior immediately before and after.`,
        `If the symptom changes, isolate the next smallest branch inside ${params.focus} instead of switching to a different system.`,
        `Restore the path and rerun the same case to confirm the symptom still tracks ${params.focus}.`,
      ];
    default:
      return [];
  }
}

export function shapeFreeAnalysisResponse(params: {
  input: AnalysisInput;
  response: FreeAnalysisResponse;
}): FreeAnalysisResponse {
  const followUp = extractFollowUpContext(params.input);
  const mode = inferCanonicalMode(params);
  const focus = inferFocusLabel({
    input: params.input,
    response: params.response,
    mode,
    followUp,
  });
  const alternateFocus = extractLeverPhrase(followUp.observation?.split(/\bbut\b/i)[1]);
  const hasHardContradiction = Boolean(
    followUp.observation && HARD_NO_CHANGE_PATTERN.test(followUp.observation) && alternateFocus,
  );
  const hasStrongConfirmation = Boolean(
    followUp.observation &&
      STRONG_CONFIRMATION_PATTERN.test(followUp.observation) &&
      !PARTIAL_PROGRESS_PATTERN.test(followUp.observation),
  );

  const shapedDiagnosis = hasHardContradiction
    ? buildContradictionDiagnosis({ focus, alternateFocus })
    : hasStrongConfirmation
      ? buildConfirmationDiagnosis({ focus, observation: followUp.observation ?? "", mode })
      : buildModeDiagnosis({ mode, focus, input: params.input }) ?? params.response.what_happened;

  const canonicalMatters = buildCanonicalMatters({
    mode,
    focus,
    followUp,
    alternateFocus,
  });
  const canonicalSteps = buildCanonicalSteps({
    mode,
    focus,
    followUp,
    alternateFocus,
  });

  return attachDryRunActionProposal({
    ...params.response,
    what_happened: trimSentence(shapedDiagnosis, 220),
    what_matters: dedupeLines([...canonicalMatters, ...params.response.what_matters])
      .slice(0, 5)
      .map((entry) => trimSentence(entry, 180)),
    what_to_do_next: dedupeLines([...canonicalSteps, ...params.response.what_to_do_next])
      .slice(0, 5)
      .map((entry) => trimSentence(entry, 180)),
  });
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
    return attachDryRunActionProposal(response);
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

  return attachDryRunActionProposal({
    ...response,
    what_to_do_next: [rewrittenStep, ...response.what_to_do_next.slice(1)],
  });
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
    "- When the evidence points to two systems writing the same value, use the exact phrase 'duplicate writer conflict' and explicitly say that two systems are writing the same value",
    "- When the evidence points to one object storing a reference and another object reading a different or missing one, use the exact phrase 'ownership/reference handoff issue'",
    "- When the evidence points to Awake/Start/OnEnable or load-order timing, use the exact phrase 'initialization-order issue' or 'execution-order issue'",
    "- When the evidence is sparse and the next move is to inspect a signal, explicitly say to instrument or log the exact handoff, event, registration, or state transition",
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
    "- If a follow-up observation says a step changed nothing, say 'this did not affect the issue' and, if another lever changes the symptom, say 'this contradicts the previous hypothesis'",
    "- If a follow-up observation cleanly tracks the same cause again, use stable confirmation language such as 'cleanly tracks the same cause', 'consistently reproduces the issue', and 'this confirms the cause'",
    "- Do not switch between many synonyms for the same concept; prefer one stable phrasing for contradiction, confirmation, duplicate writers, ownership/reference handoff, and initialization order",
    "- If you state certainty in prose, use only 'low confidence', 'medium confidence', or 'high confidence' wording and keep that wording aligned with the evidence strength",
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
    `- Action result: ${normalizeText(input.actionResult) || "None provided."}`,
    `- Session ID: ${normalizeText(input.sessionId) || "None provided."}`,
    `- Step index: ${Number.isInteger(input.stepIndex) ? input.stepIndex : "None provided."}`,
    `- Goal: ${normalizeText(input.goal) || "None provided."}`,
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
    "- Prefer these exact phrases when they fit the evidence: 'duplicate writer conflict', 'ownership/reference handoff issue', 'initialization-order issue', 'this did not affect the issue', 'this contradicts the previous hypothesis', 'cleanly tracks the same cause', 'consistently reproduces the issue', 'this confirms the cause'",
    "- If the issue report already names one concrete handoff, path, or subsystem and the rest of the system stays normal, frame it as a bounded isolation case instead of a broad subsystem mystery",
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
    hasActionResult: Boolean(normalizeText(input.actionResult)),
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

  return ensureConfirmationFirstStep(
    shapeFreeAnalysisResponse({
      input,
      response: toFreeAnalysisResponse(parsed),
    }),
  );
}

function classifyIssue(input: AnalysisInput):
  | "reference"
  | "compile"
  | "build"
  | "performance"
  | "rendering"
  | "physics"
  | "general" {
  const combined = [input.problemDescription, input.errorMessage, input.context, input.codeSnippet, input.actionResult]
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
    hasActionResult: Boolean(normalizeText(input.actionResult)),
    hasSessionId: Boolean(normalizeText(input.sessionId)),
    stepIndex: Number.isInteger(input.stepIndex) ? input.stepIndex : null,
    hasGoal: Boolean(normalizeText(input.goal)),
  });

  return shapeFreeAnalysisResponse({
    input,
    response: buildFallbackAnalysis(input),
  });
}