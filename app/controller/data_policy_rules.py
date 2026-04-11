"""Conservative source-policy validation and effective-operation helpers."""
from __future__ import annotations

from dataclasses import replace

from .data_policy_models import SourcePolicyRecord


DEFAULT_PROVENANCE_REQUIREMENTS: tuple[str, ...] = (
    "must retain original URL or source locator",
    "must retain fetch or acquisition timestamp",
    "must retain source_id on every derived record",
    "must preserve lineage into curated datasets and exports",
)


class DataPolicyRules:
    @classmethod
    def normalize_record(cls, record: SourcePolicyRecord) -> SourcePolicyRecord:
        provenance = record.provenance_requirements or DEFAULT_PROVENANCE_REQUIREMENTS
        normalized = replace(
            record,
            allowed_operations=cls.effective_allowed_operations(record=record),
            provenance_requirements=provenance,
        )
        cls.validate_record(normalized)
        return normalized

    @staticmethod
    def effective_allowed_operations(*, record: SourcePolicyRecord) -> tuple[str, ...]:
        if record.status in {"blocked", "suspended", "archived"}:
            return ("blocked",)
        if record.review_status in {"rejected", "suspended"}:
            return ("blocked",)
        if record.usage_class == "blocked":
            return ("blocked",)
        if record.review_required and record.review_status != "approved":
            return ("metadata_only",)
        if record.allowed_operations:
            return record.allowed_operations
        if record.usage_class == "training_allowed":
            return ("metadata_only", "retrieval", "evaluation", "training", "export_reference")
        if record.usage_class == "evaluation_only":
            return ("metadata_only", "retrieval", "evaluation", "export_reference")
        if record.usage_class == "retrieval_only":
            return ("metadata_only", "retrieval")
        if record.usage_class == "internal_only":
            return ("metadata_only", "retrieval", "evaluation")
        if record.usage_class == "archival_only":
            return ("metadata_only", "export_reference")
        return ("metadata_only",)

    @staticmethod
    def validate_record(record: SourcePolicyRecord) -> None:
        if not record.source_id.strip():
            raise ValueError("Source id is required.")
        if not record.source_name.strip():
            raise ValueError("Source name is required.")
        if not record.source_type.strip():
            raise ValueError("Source type must be one of the supported datasource types.")
        if not record.source_locator.strip():
            raise ValueError("Source locator is required.")
        if record.usage_class == "training_allowed" and record.review_status != "approved":
            raise ValueError("training_allowed requires review status approved before it can be set.")
        if record.status == "blocked" and not record.blocked_reason.strip():
            raise ValueError("Blocked sources require a blocked reason.")
        if record.usage_class == "blocked" and not record.blocked_reason.strip():
            raise ValueError("Blocked sources require a blocked reason.")