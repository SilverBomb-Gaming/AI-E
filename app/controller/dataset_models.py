"""Durable models for record curation, dataset membership, and dataset exports."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


DatasetPrimaryLabel = Literal["training", "evaluation_only", "discarded", "debug", "review_needed"]
DatasetSplit = Literal["", "train", "eval", "holdout"]
DatasetStatus = Literal["draft", "curated", "exported"]
DatasetExportFormat = Literal["json", "jsonl"]

PRIMARY_LABEL_VALUES = frozenset({"training", "evaluation_only", "discarded", "debug", "review_needed"})
DATASET_STATUS_VALUES = frozenset({"draft", "curated", "exported"})
DATASET_SPLIT_VALUES = frozenset({"", "train", "eval", "holdout"})
DATASET_EXPORT_FORMAT_VALUES = frozenset({"json", "jsonl"})


def normalize_primary_label(value: str) -> str:
    normalized = value.strip().lower().replace("-", "_")
    return normalized if normalized in PRIMARY_LABEL_VALUES else ""


def normalize_dataset_split(value: str) -> str:
    normalized = value.strip().lower().replace("-", "_")
    return normalized if normalized in DATASET_SPLIT_VALUES else ""


def normalize_dataset_status(value: str) -> str:
    normalized = value.strip().lower()
    return normalized if normalized in DATASET_STATUS_VALUES else "draft"


def normalize_export_format(value: str) -> str:
    normalized = value.strip().lower()
    return normalized if normalized in DATASET_EXPORT_FORMAT_VALUES else "jsonl"


def normalize_tag(value: str) -> str:
    normalized = "_".join(value.strip().lower().split())
    return normalized.strip("_")


@dataclass(frozen=True)
class RecordLabelState:
    record_id: str
    primary_label: str = ""
    tags: tuple[str, ...] = field(default_factory=tuple)
    updated_at: str = ""

    def to_payload(self) -> dict[str, object]:
        return {
            "record_id": self.record_id,
            "primary_label": self.primary_label,
            "tags": list(self.tags),
            "updated_at": self.updated_at,
        }

    @staticmethod
    def from_payload(payload: dict[str, object]) -> RecordLabelState:
        tags = payload.get("tags")
        return RecordLabelState(
            record_id=str(payload.get("record_id", "")).strip().upper(),
            primary_label=normalize_primary_label(str(payload.get("primary_label", ""))),
            tags=tuple(normalize_tag(str(item)) for item in (tags or ()) if normalize_tag(str(item))),
            updated_at=str(payload.get("updated_at", "")).strip(),
        )


@dataclass(frozen=True)
class DatasetMembershipRecord:
    dataset_id: str
    record_id: str
    inclusion_reason: str
    label: str = ""
    split: str = ""
    added_at: str = ""

    def to_payload(self) -> dict[str, object]:
        return {
            "dataset_id": self.dataset_id,
            "record_id": self.record_id,
            "inclusion_reason": self.inclusion_reason,
            "label": self.label,
            "split": self.split,
            "added_at": self.added_at,
        }

    @staticmethod
    def from_payload(payload: dict[str, object]) -> DatasetMembershipRecord:
        return DatasetMembershipRecord(
            dataset_id=str(payload.get("dataset_id", "")).strip().upper(),
            record_id=str(payload.get("record_id", "")).strip().upper(),
            inclusion_reason=str(payload.get("inclusion_reason", "")).strip(),
            label=normalize_primary_label(str(payload.get("label", ""))),
            split=normalize_dataset_split(str(payload.get("split", ""))),
            added_at=str(payload.get("added_at", "")).strip(),
        )


@dataclass(frozen=True)
class DatasetRecord:
    dataset_id: str
    title: str
    description: str
    created_at: str
    updated_at: str
    source_scope: str
    record_count: int = 0
    labels_summary: dict[str, int] = field(default_factory=dict)
    split_summary: dict[str, int] = field(default_factory=dict)
    tags: tuple[str, ...] = field(default_factory=tuple)
    status: str = "draft"
    selection_filters: dict[str, str] = field(default_factory=dict)
    source_policy_ids: tuple[str, ...] = field(default_factory=tuple)

    def to_payload(self) -> dict[str, object]:
        return {
            "dataset_id": self.dataset_id,
            "title": self.title,
            "description": self.description,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "source_scope": self.source_scope,
            "record_count": self.record_count,
            "labels_summary": dict(self.labels_summary),
            "split_summary": dict(self.split_summary),
            "tags": list(self.tags),
            "status": self.status,
            "selection_filters": dict(self.selection_filters),
            "source_policy_ids": list(self.source_policy_ids),
        }

    @staticmethod
    def from_payload(payload: dict[str, object]) -> DatasetRecord:
        labels_summary = payload.get("labels_summary")
        split_summary = payload.get("split_summary")
        selection_filters = payload.get("selection_filters")
        tags = payload.get("tags")
        normalized_labels = {
            str(key): int(value)
            for key, value in (labels_summary.items() if isinstance(labels_summary, dict) else ())
            if str(key).strip() and isinstance(value, int)
        }
        normalized_splits = {
            str(key): int(value)
            for key, value in (split_summary.items() if isinstance(split_summary, dict) else ())
            if str(key).strip() and isinstance(value, int)
        }
        normalized_filters = {
            str(key).strip().lower(): str(value).strip()
            for key, value in (selection_filters.items() if isinstance(selection_filters, dict) else ())
            if str(key).strip() and str(value).strip()
        }
        return DatasetRecord(
            dataset_id=str(payload.get("dataset_id", "")).strip().upper(),
            title=str(payload.get("title", "")).strip(),
            description=str(payload.get("description", "")).strip(),
            created_at=str(payload.get("created_at", "")).strip(),
            updated_at=str(payload.get("updated_at", "")).strip(),
            source_scope=str(payload.get("source_scope", "")).strip(),
            record_count=max(0, int(payload.get("record_count", 0) or 0)),
            labels_summary=normalized_labels,
            split_summary=normalized_splits,
            tags=tuple(normalize_tag(str(item)) for item in (tags or ()) if normalize_tag(str(item))),
            status=normalize_dataset_status(str(payload.get("status", "draft"))),
            selection_filters=normalized_filters,
            source_policy_ids=tuple(str(item).strip().upper() for item in (payload.get("source_policy_ids") or ()) if str(item).strip()),
        )


@dataclass(frozen=True)
class DatasetExportRecord:
    export_id: str
    dataset_id: str
    exported_at: str
    export_format: str
    split: str = ""
    record_count: int = 0
    file_path: str = ""
    view_shapes: tuple[str, ...] = field(default_factory=tuple)

    def to_payload(self) -> dict[str, object]:
        return {
            "export_id": self.export_id,
            "dataset_id": self.dataset_id,
            "exported_at": self.exported_at,
            "export_format": self.export_format,
            "split": self.split,
            "record_count": self.record_count,
            "file_path": self.file_path,
            "view_shapes": list(self.view_shapes),
        }

    @staticmethod
    def from_payload(payload: dict[str, object]) -> DatasetExportRecord:
        view_shapes = payload.get("view_shapes")
        return DatasetExportRecord(
            export_id=str(payload.get("export_id", "")).strip().upper(),
            dataset_id=str(payload.get("dataset_id", "")).strip().upper(),
            exported_at=str(payload.get("exported_at", "")).strip(),
            export_format=normalize_export_format(str(payload.get("export_format", "jsonl"))),
            split=normalize_dataset_split(str(payload.get("split", ""))),
            record_count=max(0, int(payload.get("record_count", 0) or 0)),
            file_path=str(payload.get("file_path", "")).strip(),
            view_shapes=tuple(str(item).strip() for item in (view_shapes or ()) if str(item).strip()),
        )