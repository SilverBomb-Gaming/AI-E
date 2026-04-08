"""Structured product-intent translation models for the operator console."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


IntentRequestType = Literal[
    "website",
    "game",
    "desktop_app",
    "backend_service",
    "automation_tool",
    "feature_request",
    "repo_task",
    "unknown",
]


@dataclass(frozen=True)
class IntentProductGoal:
    what: str
    who: str
    why: str

    def to_payload(self) -> dict[str, str]:
        return {
            "what": self.what,
            "who": self.who,
            "why": self.why,
        }


@dataclass(frozen=True)
class IntentTranslationSpec:
    intent_id: str
    title: str
    request_type: IntentRequestType
    summary: str
    product_goal: IntentProductGoal
    delivery_target: str
    constraints: tuple[str, ...]
    functional_requirements: tuple[str, ...]
    non_functional_requirements: tuple[str, ...]
    clarification_questions: tuple[str, ...]
    open_questions: tuple[str, ...]
    assumptions: tuple[str, ...]
    proposed_phases: tuple[str, ...]
    execution_brief: str
    execution_handoff: str

    def to_payload(self) -> dict[str, object]:
        return {
            "intent_id": self.intent_id,
            "title": self.title,
            "request_type": self.request_type,
            "summary": self.summary,
            "product_goal": self.product_goal.to_payload(),
            "delivery_target": self.delivery_target,
            "constraints": list(self.constraints),
            "functional_requirements": list(self.functional_requirements),
            "non_functional_requirements": list(self.non_functional_requirements),
            "clarification_questions": list(self.clarification_questions),
            "open_questions": list(self.open_questions),
            "assumptions": list(self.assumptions),
            "proposed_phases": list(self.proposed_phases),
            "execution_brief": self.execution_brief,
            "execution_handoff": self.execution_handoff,
        }