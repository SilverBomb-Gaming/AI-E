export type SemanticSource = "wordnet_seed" | "aie_operational_ontology";

export type SemanticRelationKind = "synonym" | "hypernym" | "hyponym" | "related" | "contrast" | "operational_analogy";

export type SemanticRelation = {
  kind: SemanticRelationKind;
  terms: string[];
};

export type SemanticConcept = {
  id: string;
  label: string;
  source: SemanticSource;
  aliases: string[];
  definition: string;
  relations: SemanticRelation[];
  conversationalAngles: string[];
  followUpDirections: string[];
};

export type SemanticGroundingFrame = {
  query: string;
  matchedConcepts: SemanticConcept[];
  lexicalBranches: string[];
  ontologyAnchors: string[];
  conversationalAngles: string[];
  followUpDirections: string[];
  boundary: string;
};

const semanticConcepts: SemanticConcept[] = [
  {
    id: "trust",
    label: "trust",
    source: "wordnet_seed",
    aliases: ["trust", "confidence", "reliance", "credibility", "dependability"],
    definition: "Confidence that a system or person behaves reliably enough for the situation at hand.",
    relations: [
      { kind: "synonym", terms: ["confidence", "reliance", "credibility"] },
      { kind: "hypernym", terms: ["belief", "expectation", "judgment"] },
      { kind: "related", terms: ["evidence", "verification", "accountability", "uncertainty"] },
      { kind: "contrast", terms: ["suspicion", "overconfidence", "blind faith"] },
    ],
    conversationalAngles: [
      "Trust is strongest when confidence grows from evidence rather than smooth phrasing.",
      "A trust discussion can branch into verification, accountability, uncertainty, and recovery after mistakes.",
    ],
    followUpDirections: ["Probe evidence", "Compare accountability", "Explore uncertainty", "Name a healthy trust test"],
  },
  {
    id: "governance",
    label: "governance",
    source: "wordnet_seed",
    aliases: ["governance", "oversight", "supervision", "safeguard", "control", "review"],
    definition: "The structures that decide who may act, under what limits, and with what review.",
    relations: [
      { kind: "synonym", terms: ["oversight", "supervision", "procedural control"] },
      { kind: "hypernym", terms: ["authority structure", "control system"] },
      { kind: "hyponym", terms: ["approval gate", "audit trail", "scope boundary"] },
      { kind: "related", terms: ["permission", "responsibility", "validation", "rollback"] },
    ],
    conversationalAngles: [
      "Governance can sound bureaucratic, but at its best it makes responsibility explicit.",
      "A governance discussion can vary through oversight, safeguards, authority, and review instead of repeating one doctrine word.",
    ],
    followUpDirections: ["Compare oversight and friction", "Name the authority boundary", "Explore safeguards", "Ask what should stay human"],
  },
  {
    id: "authenticity",
    label: "authenticity",
    source: "wordnet_seed",
    aliases: ["authentic", "authenticity", "fake", "real", "performative", "theatrical"],
    definition: "The felt alignment between what a system appears to be and what it can actually sustain.",
    relations: [
      { kind: "synonym", terms: ["genuineness", "groundedness", "integrity"] },
      { kind: "contrast", terms: ["performance", "pretense", "theater", "empty fluency"] },
      { kind: "related", terms: ["continuity", "hesitation", "limits", "voice", "presence"] },
    ],
    conversationalAngles: [
      "Fake-feeling agents often mismatch confident performance with shallow continuity.",
      "Authenticity is less about sounding human and more about making limits, memory, and uncertainty feel coherent.",
    ],
    followUpDirections: ["Separate warmth from performance", "Name what feels fake", "Explore continuity", "Compare confidence and evidence"],
  },
  {
    id: "autonomy",
    label: "autonomy",
    source: "wordnet_seed",
    aliases: ["autonomy", "autonomous", "automation", "self-directed", "hands-off"],
    definition: "Capacity to act without continuous direct instruction, bounded by scope and responsibility.",
    relations: [
      { kind: "synonym", terms: ["self-direction", "independent action", "automation"] },
      { kind: "hypernym", terms: ["agency", "control"] },
      { kind: "contrast", terms: ["supervision", "approval", "manual review"] },
      { kind: "related", terms: ["permission", "risk", "responsibility", "reversibility"] },
    ],
    conversationalAngles: [
      "Autonomy is valuable only when responsibility and reversibility are designed with it.",
      "A good autonomy discussion distinguishes speed, judgment, permission, and accountability.",
    ],
    followUpDirections: ["Question autonomy as value", "Discuss reversibility", "Compare speed and judgment", "Name the human checkpoint"],
  },
  {
    id: "semantic_grounding",
    label: "semantic grounding",
    source: "aie_operational_ontology",
    aliases: ["semantic grounding", "semantic vault", "second brain", "lexical cognition", "ontology", "wordnet"],
    definition: "A bounded support layer that gives AI-E stable meanings, lexical relationships, and operational concepts without pretending to be a standalone model.",
    relations: [
      { kind: "operational_analogy", terms: ["WordNet-style relationships", "operational ontology", "contextual retrieval"] },
      { kind: "related", terms: ["semantic stability", "conceptual continuity", "vocabulary variation", "retrieval"] },
      { kind: "contrast", terms: ["fake AGI", "knowledge hoarding", "alpha LLM"] },
    ],
    conversationalAngles: [
      "Semantic grounding should reduce fallback repetition by giving conversation more meaningful branches.",
      "The layer supports a frontier model; it does not replace one or become an alpha LLM.",
    ],
    followUpDirections: ["Start with WordNet", "Normalize noisy language", "Build AI-E ontology", "Add contextual retrieval"],
  },
  {
    id: "operational_gravity",
    label: "operational gravity",
    source: "aie_operational_ontology",
    aliases: ["operational gravity", "workflow gravity", "scaffold leakage", "doctrine loop", "fallback loop"],
    definition: "The pull that turns conversation back into workflow mechanics, policy narration, or repeated operational doctrine.",
    relations: [
      { kind: "related", terms: ["scaffold leakage", "workflow-first behavior", "repetitive fallback"] },
      { kind: "contrast", terms: ["natural rhythm", "topic exploration", "conversational authenticity"] },
      { kind: "operational_analogy", terms: ["UI gravity", "semantic rigidity", "template recursion"] },
    ],
    conversationalAngles: [
      "Operational gravity can persist even after workflow creation is fixed, because language itself can keep steering back to doctrine.",
      "Reducing it requires semantic branches, not just softer labels.",
    ],
    followUpDirections: ["Find the repeated phrase", "Branch the concept", "Move options to UI", "Test natural follow-ups"],
  },
  {
    id: "conversation_continuity",
    label: "conversation continuity",
    source: "aie_operational_ontology",
    aliases: ["conversation continuity", "continuity", "memory card", "active conversation", "stacked history"],
    definition: "The visible and semantic preservation of an active conversation long enough for the operator to continue naturally.",
    relations: [
      { kind: "related", terms: ["active turns", "bounded history", "continuity memory card", "handoff"] },
      { kind: "contrast", terms: ["replacement response", "single status field", "lost thread"] },
    ],
    conversationalAngles: [
      "Continuity is not perfect recall; it is enough preserved working state for the next exchange to feel connected.",
      "A continuity discussion can branch into visible history, memory cards, handoffs, and context quality.",
    ],
    followUpDirections: ["Review active history", "Create a memory card", "Test a follow-up", "Copy the conversation"],
  },
];

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function listSemanticConcepts(): SemanticConcept[] {
  return semanticConcepts.map((concept) => ({
    ...concept,
    aliases: [...concept.aliases],
    relations: concept.relations.map((relation) => ({ ...relation, terms: [...relation.terms] })),
    conversationalAngles: [...concept.conversationalAngles],
    followUpDirections: [...concept.followUpDirections],
  }));
}

