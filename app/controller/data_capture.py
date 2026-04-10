"""Builders that normalize runtime events into durable AI-E data records."""
from __future__ import annotations

from dataclasses import asdict, is_dataclass

from .data_record_models import DataRecord, DataRecordLabel
from .evaluation_session_models import EvaluationRunRecord, EvaluationSessionRecord
from .execution_models import CapabilityExecutionResult
from .feature_bundle_models import FeatureBundleRecord
from .task_chain_models import TaskChainRecord, TaskChainStepRecord


class DataCapture:
    def command_record(self, *, record_id: str, result: CapabilityExecutionResult) -> DataRecord:
        label = self._command_label(result)
        metadata = self._clean_mapping(result.request.metadata)
        telemetry = self._clean_mapping(result.telemetry)
        title = result.command_label or result.capability_id
        summary = result.internal_summary or self._summarize(result.user_message)
        return DataRecord(
            record_id=record_id,
            record_type="command",
            label=label,
            training_eligible=label == "training-eligible",
            captured_at=result.finished_at,
            title=title,
            summary=summary,
            outcome=result.outcome,
            source=result.request.source,
            input_text=result.request.original_command,
            output_text=result.user_message,
            request_id=result.request_id,
            chat_id=result.request.chat_id,
            capability_id=result.capability_id,
            command_label=result.command_label,
            bundle_id=str(result.telemetry.get("feature_bundle_id") or "").strip(),
            normalized_input={
                "command_label": result.command_label,
                "parsed_arguments": self._clean_mapping(result.request.parsed_arguments),
                "argument_summary": metadata.get("argument_summary", ""),
            },
            context_payload={
                "mode": result.request.mode_snapshot,
                "selected_mode": result.request.selected_mode_snapshot,
                "policy": result.request.policy_snapshot,
                "readiness": result.request.readiness_snapshot,
                "scope_summary": result.scope_summary,
                "trust_summary": result.trust_summary,
                "request_metadata": metadata,
            },
            result_payload={
                "outcome_reason_code": result.outcome_reason_code,
                "duration_ms": result.duration_ms,
                "confirmation_used": result.confirmation_used,
                "provider_used": result.provider_used,
                "mode_used": result.mode_used,
                "degraded": result.degraded,
                "retryable": result.retryable,
                "telemetry": telemetry,
            },
            provenance_payload={
                "invocation_timestamp": result.request.invocation_timestamp,
                "started_at": result.started_at,
                "finished_at": result.finished_at,
                "requester_label": result.request.requester_label,
                "provider_snapshot": self._to_jsonish(result.request.provider_snapshot),
            },
            tags=self._command_tags(result),
        )

    def evaluation_run_record(
        self,
        *,
        record_id: str,
        session: EvaluationSessionRecord,
        run: EvaluationRunRecord,
    ) -> DataRecord:
        job = session.allowed_jobs[0] if session.allowed_jobs else None
        return DataRecord(
            record_id=record_id,
            record_type="evaluation_run",
            label="evaluation-only",
            training_eligible=False,
            captured_at=run.finished_at,
            title=f"evaluation {session.session_id} run {run.iteration}",
            summary=run.result_summary or run.failure_reason or run.status,
            outcome=run.status,
            source=session.source,
            input_text=job.command_text if job is not None else "",
            output_text=run.result_summary,
            session_id=session.session_id,
            run_id=run.run_id,
            chat_id=session.chat_id,
            command_label=run.command_label,
            normalized_input={
                "iteration": run.iteration,
                "command_label": run.command_label,
                "command_summary": run.command_summary,
                "target_kind": job.target_kind if job is not None else "",
                "target_selector": job.target_selector if job is not None else "",
            },
            context_payload={
                "title": session.title,
                "purpose": session.purpose,
                "interval_seconds": session.interval_seconds,
                "max_runs": session.max_runs,
                "max_failures": session.max_failures,
                "stop_conditions": list(session.stop_conditions),
                "session_metadata": self._clean_mapping(session.metadata),
            },
            result_payload=self._clean_mapping(run.to_payload()),
            provenance_payload={
                "owner_label": session.owner_label,
                "created_at": session.created_at,
                "approved_at": session.approved_at,
                "latest_run_id": session.latest_run_id,
            },
            tags=("evaluation", run.comparison_kind),
        )

    def chain_step_record(
        self,
        *,
        record_id: str,
        chain: TaskChainRecord,
        step: TaskChainStepRecord,
    ) -> DataRecord:
        label: DataRecordLabel = "training-eligible" if step.status == "success" and step.progress_made else "evaluation-only"
        return DataRecord(
            record_id=record_id,
            record_type="chain_step",
            label=label,
            training_eligible=label == "training-eligible",
            captured_at=step.finished_at,
            title=f"chain {chain.chain_id} step {step.step_number}",
            summary=step.result_summary or step.failure_reason or step.family,
            outcome=step.status,
            source=chain.source,
            input_text=chain.command_text,
            output_text=step.result_summary,
            chain_id=chain.chain_id,
            step_id=step.step_id,
            chat_id=chain.chat_id,
            command_label=chain.command_label,
            bundle_id=str(step.metadata.get("bundle_id") or "").strip(),
            normalized_input={
                "family": step.family,
                "label": step.label,
                "command_label": chain.command_label,
                "command_argument": chain.command_argument,
                "step_number": step.step_number,
            },
            context_payload={
                "title": chain.title,
                "objective": chain.objective,
                "chain_type": chain.chain_type,
                "primary_target_kind": chain.primary_target_kind,
                "primary_target_selector": chain.primary_target_selector,
                "fallback_target_kind": chain.fallback_target_kind,
                "fallback_target_selector": chain.fallback_target_selector,
                "chain_metadata": self._clean_mapping(chain.metadata),
            },
            result_payload=self._clean_mapping(step.to_payload()),
            provenance_payload={
                "owner_label": chain.owner_label,
                "created_at": chain.created_at,
                "approved_at": chain.approved_at,
            },
            tags=("task-chain", step.family),
        )

    def feature_bundle_record(
        self,
        *,
        record_id: str,
        bundle: FeatureBundleRecord,
        chat_id: str,
        event_kind: str,
        command_text: str,
        outcome: str,
        output_summary: str,
        first_issue: str = "",
    ) -> DataRecord:
        label: DataRecordLabel = "training-eligible" if outcome in {"success", "passed", "validated", "applied"} else "evaluation-only"
        summary = output_summary or first_issue or bundle.validation_summary or bundle.apply_summary or bundle.bundle_summary
        return DataRecord(
            record_id=record_id,
            record_type="feature_bundle",
            label=label,
            training_eligible=label == "training-eligible",
            captured_at=bundle.updated_at,
            title=f"feature bundle {bundle.bundle_id} {event_kind}",
            summary=summary,
            outcome=outcome,
            source="feature-bundle",
            input_text=command_text,
            output_text=summary,
            bundle_id=bundle.bundle_id,
            chat_id=chat_id,
            normalized_input={
                "event_kind": event_kind,
                "feature_title": bundle.feature_title,
                "validation_command": bundle.validation_plan.command_text if bundle.validation_plan is not None else "",
            },
            context_payload={
                "feature_request": bundle.feature_request,
                "feature_title": bundle.feature_title,
                "intended_outcome": bundle.intended_outcome,
                "bundle_summary": bundle.bundle_summary,
                "bundle_state": bundle.state,
                "validation_state": bundle.validation_state,
                "files": [item.relative_path for item in bundle.files],
                "assumptions": list(bundle.assumptions),
                "risk_notes": list(bundle.risk_notes),
            },
            result_payload={
                "apply_summary": bundle.apply_summary,
                "validation_summary": bundle.validation_summary,
                "stop_reason": bundle.stop_reason,
                "applied_files": list(bundle.applied_files),
            },
            provenance_payload={
                "created_at": bundle.created_at,
                "updated_at": bundle.updated_at,
                "approval_required": bundle.approval_required,
                "event_kind": event_kind,
            },
            tags=("feature-bundle", event_kind),
        )

    @staticmethod
    def feature_bundle_record_from_result(
        *,
        record_id: str,
        result: CapabilityExecutionResult,
    ) -> DataRecord | None:
        if result.capability_id != "build.feature.apply.query":
            return None
        payload = result.telemetry.get("feature_bundle")
        if not isinstance(payload, dict):
            return None
        bundle = FeatureBundleRecord.from_payload(payload)
        if bundle.state not in {"applied", "failed"}:
            return None
        return DataCapture().feature_bundle_record(
            record_id=record_id,
            bundle=bundle,
            chat_id=result.request.chat_id,
            event_kind="apply",
            command_text=result.request.original_command,
            outcome=result.outcome,
            output_summary=result.internal_summary,
            first_issue=str(result.telemetry.get("first_issue") or ""),
        )

    @staticmethod
    def _command_label(result: CapabilityExecutionResult) -> DataRecordLabel:
        if result.capability_id in {"telegram.parse_failure", "telegram.non_text", "telegram.unknown"}:
            return "discarded"
        if result.outcome in {"invalid_request", "out_of_scope", "denied", "expired", "blocked"}:
            return "discarded"
        return "training-eligible"

    @staticmethod
    def _command_tags(result: CapabilityExecutionResult) -> tuple[str, ...]:
        tags = [result.command_label.strip("/") or "command"]
        bundle_id = str(result.telemetry.get("feature_bundle_id") or "").strip()
        if bundle_id:
            tags.append("feature-bundle")
        return tuple(tags)

    @classmethod
    def _clean_mapping(cls, mapping: object) -> dict[str, object]:
        if not isinstance(mapping, dict):
            return {}
        return {str(key): cls._to_jsonish(value) for key, value in mapping.items()}

    @classmethod
    def _to_jsonish(cls, value: object) -> object:
        if value is None or isinstance(value, (bool, int, float, str)):
            return value
        if is_dataclass(value):
            return cls._to_jsonish(asdict(value))
        if isinstance(value, dict):
            return {str(key): cls._to_jsonish(item) for key, item in value.items()}
        if isinstance(value, (list, tuple, set)):
            return [cls._to_jsonish(item) for item in value]
        return str(value)

    @staticmethod
    def _summarize(text: str, *, limit: int = 180) -> str:
        condensed = " ".join(text.split())
        if len(condensed) <= limit:
            return condensed
        return condensed[: max(0, limit - 3)].rstrip() + "..."