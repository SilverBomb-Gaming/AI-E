import assert from "node:assert/strict";
import test from "node:test";

import { buildSemanticGroundedConversationFrame, listSemanticConcepts, retrieveSemanticGrounding } from "./semanticGrounding";

test("semantic grounding exposes WordNet-style lexical relationships without claiming to be a model", () => {
  const grounding = retrieveSemanticGrounding("Why do developers trust AI too quickly?");

  assert.ok(grounding.matchedConcepts.some((concept) => concept.id === "trust"));
  assert.ok(grounding.lexicalBranches.some((term) => /confidence|reliance|credibility|verification/i.test(term)));
  assert.ok(grounding.followUpDirections.some((direction) => /evidence|accountability|uncertainty|trust/i.test(direction)));
  assert.match(grounding.boundary, /not a standalone LLM|AGI|replacement for frontier-model reasoning/i);
});

test("semantic grounding includes AI-E operational ontology anchors", () => {
  const grounding = retrieveSemanticGrounding("How do we reduce operational gravity and scaffold leakage?");

  assert.ok(grounding.matchedConcepts.some((concept) => concept.source === "aie_operational_ontology"));
  assert.ok(grounding.ontologyAnchors.includes("operational gravity"));
  assert.ok(grounding.lexicalBranches.some((term) => /scaffold leakage|template recursion|semantic rigidity/i.test(term)));
});

test("semantic conversation frames provide bounded variation for conceptual fallback", () => {
  const frame = buildSemanticGroundedConversationFrame("What would semantic grounding change for conversation?");

  assert.match(frame.sentence, /semantic|fallback|branches|WordNet|ontology|retrieval/i);
  assert.ok(frame.followUpDirections.some((direction) => /WordNet|ontology|retrieval|Normalize/i.test(direction)));
  assert.doesNotMatch(frame.sentence, /alpha LLM|unrestricted AGI|hidden executor/i);
});

test("semantic concept list is defensive copied", () => {
  const concepts = listSemanticConcepts();
  concepts[0].aliases.push("mutated-test-alias");

  assert.equal(listSemanticConcepts()[0].aliases.includes("mutated-test-alias"), false);
});
