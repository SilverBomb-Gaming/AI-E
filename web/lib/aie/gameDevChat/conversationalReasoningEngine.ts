import type { GameDevChatRoute, GameDevSessionContext } from "./gameDevChatTypes";

export type ConversationalReasoningConfidence = "LOW" | "MEDIUM" | "HIGH";
export type RuntimeAvailabilityStatus = "available_supervised" | "available_read_only" | "disabled_or_requires_approval" | "blocked_not_implemented" | "not_applicable";
export type ContextImportance = "primary_task" | "runtime_request" | "blocked_request" | "tangent" | "clarification" | "recap";
export type GameplayFeedbackCategory = "combat_impact" | "pacing_retention" | "pacing_inconsistency" | "inventory_cognitive_load" | "believability_world_design" | "ui_atmosphere" | "emotional_flatness" | "tension_design" | "interaction_feel" | "world_believability" | "ui_immersion_break" | "psychological_safety_subversion" | "environmental_storytelling" | "curiosity_decay" | "inventory_decision_fatigue" | "exploration_predictability" | "pacing_curve_inconsistency" | "player_interest_dropoff" | "smart_feedback_fallback";
export type GameplayFeedbackMatchKind = "exact" | "alias" | "smart_fallback";

export type GameplayFeedbackAnalysis = {
  category: GameplayFeedbackCategory;
  label: string;
  dimensions: string[];
  whatThisProbablyMeans: string;
  likelyCauses: string[];
  highestLeverageFixes: string[];
  diagnosticQuestions: string[];
  smallValidationLoop: string[];
  optionalBoundedWorkflowSuggestion: string;
  responseStrategy: string;
  matchKind: GameplayFeedbackMatchKind;
  matchedPhraseFamily: string;
  fallbackReason?: string;
  contextualLens?: string;
};

export type ConversationalReasoningResult = {
  phaseId: "CONVERSATIONAL_INTELLIGENCE_AND_DYNAMIC_REASONING_PHASE1" | "DEEP_GAMEPLAY_REASONING_AND_DECOMPOSITION_PHASE1" | "BROADER_REASONING_COVERAGE_AND_SMART_FALLBACK_PHASE1";
  inferredIntent: string;
  probableUserGoal: string;
  confidence: ConversationalReasoningConfidence;
  contextImportance: ContextImportance;
  selectedCapabilityRoute: string;
  routeRationale: string;
  ambiguity: string[];
  reasoningPath: string[];
  dynamicDecomposition: string[];
  inferredFeedbackCategory?: GameplayFeedbackCategory;
  categoryMatchKind?: GameplayFeedbackMatchKind;
  matchedPhraseFamily?: string;
  fallbackReason?: string;
  decompositionDimensions: string[];
  selectedResponseStrategy: string;
  gameplayFeedback?: GameplayFeedbackAnalysis;
  runtimeAwareness: {
    runtimeAvailability: RuntimeAvailabilityStatus;
    realCapabilities: string[];
    blockedCapabilities: string[];
    missingCapabilityExplanation?: string;
  };
  limitationExplanation: string;
  nextUsefulStep: string;
  shouldPreservePreviousTaskContext: boolean;
  truthfulnessWarnings: string[];
};

type ReasoningInput = {
  message: string;
  route: GameDevChatRoute;
  sessionContext?: GameDevSessionContext;
  subsystem?: "conversation" | "scoped_execution" | "operator_work_cycle" | "durable_runtime" | "meaningful_long_run" | "development_campaign";
};

function hasHorrorContext(message: string, sessionContext?: GameDevSessionContext): boolean {
  const combined = [
    message,
    sessionContext?.currentProject,
    sessionContext?.activeGameplaySystem,
    sessionContext?.currentImplementationTask,
    sessionContext?.latestAssistantResponseSummary,
  ].filter(Boolean).join(" ").toLowerCase();
  return /psychological horror|horror exploration|atmospheric exploration|dark atmosphere|horror|dread|unease|uncanny/.test(combined);
}

