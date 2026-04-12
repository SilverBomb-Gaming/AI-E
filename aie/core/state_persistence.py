from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .models import (
    ArtifactAwareSessionRecord,
    ConstraintReport,
    ConstraintRouterHandoff,
    DependencyAwareSessionRecord,
    ExecutionPlan,
    ExecutorStatus,
    IntentSpec,
    LifecycleState,
    LoadResult,
    OrchestrationAction,
    OrchestrationDecision,
    OrchestrationResult,
    OrchestrationStatus,
    PersistedExecutionSession,
    PersistedLifecycleSnapshot,
    PersistenceRecordVersion,
    PersistenceStatus,
    ReentryStatus,
    RepoImpactLevel,
    ResumeDecision,
    ResumeEligibility,
    ResumeReason,
    ResumeResult,
    SaveResult,
    StopReason,
    TaskChain,
    TaskExecutionResult,
    TaskStep,
    TaskStepExecutionStatus,
    TaskStepRun,
)


class StatePersistence:
    """Serialize and restore bounded execution sessions from deterministic JSON files."""

    def build_session(
        self,
        *,
        session_id: str,
        router_handoff: ConstraintRouterHandoff,
        orchestration_result: OrchestrationResult,
        task_execution_result: TaskExecutionResult,
        notes: tuple[str, ...] = (),
        saved_at: str | None = None,
    ) -> PersistedExecutionSession:
        lifecycle_snapshot = PersistedLifecycleSnapshot(
            last_lifecycle_state=orchestration_result.decision.lifecycle_state,
            last_required_human_action=orchestration_result.decision.required_human_action,
            final_executor_status=orchestration_result.final_executor_status,
            stop_reason=task_execution_result.stop_reason,
            blocked_step_id=task_execution_result.blocked_step_id,
            resumable_state_present=orchestration_result.decision.resume_allowed,
        )
        return PersistedExecutionSession(
            session_id=session_id,
            schema_version=PersistenceRecordVersion.V1.value,
            saved_at=saved_at or self._timestamp(),
            router_handoff=router_handoff,
            orchestration_result=orchestration_result,
            task_execution_result=task_execution_result,
            lifecycle_snapshot=lifecycle_snapshot,
            notes=notes,
        )

    def save_session(self, session: PersistedExecutionSession, path: str | Path) -> SaveResult:
        target = Path(path)
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            payload = self.serialize_session(session)
            target.write_text(json.dumps(payload, indent=2), encoding="utf-8")
            return SaveResult(
                status=PersistenceStatus.SAVED,
                path=str(target),
                session_id=session.session_id,
                notes=("Session persisted successfully.",),
            )
        except Exception as exc:
            return SaveResult(
                status=PersistenceStatus.FAILED,
                path=str(target),
                session_id=session.session_id,
                notes=(f"Failed to save session: {exc}",),
            )

    def build_session_from_record(
        self,
        record: PersistedExecutionSession | ArtifactAwareSessionRecord | DependencyAwareSessionRecord,
        *,
        notes: tuple[str, ...] = (),
        saved_at: str | None = None,
    ) -> PersistedExecutionSession:
        if isinstance(record, PersistedExecutionSession):
            merged_notes = tuple(dict.fromkeys(record.notes + notes))
            return PersistedExecutionSession(
                session_id=record.session_id,
                schema_version=record.schema_version,
                saved_at=saved_at or self._timestamp(),
                router_handoff=record.router_handoff,
                orchestration_result=record.orchestration_result,
                task_execution_result=record.task_execution_result,
                lifecycle_snapshot=record.lifecycle_snapshot,
                notes=merged_notes,
            )

        if isinstance(record, ArtifactAwareSessionRecord):
            base_record = record.base_record.base_record
        else:
            base_record = record.base_record

        if base_record.router_handoff is None:
            raise ValueError("Cannot persist a session record without router handoff context.")

        orchestration_result = base_record.orchestration_result
        task_execution_result = (
            orchestration_result.execution_result if orchestration_result and orchestration_result.execution_result else base_record.prior_execution_result
        )
        if orchestration_result is None or task_execution_result is None:
            raise ValueError("Cannot persist a session record without orchestration and execution results.")

        merged_notes = tuple(dict.fromkeys(base_record.notes + notes))
        return self.build_session(
            session_id=base_record.session_id,
            router_handoff=base_record.router_handoff,
            orchestration_result=orchestration_result,
            task_execution_result=task_execution_result,
            notes=merged_notes,
            saved_at=saved_at,
        )

    def load_session(self, path: str | Path) -> LoadResult:
        target = Path(path)
        try:
            raw_text = target.read_text(encoding="utf-8")
        except Exception as exc:
            return LoadResult(
                status=PersistenceStatus.FAILED,
                path=str(target),
                session=None,
                notes=(f"Failed to read session file: {exc}",),
            )

        try:
            payload = json.loads(raw_text)
        except json.JSONDecodeError as exc:
            return LoadResult(
                status=PersistenceStatus.INVALID,
                path=str(target),
                session=None,
                notes=(f"Invalid JSON in persisted session: {exc}",),
            )

        validation = self.validate_payload(payload)
        if validation.status != PersistenceStatus.LOADED:
            return LoadResult(
                status=validation.status,
                path=str(target),
                session=None,
                notes=validation.notes,
            )

        try:
            session = self.deserialize_session(payload)
        except Exception as exc:
            return LoadResult(
                status=PersistenceStatus.INVALID,
                path=str(target),
                session=None,
                notes=(f"Failed to reconstruct persisted session: {exc}",),
            )

        return LoadResult(
            status=PersistenceStatus.LOADED,
            path=str(target),
            session=session,
            notes=("Session loaded successfully.",),
        )

    def validate_payload(self, payload: dict[str, Any]) -> LoadResult:
        required_top_level = (
            "session_id",
            "schema_version",
            "saved_at",
            "router_handoff",
            "orchestration_result",
            "task_execution_result",
            "lifecycle_snapshot",
        )
        missing_fields = tuple(field for field in required_top_level if field not in payload)
        if missing_fields:
            return LoadResult(
                status=PersistenceStatus.INVALID,
                notes=(f"Missing required persisted session fields: {', '.join(missing_fields)}.",),
            )

        schema_version = payload.get("schema_version")
        if schema_version != PersistenceRecordVersion.V1.value:
            return LoadResult(
                status=PersistenceStatus.VERSION_MISMATCH,
                notes=(f"Unsupported persisted session schema version: {schema_version}.",),
            )

        nested_requirements = {
            "router_handoff": ("intent", "constraints", "plan", "task_chain"),
            "orchestration_result": ("status", "decision"),
            "task_execution_result": ("status", "completed_step_ids", "step_runs"),
            "lifecycle_snapshot": ("last_lifecycle_state", "resumable_state_present"),
        }
        for field, required_fields in nested_requirements.items():
            nested_payload = payload.get(field)
            if not isinstance(nested_payload, dict):
                return LoadResult(
                    status=PersistenceStatus.INVALID,
                    notes=(f"Persisted field {field} must be an object.",),
                )
            missing_nested = tuple(required for required in required_fields if required not in nested_payload)
            if missing_nested:
                return LoadResult(
                    status=PersistenceStatus.INVALID,
                    notes=(f"Persisted field {field} is missing required entries: {', '.join(missing_nested)}.",),
                )

        return LoadResult(status=PersistenceStatus.LOADED, notes=("Payload validation succeeded.",))

    @staticmethod
    def serialize_session(session: PersistedExecutionSession) -> dict[str, Any]:
        return session.to_dict()

    def deserialize_session(self, payload: dict[str, Any]) -> PersistedExecutionSession:
        router_handoff = self._deserialize_router_handoff(payload["router_handoff"])
        orchestration_result = self._deserialize_orchestration_result(payload["orchestration_result"])
        task_execution_result = self._deserialize_task_execution_result(payload["task_execution_result"])
        lifecycle_snapshot = self._deserialize_lifecycle_snapshot(payload["lifecycle_snapshot"])
        return PersistedExecutionSession(
            session_id=payload["session_id"],
            schema_version=int(payload["schema_version"]),
            saved_at=payload["saved_at"],
            router_handoff=router_handoff,
            orchestration_result=orchestration_result,
            task_execution_result=task_execution_result,
            lifecycle_snapshot=lifecycle_snapshot,
            notes=tuple(payload.get("notes", [])),
        )

    @staticmethod
    def _timestamp() -> str:
        return datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    @staticmethod
    def _optional_enum(enum_type, value):
        return enum_type(value) if value is not None else None

    def _deserialize_router_handoff(self, payload: dict[str, Any]) -> ConstraintRouterHandoff:
        return ConstraintRouterHandoff(
            intent=IntentSpec(
                raw_request=payload["intent"]["raw_request"],
                goal=payload["intent"].get("goal"),
                engine_target=payload["intent"].get("engine_target"),
                platform_target=payload["intent"].get("platform_target"),
                scope=payload["intent"].get("scope"),
                features=tuple(payload["intent"].get("features", [])),
                tone=payload["intent"].get("tone"),
                constraints=tuple(payload["intent"].get("constraints", [])),
                missing_fields=tuple(payload["intent"].get("missing_fields", [])),
            ),
            constraints=ConstraintReport(
                supported=payload["constraints"]["supported"],
                engine_target=payload["constraints"].get("engine_target"),
                warnings=tuple(payload["constraints"].get("warnings", [])),
                blocked_actions=tuple(payload["constraints"].get("blocked_actions", [])),
                ambiguities=tuple(payload["constraints"].get("ambiguities", [])),
                missing_inputs=tuple(payload["constraints"].get("missing_inputs", [])),
                guardrail_notes=tuple(payload["constraints"].get("guardrail_notes", [])),
                status=payload["constraints"].get("status", "bounded_draft_only"),
                implementation_allowed=payload["constraints"].get("implementation_allowed", False),
                scaffold_only=payload["constraints"].get("scaffold_only", True),
                confirmation_required=payload["constraints"].get("confirmation_required", False),
                playtest_required=payload["constraints"].get("playtest_required", False),
                human_review_required=payload["constraints"].get("human_review_required", False),
                commit_preparation_allowed=payload["constraints"].get("commit_preparation_allowed", False),
            ),
            plan=ExecutionPlan(
                status=payload["plan"]["status"],
                summary=payload["plan"]["summary"],
                bounded=payload["plan"]["bounded"],
                engine_target=payload["plan"].get("engine_target"),
                tasks=tuple(payload["plan"].get("tasks", [])),
                file_operations=tuple(payload["plan"].get("file_operations", [])),
                verification_steps=tuple(payload["plan"].get("verification_steps", [])),
                warnings=tuple(payload["plan"].get("warnings", [])),
                codex_handoff_ready=payload["plan"].get("codex_handoff_ready", False),
                limitations=tuple(payload["plan"].get("limitations", [])),
                open_assumptions=tuple(payload["plan"].get("open_assumptions", [])),
                blocked_items=tuple(payload["plan"].get("blocked_items", [])),
                implementation_allowed=payload["plan"].get("implementation_allowed", False),
                scaffold_only=payload["plan"].get("scaffold_only", True),
                confirmation_required=payload["plan"].get("confirmation_required", False),
                playtest_required=payload["plan"].get("playtest_required", False),
                human_review_required=payload["plan"].get("human_review_required", False),
                commit_preparation_allowed=payload["plan"].get("commit_preparation_allowed", False),
                task_chain_ready=payload["plan"].get("task_chain_ready", False),
            ),
            task_chain=self._deserialize_task_chain(payload["task_chain"]),
            adapter_guidance=tuple(payload.get("adapter_guidance", [])),
            open_assumptions=tuple(payload.get("open_assumptions", [])),
            blocked_items=tuple(payload.get("blocked_items", [])),
            confirmation_requirements=tuple(payload.get("confirmation_requirements", [])),
            requires_playtest=payload.get("requires_playtest", False),
            requires_human_review=payload.get("requires_human_review", False),
        )

    def _deserialize_task_chain(self, payload: dict[str, Any]) -> TaskChain:
        return TaskChain(
            chain_id=payload["chain_id"],
            status=payload["status"],
            summary=payload["summary"],
            bounded=payload["bounded"],
            engine_target=payload.get("engine_target"),
            steps=tuple(self._deserialize_task_step(step) for step in payload.get("steps", [])),
            open_assumptions=tuple(payload.get("open_assumptions", [])),
            blocked_items=tuple(payload.get("blocked_items", [])),
            confirmation_requirements=tuple(payload.get("confirmation_requirements", [])),
            playtest_required=payload.get("playtest_required", False),
            human_review_required=payload.get("human_review_required", False),
            codex_handoff_ready=payload.get("codex_handoff_ready", False),
            notes=tuple(payload.get("notes", [])),
        )

    @staticmethod
    def _deserialize_task_step(payload: dict[str, Any]) -> TaskStep:
        return TaskStep(
            step_id=payload["step_id"],
            step_type=payload["step_type"],
            title=payload["title"],
            purpose=payload["purpose"],
            target_area=payload["target_area"],
            engine_context=payload.get("engine_context"),
            repo_impact_level=payload.get("repo_impact_level", "none"),
            risk_level=payload.get("risk_level", "low"),
            requires_confirmation=payload.get("requires_confirmation", False),
            requires_playtest=payload.get("requires_playtest", False),
            requires_human_review=payload.get("requires_human_review", False),
            depends_on=tuple(payload.get("depends_on", [])),
            suggested_outputs=tuple(payload.get("suggested_outputs", [])),
            boundedness_notes=tuple(payload.get("boundedness_notes", [])),
            status=payload.get("status", "planned"),
        )

    def _deserialize_orchestration_result(self, payload: dict[str, Any]) -> OrchestrationResult:
        resume_payload = payload.get("resume_result")
        return OrchestrationResult(
            status=OrchestrationStatus(payload["status"]),
            decision=OrchestrationDecision(
                lifecycle_state=LifecycleState(payload["decision"]["lifecycle_state"]),
                chosen_action=OrchestrationAction(payload["decision"]["chosen_action"]),
                prior_executor_status=self._optional_enum(ExecutorStatus, payload["decision"].get("prior_executor_status")),
                resume_allowed=payload["decision"].get("resume_allowed", False),
                required_human_action=payload["decision"].get("required_human_action"),
                orchestration_notes=tuple(payload["decision"].get("orchestration_notes", [])),
            ),
            execution_result=self._deserialize_task_execution_result(payload["execution_result"]) if payload.get("execution_result") else None,
            resume_result=self._deserialize_resume_result(resume_payload) if resume_payload else None,
            final_executor_status=self._optional_enum(ExecutorStatus, payload.get("final_executor_status")),
            orchestration_notes=tuple(payload.get("orchestration_notes", [])),
        )

    def _deserialize_resume_result(self, payload: dict[str, Any]) -> ResumeResult:
        return ResumeResult(
            status=ReentryStatus(payload["status"]),
            decision=ResumeDecision(
                eligibility=ResumeEligibility(payload["decision"]["eligibility"]),
                reason=ResumeReason(payload["decision"]["reason"]),
                prior_executor_status=ExecutorStatus(payload["decision"]["prior_executor_status"]),
                stop_reason=self._optional_enum(StopReason, payload["decision"].get("stop_reason")),
                blocked_step_id=payload["decision"].get("blocked_step_id"),
                next_resumable_step_id=payload["decision"].get("next_resumable_step_id"),
                human_action_cleared=payload["decision"].get("human_action_cleared", False),
                confirmation_cleared=payload["decision"].get("confirmation_cleared", False),
                review_cleared=payload["decision"].get("review_cleared", False),
                playtest_cleared=payload["decision"].get("playtest_cleared", False),
                resume_allowed=payload["decision"].get("resume_allowed", False),
                resume_notes=tuple(payload["decision"].get("resume_notes", [])),
            ),
            execution_result=self._deserialize_task_execution_result(payload["execution_result"]) if payload.get("execution_result") else None,
            resume_notes=tuple(payload.get("resume_notes", [])),
        )

    def _deserialize_task_execution_result(self, payload: dict[str, Any]) -> TaskExecutionResult:
        return TaskExecutionResult(
            status=ExecutorStatus(payload["status"]),
            completed_step_ids=tuple(payload.get("completed_step_ids", [])),
            blocked_step_ids=tuple(payload.get("blocked_step_ids", [])),
            deferred_step_ids=tuple(payload.get("deferred_step_ids", [])),
            step_runs=tuple(self._deserialize_task_step_run(step_run) for step_run in payload.get("step_runs", [])),
            next_human_action=payload.get("next_human_action"),
            stop_reason=self._optional_enum(StopReason, payload.get("stop_reason")),
            blocked_step_id=payload.get("blocked_step_id"),
            summary_notes=tuple(payload.get("summary_notes", [])),
        )

    @staticmethod
    def _deserialize_task_step_run(payload: dict[str, Any]) -> TaskStepRun:
        return TaskStepRun(
            step_id=payload["step_id"],
            step_type=payload["step_type"],
            status=TaskStepExecutionStatus(payload["status"]),
            stop_reason=StopReason(payload["stop_reason"]) if payload.get("stop_reason") else None,
            notes=tuple(payload.get("notes", [])),
            human_action_required=payload.get("human_action_required"),
            depends_on_satisfied=payload.get("depends_on_satisfied", True),
        )

    def _deserialize_lifecycle_snapshot(self, payload: dict[str, Any]) -> PersistedLifecycleSnapshot:
        return PersistedLifecycleSnapshot(
            last_lifecycle_state=LifecycleState(payload["last_lifecycle_state"]),
            last_required_human_action=payload.get("last_required_human_action"),
            final_executor_status=self._optional_enum(ExecutorStatus, payload.get("final_executor_status")),
            stop_reason=self._optional_enum(StopReason, payload.get("stop_reason")),
            blocked_step_id=payload.get("blocked_step_id"),
            resumable_state_present=payload.get("resumable_state_present", False),
        )