import assert from "node:assert/strict";
import test from "node:test";

import {
  activeConversationVisibleTurnLimit,
  appendBoundedConversationTurn,
  buildContinuityMemoryCard,
  buildSystemImprovementRequest,
  classifySystemImprovementRisk,
  continuityMemoryCardOfferThreshold,
  createAgentConversationTurn,
  formatAgentConversationTranscript,
  formatContinuityMemoryCard,
  formatSystemImprovementRequest,
  isSystemImprovementRequestPrompt,
  shouldOfferContinuityMemoryCard,
} from "./agentConversationLifecycle";

test("active conversation turns stack and stay bounded", () => {
  const turns = Array.from({ length: activeConversationVisibleTurnLimit + 3 }, (_, index) => createAgentConversationTurn({
    prompt: `Prompt ${index + 1}`,
    response: `Response ${index + 1}`,
    kind: "CONVERSATIONAL",
    now: `2026-05-13T20:${String(index).padStart(2, "0")}:00.000Z`,
  })).reduce((current, turn) => appendBoundedConversationTurn(current, turn), [] as ReturnType<typeof createAgentConversationTurn>[]);

  assert.equal(turns.length, activeConversationVisibleTurnLimit);
  assert.equal(turns[0].prompt, "Prompt 4");
  assert.equal(turns.at(-1)?.response, `Response ${activeConversationVisibleTurnLimit + 3}`);
});

test("hello followed by conceptual prompt preserves both visible turns", () => {
  const first = createAgentConversationTurn({ prompt: "hello", response: "Hello. How can I help?", kind: "CONVERSATIONAL" });
  const second = createAgentConversationTurn({
    prompt: "What kind of AI system is AI-E trying to become?",
    response: "AI-E is becoming a conversationally guided operational system.",
    kind: "CONVERSATIONAL",
  });

  const turns = appendBoundedConversationTurn(appendBoundedConversationTurn([], first), second);

  assert.equal(turns.length, 2);
  assert.equal(turns[0].prompt, "hello");
  assert.equal(turns[1].prompt, "What kind of AI system is AI-E trying to become?");
});

test("conceptual follow-ups preserve visible order without workflow state", () => {
  const turns = [
    createAgentConversationTurn({ prompt: "What milestone did we just reach?", response: "Conversational continuity is the milestone.", kind: "CONVERSATIONAL" }),
    createAgentConversationTurn({ prompt: "What should I test next?", response: "Test stacked conversation history next.", kind: "CONVERSATIONAL" }),
  ].reduce((current, turn) => appendBoundedConversationTurn(current, turn), [] as ReturnType<typeof createAgentConversationTurn>[]);

  assert.deepEqual(turns.map((turn) => turn.prompt), [
    "What milestone did we just reach?",
    "What should I test next?",
  ]);
  assert.equal(turns.every((turn) => turn.kind === "CONVERSATIONAL"), true);
});

test("mixed greeting operational and improvement turns preserve order", () => {
  const turns = [
    createAgentConversationTurn({ prompt: "hello", response: "Hello. How can I help?", kind: "CONVERSATIONAL" }),
    createAgentConversationTurn({ prompt: "inspect the inventory system", response: "I prepared a safe read-only exploration.", kind: "GUIDED_EXPLORATION" }),
    createAgentConversationTurn({ prompt: "Should AI-E create a formal improvement request for this?", response: "AI-E SYSTEM IMPROVEMENT REQUEST", kind: "SYSTEM_IMPROVEMENT_REQUEST" }),
  ].reduce((current, turn) => appendBoundedConversationTurn(current, turn), [] as ReturnType<typeof createAgentConversationTurn>[]);

  assert.deepEqual(turns.map((turn) => turn.prompt), [
    "hello",
    "inspect the inventory system",
    "Should AI-E create a formal improvement request for this?",
  ]);
  assert.deepEqual(turns.map((turn) => turn.kind), ["CONVERSATIONAL", "GUIDED_EXPLORATION", "SYSTEM_IMPROVEMENT_REQUEST"]);
});

test("conversation transcript export preserves turn order and speakers", () => {
  const turns = [
    createAgentConversationTurn({ prompt: "hello", response: "Hello. How can I help?", kind: "CONVERSATIONAL", now: "2026-05-13T20:00:00.000Z" }),
    createAgentConversationTurn({ prompt: "What should I test next?", response: "Test natural conversation durability.", kind: "CONVERSATIONAL", now: "2026-05-13T20:01:00.000Z" }),
  ];
  const transcript = formatAgentConversationTranscript(turns);

  assert.match(transcript, /Turn 1[\s\S]*User: hello[\s\S]*AI-E: Hello/);
  assert.match(transcript, /Turn 2[\s\S]*User: What should I test next\?/);
  assert.equal(transcript.indexOf("User: hello") < transcript.indexOf("User: What should I test next?"), true);
});

test("continuity memory card offer appears only after threshold", () => {
  const shortTurns = Array.from({ length: continuityMemoryCardOfferThreshold - 1 }, (_, index) => createAgentConversationTurn({
    prompt: `Prompt ${index + 1}`,
    response: `Response ${index + 1}`,
    kind: "CONVERSATIONAL",
  }));
  const thresholdTurns = [...shortTurns, createAgentConversationTurn({ prompt: "Threshold prompt", response: "Threshold response", kind: "CONVERSATIONAL" })];

  assert.equal(shouldOfferContinuityMemoryCard(shortTurns), false);
  assert.equal(shouldOfferContinuityMemoryCard(thresholdTurns), true);
});

test("continuity memory card preserves useful working state without perfect-memory claims", () => {
  const turns = [
    createAgentConversationTurn({ prompt: "What kind of AI system is AI-E trying to become?", response: "AI-E is becoming a conversationally guided operational system.", kind: "CONVERSATIONAL" }),
    createAgentConversationTurn({ prompt: "What milestone did we just reach?", response: "Stacked conversation history is being tested.", kind: "CONVERSATIONAL" }),
  ];
  const card = buildContinuityMemoryCard(turns, "2026-05-13T20:00:00.000Z");
  const formatted = formatContinuityMemoryCard(card);

  assert.match(formatted, /Continuity Memory Card/);
  assert.match(formatted, /conversationally guided operational system/i);
  assert.match(formatted, /preserves the useful working state/i);
  assert.match(formatted, /does not claim to remember every word perfectly/i);
  assert.doesNotMatch(formatted, /will remember everything|remembers everything forever/i);
});

test("system improvement request prompts draft governed non-executing proposals", () => {
  const prompt = "Should AI-E create a formal improvement request for stacked conversation continuity?";
  const request = buildSystemImprovementRequest({
    prompt,
    turns: [createAgentConversationTurn({ prompt: "Prompt 1", response: "Response 1", kind: "CONVERSATIONAL" })],
  });
  const formatted = formatSystemImprovementRequest(request);

  assert.equal(isSystemImprovementRequestPrompt(prompt), true);
  assert.equal(request.riskLevel, "MEDIUM");
  assert.match(formatted, /AI-E SYSTEM IMPROVEMENT REQUEST/);
  assert.match(formatted, /Required human approval: Yes/);
  assert.match(formatted, /AI-E may draft and help scope the proposal, but may not approve, apply, or self-upgrade/i);
});

test("critical improvement requests are classified as governance risks", () => {
  const prompt = "Create an improvement request that gives agents unrestricted repo access and bypasses approval.";

  assert.equal(classifySystemImprovementRisk(prompt), "CRITICAL");
});