function isDesignFeedbackLike(message: string): boolean {
  return /\b(feels?|players?|player's|curiosity|immersion|flow|loop|pacing|world|environment|level|rooms?|inventory|combat|tension|mystery|exploration|interest|fatigue|overwhelming|artificial|predictable|repetitive|unsafe|safe rooms?|lived-in|staged|believable|rhythm|feedback|unsatisfying|clunky)\b/i.test(message);
}

function smartFallbackAnalysis(message: string, sessionContext?: GameDevSessionContext): GameplayFeedbackAnalysis | undefined {
  if (!isDesignFeedbackLike(message)) {
    return undefined;
  }
  const lower = message.toLowerCase();
  const systemArea = /ui|interface|hud|menu/.test(lower)
    ? "interface/feedback layer"
    : /inventory|item/.test(lower)
      ? "inventory and decision flow"
      : /world|environment|level|room|exploration/.test(lower)
        ? "world, level, or exploration loop"
        : /combat|enemy|hit|attack/.test(lower)
          ? "combat or encounter feel"
          : /pacing|interest|curiosity|tension|mystery|rhythm/.test(lower)
            ? "pacing, curiosity, or emotional rhythm"
            : "player experience loop";
  return withHorrorLens({
    category: "smart_feedback_fallback",
    label: "nuanced player-experience feedback",
    dimensions: ["probable player experience", "likely system area", "cause category", "friction or emotion shift", "validation signal", "bounded action path"],
    whatThisProbablyMeans: `The player-facing symptom is real enough to analyze, but it did not map cleanly to one of the deeper named categories. I would treat it as a ${systemArea} problem until playtest evidence narrows it.`,
    likelyCauses: [
      "The player may be feeling a mismatch between intended emotion and the feedback the game actually gives.",
      "A system may be functionally correct but missing readable cause, consequence, contrast, or payoff.",
      "The issue may live between systems rather than inside one script, asset, menu, or encounter.",
      "The wording points to experience quality, so jumping straight to implementation would likely fix the wrong layer.",
    ],
    highestLeverageFixes: [
      "Name the intended player emotion or behavior in one sentence before changing mechanics.",
      "Identify the first moment where the current experience breaks that intention.",
      "Change one visible lever at a time: timing, feedback, clarity, consequence, contrast, or friction.",
      "Use a short before/after playtest slice instead of broad redesign notes.",
    ],
    diagnosticQuestions: ["Where is the first moment the player stops feeling what the design intends?"],
    smallValidationLoop: [
      "Pick one 60-120 second slice where the symptom appears.",
      "Write the intended emotion, decision, or question for that slice.",
      "Change one likely cause category and replay the same slice.",
      "Keep the change only if a tester describes the intended experience without prompting.",
    ],
    optionalBoundedWorkflowSuggestion: "AI-E can prepare a bounded supervised workflow to inspect the relevant notes/files and record one scoped experience-improvement plan after approval.",
    responseStrategy: "smart fallback: decompose player-experience feedback without pretending exact category certainty",
    matchKind: "smart_fallback",
    matchedPhraseFamily: "design/playtest feedback language",
    fallbackReason: "No deeper category alias matched, so AI-E used the broad player-experience feedback fallback instead of generic planning bullets.",
  }, message, sessionContext);
}

function withHorrorLens(analysis: GameplayFeedbackAnalysis, message: string, sessionContext?: GameDevSessionContext): GameplayFeedbackAnalysis {
  if (!hasHorrorContext(message, sessionContext)) {
    return analysis;
  }
  return {
    ...analysis,
    contextualLens: "Use the existing psychological horror context: preserve uncertainty, dread, and player vulnerability instead of solving every issue with louder feedback or faster pacing.",
    highestLeverageFixes: [
      ...analysis.highestLeverageFixes,
      "For psychological horror, make at least one fix quieter or more ambiguous so tension rises without turning the scene into pure action feedback.",
    ],
    diagnosticQuestions: [
      ...analysis.diagnosticQuestions,
      "Should this moment make the player feel powerful, unsafe, watched, lost, or reluctant to proceed?",
    ],
  };
}

export function analyzeGameplayFeedback(message: string, sessionContext?: GameDevSessionContext): GameplayFeedbackAnalysis | undefined {
  const lower = message.toLowerCase();
  const match = (patterns: RegExp[]) => patterns.some((pattern) => pattern.test(lower));
  const base = (() : GameplayFeedbackAnalysis | undefined => {
    if (match([/world.*artificial/, /not lived[- ]in/, /fake world/, /environment.*staged/, /world.*lacks logic/, /level.*feels like a set/, /world.*instead of lived[- ]in/, /world.*doesn'?t.*believable/, /world.*does not.*believable/])) {
      return {
        category: "world_believability",
        label: "world believability",
        dimensions: ["lived-in logic", "environmental cause/effect", "spatial purpose", "prop/NPC placement", "readable history", "scale coherence", "material and lighting coherence", "asset repetition", "lived-in details", "implicit routine", "off-screen life"],
        whatThisProbablyMeans: "The space may be visually complete, but players are reading it as arranged for gameplay instead of inhabited by people, history, pressure, and consequence.",
        likelyCauses: ["Rooms or props communicate coverage rather than purpose.", "Objects do not imply who used the space, what happened there, or why it changed.", "Cause/effect rules are inconsistent across clutter, lighting, damage, routes, and locked areas.", "Repeated asset patterns reveal construction instead of supporting world logic."],
        highestLeverageFixes: ["Give each important space a purpose, recent event, and implied routine before adding more dressing.", "Add cause/effect details that show what changed before the player arrived.", "Break repeated asset seams with wear, occlusion, signage, damage, or asymmetric placement logic.", "Remove decorative props that do not support use, history, threat, or navigation."],
        diagnosticQuestions: ["What should the player infer happened here without being told?", "Which room most feels like a set rather than a place?"],
        smallValidationLoop: ["Choose one artificial-feeling room.", "Write purpose, routine, disruption, and one clue.", "Change three details only: placement, cause/effect, and lighting/material cue.", "Ask a tester what happened there before explaining it."],
        optionalBoundedWorkflowSuggestion: "AI-E can prepare a bounded supervised workflow to inspect level notes or scene artifacts and record one scoped lived-in believability pass after approval.",
        responseStrategy: "alias match: diagnose lived-in world believability",
        matchKind: "alias",
        matchedPhraseFamily: "world artificial / not lived-in / staged environment",
      };
    }
    if (match([/ui.*pulls?.*out of immersion/, /interface.*breaks?.*immersion/, /hud.*immersion/, /ui.*feels.*gamey/, /menus?.*pulls?.*players?.*out/])) {
      return {
        category: "ui_immersion_break",
        label: "UI immersion break",
        dimensions: ["diegetic fit", "visual language", "transition timing", "input feedback", "information density", "tone mismatch", "attention theft", "readability under pressure"],
        whatThisProbablyMeans: "The UI is probably functional, but it is drawing attention to itself at moments when the player should stay emotionally inside the world.",
        likelyCauses: ["The UI visual language does not share the game world’s materials, rhythm, or tone.", "Transitions or popups interrupt tension at the wrong emotional moment.", "Information density or highlight treatment competes with the scene’s focal point.", "Feedback sounds, colors, or motion feel like generic app UI rather than part of the fiction."],
        highestLeverageFixes: ["Identify which UI moment first breaks immersion and tune only that moment.", "Reduce nonessential motion, contrast, or copy during high-mood gameplay.", "Make urgent information readable without making routine UI louder.", "Use diegetic framing or quieter transitions where the UI should feel embedded."],
        diagnosticQuestions: ["Which UI element steals attention first: prompt, inventory, HUD, damage state, objective, or menu transition?"],
        smallValidationLoop: ["Replay one gameplay moment with the UI visible.", "Mute or simplify one UI layer and compare immersion/readability.", "Retune timing, contrast, or sound for that layer only.", "Keep the change if players still understand the state without noticing the UI first."],
        optionalBoundedWorkflowSuggestion: "AI-E can prepare a bounded supervised workflow to inspect UI components/styles and propose one scoped immersion-preserving adjustment after approval.",
        responseStrategy: "alias match: reduce UI attention theft while preserving readability",
        matchKind: "alias",
        matchedPhraseFamily: "UI pulls players out of immersion",
      };
    }
    if (match([/psychologically unsafe.*safe rooms?/, /unsafe even in safe rooms?/, /safe rooms?.*(feel|feels).*unsafe/, /safe spaces?.*(dread|paranoia|unsafe)/])) {
      return {
        category: "psychological_safety_subversion",
        label: "psychological safety subversion",
        dimensions: ["unsafe safety", "ambient dread", "false relief", "anticipation", "uncertainty", "paranoia", "player vulnerability", "quiet threat implication"],
        whatThisProbablyMeans: "You want mechanical safety without emotional safety: the player can breathe, but they should not fully trust the room, silence, or rules.",
        likelyCauses: ["Safe rooms may currently signal complete relief instead of uneasy recovery.", "The game may remove too many threat cues at once.", "Environmental implication may not suggest that danger can observe, remember, or return.", "The room may lack a subtle unresolved question."],
        highestLeverageFixes: ["Keep mechanics safe but add one ambiguous sensory cue that cannot be solved immediately.", "Let the room imply observation, past harm, or changed rules without spawning a direct threat.", "Use quiet audio, object displacement, lighting instability, or spatial contradiction rather than jump scares.", "Preserve a small player vulnerability, such as limited information or uncertain exit knowledge."],
        diagnosticQuestions: ["Should the safe room feel watched, contaminated, unreliable, too quiet, or falsely familiar?"],
        smallValidationLoop: ["Pick one safe room and define what remains mechanically safe.", "Add one paranoia cue and one unresolved environmental implication.", "Test whether players rest but still hesitate before leaving.", "Remove the cue if players read it as active combat danger instead of dread."],
        optionalBoundedWorkflowSuggestion: "AI-E can prepare a bounded supervised workflow to capture one safe-room dread pass and propose scoped scene/UI/audio notes after approval.",
        responseStrategy: "alias match: preserve safety mechanically while subverting it emotionally",
        matchKind: "alias",
        matchedPhraseFamily: "psychologically unsafe safe rooms",
      };
    }
    if (match([/silent hill[- ]like environmental storytelling/, /environmental storytelling.*support/, /environment.*storytelling/, /storytelling.*environment/])) {
      return {
        category: "environmental_storytelling",
        label: "environmental storytelling",
        dimensions: ["implied history", "symbolic motif", "spatial contradiction", "object placement", "cause/effect clue", "recurring visual language", "player inference", "withheld explanation"],
        whatThisProbablyMeans: "The environment should carry story pressure through implication: players feel meaning before they can fully explain it.",
        likelyCauses: ["Current spaces may tell story through explicit text instead of spatial evidence.", "Motifs may not repeat with enough variation to become readable.", "Objects may lack cause/effect relationships that invite inference.", "The world may explain too much too early, reducing mystery."],
        highestLeverageFixes: ["Choose one recurring motif tied to guilt, memory, threat, or loss.", "Let object placement imply a past action instead of describing it.", "Use contradictions in scale, repetition, or decay to create unease.", "Answer one question visually while raising a smaller new one."],
        diagnosticQuestions: ["What should the player suspect after entering the space, and what should remain unresolved?"],
        smallValidationLoop: ["Pick one room and one story implication.", "Add three clues: object, spatial contradiction, and lighting/material cue.", "Ask testers what they think happened and what they still wonder.", "Keep clues that produce inference rather than exposition."],
        optionalBoundedWorkflowSuggestion: "AI-E can prepare a bounded supervised workflow to turn a target area into an environmental-storytelling checklist after approval.",
        responseStrategy: "alias match: use implication and motif instead of exposition",
        matchKind: "alias",
        matchedPhraseFamily: "Silent Hill-like environmental storytelling",
      };
    }
    if (match([/curiosity.*collapses?/, /mystery fades?/, /stop wondering/, /players?.*stop exploring/, /no reason to investigate/, /discovery loop dies?/])) {
      return {
        category: "curiosity_decay",
        label: "curiosity decay",
        dimensions: ["mystery sustain", "question cadence", "discovery reward", "unanswered implication", "novel clue timing", "investigation payoff", "optional route value", "player hypothesis"],
        whatThisProbablyMeans: "The game is probably answering, repeating, or exhausting its mystery faster than it creates new reasons to wonder.",
        likelyCauses: ["Discoveries may not change the player’s hypothesis or available choices.", "The clue cadence may front-load answers and leave no active question.", "Optional exploration may pay out with filler instead of implication, power, or risk.", "Rooms may repeat the same discovery pattern too predictably."],
        highestLeverageFixes: ["Give each discovery a question it answers and a smaller question it opens.", "Delay one explanation and replace it with a concrete implication.", "Reward investigation with changed understanding, access, or threat awareness.", "Vary clue formats so players cannot predict every payoff."],
        diagnosticQuestions: ["What question should the player still be carrying after the current discovery?"],
        smallValidationLoop: ["Map three discoveries in sequence.", "For each, write answered question, new question, and player reward.", "Replace one dead reward with a clue that changes the hypothesis.", "Ask whether testers want to investigate the next room and why."],
        optionalBoundedWorkflowSuggestion: "AI-E can prepare a bounded supervised workflow to inspect exploration/discovery notes and propose one scoped curiosity-cadence pass after approval.",
        responseStrategy: "alias match: preserve mystery through question cadence",
        matchKind: "alias",
        matchedPhraseFamily: "curiosity collapses / discovery loop dies",
      };
    }
    if (match([/inventory.*decision fatigue/, /too many item choices/, /item management.*exhausting/, /players?.*overthink inventory/, /inventory.*overwhelming/])) {
      return {
        category: "inventory_decision_fatigue",
        label: "inventory decision fatigue",
        dimensions: ["choice count", "decision frequency", "comparison burden", "consequence clarity", "item categorization", "default choice", "risk of regret", "input steps", "sorting/filtering"],
        whatThisProbablyMeans: "Inventory is probably forcing too many repeated micro-decisions with unclear stakes, so players spend attention managing anxiety instead of playing.",
        likelyCauses: ["Too many items ask for comparison before the player knows what matters.", "Consequences of equip/use/drop/sell are unclear or feel irreversible.", "Sorting and grouping do not match the player’s current goal.", "The most common action takes too many inputs or too much visual scanning."],
        highestLeverageFixes: ["Reduce simultaneous choices by grouping items by immediate use case.", "Expose consequences and recommended/default actions before commitment.", "Make comparison focus on the two or three stats that matter now.", "Lower input steps for the most repeated inventory decision."],
        diagnosticQuestions: ["Which inventory decision creates the most hesitation: keep, equip, compare, consume, sell, discard, or craft?"],
        smallValidationLoop: ["Pick one repeated inventory decision.", "Count choices, inputs, and unclear consequences.", "Reduce one burden and replay the same decision.", "Keep the change if players decide faster without regretting the choice."],
        optionalBoundedWorkflowSuggestion: "AI-E can prepare a bounded supervised workflow to inspect inventory UI/state files and propose one scoped decision-fatigue reduction after approval.",
        responseStrategy: "alias match: reduce inventory overthinking and regret",
        matchKind: "alias",
        matchedPhraseFamily: "inventory decision fatigue / too many item choices",
      };
    }
    if (match([/exploration loop.*predictable/, /exploration.*repetitive/, /players?.*know what comes next/, /discovery pattern.*obvious/, /rooms?.*formulaic/])) {
      return {
        category: "exploration_predictability",
        label: "exploration predictability",
        dimensions: ["route rhythm", "room formula", "discovery pattern", "risk variation", "reward surprise", "spatial twist", "optional path value", "anticipation disruption"],
        whatThisProbablyMeans: "Players have learned the exploration grammar too quickly, so rooms stop asking new questions and start feeling like a repeated template.",
        likelyCauses: ["Rooms repeat the same entry, clue, obstacle, reward, and exit pattern.", "Optional paths do not change risk, knowledge, or route decisions.", "Rewards arrive at predictable intervals or obvious landmarks.", "Threat and discovery placement no longer disrupt player assumptions."],
        highestLeverageFixes: ["Break the room formula in one place: entry, route, clue, threat, reward, or exit.", "Add one optional path with a different kind of value, not just more loot.", "Use a spatial twist or delayed payoff to make players revise their mental map.", "Vary discovery timing so not every room resolves the same way."],
        diagnosticQuestions: ["What pattern have players learned, and where can the game violate it fairly?"],
        smallValidationLoop: ["Map three adjacent exploration beats.", "Identify the repeated structure.", "Change one beat to alter route, risk, reward, or question cadence.", "Ask testers what they expected and what surprised them."],
        optionalBoundedWorkflowSuggestion: "AI-E can prepare a bounded supervised workflow to inspect exploration flow notes and propose one scoped unpredictability pass after approval.",
        responseStrategy: "alias match: break exploration formula without randomizing everything",
        matchKind: "alias",
        matchedPhraseFamily: "exploration predictable / rooms formulaic",
      };
    }
    if (match([/pacing curve.*emotional rhythm/, /pacing curve.*no rhythm/, /emotional rhythm.*pacing/, /pacing.*emotional rhythm/])) {
      return {
        category: "pacing_curve_inconsistency",
        label: "pacing curve emotional rhythm",
        dimensions: ["emotional beat order", "intensity ramp", "release timing", "reward placement", "story interruption", "encounter spacing", "objective clarity", "recovery beat"],
        whatThisProbablyMeans: "The game may have events in the right rough order, but the emotional contour between them is not readable as build, pressure, release, and consequence.",
        likelyCauses: ["Intensity may reset or spike without enough setup.", "Rewards and recovery beats may arrive before the player has earned emotional release.", "Story or UI interruptions may cut across agency moments.", "Objectives may not clarify why the next beat matters emotionally."],
        highestLeverageFixes: ["Plot the emotional intensity curve separately from the objective list.", "Move one reward or recovery beat to land after effort, not before it.", "Add a quiet consequence beat after a high-pressure moment.", "Remove or relocate interruptions that flatten the ramp."],
        diagnosticQuestions: ["Where should the player feel build, peak, release, and consequence in this slice?"],
        smallValidationLoop: ["Draw a 10-minute curve with intended emotion every minute.", "Mark encounters, dialogue, traversal, rewards, and recovery.", "Move one beat that contradicts the curve.", "Ask testers to describe the rhythm without seeing the map."],
        optionalBoundedWorkflowSuggestion: "AI-E can prepare a bounded supervised workflow to record a pacing-curve map and propose one scoped emotional-rhythm adjustment after approval.",
        responseStrategy: "alias match: tune emotional pacing curve",
        matchKind: "alias",
        matchedPhraseFamily: "pacing curve emotional rhythm",
      };
    }
    if (match([/players?.*(lose|losing|drop|stop).*interest/, /interest.*drops?/, /interest.*falls?/, /bored.*after/, /retention drop/])) {
      return {
        category: "player_interest_dropoff",
        label: "player interest dropoff",
        dimensions: ["motivation gap", "short-term objective", "first reward timing", "reward timing", "novelty cadence", "challenge curve", "dead traversal", "stakes clarity", "friction spike", "progression signal", "choice freshness"],
        whatThisProbablyMeans: "Players probably understand the loop but stop expecting the next few minutes to offer a fresh goal, risk, reward, or question worth pursuing.",
        likelyCauses: ["The short-term objective may be too vague or too far away.", "Reward timing may not prove that effort changes capability, access, story, or knowledge.", "Novelty may arrive after interest has already decayed.", "Friction spikes may make progress feel more costly than exciting."],
        highestLeverageFixes: ["Move one motivating reward, reveal, or capability change earlier.", "Give the player a near-term objective they can complete in one play slice.", "Add one fresh decision before repetition becomes obvious.", "Clarify stakes so the next action has emotional or strategic meaning."],
        diagnosticQuestions: ["At the dropoff moment, what does the player believe will happen if they keep playing?"],
        smallValidationLoop: ["Find the minute where interest drops.", "Add one objective, reward, or mystery beat before that minute.", "Run a short test and ask what players expect next.", "Keep the change if they can name a reason to continue."],
        optionalBoundedWorkflowSuggestion: "AI-E can prepare a bounded supervised workflow to inspect first-session loop notes and propose one scoped interest-retention adjustment after approval.",
        responseStrategy: "alias match: diagnose motivation dropoff",
        matchKind: "alias",
        matchedPhraseFamily: "players lose/stop/drop interest",
      };
    }
    if (match([/combat.*(lack|lacks|missing|no).*impact/, /combat.*(weak|floaty|soft)/, /hits?.*(lack|lacks|missing|no).*impact/, /attacks?.*(feel|feels).*(weak|soft)/])) {
      return {
        category: "combat_impact",
        label: "combat impact",
        dimensions: ["hit stop", "screen shake", "enemy reaction", "animation anticipation/follow-through", "sound transients", "damage readability", "controller vibration", "camera impulse", "timing windows", "VFX contact clarity"],
        whatThisProbablyMeans: "The hit is probably registering mechanically, but the player is not getting enough synchronized sensory proof that contact, force, and consequence happened.",
        likelyCauses: ["Hit stop is absent or too short to let impact breathe.", "Enemy reactions do not visibly acknowledge the exact contact moment.", "Attack anticipation or follow-through is too even, so the swing has no weight shift.", "Sound transients, camera impulse, screen shake, vibration, and VFX are not aligned on the same frame.", "Damage numbers, health feedback, or stagger rules make the result hard to read."],
        highestLeverageFixes: ["Add a tiny hit-stop window and tune it separately for light, heavy, and blocked hits.", "Give enemies a clear flinch, recoil, armor spark, or posture break tied to damage type.", "Sharpen attack anticipation and follow-through so the strike has before/after contrast.", "Layer a short transient sound, contact VFX, camera impulse, and optional vibration on the hit frame.", "Make damage readability obvious through health feedback, stagger threshold, or contact-point VFX clarity."],
        diagnosticQuestions: ["Which hit type feels weakest: light attack, heavy attack, ranged hit, block, parry, or enemy hit reaction?", "Does the player miss the contact moment, the consequence, or both?", "Is the issue worse against small enemies, armored enemies, or all targets?"],
        smallValidationLoop: ["Record a five-second clip of one repeated hit in a neutral room.", "Tune hit stop, enemy reaction, contact VFX, and sound one at a time.", "Compare before/after muted and unmuted so visual and audio impact are each carrying weight.", "Stop when a tester can identify the exact contact frame and result without explanation."],
        optionalBoundedWorkflowSuggestion: "AI-E can prepare a bounded supervised workflow to inspect combat feedback assets/scripts and propose one scoped impact-tuning patch after approval.",
        responseStrategy: "diagnose sensory impact stack before implementation",
        matchKind: "exact",
        matchedPhraseFamily: "combat impact / weak attacks",
      };
    }
    if (match([/players?.*(lose|losing).*interest.*10 minutes/, /lose interest after 10/, /retention/, /boring.*10 minutes/, /after 10 minutes.*(bored|interest)/])) {
      return {
        category: "pacing_retention",
        label: "pacing and retention",
        dimensions: ["first reward timing", "novelty cadence", "goal clarity", "challenge curve", "friction spikes", "dead traversal", "weak stakes", "unclear progression", "missing short-term objective"],
        whatThisProbablyMeans: "The first session loop probably has a motivation gap: players understand the controls, but the game has not refreshed goals, stakes, rewards, or novelty quickly enough.",
        likelyCauses: ["The first meaningful reward arrives too late or feels too small.", "Novel mechanics, spaces, enemies, or decisions are introduced with a flat cadence.", "Players lack a short-term objective after the initial onboarding beat.", "Dead traversal or repeated low-stakes actions stretch the loop.", "Challenge spikes or unclear progression make effort feel poorly paid off."],
        highestLeverageFixes: ["Move the first clear reward earlier and make it visibly change player capability, knowledge, or access.", "Add a novelty beat every few minutes: a new decision, rule twist, threat, route, or reveal.", "Give the player a short-term objective that can be completed in one play slice.", "Cut or compress dead traversal between decisions and consequences.", "Smooth friction spikes so difficulty rises as a curve, not as surprise punishment."],
        diagnosticQuestions: ["At what minute do players stop making new decisions?", "What is the first reward they can name without prompting?", "Do players know what they are working toward at minute 3, 7, and 10?"],
        smallValidationLoop: ["Map the first 12 minutes as beats: objective, action, reward, novelty, friction.", "Remove or shorten one dead segment and move one reward earlier.", "Run two testers and ask what they want next at minute 10.", "Keep the change only if they can name a goal and a reason to continue."],
        optionalBoundedWorkflowSuggestion: "AI-E can prepare a bounded supervised workflow to inspect the first-session loop notes/artifacts and record a retention-focused tuning plan after approval.",
        responseStrategy: "turn retention complaint into first-session beat diagnosis",
        matchKind: "exact",
        matchedPhraseFamily: "players lose interest after time threshold",
      };
    }
    if (match([/pacing.*(inconsistent|uneven|weird|off)/, /inconsistent.*pacing/, /pace.*(jumpy|uneven)/])) {
      return {
        category: "pacing_inconsistency",
        label: "pacing inconsistency",
        dimensions: ["encounter spacing", "safe room intervals", "tension/release rhythm", "traversal dead zones", "dialogue/cutscene interruption", "objective clarity", "difficulty spikes", "reward timing"],
        whatThisProbablyMeans: "The game may have strong individual moments, but the transitions between pressure, rest, reward, and direction are not forming a readable rhythm.",
        likelyCauses: ["Encounters are clustered or isolated without intentional contrast.", "Safe rooms or relief beats arrive too early, too late, or without a purpose.", "Traversal dead zones separate decisions from payoff.", "Dialogue or cutscenes interrupt player momentum at the wrong time.", "Difficulty spikes and reward timing are fighting the intended emotional curve."],
        highestLeverageFixes: ["Chart encounter spacing and safe intervals as a pressure timeline.", "Pair each high-pressure segment with a deliberate release or reflection beat.", "Trim traversal that contains no threat, choice, reveal, or reward.", "Move dialogue/cutscene beats away from peak agency moments.", "Align rewards with effort so intensity resolves into meaning."],
        diagnosticQuestions: ["Where exactly does the pace feel too fast, too slow, or too stop-start?", "Do players lose objective clarity after combat, traversal, or story beats?", "Which beat should feel like release rather than interruption?"],
        smallValidationLoop: ["Make a one-page timeline of a 10-minute slice.", "Mark pressure, release, traversal, dialogue, reward, and objective beats.", "Change one spacing issue and replay only that slice.", "Ask testers to describe the intended rhythm in their own words."],
        optionalBoundedWorkflowSuggestion: "AI-E can prepare a bounded supervised workflow to capture a pacing map artifact and propose one scoped timing adjustment after approval.",
        responseStrategy: "map rhythm before tuning isolated moments",
        matchKind: "exact",
        matchedPhraseFamily: "pacing inconsistent / uneven pace",
      };
    }
    if (match([/inventory.*(cognitive overload|overload|confusing|too much|overwhelming)/, /cognitive overload.*inventory/, /inventory flow/])) {
      return {
        category: "inventory_cognitive_load",
        label: "inventory cognitive load",
        dimensions: ["item categorization", "visual grouping", "decision frequency", "screen density", "affordances", "comparison friction", "sorting/filtering", "consequences clarity", "controller/mouse input burden"],
        whatThisProbablyMeans: "The inventory is probably asking players to parse, compare, and commit too often before they understand what matters.",
        likelyCauses: ["Items are not grouped by player intent or immediate decision type.", "Screen density makes important differences compete with decorative information.", "Comparison requires memory instead of side-by-side readability.", "Sorting/filtering does not match the decisions players actually make.", "Input burden is too high for frequent checks, especially on controller."],
        highestLeverageFixes: ["Group items by use case before rarity, lore, or internal data type.", "Reduce screen density around the next likely decision.", "Add comparison affordances that expose tradeoffs without extra navigation.", "Make consequences clear before commit: equip, consume, discard, upgrade, sell.", "Lower controller/mouse input steps for the most repeated inventory action."],
        diagnosticQuestions: ["What decision does the player open inventory to make most often?", "Which information is required now, and which can be deferred?", "How many inputs does the most common inventory action take on controller and mouse?"],
        smallValidationLoop: ["Pick one repeated inventory task and count inputs, eye jumps, and ambiguous labels.", "Reorder/group only the information needed for that task.", "Run a 60-second usability pass with one item comparison or equip decision.", "Keep the change if the player can explain the tradeoff before committing."],
        optionalBoundedWorkflowSuggestion: "AI-E can prepare a bounded supervised workflow to inspect inventory UI/state files and propose one scoped grouping or comparison improvement after approval.",
        responseStrategy: "reduce decision load before adding inventory features",
        matchKind: "exact",
        matchedPhraseFamily: "inventory cognitive overload",
      };
    }
    if (match([/world.*(doesn'?t|does not).*believable/, /world.*(unbelievable|fake|empty)/, /believable.*world/, /doesn'?t feel believable/])) {
      return {
        category: "believability_world_design",
        label: "world believability",
        dimensions: ["environmental logic", "NPC/object placement", "cause/effect consistency", "readable history", "scale coherence", "lighting/material consistency", "spatial purpose", "repeated asset seams", "missing lived-in details"],
        whatThisProbablyMeans: "The world may contain assets and spaces, but players are not seeing enough evidence that places have purpose, history, rules, and consequences.",
        likelyCauses: ["Props or NPCs are placed for coverage rather than reason.", "Cause and effect are inconsistent across doors, damage, lighting, clutter, or routes.", "Spaces lack readable history: who used this place, why, and what changed?", "Scale, materials, or lighting break the implied rules of the location.", "Repeated asset seams make construction visible instead of world logic."],
        highestLeverageFixes: ["Give each room or landmark a purpose sentence before adding details.", "Add two cause/effect details that show what happened before the player arrived.", "Fix scale, material, and lighting outliers that contradict the setting.", "Vary repeated assets with placement logic, damage, wear, signage, or occlusion.", "Use lived-in details to imply routine, conflict, or neglect without exposition."],
        diagnosticQuestions: ["Which area feels most fake: layout, props, lighting, NPC behavior, or repeated assets?", "Can a player infer who uses the space and why?", "What rule does the world seem to break most often?"],
        smallValidationLoop: ["Choose one room and write its purpose, recent history, and player-facing clue.", "Change three details only: one placement, one material/lighting cue, one cause/effect clue.", "Ask a tester what they think happened there before explaining it.", "Keep details that produce the intended inference."],
        optionalBoundedWorkflowSuggestion: "AI-E can prepare a bounded supervised workflow to inspect level/world notes and record one scoped believability pass after approval.",
        responseStrategy: "restore world logic before adding more content",
        matchKind: "exact",
        matchedPhraseFamily: "world believable / fake world",
      };
    }
    if (match([/ui.*(atmosphere|atmospheric|mood|tone)/, /interface.*(atmosphere|mood)/])) {
      return {
        category: "ui_atmosphere",
        label: "UI atmosphere",
        dimensions: ["visual hierarchy", "motion tone", "audio/interaction feedback", "color temperature", "diegetic framing", "readability under pressure", "transition rhythm"],
        whatThisProbablyMeans: "The UI may be functional, but its hierarchy, motion, and feedback are not reinforcing the emotional tone of the game.",
        likelyCauses: ["UI elements use neutral timing, color, or density that clashes with the scene mood.", "Feedback sounds and transitions feel like generic app UI instead of part of the world.", "Important information is readable, but not emotionally framed.", "Motion rhythm is too busy or too flat for the intended pressure."],
        highestLeverageFixes: ["Define the UI mood in one phrase before changing styles.", "Tune transition duration and easing to match the game’s emotional tempo.", "Use color/material contrast to support urgency without sacrificing readability.", "Make only the most important state changes expressive; keep routine UI quiet."],
        diagnosticQuestions: ["Should the UI feel clinical, haunted, tactical, playful, fragile, or oppressive?", "Which UI moment breaks mood first?", "Is readability failing, tone failing, or both?"],
        smallValidationLoop: ["Pick one repeated UI interaction and retheme only timing, sound, and highlight treatment.", "Test it during a real gameplay moment, not on an empty menu.", "Keep the change if players notice the state faster and describe the intended mood."],
        optionalBoundedWorkflowSuggestion: "AI-E can prepare a bounded supervised workflow to inspect UI components/styles and propose one scoped atmosphere pass after approval.",
        responseStrategy: "tie interface feedback to emotional tone",
        matchKind: "exact",
        matchedPhraseFamily: "UI atmosphere / interface mood",
      };
    }
    if (match([/emotionally flat|emotional flatness|feels flat|flat emotionally|no emotion|not emotional/])) {
      return {
        category: "emotional_flatness",
        label: "emotional flatness",
        dimensions: ["stakes", "contrast", "character reaction", "consequence", "anticipation", "payoff", "music/silence", "player agency"],
        whatThisProbablyMeans: "The game may be presenting events, but it is not giving players enough setup, contrast, consequence, or agency to feel them.",
        likelyCauses: ["Important beats arrive without anticipation.", "Characters, systems, or the world do not react enough after events.", "Music, silence, camera, and pacing do not distinguish emotional highs and lows.", "Player choices do not visibly affect stakes or outcomes."],
        highestLeverageFixes: ["Add anticipation before the emotional beat and a visible consequence after it.", "Create contrast between normal state and changed state.", "Let a character, object, or system react in a way the player can read.", "Use music or silence sparingly to frame the moment rather than fill it."],
        diagnosticQuestions: ["What emotion should the player feel at that moment?", "What changes because the moment happened?", "Does the player have any agency before or after the beat?"],
        smallValidationLoop: ["Pick one flat beat and define setup, action, consequence, and recovery.", "Change only one setup cue and one consequence cue.", "Ask a tester what they felt and what changed."],
        optionalBoundedWorkflowSuggestion: "AI-E can prepare a bounded supervised workflow to turn one flat beat into a scoped emotional tuning checklist after approval.",
        responseStrategy: "build emotional contrast and consequence",
        matchKind: "exact",
        matchedPhraseFamily: "emotional flatness",
      };
    }
    if (match([/tense|tension|suspense|atmosphere|atmospheric|mood/])) {
      return {
        category: "tension_design",
        label: "tension design",
        dimensions: ["pacing pressure", "audio pressure", "visibility pressure", "enemy pressure", "resource pressure", "UI pressure", "environmental storytelling"],
        whatThisProbablyMeans: "The game needs pressure that players can anticipate, not just more darkness, danger, or noise.",
        likelyCauses: ["Safe intervals may be too predictable or too generous.", "Audio and visibility cues are not shaping uncertainty.", "Enemy or resource pressure does not make the player plan ahead.", "Environmental clues are not implying risk before it arrives."],
        highestLeverageFixes: ["Shorten safe intervals or delay relief in a controlled slice.", "Use silence, distant cues, or warning layers to make players predict danger.", "Reduce certainty with readable occlusion or limited sightlines.", "Let resource pressure create choices without making failure feel unfair."],
        diagnosticQuestions: ["Should tension come from pursuit, uncertainty, scarcity, time pressure, or narrative dread?", "Where should the player feel safe, and for how long?", "What clue should warn them before danger arrives?"],
        smallValidationLoop: ["Pick a 60-second route and mark safety, warning, threat, and release.", "Tune one pressure source and replay the same route.", "Ask whether players felt anticipation before the threat."],
        optionalBoundedWorkflowSuggestion: "AI-E can prepare a bounded supervised workflow to inspect a target scene/encounter plan and propose one scoped tension pass after approval.",
        responseStrategy: "shape anticipation rather than simply raising intensity",
        matchKind: "exact",
        matchedPhraseFamily: "tension / suspense / atmosphere",
      };
    }
    if (match([/interaction.*(feel|clunky|unresponsive|awkward|sticky)/, /(button|pickup|interact|interaction).*(feel|feels).*(bad|weak|clunky|off)/])) {
      return {
        category: "interaction_feel",
        label: "interaction feel",
        dimensions: ["input buffering", "prompt clarity", "target selection", "animation lock", "response latency", "feedback timing", "cancel/retry forgiveness", "state confirmation"],
        whatThisProbablyMeans: "The interaction probably works functionally, but the player cannot predict, trigger, or confirm it with enough confidence.",
        likelyCauses: ["Prompts appear too late, too often, or on the wrong target.", "Input buffering and cancel windows do not match player intent.", "Animation locks or latency hide whether the input was accepted.", "Feedback timing does not confirm state change quickly enough."],
        highestLeverageFixes: ["Make target selection and prompt priority deterministic.", "Add small input buffering or retry forgiveness for common interactions.", "Separate input acceptance feedback from long completion animation.", "Confirm the resulting state with sound, UI, animation, or object change."],
        diagnosticQuestions: ["Does the interaction fail before input, during input, or after confirmation?", "Is the wrong target selected when objects overlap?", "Do players know whether the input was accepted immediately?"],
        smallValidationLoop: ["Test the interaction from three distances and two angles.", "Tune prompt timing, input buffer, and confirmation feedback one at a time.", "Keep the change if players stop double-pressing or hesitating."],
        optionalBoundedWorkflowSuggestion: "AI-E can prepare a bounded supervised workflow to inspect interaction prompt/state code and propose one scoped feel improvement after approval.",
        responseStrategy: "separate functional interaction from perceived responsiveness",
        matchKind: "exact",
        matchedPhraseFamily: "interaction feel / clunky interaction",
      };
    }
    return undefined;
  })();
  return base ? withHorrorLens(base, message, sessionContext) : smartFallbackAnalysis(message, sessionContext);
}

function compact(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function includesAny(message: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(message));
}

function inferContextImportance(message: string, route: GameDevChatRoute): ContextImportance {
  const lower = message.toLowerCase();
  if (route.safetyStatus === "BLOCKED" || route.mode === "BLOCKED_OR_UNSAFE") {
    return "blocked_request";
  }
  if (route.needsClarification || route.mode === "CLARIFICATION_NEEDED") {
    return "clarification";
  }
  if (route.mode === "SESSION_RECAP" || /what (were|are) we/i.test(message)) {
    return "recap";
  }
  if (route.conversationMode === "SCOPED_EXECUTION_REQUEST" || route.conversationMode === "OPERATOR_WORK_CYCLE_REQUEST" || route.conversationMode === "DURABLE_RUNTIME_CONTINUITY_REQUEST" || route.conversationMode === "MEANINGFUL_LONG_RUN_REQUEST") {
    return "runtime_request";
  }
  if (/^(thanks|thank you|ok|okay|cool|nice|goodnight|hello|hi)\b/i.test(lower)) {
    return "tangent";
  }
  return "primary_task";
}

function runtimeStatusFor(message: string, route: GameDevChatRoute, subsystem?: ReasoningInput["subsystem"]): RuntimeAvailabilityStatus {
  const lower = message.toLowerCase();
  if (includesAny(lower, [/run unity/, /open unity/, /control unity/, /playtest in unity/, /unity editor/])) {
    return "blocked_not_implemented";
  }
  if (includesAny(lower, [/autonomous_real/, /overnight/, /unattended/, /hands[- ]off/, /do everything/])) {
    return "blocked_not_implemented";
  }
  if (subsystem === "operator_work_cycle") {
    return "available_supervised";
  }
  if (subsystem === "scoped_execution" || route.conversationMode === "SCOPED_EXECUTION_REQUEST") {
    return "disabled_or_requires_approval";
  }
  if (subsystem === "durable_runtime" || subsystem === "meaningful_long_run") {
    return "disabled_or_requires_approval";
  }
  return "not_applicable";
}

function decompositionFor(message: string, route: GameDevChatRoute, gameplayFeedback?: GameplayFeedbackAnalysis): string[] {
  if (gameplayFeedback) {
    return gameplayFeedback.dimensions;
  }
  const lower = message.toLowerCase();
  if (/tense|tension|suspense|atmosphere|atmospheric|mood/.test(lower)) {
    return [
      "Pacing pressure: shorten safe intervals, delay relief, or make consequences feel closer.",
      "Audio pressure: use silence, distant cues, heartbeat-like rhythm, or warning layers carefully.",
      "Visibility pressure: reduce certainty with occlusion, limited sightlines, contrast, or readable darkness.",
      "Enemy pressure: make patrol timing, pursuit commitment, and recovery windows create anticipation.",
      "Resource pressure: limit time, health, ammo, light, inventory, or retry comfort without making the game unfair.",
      "UI pressure: expose urgent information clearly, but avoid noisy overlays that fight the intended mood.",
      "Environmental storytelling: imply risk before showing it so the player starts predicting danger.",
    ];
  }
  if (/jump|floaty|movement/.test(lower)) {
    return ["Physics feel", "Input buffering", "Apex timing", "Fall acceleration", "Ground/edge forgiveness", "Tiny repeatable test scene"];
  }
  if (/enemy|patrol|combat/.test(lower)) {
    return ["State ownership", "Movement route", "Detection rule", "Chase/return behavior", "Tuning variables", "Scene validation"];
  }
  if (route.conversationMode === "OPERATOR_WORK_CYCLE_REQUEST") {
    return ["Infer repo task category", "Prepare bounded plan", "Request approval", "Run scoped mutation", "Capture diff/checkpoint/validation evidence", "Report blocked capabilities"];
  }
  if (route.conversationMode === "SCOPED_EXECUTION_REQUEST") {
    return ["Classify command intent", "Check allowlist and working directory", "Require approval", "Run only through trusted adapter", "Report stdout/stderr and truthfulness labels"];
  }
  return ["Clarify the real target", "Identify the smallest useful next step", "Name the relevant capability boundary", "Keep the response truthful about execution"];
}

function blockedCapabilitiesFor(message: string, route: GameDevChatRoute): string[] {
  const lower = message.toLowerCase();
  const blocked = new Set<string>();
  if (/unity|editor|playtest/.test(lower)) {
    blocked.add("direct Unity Editor control from operator chat");
  }
  if (/overnight|unattended|hands[- ]off|autonomous_real|do everything/.test(lower)) {
    blocked.add("unattended autonomous operation");
    blocked.add("autonomous_real status");
  }
  if (/delete everything|reset --hard|force push|rm -rf|remove-item/.test(lower) || route.safetyStatus === "BLOCKED") {
    blocked.add("destructive or unrestricted shell execution");
  }
  if (route.conversationMode !== "OPERATOR_WORK_CYCLE_REQUEST") {
    blocked.add("unrestricted arbitrary repo mutation");
  }
  return Array.from(blocked);
}

function realCapabilitiesFor(route: GameDevChatRoute, subsystem?: ReasoningInput["subsystem"]): string[] {
  const capabilities = ["session-scoped conversational context", "deterministic route classification", "truthful no-execution labeling"];
  if (subsystem === "operator_work_cycle" || route.conversationMode === "OPERATOR_WORK_CYCLE_REQUEST") {
    capabilities.push("bounded supervised repo workflow", "approved scoped mutation", "checkpoint/diff/validation visibility");
  }
  if (subsystem === "scoped_execution" || route.conversationMode === "SCOPED_EXECUTION_REQUEST") {
    capabilities.push("approved allowlisted command execution when trusted runtime is enabled");
  }
  if (subsystem === "durable_runtime" || route.conversationMode === "DURABLE_RUNTIME_CONTINUITY_REQUEST") {
    capabilities.push("local JSON file-backed durable runtime restore reporting");
  }
  if (subsystem === "meaningful_long_run" || route.conversationMode === "MEANINGFUL_LONG_RUN_REQUEST") {
    capabilities.push("approved supervised long-run test/supervised session controller");
  }
  return capabilities;
}

function missingCapabilityExplanation(message: string, runtimeAvailability: RuntimeAvailabilityStatus, blockedCapabilities: string[]): string | undefined {
  const lower = message.toLowerCase();
  if (/run unity|open unity|control unity|playtest in unity|unity editor/.test(lower)) {
    return "Unity Editor control is not implemented in this operator chat workflow. Making it real would require a trusted editor automation bridge, project-lock handling, scene/playmode validation hooks, and explicit operator approval gates.";
  }
  if (/overnight|unattended|hands[- ]off|autonomous_real|do everything/.test(lower)) {
    return "Unattended or autonomous_real operation is intentionally unavailable. Current execution remains bounded, supervised, and approval-gated, so long-running or overnight claims require measured runs and explicit operator supervision.";
  }
  if (blockedCapabilities.length > 0 || runtimeAvailability === "blocked_not_implemented") {
    return `The missing piece is ${blockedCapabilities.join(", ")}. The closest supported workflow is a bounded supervised repo request with visible approval, diff, checkpoint, and validation evidence.`;
  }
  return undefined;
}

function probableGoalFor(message: string, route: GameDevChatRoute): string {
  const lower = message.toLowerCase();
  const gameplayFeedback = analyzeGameplayFeedback(message);
  if (gameplayFeedback) {
    return `analyze ${gameplayFeedback.label} feedback into causes, levers, questions, and validation`;
  }
  if (/why|what happened|failed|blocked|cannot|can't|didn't work/.test(lower)) {
    return "understand why a workflow failed or could not proceed";
  }
  if (/what is real|what can you do|runtime state|scaffold|implemented/.test(lower)) {
    return "inspect AI-E's current runtime capabilities and limits";
  }
  if (/tense|tension|atmosphere|atmospheric/.test(lower)) {
    return "turn a vague mood request into actionable game-feel levers";
  }
  if (route.conversationMode === "OPERATOR_WORK_CYCLE_REQUEST") {
    return "prepare a visible supervised repo workflow the operator can approve";
  }
  return route.detectedIntent;
}

export function runConversationalReasoning(input: ReasoningInput): ConversationalReasoningResult {
  const message = compact(input.message);
  const route = input.route;
  const analyzedGameplayFeedback = route.conversationMode === "GAME_DEV_TASK" || route.taskMode ? analyzeGameplayFeedback(message, input.sessionContext) : undefined;
  const gameplayFeedback = analyzedGameplayFeedback?.matchKind === "smart_fallback" && route.taskMode === "UNITY_IMPLEMENTATION_PLAN" ? undefined : analyzedGameplayFeedback;
  const contextImportance = inferContextImportance(message, route);
  const runtimeAvailability = runtimeStatusFor(message, route, input.subsystem);
  const blockedCapabilities = blockedCapabilitiesFor(message, route);
  const realCapabilities = realCapabilitiesFor(route, input.subsystem);
  const ambiguity = [
    route.confidence === "LOW" ? "Route confidence is low; the user may need to name the target system or desired action." : undefined,
    route.needsClarification ? "The request lacks enough detail to safely choose an implementation path." : undefined,
    /it|that|this|continue|again/i.test(message) && !input.sessionContext?.currentImplementationTask ? "The message depends on prior context that is not fully available in this session." : undefined,
  ].filter((entry): entry is string => Boolean(entry));
  const selectedCapabilityRoute = route.conversationMode ?? route.taskMode ?? route.mode;
  const missing = gameplayFeedback ? undefined : missingCapabilityExplanation(message, runtimeAvailability, blockedCapabilities);
  const routeRationale = gameplayFeedback
    ? gameplayFeedback.matchKind === "smart_fallback"
      ? `Selected ${selectedCapabilityRoute} and smart fallback reasoning because the message looked like design/playtest feedback but did not match a deeper category alias. Fallback reason: ${gameplayFeedback.fallbackReason}`
      : `Selected ${selectedCapabilityRoute} and ${gameplayFeedback.matchKind} gameplay feedback category ${gameplayFeedback.category} from phrase family ${gameplayFeedback.matchedPhraseFamily}.`
    : `Selected ${selectedCapabilityRoute} because the message matched ${route.detectedIntent} with ${route.confidence.toLowerCase()} confidence and safety status ${route.safetyStatus}.`;
  const nextUsefulStep = route.needsClarification
    ? "Ask one precise clarification before planning or execution."
    : runtimeAvailability === "blocked_not_implemented"
      ? "Use the closest supported supervised repo workflow or ask for a planning-only Unity handoff."
      : route.conversationMode === "OPERATOR_WORK_CYCLE_REQUEST"
        ? "Review the bounded plan, then approve or reject it in the operator UI."
        : route.conversationMode === "SCOPED_EXECUTION_REQUEST"
          ? "Approve only if the command, working directory, timeout, and rollback boundary are acceptable."
          : gameplayFeedback
            ? "Pick one likely cause and run the smallest validation loop before asking AI-E to prepare a bounded workflow."
            : "Continue with the most specific target system, symptom, or desired player-facing outcome.";
  const decomposition = decompositionFor(message, route, gameplayFeedback);

  return {
    phaseId: gameplayFeedback ? "BROADER_REASONING_COVERAGE_AND_SMART_FALLBACK_PHASE1" : "CONVERSATIONAL_INTELLIGENCE_AND_DYNAMIC_REASONING_PHASE1",
    inferredIntent: route.detectedIntent,
    probableUserGoal: gameplayFeedback ? `analyze ${gameplayFeedback.label} feedback into causes, levers, questions, and validation` : probableGoalFor(message, route),
    confidence: route.confidence,
    contextImportance,
    selectedCapabilityRoute,
    routeRationale,
    ambiguity,
    reasoningPath: [
      `Read the user message as: ${probableGoalFor(message, route)}.`,
      routeRationale,
      `Context importance: ${contextImportance}.`,
      `Runtime availability: ${runtimeAvailability}.`,
      missing ?? "No missing runtime capability was required for the prepared response.",
    ],
    dynamicDecomposition: decomposition,
    inferredFeedbackCategory: gameplayFeedback?.category,
    categoryMatchKind: gameplayFeedback?.matchKind,
    matchedPhraseFamily: gameplayFeedback?.matchedPhraseFamily,
    fallbackReason: gameplayFeedback?.fallbackReason,
    decompositionDimensions: decomposition,
    selectedResponseStrategy: gameplayFeedback?.responseStrategy ?? (route.needsClarification ? "ask one clarifying question before planning" : "standard truthful planning response"),
    gameplayFeedback,
    runtimeAwareness: {
      runtimeAvailability,
      realCapabilities,
      blockedCapabilities,
      missingCapabilityExplanation: missing,
    },
    limitationExplanation: gameplayFeedback ? "This is design reasoning over the supplied feedback and session context; it has not inspected project files, edited content, run Unity, or validated gameplay." : missing ?? "The response stays inside the current supervised runtime boundary and does not claim hidden execution.",
    nextUsefulStep,
    shouldPreservePreviousTaskContext: contextImportance === "tangent" || contextImportance === "blocked_request" || contextImportance === "clarification" || contextImportance === "recap",
    truthfulnessWarnings: [
      "This is deterministic runtime-aware reasoning over known chat state and route metadata, not generalized AGI reasoning.",
      "Prepared, blocked, or clarification responses must not be described as file edits or runtime execution.",
      "autonomous_real, unrestricted repo autonomy, and unattended overnight operation remain unavailable.",
    ],
  };
}

export function formatReasoningPreface(reasoning: ConversationalReasoningResult): string {
  return [
    `Reasoning summary: I read this as ${reasoning.probableUserGoal}.`,
    `Why this route: ${reasoning.routeRationale}`,
    reasoning.ambiguity.length > 0 ? `Uncertainty: ${reasoning.ambiguity.join(" ")}` : undefined,
    `Runtime note: ${reasoning.limitationExplanation}`,
    `Next useful step: ${reasoning.nextUsefulStep}`,
  ].filter(Boolean).join("\n");
}
