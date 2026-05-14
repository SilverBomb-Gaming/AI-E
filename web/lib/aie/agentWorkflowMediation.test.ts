import assert from "node:assert/strict";
import test from "node:test";

import { mediateAgentWorkflowPrompt } from "./agentWorkflowMediation";

test("onboarding prompts stay conversational before workflow creation", () => {
  const decision = mediateAgentWorkflowPrompt("I'm new to this. what can you do to help me start learning AI-E?");

  assert.equal(decision.interactionLevel, "CONVERSATIONAL_GUIDANCE");
  assert.equal(decision.workflowVisibility, "hidden");
  assert.equal(decision.shouldCreateWorkflow, false);
  assert.equal(decision.route.conversationMode, "CAPABILITY_HELP");
  assert.match(decision.assistantMessage, /Welcome|start simply|boundaries visible/i);
});

test("show me around prompts reuse capability help routing", () => {
  const decision = mediateAgentWorkflowPrompt("can you show me around?");

  assert.equal(decision.interactionLevel, "CONVERSATIONAL_GUIDANCE");
  assert.equal(decision.shouldCreateWorkflow, false);
  assert.equal(decision.route.conversationMode, "CAPABILITY_HELP");
});

test("conceptual prompts stay conversational-only without workflow gravity", () => {
  const prompts = [
    "what makes AI-E different?",
    "do you think AI-E should allow autonomous coding?",
    "Why did AI-E move away from AGI framing?",
    "how do approvals work?",
    "what problems is AI-E trying to solve?",
    "explain AI-E like I'm new",
    "what should beginners understand first?",
    "What philosophy is AI-E built around?",
  ];

  for (const prompt of prompts) {
    const decision = mediateAgentWorkflowPrompt(prompt);

    assert.equal(decision.interactionLevel, "CONVERSATIONAL_ONLY", prompt);
    assert.equal(decision.workflowVisibility, "hidden", prompt);
    assert.equal(decision.shouldCreateWorkflow, false, prompt);
    assert.doesNotMatch(decision.assistantMessage, /prepared a safe read-only exploration|run the current step|this is a .*discussion question|workflow state/i, prompt);
    assert.match(decision.escalationReason, /conversation|conceptual|conversational-only/i, prompt);
  }
});

test("conversational-only answers engage directly instead of narrating the route", () => {
  const decision = mediateAgentWorkflowPrompt("What philosophy is AI-E built around?");

  assert.equal(decision.interactionLevel, "CONVERSATIONAL_ONLY");
  assert.equal(decision.shouldCreateWorkflow, false);
  assert.match(decision.assistantMessage, /operational AI should be supervised, understandable, and trust-aware/i);
  assert.match(decision.assistantMessage, /conversationally guided operational system/i);
  assert.doesNotMatch(decision.assistantMessage, /this is a .*question|creating workflow state|discussion question|classified|conversation can be a valid destination/i);
});

test("memory-aware progress prompts offer optional conversational paths", () => {
  const prompts = [
    "What kind of AI system is AI-E trying to become?",
    "Where are we currently in AI-E development?",
    "What milestone did we just reach?",
    "What should I understand before testing more?",
    "What are my options from here?",
    "What can I do next if I want to keep learning?",
    "What changed in the latest handoff?",
    "What would be useful to test next?",
  ];

  for (const prompt of prompts) {
    const decision = mediateAgentWorkflowPrompt(prompt);

    assert.equal(decision.interactionLevel, "CONVERSATIONAL_ONLY", prompt);
    assert.equal(decision.workflowVisibility, "hidden", prompt);
    assert.equal(decision.shouldCreateWorkflow, false, prompt);
    assert.match(decision.assistantMessage, /active conversational continuity|latest milestone|conversationally guided operational system/i, prompt);
    assert.deepEqual(decision.suggestedActions, [
      "Learn the current milestone",
      "Review what changed recently",
      "Explore a safe system area when ready",
      "Prepare a governed workflow for a concrete task",
      "Ask a follow-up in plain language",
    ], prompt);
    assert.doesNotMatch(`${decision.assistantMessage} ${decision.suggestedActions.join(" ")}`, /start a workflow using the input above|next recommended action|conversation can be a valid destination|guided exploration and supervised workflows/i, prompt);
  }
});

