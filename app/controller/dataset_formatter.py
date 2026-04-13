"""Formatting helpers for curated datasets and export payloads."""
from __future__ import annotations

from .data_record_models import DataRecord
from .dataset_models import DatasetMembershipRecord, DatasetRecord, RecordLabelState


class DatasetFormatter:
    def format_dataset_summary_line(self, dataset: DatasetRecord) -> str:
        return f"- {dataset.dataset_id} | {dataset.status} | {dataset.record_count} records | {dataset.title}"

    def format_dataset_record_line(
        self,
        *,
        record: DataRecord,
        membership: DatasetMembershipRecord,
        curation: RecordLabelState | None,
    ) -> str:
        label = membership.label or (curation.primary_label if curation is not None else "") or "-"
        split = membership.split or "-"
        reason = membership.inclusion_reason or "manual"
        detail = record.command_label or record.capability_id or record.title
        return f"- {record.record_id} | {record.record_type} | label={label} | split={split} | {detail} | why={reason}"

    def format_dataset_labels(self, dataset: DatasetRecord) -> str:
        if not dataset.labels_summary:
            return "none"
        return ", ".join(f"{key}={value}" for key, value in sorted(dataset.labels_summary.items()))

    def format_dataset_splits(self, dataset: DatasetRecord) -> str:
        if not dataset.split_summary:
            return "none"
        return ", ".join(f"{key}={value}" for key, value in sorted(dataset.split_summary.items()))

    def export_item(
        self,
        *,
        dataset: DatasetRecord,
        record: DataRecord,
        membership: DatasetMembershipRecord,
        curation: RecordLabelState | None,
    ) -> dict[str, object]:
        view_shape = self._view_shape(record)
        return {
            "dataset_id": dataset.dataset_id,
            "dataset_title": dataset.title,
            "record_id": record.record_id,
            "record_type": record.record_type,
            "raw_input": record.input_text,
            "normalized_input": dict(record.normalized_input),
            "output": record.output_text,
            "status": record.outcome,
            "summary": record.summary,
            "source": record.source,
            "labels": {
                "raw": record.label,
                "curation": curation.primary_label if curation is not None else "",
                "membership": membership.label,
            },
            "tags": {
                "raw": list(record.tags),
                "curation": list(curation.tags if curation is not None else ()),
            },
            "split": membership.split,
            "inclusion_reason": membership.inclusion_reason,
            "provenance": {
                "captured_at": record.captured_at,
                "request_id": record.request_id,
                "source_interface": record.source,
                "capability_id": record.capability_id,
                "command_label": record.command_label,
                "source_policy_ids": list(dataset.source_policy_ids),
                **dict(record.provenance_payload),
            },
            "parent_references": {
                "session_id": record.session_id,
                "chain_id": record.chain_id,
                "step_id": record.step_id,
                "run_id": record.run_id,
                "bundle_id": record.bundle_id,
                "chat_id": record.chat_id,
            },
            "context": dict(record.context_payload),
            "result": dict(record.result_payload),
            "view_shape": view_shape,
            "source_policy_ids": list(dataset.source_policy_ids),
            "model_work_item": self._model_work_item(view_shape=view_shape, record=record),
        }

    @staticmethod
    def _view_shape(record: DataRecord) -> str:
        if record.record_type == "command":
            return "command_trace"
        if record.record_type == "evaluation_run":
            return "evaluation_outcome"
        if record.record_type == "chain_step":
            return "chain_decision"
        return "generic"

    @staticmethod
    def _model_work_item(*, view_shape: str, record: DataRecord) -> dict[str, object]:
        if view_shape == "command_trace":
            return {
                "raw_command": record.input_text,
                "normalized_command": dict(record.normalized_input),
                "result_response": record.output_text,
                "context_provenance": {
                    "context": dict(record.context_payload),
                    "provenance": dict(record.provenance_payload),
                },
            }
        if view_shape == "evaluation_outcome":
            return {
                "target": record.normalized_input.get("target_selector") or record.command_label or record.title,
                "outcome": record.outcome,
                "summary": record.summary,
                "regression_recovery_metadata": dict(record.result_payload),
            }
        if view_shape == "chain_decision":
            return {
                "step_context": dict(record.context_payload),
                "rule_matched": record.result_payload.get("matched_rule_id") or record.normalized_input.get("matched_rule_id"),
                "fallback_used": record.result_payload.get("fallback_used"),
                "decision_summary": record.result_payload.get("decision_summary") or record.summary,
                "progress_state": record.result_payload.get("progress_state") or record.normalized_input.get("progress_state"),
                "outcome": record.outcome,
            }
        return {
            "summary": record.summary,
            "normalized_input": dict(record.normalized_input),
            "result": dict(record.result_payload),
        }