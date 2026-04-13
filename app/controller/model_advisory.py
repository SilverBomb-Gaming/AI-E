"""Advisory-only inference helpers for approved local model experiments."""
from __future__ import annotations

import json
from pathlib import Path

from .model_experiment_models import CommandCorrectionArtifact


class CommandGrammarAdvisoryModel:
    def __init__(self, artifact: CommandCorrectionArtifact) -> None:
        self._artifact = artifact

    @classmethod
    def load(cls, *, artifact_path: str | Path) -> CommandGrammarAdvisoryModel:
        payload = json.loads(Path(artifact_path).read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("Model artifact payload must be an object.")
        return cls(CommandCorrectionArtifact.from_payload(payload))

    @property
    def advisory_threshold(self) -> float:
        return self._artifact.advisory_threshold

    def suggest(self, *, text: str) -> tuple[str, float]:
        stripped = " ".join(text.split())
        if not stripped.startswith("/"):
            return "", 0.0
        token, _, remainder = stripped.partition(" ")
        best_label = ""
        best_score = 0.0
        for label, variants in self._artifact.command_variants.items():
            label_score = max((self._score(token, variant) for variant in variants), default=0.0)
            if label_score > best_score:
                best_label = label
                best_score = label_score
        if not best_label:
            return "", 0.0
        suggestion = self._reconstruct_suggestion(original_text=stripped, predicted_label=best_label, remainder=remainder)
        return suggestion, best_score

    @staticmethod
    def _reconstruct_suggestion(*, original_text: str, predicted_label: str, remainder: str) -> str:
        token, _, _ = original_text.partition(" ")
        if remainder:
            return f"{predicted_label} {remainder}".strip()
        if token.startswith(predicted_label) and len(token) > len(predicted_label):
            attached = token[len(predicted_label) :].strip()
            if attached:
                return f"{predicted_label} {attached}".strip()
        return predicted_label

    @staticmethod
    def _score(left: str, right: str) -> float:
        left_bigrams = CommandGrammarAdvisoryModel._bigrams(left)
        right_bigrams = CommandGrammarAdvisoryModel._bigrams(right)
        if not left_bigrams or not right_bigrams:
            return 0.0
        overlap = len(left_bigrams & right_bigrams)
        return (2.0 * overlap) / (len(left_bigrams) + len(right_bigrams))

    @staticmethod
    def _bigrams(value: str) -> set[str]:
        padded = f"^{value}$"
        return {padded[index : index + 2] for index in range(len(padded) - 1)}