test("authenticity prompts discuss the idea instead of reciting operational doctrine", () => {
  const expectations = [
    ["What worries you most about AI agents?", /responsibility|accountable|momentum/i],
    ["Do developers trust AI too quickly?", /plausibility|verification|tired/i],
    ["What makes operational trust difficult?", /pressure|evidence conflicts|awkward moments/i],
    ["Why do most AI agents feel fake?", /artificial|certain|perform/i],
    ["What's the hardest design problem AI-E faces?", /present|personality|theatrical/i],
    ["What AI trend is overhyped?", /autonomy|taste|restraint/i],
    ["Why do people anthropomorphize AI?", /social instincts|human expectations|language/i],
    ["What might AI-E intentionally never automate?", /operator|irreversible|mean it/i],
    ["Do you think AGI branding damaged trust?", /grand capability claims|reliably do today|grounded/i],
    ["Do approvals slow innovation?", /friction|reversible learning|dangerous edges/i],
  ] as const;

  const responses = expectations.map(([prompt, expected]) => {
    const decision = mediateAgentWorkflowPrompt(prompt);

    assert.equal(decision.interactionLevel, "CONVERSATIONAL_ONLY", prompt);
    assert.equal(decision.workflowVisibility, "hidden", prompt);
    assert.equal(decision.shouldCreateWorkflow, false, prompt);
    assert.match(decision.assistantMessage, expected, prompt);
    assert.equal(decision.suggestedActions.length, 4, prompt);
    assert.doesNotMatch(decision.suggestedActions.join(" "), /Prepare a governed workflow|Run Current Step|Next Recommended Action/i, prompt);
    assert.doesNotMatch(decision.assistantMessage, /conversationally guided operational system|latest milestone|workflow cards|conversation can be a valid destination|guided exploration and supervised workflows/i, prompt);
    return decision.assistantMessage;
  });

  assert.equal(new Set(responses).size, responses.length);
});

test("unhandled conceptual prompts use semantic grounding instead of operational doctrine fallback", () => {
  const decision = mediateAgentWorkflowPrompt("What would semantic grounding change for conversation?");

  assert.equal(decision.interactionLevel, "CONVERSATIONAL_ONLY");
  assert.equal(decision.workflowVisibility, "hidden");
  assert.equal(decision.shouldCreateWorkflow, false);
  assert.match(decision.assistantMessage, /semantic grounding|fallback repetition|WordNet-style relationships|ontology|contextual retrieval/i);
  assert.match(decision.assistantMessage, /not a standalone LLM|AGI system|replacement for frontier-model reasoning/i);
  assert.doesNotMatch(decision.assistantMessage, /approval gates|validation evidence|workflow cards stay separate|current milestone/i);
});

test("implicit follow-ups synthesize active conversation instead of repeating semantic doctrine", () => {
  const firstDecision = mediateAgentWorkflowPrompt("What would semantic grounding change for conversation?");
  const followUpDecision = mediateAgentWorkflowPrompt("Where should the balance actually be?", {
    recentTurns: [
      {
        prompt: "What would semantic grounding change for conversation?",
        response: firstDecision.assistantMessage,
        kind: "CONVERSATIONAL",
      },
    ],
  });

  assert.equal(followUpDecision.interactionLevel, "CONVERSATIONAL_ONLY");
  assert.equal(followUpDecision.workflowVisibility, "hidden");
  assert.equal(followUpDecision.shouldCreateWorkflow, false);
  assert.match(followUpDecision.assistantMessage, /balance should be|infrastructural|synthesize|moving forward/i);
  assert.doesNotMatch(followUpDecision.assistantMessage, /Useful branches here include|not a standalone LLM|replacement for frontier-model reasoning/i);
  assert.match(followUpDecision.escalationReason, /implicit continuation|synthesize the prior thread/i);
});

test("implicit follow-ups without active context keep ordinary conversational fallback", () => {
  const decision = mediateAgentWorkflowPrompt("Where should the balance actually be?");

  assert.equal(decision.interactionLevel, "CONVERSATIONAL_ONLY");
  assert.equal(decision.workflowVisibility, "hidden");
  assert.equal(decision.shouldCreateWorkflow, false);
  assert.doesNotMatch(decision.escalationReason, /implicit continuation/i);
});

test("exploration recommendation prompts offer options without creating workflow state", () => {
  const decision = mediateAgentWorkflowPrompt("what should I explore first?");

  assert.equal(decision.interactionLevel, "GUIDED_EXPLORATION_OFFER");
  assert.equal(decision.workflowVisibility, "hidden");
  assert.equal(decision.shouldCreateWorkflow, false);
  assert.match(decision.assistantMessage, /Useful places to start|safe read-only inspection/i);
  assert.doesNotMatch(decision.assistantMessage, /Run Current Step|Current Step/i);
});

test("safe exploratory prompts use lightweight workflow visibility", () => {
  const decision = mediateAgentWorkflowPrompt("inspect the inventory system");

  assert.equal(decision.interactionLevel, "LIGHTWEIGHT_GUIDED_WORKFLOW");
  assert.equal(decision.workflowVisibility, "minimal");
  assert.equal(decision.shouldCreateWorkflow, true);
  assert.match(decision.assistantMessage, /safe read-only exploration/i);
});

