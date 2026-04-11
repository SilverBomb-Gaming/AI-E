"""Formatting helpers for controlled data-source policy records."""
from __future__ import annotations

from .data_policy_models import SourcePolicyRecord


class DataPolicyFormatter:
    def format_summary_line(self, record: SourcePolicyRecord) -> str:
        return (
            f"- {record.source_id} | {record.usage_class} | {record.review_status} | "
            f"{record.source_type} | {record.source_name}"
        )

    @staticmethod
    def format_operations(record: SourcePolicyRecord) -> str:
        if not record.allowed_operations:
            return "none"
        return ", ".join(record.allowed_operations)

    @staticmethod
    def format_tags(record: SourcePolicyRecord) -> str:
        if not record.tags:
            return "none"
        return ", ".join(record.tags)

    @staticmethod
    def format_provenance(record: SourcePolicyRecord) -> str:
        if not record.provenance_requirements:
            return "none"
        return "; ".join(record.provenance_requirements)

    @staticmethod
    def format_counts(counts: dict[str, int]) -> str:
        if not counts:
            return "none"
        return ", ".join(f"{key}={value}" for key, value in sorted(counts.items()))