"""Deterministic production-conversation intent detection."""
from __future__ import annotations

from dataclasses import dataclass

from .production_state_models import TASK_TAXONOMY, ProductionConversationMemory, ProductionTaskCategory, normalize_task_category


@dataclass(frozen=True)
class ProductionIntentDecision:
    matched: bool
    intent: str
    rationale: str
    category: str = ""
    title: str = ""
    target: str = ""
    secondary_category: str = ""
    mobile: bool = False
    needs_clarification: bool = False
    clarification_message: str = ""

    def to_payload(self) -> dict[str, object]:
        return {
            "matched": self.matched,
            "intent": self.intent,
            "rationale": self.rationale,
            "category": self.category,
            "title": self.title,
            "target": self.target,
            "secondary_category": self.secondary_category,
            "mobile": self.mobile,
            "needs_clarification": self.needs_clarification,
            "clarification_message": self.clarification_message,
        }


class ProductionIntentRouter:
    _STATUS_MARKERS = (
        "what's the current status",
        "what is the current status",
        "what’s the current status",
        "current status",
        "what's going on",
        "what is going on",
        "what’s going on",
        "where are we at",
        "where are we at on current priorities",
        "where do we stand",
        "status update",
        "quick status update",
    )
    _BLOCKED_MARKERS = ("what is blocked", "what's blocked", "what’s blocked", "blocked", "what needs my attention")
    _CHANGES_MARKERS = (
        "what changed",
        "what changed since yesterday",
        "what happened after that",
        "what happened",
    )
    _NODE_MARKERS = (
        "which nodes are busy",
        "which nodes are busy right now",
        "who is working on that",
        "node-focused update",
    )
    _MOBILE_MARKERS = ("quick mobile update", "mobile update", "quick status", "short status")
    _SET_PRIORITY_MARKERS = ("shift priority to ", "focus on ", "move focus to ", "set priority to ")
    _PAUSE_MARKERS = ("pause it", "pause that", "pause the current", "pause current", "stop ")
    _RESUME_MARKERS = ("resume it", "resume that", "continue that", "continue it", "resume ")
    _MOVE_MARKERS = ("move it to another node", "move this to another node", "move it", "move this")
    _ASSIGN_MARKERS = ("have the qa node", "have the validation node", "assign", "move to another node")

    _CATEGORY_ALIASES: dict[str, ProductionTaskCategory] = {
        "gameplay": "gameplay",
        "gameplay systems": "gameplay",
        "combat": "gameplay",
        "combat feel": "gameplay",
        "ai": "ai_behavior",
        "ai behavior": "ai_behavior",
        "ui": "ui_ux",
        "ux": "ui_ux",
        "systems": "systems_tools",
        "tools": "systems_tools",
        "animation": "animation",
        "audio": "audio",
        "content": "content_pipeline",
        "content prep": "content_pipeline",
        "content experiments": "content_pipeline",
        "performance": "performance",
        "build": "build_release",
        "release": "build_release",
        "build validation": "build_release",
        "qa": "qa_validation",
        "validation": "qa_validation",
        "validation effort": "qa_validation",
        "validation loop": "qa_validation",
        "research": "research_modeling",
        "model": "research_modeling",
    }

    def classify(self, *, message: str, memory: ProductionConversationMemory | None) -> ProductionIntentDecision:
        normalized = " ".join(message.lower().split())
        canonical = normalized.rstrip(".!? ")
        has_production_context = memory is not None and bool(memory.current_project_id)
        if not normalized:
            return self._ignore("No conversational content was provided.")
        if has_production_context and any(marker in normalized for marker in self._MOBILE_MARKERS):
            return ProductionIntentDecision(matched=True, intent="status_mobile", rationale="The user asked for a mobile-style production update.", mobile=True)
        if has_production_context and any(marker in normalized for marker in self._STATUS_MARKERS):
            return ProductionIntentDecision(matched=True, intent="status_overview", rationale="The user asked for a production status summary.")
        if has_production_context and any(marker in normalized for marker in self._BLOCKED_MARKERS):
            return ProductionIntentDecision(matched=True, intent="status_blocked", rationale="The user asked for blocked work or operator attention.")
        if has_production_context and any(marker in normalized for marker in self._CHANGES_MARKERS):
            return ProductionIntentDecision(matched=True, intent="status_changes", rationale="The user asked for recent production changes.")
        if has_production_context and any(marker in normalized for marker in self._NODE_MARKERS):
            return ProductionIntentDecision(matched=True, intent="status_nodes", rationale="The user asked for node activity or ownership.")
        if has_production_context and canonical == "what needs my attention":
            return ProductionIntentDecision(matched=True, intent="status_attention", rationale="The user asked what needs attention.")
        for marker in self._SET_PRIORITY_MARKERS:
            if marker in normalized:
                title = normalized.split(marker, 1)[1].strip(" .")
                category = self._extract_category(title)
                return ProductionIntentDecision(
                    matched=True,
                    intent="set_priority",
                    rationale="The user asked to change production focus.",
                    category=category,
                    title=title,
                )
        if "pause" in normalized and "validation" in normalized:
            return ProductionIntentDecision(matched=True, intent="pause_validation", rationale="The user asked to pause validation work.", category="qa_validation", title="validation")
        if canonical in {"pause it", "pause that"}:
            if not has_production_context:
                return self._clarify("I need to know which production item you want to pause.")
            return ProductionIntentDecision(matched=True, intent="pause_followup", rationale="The user referred to the last production target.")
        if "resume" in normalized and "validation" in normalized:
            return ProductionIntentDecision(matched=True, intent="resume_validation", rationale="The user asked to resume validation work.", category="qa_validation", title="validation")
        if canonical in {"resume it", "resume that", "continue that", "continue it"}:
            if not has_production_context:
                return self._clarify("I need a recent production target before I can continue it.")
            return ProductionIntentDecision(matched=True, intent="resume_followup", rationale="The user referred to the last production target.")
        if any(marker in normalized for marker in self._MOVE_MARKERS):
            if memory is None or not memory.last_priority_id:
                return self._clarify("I need a recently discussed priority before I can move it to another node.")
            return ProductionIntentDecision(matched=True, intent="move_followup", rationale="The user asked to reassign the current production target.")
        if has_production_context and canonical in {"what changed", "what happened after that", "who is working on that"}:
            if memory is None or not (memory.last_priority_id or memory.most_recent_task_title or memory.last_meaningful_action_summary):
                return self._clarify("I need a recent production reference before I can resolve that follow-up.")
            return ProductionIntentDecision(
                matched=True,
                intent="status_nodes" if "who is working" in canonical else "status_changes",
                rationale="The user asked a short follow-up about the last production topic.",
            )
        if "qa node" in normalized or "validation node" in normalized:
            category = self._extract_category(normalized) or "qa_validation"
            return ProductionIntentDecision(
                matched=True,
                intent="assign_priority",
                rationale="The user asked to route work to a discipline-specific node.",
                category=category,
                title=normalized,
                target="validator",
            )
        if "stop content experiments" in normalized and "resume build validation" in normalized:
            return ProductionIntentDecision(
                matched=True,
                intent="pause_and_shift",
                rationale="The user asked to stop one area and refocus another.",
                category="content_pipeline",
                secondary_category="build_release",
                title="build validation",
            )
        if memory is not None and memory.current_project_id and any(word in normalized for word in ("blocked", "priority", "node", "milestone", "approval", "validation", "build")):
            return ProductionIntentDecision(matched=True, intent="status_overview", rationale="An active production context exists and the message refers to production concepts.")
        return self._ignore("The message does not look like a production-orchestration request.")

    def _extract_category(self, text: str) -> str:
        lowered = text.lower()
        for alias, category in sorted(self._CATEGORY_ALIASES.items(), key=lambda item: len(item[0]), reverse=True):
            if alias in lowered:
                return category
        if lowered in TASK_TAXONOMY:
            return normalize_task_category(lowered)
        return ""

    @staticmethod
    def _ignore(rationale: str) -> ProductionIntentDecision:
        return ProductionIntentDecision(matched=False, intent="ignore", rationale=rationale)

    @staticmethod
    def _clarify(message: str) -> ProductionIntentDecision:
        return ProductionIntentDecision(
            matched=True,
            intent="clarify",
            rationale="The request references production state but lacks enough context for a safe bounded action.",
            needs_clarification=True,
            clarification_message=message,
        )
