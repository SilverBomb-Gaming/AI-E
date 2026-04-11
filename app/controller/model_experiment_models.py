"""Durable models for local small-model adaptation experiments."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


ModelExperimentTaskType = Literal["command_grammar_correction"]
ModelExperimentStatus = Literal["draft", "running", "trained", "evaluated", "failed", "stopped"]
ModelIntegrationStatus = Literal["draft", "trained", "evaluated", "approved_for_advisory_use", "rejected"]
ModelAdaptationMethod = Literal["char_bigram_knn_v1"]
ModelExperimentMode = Literal["advisory"]
ModelBaselineKind = Literal["rules", "none", "previous_model"]

TASK_TYPE_VALUES = frozenset({"command_grammar_correction"})
STATUS_VALUES = frozenset({"draft", "running", "trained", "evaluated", "failed", "stopped"})
INTEGRATION_STATUS_VALUES = frozenset({"draft", "trained", "evaluated", "approved_for_advisory_use", "rejected"})
ADAPTATION_METHOD_VALUES = frozenset({"char_bigram_knn_v1"})
MODE_VALUES = frozenset({"advisory"})
BASELINE_VALUES = frozenset({"rules", "none", "previous_model"})


def normalize_task_type(value: str) -> str:
    normalized = value.strip().lower().replace("-", "_")
    return normalized if normalized in TASK_TYPE_VALUES else ""


def normalize_experiment_status(value: str) -> str:
    normalized = value.strip().lower().replace("-", "_")
    return normalized if normalized in STATUS_VALUES else "draft"


def normalize_integration_status(value: str) -> str:
    normalized = value.strip().lower().replace("-", "_")
    return normalized if normalized in INTEGRATION_STATUS_VALUES else "draft"


def normalize_adaptation_method(value: str) -> str:
    normalized = value.strip().lower().replace("-", "_")
    return normalized if normalized in ADAPTATION_METHOD_VALUES else "char_bigram_knn_v1"


def normalize_experiment_mode(value: str) -> str:
    normalized = value.strip().lower().replace("-", "_")
    return normalized if normalized in MODE_VALUES else "advisory"


def normalize_baseline_kind(value: str) -> str:
    normalized = value.strip().lower().replace("-", "_")
    return normalized if normalized in BASELINE_VALUES else "rules"


def _normalize_string_map(payload: object) -> dict[str, str]:
    if not isinstance(payload, dict):
        return {}
    result: dict[str, str] = {}
    for key, value in payload.items():
        normalized_key = str(key).strip()
        normalized_value = str(value).strip()
        if normalized_key and normalized_value:
            result[normalized_key] = normalized_value
    return result


def _normalize_int_map(payload: object) -> dict[str, int]:
    if not isinstance(payload, dict):
        return {}
    result: dict[str, int] = {}
    for key, value in payload.items():
        normalized_key = str(key).strip()
        if not normalized_key:
            continue
        try:
            normalized_value = int(value)
        except (TypeError, ValueError):
            continue
        result[normalized_key] = normalized_value
    return result


def _normalize_metric_map(payload: object) -> dict[str, float | int | str]:
    if not isinstance(payload, dict):
        return {}
    result: dict[str, float | int | str] = {}
    for key, value in payload.items():
        normalized_key = str(key).strip()
        if not normalized_key:
            continue
        if isinstance(value, (int, float, str)):
            result[normalized_key] = value
            continue
        text = str(value).strip()
        if text:
            result[normalized_key] = text
    return result


@dataclass(frozen=True)
class ModelExperimentRecord:
    experiment_id: str
    title: str
    task_type: str
    dataset_id: str
    created_at: str
    updated_at: str
    status: str
    base_model: str
    adaptation_method: str
    train_split: str
    eval_split: str
    metrics: dict[str, float | int | str] = field(default_factory=dict)
    artifact_paths: dict[str, str] = field(default_factory=dict)
    notes: str = ""
    integration_status: str = "draft"
    baseline: str = "rules"
    mode: str = "advisory"
    dataset_export_id: str = ""
    dataset_export_path: str = ""
    dataset_record_count: int = 0
    training_example_count: int = 0
    evaluation_example_count: int = 0
    label_filters: dict[str, str] = field(default_factory=dict)
    source_policy_ids: tuple[str, ...] = field(default_factory=tuple)
    split_policy: str = "hash_80_20"
    builder_name: str = "command_grammar_correction_v1"
    artifact_root: str = ""
    last_error: str = ""
    stop_requested: bool = False
    advisory_threshold: float = 0.55

    def to_payload(self) -> dict[str, object]:
        return {
            "experiment_id": self.experiment_id,
            "title": self.title,
            "task_type": self.task_type,
            "dataset_id": self.dataset_id,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "status": self.status,
            "base_model": self.base_model,
            "adaptation_method": self.adaptation_method,
            "train_split": self.train_split,
            "eval_split": self.eval_split,
            "metrics": dict(self.metrics),
            "artifact_paths": dict(self.artifact_paths),
            "notes": self.notes,
            "integration_status": self.integration_status,
            "baseline": self.baseline,
            "mode": self.mode,
            "dataset_export_id": self.dataset_export_id,
            "dataset_export_path": self.dataset_export_path,
            "dataset_record_count": self.dataset_record_count,
            "training_example_count": self.training_example_count,
            "evaluation_example_count": self.evaluation_example_count,
            "label_filters": dict(self.label_filters),
            "source_policy_ids": list(self.source_policy_ids),
            "split_policy": self.split_policy,
            "builder_name": self.builder_name,
            "artifact_root": self.artifact_root,
            "last_error": self.last_error,
            "stop_requested": self.stop_requested,
            "advisory_threshold": self.advisory_threshold,
        }

    @staticmethod
    def from_payload(payload: dict[str, object]) -> ModelExperimentRecord:
        return ModelExperimentRecord(
            experiment_id=str(payload.get("experiment_id", "")).strip().upper(),
            title=" ".join(str(payload.get("title", "")).split()),
            task_type=normalize_task_type(str(payload.get("task_type", ""))),
            dataset_id=str(payload.get("dataset_id", "")).strip().upper(),
            created_at=str(payload.get("created_at", "")).strip(),
            updated_at=str(payload.get("updated_at", "")).strip(),
            status=normalize_experiment_status(str(payload.get("status", "draft"))),
            base_model=" ".join(str(payload.get("base_model", "rules")).split()) or "rules",
            adaptation_method=normalize_adaptation_method(str(payload.get("adaptation_method", "char_bigram_knn_v1"))),
            train_split=" ".join(str(payload.get("train_split", "train")).split()) or "train",
            eval_split=" ".join(str(payload.get("eval_split", "eval")).split()) or "eval",
            metrics=_normalize_metric_map(payload.get("metrics")),
            artifact_paths=_normalize_string_map(payload.get("artifact_paths")),
            notes=str(payload.get("notes", "")).strip(),
            integration_status=normalize_integration_status(str(payload.get("integration_status", "draft"))),
            baseline=normalize_baseline_kind(str(payload.get("baseline", "rules"))),
            mode=normalize_experiment_mode(str(payload.get("mode", "advisory"))),
            dataset_export_id=str(payload.get("dataset_export_id", "")).strip().upper(),
            dataset_export_path=str(payload.get("dataset_export_path", "")).strip(),
            dataset_record_count=max(0, int(payload.get("dataset_record_count", 0) or 0)),
            training_example_count=max(0, int(payload.get("training_example_count", 0) or 0)),
            evaluation_example_count=max(0, int(payload.get("evaluation_example_count", 0) or 0)),
            label_filters=_normalize_string_map(payload.get("label_filters")),
            source_policy_ids=tuple(str(item).strip().upper() for item in (payload.get("source_policy_ids") or ()) if str(item).strip()),
            split_policy=" ".join(str(payload.get("split_policy", "hash_80_20")).split()) or "hash_80_20",
            builder_name=" ".join(str(payload.get("builder_name", "command_grammar_correction_v1")).split()) or "command_grammar_correction_v1",
            artifact_root=str(payload.get("artifact_root", "")).strip(),
            last_error=str(payload.get("last_error", "")).strip(),
            stop_requested=bool(payload.get("stop_requested", False)),
            advisory_threshold=float(payload.get("advisory_threshold", 0.55) or 0.55),
        )


@dataclass(frozen=True)
class CommandCorrectionExample:
    example_id: str
    source_record_id: str
    malformed_text: str
    target_text: str
    command_label: str
    variant_kind: str
    provenance: dict[str, str] = field(default_factory=dict)

    def to_payload(self) -> dict[str, object]:
        return {
            "example_id": self.example_id,
            "source_record_id": self.source_record_id,
            "malformed_text": self.malformed_text,
            "target_text": self.target_text,
            "command_label": self.command_label,
            "variant_kind": self.variant_kind,
            "provenance": dict(self.provenance),
        }

    @staticmethod
    def from_payload(payload: dict[str, object]) -> CommandCorrectionExample:
        return CommandCorrectionExample(
            example_id=str(payload.get("example_id", "")).strip(),
            source_record_id=str(payload.get("source_record_id", "")).strip().upper(),
            malformed_text=str(payload.get("malformed_text", "")).strip(),
            target_text=str(payload.get("target_text", "")).strip(),
            command_label=str(payload.get("command_label", "")).strip().lower(),
            variant_kind=str(payload.get("variant_kind", "")).strip().lower(),
            provenance=_normalize_string_map(payload.get("provenance")),
        )


@dataclass(frozen=True)
class ModelExperimentEvaluationRow:
    input_text: str
    target_text: str
    baseline_prediction: str
    adapted_prediction: str
    baseline_match: bool
    adapted_match: bool
    similarity_score: float
    command_label: str

    def to_payload(self) -> dict[str, object]:
        return {
            "input_text": self.input_text,
            "target_text": self.target_text,
            "baseline_prediction": self.baseline_prediction,
            "adapted_prediction": self.adapted_prediction,
            "baseline_match": self.baseline_match,
            "adapted_match": self.adapted_match,
            "similarity_score": self.similarity_score,
            "command_label": self.command_label,
        }


@dataclass(frozen=True)
class CommandCorrectionArtifact:
    task_type: str
    adaptation_method: str
    created_at: str
    command_variants: dict[str, tuple[str, ...]]
    advisory_threshold: float = 0.55

    def to_payload(self) -> dict[str, object]:
        return {
            "task_type": self.task_type,
            "adaptation_method": self.adaptation_method,
            "created_at": self.created_at,
            "command_variants": {key: list(value) for key, value in self.command_variants.items()},
            "advisory_threshold": self.advisory_threshold,
        }

    @staticmethod
    def from_payload(payload: dict[str, object]) -> CommandCorrectionArtifact:
        command_variants_raw = payload.get("command_variants")
        command_variants: dict[str, tuple[str, ...]] = {}
        if isinstance(command_variants_raw, dict):
            for key, value in command_variants_raw.items():
                normalized_key = str(key).strip().lower()
                if not normalized_key:
                    continue
                if isinstance(value, list):
                    command_variants[normalized_key] = tuple(str(item).strip() for item in value if str(item).strip())
        return CommandCorrectionArtifact(
            task_type=normalize_task_type(str(payload.get("task_type", ""))),
            adaptation_method=normalize_adaptation_method(str(payload.get("adaptation_method", "char_bigram_knn_v1"))),
            created_at=str(payload.get("created_at", "")).strip(),
            command_variants=command_variants,
            advisory_threshold=float(payload.get("advisory_threshold", 0.55) or 0.55),
        )