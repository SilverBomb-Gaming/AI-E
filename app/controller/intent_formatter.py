"""Human-readable formatting helpers for translated product intent."""
from __future__ import annotations

from .intent_models import IntentTranslationSession, IntentTranslationSpec


class IntentFormatter:
    """Render translated intent into concise operator-facing text."""

    def format_operator_summary(self, spec: IntentTranslationSpec) -> str:
        lines = [
            "Translation",
            f"Type: {spec.request_type}",
            f"Title: {spec.title}",
            f"Summary: {spec.summary}",
        ]
        if spec.confirmed_values:
            lines.append(f"Confirmed: {self._join_items(spec.confirmed_values, limit=4)}")
        if spec.functional_requirements:
            lines.append(f"Requirements: {self._join_items(spec.functional_requirements, limit=4)}")
        if spec.open_questions:
            lines.append("Open questions:")
            lines.extend(f"- {item}" for item in spec.open_questions[:3])
        if spec.assumptions:
            lines.append(f"Assumptions: {self._join_items(spec.assumptions, limit=3)}")
        lines.append(f"Next: {self._next_step(spec)}")
        return "\n".join(lines)

    def format_translation_session(
        self,
        session: IntentTranslationSession,
        *,
        heading: str,
    ) -> str:
        lines = [
            heading,
            f"Session: {session.translation_session_id} {session.state}",
            f"Type: {session.current_spec.request_type}",
            f"Summary: {session.current_spec.summary}",
        ]
        if session.current_spec.confirmed_values:
            lines.append(f"Confirmed: {self._join_items(session.current_spec.confirmed_values, limit=4)}")
        if session.open_questions:
            lines.append("Open questions:")
            lines.extend(f"- {item}" for item in session.open_questions[:3])
        if session.assumptions:
            lines.append(f"Assumptions: {self._join_items(session.assumptions, limit=2)}")
        lines.append(f"Next: {self._session_next_step(session)}")
        return "\n".join(lines)

    def format_no_active_session(self) -> str:
        return "No active translation draft.\nNext: Use /translate <idea or request>."

    def format_clear_reply(self, session: IntentTranslationSession | None) -> str:
        if session is None:
            return "No active translation draft to clear."
        return f"Translation draft cleared.\nSession: {session.translation_session_id} archived."

    def format_execution_handoff(self, spec: IntentTranslationSpec) -> str:
        lines = [
            "Execution handoff",
            f"Intent id: {spec.intent_id}",
            f"Target: {spec.delivery_target}",
            f"Goal: {spec.product_goal.what}",
            f"Audience: {spec.product_goal.who}",
            f"Outcome: {spec.product_goal.why}",
        ]
        if spec.functional_requirements:
            lines.append("Functional requirements:")
            lines.extend(f"- {item}" for item in spec.functional_requirements)
        if spec.constraints:
            lines.append("Constraints:")
            lines.extend(f"- {item}" for item in spec.constraints)
        if spec.non_functional_requirements:
            lines.append("Non-functional requirements:")
            lines.extend(f"- {item}" for item in spec.non_functional_requirements)
        if spec.assumptions:
            lines.append("Assumptions:")
            lines.extend(f"- {item}" for item in spec.assumptions)
        if spec.open_questions:
            lines.append("Open questions:")
            lines.extend(f"- {item}" for item in spec.open_questions)
        lines.append("Operator note: keep execution explicit, confirmation-gated, and audited.")
        return "\n".join(lines)

    @staticmethod
    def _join_items(items: tuple[str, ...], *, limit: int) -> str:
        selected = list(items[:limit])
        remaining = len(items) - len(selected)
        summary = "; ".join(selected)
        if remaining > 0:
            return f"{summary}; +{remaining} more"
        return summary

    @staticmethod
    def _next_step(spec: IntentTranslationSpec) -> str:
        if spec.open_questions:
            return "Answer the open questions, then generate an implementation brief for the controlled operator loop."
        return "Use the execution handoff to drive a bounded implementation brief or operator task sequence."

    @staticmethod
    def _session_next_step(session: IntentTranslationSession) -> str:
        if session.open_questions:
            return "Reply with /refine <clarification> or inspect the draft with /translateview."
        return "Use /planbuild or /translateview."