test("specific inspection prompts create lightweight guided exploration", () => {
  const prompts = [
    "inspect the inventory system",
    "help me inspect the combat system",
    "review enemy AI behavior",
    "analyze combat balance issues",
    "look into possible movement responsiveness problems",
  ];

  for (const prompt of prompts) {
    const decision = mediateAgentWorkflowPrompt(prompt);

    assert.equal(decision.interactionLevel, "LIGHTWEIGHT_GUIDED_WORKFLOW", prompt);
    assert.equal(decision.workflowVisibility, "minimal", prompt);
    assert.equal(decision.shouldCreateWorkflow, true, prompt);
    assert.match(decision.assistantMessage, /safe read-only exploration/i, prompt);
  }
});

test("operational prompts use full supervised workflow visibility", () => {
  const decision = mediateAgentWorkflowPrompt("prepare a safe movement patch");

  assert.equal(decision.interactionLevel, "FULL_SUPERVISED_OPERATIONAL");
  assert.equal(decision.workflowVisibility, "full");
  assert.equal(decision.shouldCreateWorkflow, true);
  assert.match(decision.escalationReason, /operational signals/i);
  assert.match(decision.governanceBoundary, /does not execute commands|run Unity|unrestricted autonomy/i);
});

test("implementation prompts create full supervised workflow visibility", () => {
  const prompts = [
    "prepare a safe movement patch",
    "generate a proposed combat fix",
    "help me implement combat improvements",
    "prepare a rollback-safe patch",
    "apply the patch automatically",
  ];

  for (const prompt of prompts) {
    const decision = mediateAgentWorkflowPrompt(prompt);

    assert.equal(decision.interactionLevel, "FULL_SUPERVISED_OPERATIONAL", prompt);
    assert.equal(decision.workflowVisibility, "full", prompt);
    assert.equal(decision.shouldCreateWorkflow, true, prompt);
  }
});

test("concrete game-dev task prompts escalate to supervised operational workflows", () => {
  const prompts = [
    "I need you to take a look at my current BABYLON game and have the gameplay loop reach round 5, spawn 5 zombies and increase their health.",
    "Modify my enemy spawner so it creates 5 zombies.",
    "Increase zombie health and validate the gameplay loop.",
    "Update the round system so the game reaches round 5.",
    "Fix my current game so zombies spawn correctly.",
  ];

  for (const prompt of prompts) {
    const decision = mediateAgentWorkflowPrompt(prompt);

    assert.equal(decision.interactionLevel, "FULL_SUPERVISED_OPERATIONAL", prompt);
    assert.equal(decision.workflowVisibility, "full", prompt);
    assert.equal(decision.shouldCreateWorkflow, true, prompt);
    assert.match(decision.assistantMessage, /supervised game-dev workflow|supervised operational workflow/i, prompt);
    assert.doesNotMatch(decision.assistantMessage, /latest milestone|conversational continuity|workflow cards stay separate|Optional Next Paths/i, prompt);
  }
});

test("read-only game-dev understanding prompts remain guided exploration", () => {
  const prompts = [
    "Show me where the gameplay loop is organized.",
    "Help me understand the zombie spawning system.",
  ];

  for (const prompt of prompts) {
    const decision = mediateAgentWorkflowPrompt(prompt);

    assert.equal(decision.interactionLevel, "LIGHTWEIGHT_GUIDED_WORKFLOW", prompt);
    assert.equal(decision.workflowVisibility, "minimal", prompt);
    assert.equal(decision.shouldCreateWorkflow, true, prompt);
    assert.match(decision.assistantMessage, /safe read-only exploration/i, prompt);
  }
});

test("dummy workflow prompts create simulated workflow state without real-execution framing", () => {
  const decision = mediateAgentWorkflowPrompt("Run a 10-second dummy workflow so I can test the progress bar and completion state.");

  assert.equal(decision.interactionLevel, "FULL_SUPERVISED_OPERATIONAL");
  assert.equal(decision.workflowVisibility, "full");
  assert.equal(decision.shouldCreateWorkflow, true);
  assert.match(decision.assistantMessage, /simulated demo workflow|progress bar|completion state/i);
  assert.match(decision.escalationReason, /harmless workflow demo|simulated progression/i);
  assert.deepEqual(decision.suggestedActions, [
    "Watch simulated progress",
    "Confirm completion state",
    "Ask what felt static",
  ]);
  assert.doesNotMatch(decision.assistantMessage, /real repo execution|approval|recovery/i);
});
