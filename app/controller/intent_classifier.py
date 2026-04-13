"""Rule-based natural chat intent classification."""
from __future__ import annotations

from .routing_types import NaturalChatClassification, NaturalChatContext


class IntentClassifier:
    """Classify plain-English operator messages into bounded intent buckets."""

    _STATUS_MARKERS = (
        "where are we",
        "where do we stand",
        "last result",
        "last run",
        "last action",
        "what happened",
        "what file",
        "working on",
        "status",
        "context",
        "what was the last result",
        "what happened on the last run",
        "help",
    )
    _EXPLANATION_MARKERS = (
        "what does",
        "explain",
        "why did",
        "why does",
        "what changed",
        "describe",
        "summarize",
        "explain the error",
    )
    _PLANNING_MARKERS = (
        "how should",
        "how would",
        "give me a plan",
        "plan for",
        "approach",
        "roadmap",
        "design",
        "implement",
        "architecture",
        "what's next",
        "what is next",
        "next step",
        "continue",
        "build me",
        "create a",
        "create an",
        "i have an idea",
        "i need a",
        "i want a",
    )
    _PATCH_MARKERS = (
        "add ",
        "fix ",
        "update ",
        "change ",
        "make this",
        "make it",
        "save logs",
        "write csv",
        "add csv",
        "csv output",
        "fix the crash",
        "patch",
    )
    _EXECUTION_MARKERS = (
        "run it",
        "run it again",
        "rerun",
        "re-run",
        "execute",
        "run the latest patch",
        "test this",
        "run this",
    )
    _TEST_MARKERS = ("test", "tests", "unit test")
    _AMBIGUOUS_SHORT_MESSAGES = frozenset({"yes", "no", "ok", "okay", "maybe"})

    def classify(self, *, message: str, context: NaturalChatContext) -> NaturalChatClassification:
        normalized = " ".join(message.lower().split())
        if not normalized:
            return NaturalChatClassification(
                intent_label="unknown_or_ambiguous",
                confidence=0.0,
                action_hints=(),
                rationale="No conversational content was provided.",
            )
        if normalized in self._AMBIGUOUS_SHORT_MESSAGES:
            return NaturalChatClassification(
                intent_label="unknown_or_ambiguous",
                confidence=0.18,
                action_hints=(),
                rationale="The message is too short to route safely.",
            )
        if self._contains_any(normalized, self._STATUS_MARKERS):
            hints = []
            if "help" in normalized:
                hints.append("help")
            if "last" in normalized or "happened" in normalized:
                hints.append("lastaction")
            if "file" in normalized or "working on" in normalized:
                hints.append("project_or_context")
            return NaturalChatClassification(
                intent_label="status_or_context",
                confidence=0.93,
                action_hints=tuple(hints),
                rationale="The message asks for current state, last result, or operator guidance.",
            )
        if self._contains_any(normalized, self._EXECUTION_MARKERS) or normalized.startswith("run ") or normalized.startswith("test "):
            hints = ("test",) if self._contains_test_request(normalized) else ("run",)
            return NaturalChatClassification(
                intent_label="execution_request",
                confidence=0.95,
                action_hints=hints,
                rationale="The message asks to execute or test an existing bounded target.",
            )
        if self._contains_any(normalized, self._EXPLANATION_MARKERS):
            return NaturalChatClassification(
                intent_label="explanation",
                confidence=0.89,
                action_hints=("contextual_explanation",),
                rationale="The message asks for an explanation or summary.",
            )
        if normalized.startswith(("how should", "how would", "give me a plan", "plan", "what's next", "what is next")) or self._contains_any(normalized, self._PLANNING_MARKERS):
            hints: list[str] = []
            if any(marker in normalized for marker in ("build me", "create a", "create an", "i have an idea", "i need a", "i want a")):
                hints.append("legacy_chat_candidate")
                hints.append("new_intent_candidate")
            if any(marker in normalized for marker in ("what's next", "what is next", "next step", "continue")):
                hints.append("legacy_chat_candidate")
                hints.append("next_step_candidate")
            return NaturalChatClassification(
                intent_label="planning",
                confidence=0.88,
                action_hints=tuple(hints),
                rationale="The message asks for a plan, approach, or next-step decision.",
            )
        if self._contains_any(normalized, self._PATCH_MARKERS) or normalized.startswith(("add ", "fix ", "update ", "change ", "make ", "save ", "write ")):
            hints = ["bounded_patch"]
            if context.has_recent_run:
                hints.append("prefer_last_run")
            elif context.has_recent_context:
                hints.append("prefer_latest_context")
            return NaturalChatClassification(
                intent_label="patch_request",
                confidence=0.91,
                action_hints=tuple(hints),
                rationale="The message asks for a concrete code or behavior change.",
            )
        return NaturalChatClassification(
            intent_label="unknown_or_ambiguous",
            confidence=0.32,
            action_hints=(),
            rationale="The message did not match a safe deterministic natural-chat intent.",
        )

    @staticmethod
    def _contains_any(message: str, markers: tuple[str, ...]) -> bool:
        return any(marker in message for marker in markers)

    @staticmethod
    def _contains_test_request(message: str) -> bool:
        tokens = tuple(part for part in message.replace("-", " ").split() if part)
        return any(token == "test" for token in tokens) or "unit test" in message or "run tests" in message