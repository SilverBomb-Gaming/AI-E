"""Deterministic models for the unified /chat orchestration layer."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


ChatDetectedMode = Literal[
    "new_intent",
    "refine_intent",
    "view_intent",
    "build_plan",
    "view_plan",
    "propose_step",
    "approve_step_request",
    "propose_bundle",
    "approve_bundle_request",
    "status_request",
    "unknown",
]


@dataclass(frozen=True)
class ChatOrchestrationContext:
    has_active_translation_draft: bool
    has_active_plan: bool
    has_active_step_proposal: bool
    has_active_bundle_proposal: bool
    has_running_bundle: bool
    last_loop_action_summary: str
    current_blockers: tuple[str, ...]

    def to_payload(self) -> dict[str, object]:
        return {
            "has_active_translation_draft": self.has_active_translation_draft,
            "has_active_plan": self.has_active_plan,
            "has_active_step_proposal": self.has_active_step_proposal,
            "has_active_bundle_proposal": self.has_active_bundle_proposal,
            "has_running_bundle": self.has_running_bundle,
            "last_loop_action_summary": self.last_loop_action_summary,
            "current_blockers": list(self.current_blockers),
        }


@dataclass(frozen=True)
class ChatOrchestrationResult:
    orchestration_id: str
    chat_id: str
    detected_mode: ChatDetectedMode
    rationale: str
    routed_capability: str
    routed_action: str
    user_visible_summary: str
    follow_up_questions: tuple[str, ...]
    blockers: tuple[str, ...]
    requires_explicit_operator_confirmation: bool

    def to_payload(self) -> dict[str, object]:
        return {
            "orchestration_id": self.orchestration_id,
            "chat_id": self.chat_id,
            "detected_mode": self.detected_mode,
            "rationale": self.rationale,
            "routed_capability": self.routed_capability,
            "routed_action": self.routed_action,
            "user_visible_summary": self.user_visible_summary,
            "follow_up_questions": list(self.follow_up_questions),
            "blockers": list(self.blockers),
            "requires_explicit_operator_confirmation": self.requires_explicit_operator_confirmation,
        }