export function retrieveSemanticGrounding(query: string): SemanticGroundingFrame {
  const normalizedQuery = normalize(query);
  const matchedConcepts = semanticConcepts.filter((concept) => {
    const candidates = [concept.label, ...concept.aliases];
    return candidates.some((candidate) => normalizedQuery.includes(normalize(candidate)));
  });
  const concepts = matchedConcepts.length > 0 ? matchedConcepts : [semanticConcepts.find((concept) => concept.id === "semantic_grounding") ?? semanticConcepts[0]];
  const lexicalBranches = unique(concepts.flatMap((concept) => concept.relations.flatMap((relation) => relation.terms))).slice(0, 12);
  const ontologyAnchors = unique(concepts.filter((concept) => concept.source === "aie_operational_ontology").map((concept) => concept.label));
  return {
    query,
    matchedConcepts: concepts,
    lexicalBranches,
    ontologyAnchors,
    conversationalAngles: unique(concepts.flatMap((concept) => concept.conversationalAngles)).slice(0, 4),
    followUpDirections: unique(concepts.flatMap((concept) => concept.followUpDirections)).slice(0, 4),
    boundary: "Semantic grounding supports lexical variation, ontology continuity, and contextual retrieval. It is not a standalone LLM, AGI system, hidden executor, or replacement for frontier-model reasoning.",
  };
}

export function buildSemanticGroundedConversationFrame(query: string): { sentence: string; followUpDirections: string[]; boundary: string } {
  const grounding = retrieveSemanticGrounding(query);
  const primary = grounding.matchedConcepts[0];
  const branchText = grounding.lexicalBranches.slice(0, 4).join(", ");
  const angle = grounding.conversationalAngles[0] ?? primary.definition;
  return {
    sentence: `${angle} Useful branches here include ${branchText}.`,
    followUpDirections: grounding.followUpDirections,
    boundary: grounding.boundary,
  };
}
