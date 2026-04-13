from __future__ import annotations

from datetime import datetime, timezone

from .models import (
    InsightCategory,
    InsightFailureReason,
    InsightItem,
    InsightResult,
    InsightScope,
    InsightStatus,
    WorkflowFailureReason,
    WorkflowRequest,
    WorkflowResult,
    WorkflowStatus,
    WorkflowStep,
    WorkflowStepType,
    WorkflowSuggestion,
)


class OperatorWorkflows:
    """Convert structured insights into safe, deterministic operator workflows."""

    _SUPPORTED_SCOPES = {
        InsightScope.FULL_LOG,
        InsightScope.SESSION,
        InsightScope.CYCLE,
    }

    def generate_workflow(
        self,
        request: WorkflowRequest,
        *,
        insight_result: InsightResult | None = None,
    ) -> WorkflowResult:
        workflow_id = request.request_id or self._build_workflow_id()
        validation_failure = self._validate_request(request)
        if validation_failure is not None:
            status = WorkflowStatus.INVALID
            if validation_failure == WorkflowFailureReason.UNSUPPORTED_SCOPE:
                status = WorkflowStatus.UNSUPPORTED_SCOPE
            return self._failure_result(
                workflow_id=workflow_id,
                request=request,
                status=status,
                failure_reason=validation_failure,
                notes=self._validation_failure_notes(request, validation_failure),
            )
        if insight_result is None:
            return self._failure_result(
                workflow_id=workflow_id,
                request=request,
                status=WorkflowStatus.INVALID,
                failure_reason=WorkflowFailureReason.MISSING_INSIGHT_INPUT,
                notes=("Operator workflow generation requires an insight result.",),
            )

        source_failure = self._validate_insight_source(request, insight_result)
        if source_failure is not None:
            return self._failure_result(
                workflow_id=workflow_id,
                request=request,
                status=WorkflowStatus.INVALID,
                failure_reason=source_failure,
                notes=("Workflow request did not match the provided insight result.",),
            )

        if insight_result.status in {InsightStatus.INVALID, InsightStatus.FAILED, InsightStatus.UNSUPPORTED_SCOPE}:
            return self._failure_result(
                workflow_id=workflow_id,
                request=request,
                status=self._status_from_insight_status(insight_result.status),
                failure_reason=self._failure_from_insight_failure(insight_result.failure_reason),
                notes=insight_result.notes or ("Upstream insight result could not be converted into workflow steps.",),
                source_insight_id=insight_result.insight_id,
            )
        if insight_result.summary is None and not insight_result.items:
            return self._failure_result(
                workflow_id=workflow_id,
                request=request,
                status=WorkflowStatus.INVALID,
                failure_reason=WorkflowFailureReason.MALFORMED_INSIGHT,
                notes=("Insight result did not include summary or item data for workflow generation.",),
                source_insight_id=insight_result.insight_id,
            )

        steps = self._build_steps(insight_result)
        notes = request.notes + insight_result.notes
        if insight_result.status == InsightStatus.PARTIAL:
            notes = notes + ("Workflow is limited to the available partial insight set.",)

        linked_insights = tuple(dict.fromkeys(step.related_insight_id for step in steps))
        priority_order = tuple(step.step_id for step in steps)
        summary = self._build_summary(steps, insight_result)
        status = WorkflowStatus.PARTIAL if insight_result.status == InsightStatus.PARTIAL else WorkflowStatus.GENERATED
        return WorkflowResult(
            workflow_id=workflow_id,
            scope=request.scope,
            steps=steps,
            linked_insights=linked_insights,
            priority_order=priority_order,
            summary=summary,
            status=status,
            failure_reason=None,
            source_insight_id=insight_result.insight_id,
            source_trace_id=insight_result.source_trace_id,
            target_session_id=insight_result.target_session_id,
            target_cycle_id=insight_result.target_cycle_id,
            notes=notes,
        )

    def build_full_log_workflow(self, insight_result: InsightResult) -> WorkflowResult:
        return self.generate_workflow(
            WorkflowRequest(
                scope=InsightScope.FULL_LOG,
                source_insight_id=insight_result.insight_id,
                source_trace_id=insight_result.source_trace_id,
            ),
            insight_result=insight_result,
        )

    def build_session_workflow(self, insight_result: InsightResult, session_id: str) -> WorkflowResult:
        return self.generate_workflow(
            WorkflowRequest(
                scope=InsightScope.SESSION,
                target_session_id=session_id,
                source_insight_id=insight_result.insight_id,
                source_trace_id=insight_result.source_trace_id,
            ),
            insight_result=insight_result,
        )

    def build_cycle_workflow(self, insight_result: InsightResult, cycle_id: int) -> WorkflowResult:
        return self.generate_workflow(
            WorkflowRequest(
                scope=InsightScope.CYCLE,
                target_cycle_id=cycle_id,
                source_insight_id=insight_result.insight_id,
                source_trace_id=insight_result.source_trace_id,
            ),
            insight_result=insight_result,
        )

    def _build_steps(self, insight_result: InsightResult) -> tuple[WorkflowStep, ...]:
        built_steps: list[WorkflowStep] = []
        seen_keys: set[tuple[str, str, str]] = set()

        blockers = sorted(
            (item for item in insight_result.items if item.category == InsightCategory.BLOCKER),
            key=lambda item: item.sequence_index,
            reverse=True,
        )
        blocked_policies = sorted(
            (
                item
                for item in insight_result.items
                if item.category == InsightCategory.POLICY_TRANSITION and "blocked" in item.detail.lower()
            ),
            key=lambda item: item.sequence_index,
            reverse=True,
        )
        completions = sorted(
            (item for item in insight_result.items if item.category == InsightCategory.COMPLETION),
            key=lambda item: item.sequence_index,
        )
        persistence_items = sorted(
            (item for item in insight_result.items if item.category == InsightCategory.PERSISTENCE_MILESTONE),
            key=lambda item: item.sequence_index,
        )

        for blocker in blockers:
            for step_type, description, recommended_action in self._steps_for_blocker(blocker):
                self._append_step(
                    built_steps,
                    seen_keys,
                    step_type=step_type,
                    description=description,
                    recommended_action=recommended_action,
                    item=blocker,
                )

        for policy_item in blocked_policies:
            self._append_step(
                built_steps,
                seen_keys,
                step_type=WorkflowStepType.CHECK_POLICY,
                description="Inspect policy constraints preventing execution",
                recommended_action="Review the bounded policy decision and the blocked action request before asking for another run.",
                item=policy_item,
            )
            self._append_step(
                built_steps,
                seen_keys,
                step_type=WorkflowStepType.INSPECT,
                description="Inspect the blocked action context linked to the policy decision",
                recommended_action="Compare the blocked action request against the selected session and cycle context.",
                item=policy_item,
            )

        if completions:
            completion_item = completions[-1]
            persistence_item = persistence_items[-1] if persistence_items else completion_item
            self._append_step(
                built_steps,
                seen_keys,
                step_type=WorkflowStepType.CONFIRM,
                description="Verify completion output and persistence state",
                recommended_action="Confirm the completed scope produced the expected bounded output and that persistence finished cleanly.",
                item=completion_item,
            )
            self._append_step(
                built_steps,
                seen_keys,
                step_type=WorkflowStepType.INSPECT,
                description="Inspect persisted outputs for the completed scope",
                recommended_action="Inspect the final persisted output or state artifact linked to the completed cycle.",
                item=persistence_item,
            )

        return tuple(
            WorkflowStep(
                step_id=step.step_id,
                step_type=step.step_type,
                description=step.description,
                related_insight_id=step.related_insight_id,
                recommended_action=step.recommended_action,
                context_reference=step.context_reference,
                priority_order=index,
            )
            for index, step in enumerate(built_steps, start=1)
        )

    @staticmethod
    def _steps_for_blocker(item: InsightItem) -> tuple[tuple[WorkflowStepType, str, str], ...]:
        detail = item.detail.lower()
        if "review" in detail or "gate" in detail or "wait" in detail:
            return (
                (
                    WorkflowStepType.REVIEW,
                    "Review pending gate before execution can continue",
                    "Review the pending gate or approval condition linked to this blocked step.",
                ),
                (
                    WorkflowStepType.CONFIRM,
                    "Confirm review gate resolution before requesting another bounded cycle",
                    "Confirm the gate is cleared and recorded before asking for another bounded execution attempt.",
                ),
            )
        if "dependency" in detail:
            return (
                (
                    WorkflowStepType.CHECK_DEPENDENCY,
                    "Inspect unresolved dependency reference",
                    "Check the missing or unresolved dependency referenced by the blocked step.",
                ),
                (
                    WorkflowStepType.INSPECT,
                    "Inspect upstream context linked to the dependency blocker",
                    "Inspect the session and cycle context that produced the dependency blocker before retrying any work.",
                ),
            )
        if "artifact" in detail:
            return (
                (
                    WorkflowStepType.CHECK_ARTIFACT,
                    "Verify required artifact exists and is valid",
                    "Check that the required artifact exists, matches the expected contract, and is usable by the bounded step.",
                ),
                (
                    WorkflowStepType.VALIDATE,
                    "Validate artifact contract before requesting another bounded run",
                    "Validate the artifact contents and schema before requesting another bounded execution attempt.",
                ),
            )
        if "policy" in detail:
            return (
                (
                    WorkflowStepType.CHECK_POLICY,
                    "Inspect policy constraints preventing execution",
                    "Review the policy constraint named in the blocker before asking for another run.",
                ),
                (
                    WorkflowStepType.INSPECT,
                    "Inspect blocked runtime context",
                    "Inspect the bounded runtime context attached to the policy blocker.",
                ),
            )
        return (
            (
                WorkflowStepType.INSPECT,
                "Inspect blocker conditions before further bounded action",
                "Inspect the blocker condition and its surrounding runtime context before taking the next bounded step.",
            ),
            (
                WorkflowStepType.VALIDATE,
                "Validate blocker prerequisites before requesting another run",
                "Validate the required bounded prerequisites are satisfied before asking for another execution attempt.",
            ),
        )

    def _append_step(
        self,
        built_steps: list[WorkflowStep],
        seen_keys: set[tuple[str, str, str]],
        *,
        step_type: WorkflowStepType,
        description: str,
        recommended_action: str,
        item: InsightItem,
    ) -> None:
        dedupe_key = (step_type.value, item.event_id, description)
        if dedupe_key in seen_keys:
            return
        seen_keys.add(dedupe_key)
        built_steps.append(
            WorkflowStep(
                step_id=f"workflow-step-{len(built_steps) + 1:03d}",
                step_type=step_type,
                description=description,
                related_insight_id=item.event_id,
                recommended_action=recommended_action,
                context_reference=self._context_reference(item),
                priority_order=len(built_steps) + 1,
            )
        )

    @staticmethod
    def _build_summary(steps: tuple[WorkflowStep, ...], insight_result: InsightResult) -> WorkflowSuggestion | None:
        if steps:
            first_step = steps[0]
            return WorkflowSuggestion(
                title=first_step.description,
                linked_step_id=first_step.step_id,
                detail=first_step.recommended_action,
            )
        if insight_result.summary and insight_result.summary.next_inspection_hint:
            return WorkflowSuggestion(
                title=insight_result.summary.next_inspection_hint,
                linked_step_id=None,
                detail="No linked workflow step was generated from the available insight items.",
            )
        return None

    def _validate_request(self, request: WorkflowRequest) -> WorkflowFailureReason | None:
        if request.scope not in self._SUPPORTED_SCOPES:
            return WorkflowFailureReason.UNSUPPORTED_SCOPE
        if request.scope == InsightScope.SESSION and request.target_session_id is None:
            return WorkflowFailureReason.UNKNOWN_SCOPE_TARGET
        if request.scope == InsightScope.CYCLE and request.target_cycle_id is None:
            return WorkflowFailureReason.UNKNOWN_SCOPE_TARGET
        return None

    @staticmethod
    def _validation_failure_notes(request: WorkflowRequest, failure_reason: WorkflowFailureReason) -> tuple[str, ...]:
        if failure_reason == WorkflowFailureReason.UNSUPPORTED_SCOPE:
            return (f"Operator workflow scope {request.scope.value} is not supported in v1.",)
        if failure_reason == WorkflowFailureReason.UNKNOWN_SCOPE_TARGET:
            return (f"Operator workflow request for scope {request.scope.value} is missing its target identifier.",)
        return ("Operator workflow request validation failed.",)

    @staticmethod
    def _validate_insight_source(request: WorkflowRequest, insight_result: InsightResult) -> WorkflowFailureReason | None:
        if insight_result.scope != request.scope:
            return WorkflowFailureReason.INCONSISTENT_WORKFLOW_SOURCE
        if request.target_session_id is not None and request.target_session_id != insight_result.target_session_id:
            return WorkflowFailureReason.INCONSISTENT_WORKFLOW_SOURCE
        if request.target_cycle_id is not None and request.target_cycle_id != insight_result.target_cycle_id:
            return WorkflowFailureReason.INCONSISTENT_WORKFLOW_SOURCE
        if request.source_insight_id is not None and request.source_insight_id != insight_result.insight_id:
            return WorkflowFailureReason.INCONSISTENT_WORKFLOW_SOURCE
        if request.source_trace_id is not None and request.source_trace_id != insight_result.source_trace_id:
            return WorkflowFailureReason.INCONSISTENT_WORKFLOW_SOURCE
        return None

    @staticmethod
    def _status_from_insight_status(status: InsightStatus) -> WorkflowStatus:
        if status == InsightStatus.PARTIAL:
            return WorkflowStatus.PARTIAL
        if status == InsightStatus.UNSUPPORTED_SCOPE:
            return WorkflowStatus.UNSUPPORTED_SCOPE
        if status == InsightStatus.INVALID:
            return WorkflowStatus.INVALID
        return WorkflowStatus.FAILED

    @staticmethod
    def _failure_from_insight_failure(failure_reason: InsightFailureReason | None) -> WorkflowFailureReason:
        if failure_reason == InsightFailureReason.UNKNOWN_SCOPE_TARGET:
            return WorkflowFailureReason.UNKNOWN_SCOPE_TARGET
        if failure_reason == InsightFailureReason.UNSUPPORTED_SCOPE:
            return WorkflowFailureReason.UNSUPPORTED_SCOPE
        if failure_reason == InsightFailureReason.INCONSISTENT_INSIGHT_SOURCE:
            return WorkflowFailureReason.INCONSISTENT_WORKFLOW_SOURCE
        if failure_reason == InsightFailureReason.MALFORMED_TRACE:
            return WorkflowFailureReason.MALFORMED_INSIGHT
        return WorkflowFailureReason.MISSING_INSIGHT_INPUT

    @staticmethod
    def _failure_result(
        *,
        workflow_id: str,
        request: WorkflowRequest,
        status: WorkflowStatus,
        failure_reason: WorkflowFailureReason,
        notes: tuple[str, ...],
        source_insight_id: str | None = None,
    ) -> WorkflowResult:
        return WorkflowResult(
            workflow_id=workflow_id,
            scope=request.scope,
            steps=(),
            linked_insights=(),
            priority_order=(),
            summary=None,
            status=status,
            failure_reason=failure_reason,
            source_insight_id=source_insight_id or request.source_insight_id,
            source_trace_id=request.source_trace_id,
            target_session_id=request.target_session_id,
            target_cycle_id=request.target_cycle_id,
            notes=request.notes + notes,
        )

    @staticmethod
    def _context_reference(item: InsightItem) -> str:
        parts = [f"event={item.event_id}"]
        if item.session_id is not None:
            parts.append(f"session={item.session_id}")
        if item.cycle_index is not None:
            parts.append(f"cycle={item.cycle_index}")
        return " ".join(parts)

    @staticmethod
    def _build_workflow_id() -> str:
        return f"workflow-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"