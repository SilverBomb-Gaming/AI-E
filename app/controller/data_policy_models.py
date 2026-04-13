"""Durable models for controlled data-source policy records and review history."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


SourcePolicyStatus = Literal["draft", "active", "blocked", "suspended", "archived"]
SourceUsageClass = Literal[
    "requires_review",
    "retrieval_only",
    "evaluation_only",
    "training_allowed",
    "blocked",
    "archival_only",
    "internal_only",
]
SourceReviewStatus = Literal["draft", "pending_review", "approved", "rejected", "suspended"]
SourceAllowedOperation = Literal["metadata_only", "retrieval", "evaluation", "training", "export_reference", "blocked"]
SourceType = Literal[
    "web_domain",
    "website_section",
    "api_source",
    "internal_dataset",
    "file_bundle",
    "exported_dataset",
    "manual_import",
    "document_collection",
    "repo_source",
]


SOURCE_POLICY_STATUS_VALUES = frozenset({"draft", "active", "blocked", "suspended", "archived"})
SOURCE_USAGE_CLASS_VALUES = frozenset(
    {"requires_review", "retrieval_only", "evaluation_only", "training_allowed", "blocked", "archival_only", "internal_only"}
)
SOURCE_REVIEW_STATUS_VALUES = frozenset({"draft", "pending_review", "approved", "rejected", "suspended"})
SOURCE_ALLOWED_OPERATION_VALUES = frozenset({"metadata_only", "retrieval", "evaluation", "training", "export_reference", "blocked"})
SOURCE_TYPE_VALUES = frozenset(
    {
        "web_domain",
        "website_section",
        "api_source",
        "internal_dataset",
        "file_bundle",
        "exported_dataset",
        "manual_import",
        "document_collection",
        "repo_source",
    }
)


def _normalize_slug(value: str) -> str:
    return "_".join(value.strip().lower().replace("-", "_").split())


def normalize_source_policy_status(value: str) -> str:
    normalized = _normalize_slug(value)
    return normalized if normalized in SOURCE_POLICY_STATUS_VALUES else "draft"


def normalize_usage_class(value: str) -> str:
    normalized = _normalize_slug(value)
    return normalized if normalized in SOURCE_USAGE_CLASS_VALUES else "requires_review"


def normalize_review_status(value: str) -> str:
    normalized = _normalize_slug(value)
    return normalized if normalized in SOURCE_REVIEW_STATUS_VALUES else "draft"


def normalize_allowed_operation(value: str) -> str:
    normalized = _normalize_slug(value)
    return normalized if normalized in SOURCE_ALLOWED_OPERATION_VALUES else ""


def normalize_source_type(value: str) -> str:
    normalized = _normalize_slug(value)
    return normalized if normalized in SOURCE_TYPE_VALUES else ""


def normalize_policy_tag(value: str) -> str:
    return _normalize_slug(value).strip("_")


def normalize_text_list(payload: object) -> tuple[str, ...]:
    if not isinstance(payload, (list, tuple)):
        return ()
    items: list[str] = []
    for value in payload:
        text = " ".join(str(value).split()).strip()
        if text and text not in items:
            items.append(text)
    return tuple(items)


def normalize_identifier_list(payload: object) -> tuple[str, ...]:
    if not isinstance(payload, (list, tuple)):
        return ()
    items: list[str] = []
    for value in payload:
        text = str(value).strip().upper()
        if text and text not in items:
            items.append(text)
    return tuple(items)


@dataclass(frozen=True)
class SourcePolicyApprovalRecord:
    review_status: str
    note: str = ""
    reviewer: str = ""
    reviewed_at: str = ""

    def to_payload(self) -> dict[str, object]:
        return {
            "review_status": self.review_status,
            "note": self.note,
            "reviewer": self.reviewer,
            "reviewed_at": self.reviewed_at,
        }

    @staticmethod
    def from_payload(payload: dict[str, object]) -> "SourcePolicyApprovalRecord":
        return SourcePolicyApprovalRecord(
            review_status=normalize_review_status(str(payload.get("review_status", "draft"))),
            note=str(payload.get("note", "")).strip(),
            reviewer=str(payload.get("reviewer", "")).strip(),
            reviewed_at=str(payload.get("reviewed_at", "")).strip(),
        )


@dataclass(frozen=True)
class SourcePolicyRecord:
    source_id: str
    source_name: str
    source_type: str
    source_locator: str
    created_at: str
    updated_at: str
    status: str = "draft"
    usage_class: str = "requires_review"
    review_status: str = "draft"
    provenance_requirements: tuple[str, ...] = field(default_factory=tuple)
    policy_notes: str = ""
    allowed_operations: tuple[str, ...] = field(default_factory=tuple)
    blocked_reason: str = ""
    tags: tuple[str, ...] = field(default_factory=tuple)
    owner: str = ""
    approval_history: tuple[SourcePolicyApprovalRecord, ...] = field(default_factory=tuple)
    source_scope: str = ""
    collection_method_class: str = "manual_declaration"
    content_license_note: str = ""
    robots_note: str = ""
    terms_note: str = ""
    retention_policy: str = ""
    training_eligibility_reason: str = ""
    review_required: bool = True
    reviewer: str = ""
    reviewed_at: str = ""
    linked_dataset_ids: tuple[str, ...] = field(default_factory=tuple)
    linked_experiment_ids: tuple[str, ...] = field(default_factory=tuple)

    def to_payload(self) -> dict[str, object]:
        return {
            "source_id": self.source_id,
            "source_name": self.source_name,
            "source_type": self.source_type,
            "source_locator": self.source_locator,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "status": self.status,
            "usage_class": self.usage_class,
            "review_status": self.review_status,
            "provenance_requirements": list(self.provenance_requirements),
            "policy_notes": self.policy_notes,
            "allowed_operations": list(self.allowed_operations),
            "blocked_reason": self.blocked_reason,
            "tags": list(self.tags),
            "owner": self.owner,
            "approval_history": [item.to_payload() for item in self.approval_history],
            "source_scope": self.source_scope,
            "collection_method_class": self.collection_method_class,
            "content_license_note": self.content_license_note,
            "robots_note": self.robots_note,
            "terms_note": self.terms_note,
            "retention_policy": self.retention_policy,
            "training_eligibility_reason": self.training_eligibility_reason,
            "review_required": self.review_required,
            "reviewer": self.reviewer,
            "reviewed_at": self.reviewed_at,
            "linked_dataset_ids": list(self.linked_dataset_ids),
            "linked_experiment_ids": list(self.linked_experiment_ids),
        }

    @staticmethod
    def from_payload(payload: dict[str, object]) -> "SourcePolicyRecord":
        approval_history = payload.get("approval_history")
        tags = payload.get("tags")
        return SourcePolicyRecord(
            source_id=str(payload.get("source_id", "")).strip().upper(),
            source_name=" ".join(str(payload.get("source_name", "")).split()),
            source_type=normalize_source_type(str(payload.get("source_type", ""))),
            source_locator=str(payload.get("source_locator", "")).strip(),
            created_at=str(payload.get("created_at", "")).strip(),
            updated_at=str(payload.get("updated_at", "")).strip(),
            status=normalize_source_policy_status(str(payload.get("status", "draft"))),
            usage_class=normalize_usage_class(str(payload.get("usage_class", "requires_review"))),
            review_status=normalize_review_status(str(payload.get("review_status", "draft"))),
            provenance_requirements=normalize_text_list(payload.get("provenance_requirements")),
            policy_notes=str(payload.get("policy_notes", "")).strip(),
            allowed_operations=tuple(
                normalized
                for item in (payload.get("allowed_operations") or ())
                if (normalized := normalize_allowed_operation(str(item)))
            ),
            blocked_reason=str(payload.get("blocked_reason", "")).strip(),
            tags=tuple(normalize_policy_tag(str(item)) for item in (tags or ()) if normalize_policy_tag(str(item))),
            owner=str(payload.get("owner", "")).strip(),
            approval_history=tuple(
                SourcePolicyApprovalRecord.from_payload(item)
                for item in (approval_history or ())
                if isinstance(item, dict)
            ),
            source_scope=str(payload.get("source_scope", "")).strip(),
            collection_method_class=_normalize_slug(str(payload.get("collection_method_class", "manual_declaration"))) or "manual_declaration",
            content_license_note=str(payload.get("content_license_note", "")).strip(),
            robots_note=str(payload.get("robots_note", "")).strip(),
            terms_note=str(payload.get("terms_note", "")).strip(),
            retention_policy=str(payload.get("retention_policy", "")).strip(),
            training_eligibility_reason=str(payload.get("training_eligibility_reason", "")).strip(),
            review_required=bool(payload.get("review_required", True)),
            reviewer=str(payload.get("reviewer", "")).strip(),
            reviewed_at=str(payload.get("reviewed_at", "")).strip(),
            linked_dataset_ids=normalize_identifier_list(payload.get("linked_dataset_ids")),
            linked_experiment_ids=normalize_identifier_list(payload.get("linked_experiment_ids")),
        )