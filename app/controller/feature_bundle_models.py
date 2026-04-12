"""Bounded multi-file feature bundle models."""
from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Literal


FeatureBundleState = Literal["proposed", "applying", "applied", "validated", "failed", "invalidated"]
FeatureBundleValidationState = Literal["not_run", "passed", "failed", "timed_out"]
CodingTaskType = Literal[
    "controller_logic_update",
    "model_field_extension",
    "formatter_output_update",
    "test_alignment_update",
    "helper_extraction",
    "capability_wiring_update",
    "controller_state_alignment",
    "formatter_model_executor_alignment",
    "test_repair_alignment",
    "bounded_refactor",
]
CodingTaskPlanStatus = Literal["proposal_ready", "needs_clarification"]
CodingTaskPlanConfidence = Literal["high", "medium", "low"]
CodingTaskPlanScopeType = Literal["single_cluster", "multi_cluster", "ambiguous"]
CodingTaskPlanRiskLevel = Literal["low", "medium", "high"]
FeatureBundleCommitReadiness = Literal[
    "safe_to_commit",
    "blocked_pending_validation",
    "blocked_pending_playtest",
    "blocked_by_unrelated_changes",
    "needs_human_review",
]
FeatureBundleCommitMode = Literal["preview", "execute"]
FeatureBundlePushMode = Literal["preview", "execute"]
FeatureBundlePushStatus = Literal["ready_to_push", "blocked", "pushed"]
FeatureBundlePrMode = Literal["preview", "execute"]
FeatureBundlePrStatus = Literal["ready_for_review", "blocked", "manual_only"]
FeatureBundleMergeReadiness = Literal["ready_for_review", "blocked_pending_checks", "blocked_pending_playtest", "manual_pr_only"]
FeatureBundleReadmeStatus = Literal[
    "clean",
    "relevant_and_includable",
    "dirty_but_unrelated",
    "requires_isolated_follow_up",
]


@dataclass(frozen=True)
class FeatureBundleFile:
    relative_path: str
    inclusion_reason: str
    change_summary: str
    editable: bool
    scope_confidence: float
    patch_argument: str = ""

    def to_payload(self) -> dict[str, object]:
        return {
            "relative_path": self.relative_path,
            "inclusion_reason": self.inclusion_reason,
            "change_summary": self.change_summary,
            "editable": self.editable,
            "scope_confidence": round(self.scope_confidence, 2),
        }

    @staticmethod
    def from_payload(payload: dict[str, object]) -> FeatureBundleFile:
        confidence = payload.get("scope_confidence")
        numeric_confidence = float(confidence) if isinstance(confidence, (int, float)) else 0.0
        return FeatureBundleFile(
            relative_path=str(payload.get("relative_path", "")).strip(),
            inclusion_reason=str(payload.get("inclusion_reason", "")).strip(),
            change_summary=str(payload.get("change_summary", "")).strip(),
            editable=bool(payload.get("editable", False)),
            scope_confidence=numeric_confidence,
            patch_argument=str(payload.get("patch_argument", "")).strip(),
        )


@dataclass(frozen=True)
class FeatureValidationPlan:
    command_text: str
    rationale: str

    def to_payload(self) -> dict[str, str]:
        return {"command_text": self.command_text, "rationale": self.rationale}

    @staticmethod
    def from_payload(payload: dict[str, object]) -> FeatureValidationPlan:
        return FeatureValidationPlan(
            command_text=str(payload.get("command_text", "")).strip(),
            rationale=str(payload.get("rationale", "")).strip(),
        )


@dataclass(frozen=True)
class CodingTaskFilePlan:
    relative_path: str
    reason: str
    change_type: str
    editable: bool
    scope_confidence: float

    def to_payload(self) -> dict[str, object]:
        return {
            "relative_path": self.relative_path,
            "reason": self.reason,
            "change_type": self.change_type,
            "editable": self.editable,
            "scope_confidence": round(self.scope_confidence, 2),
        }

    @staticmethod
    def from_payload(payload: dict[str, object]) -> "CodingTaskFilePlan":
        confidence = payload.get("scope_confidence")
        numeric_confidence = float(confidence) if isinstance(confidence, (int, float)) else 0.0
        return CodingTaskFilePlan(
            relative_path=str(payload.get("relative_path", "")).strip(),
            reason=str(payload.get("reason", "")).strip(),
            change_type=str(payload.get("change_type", "")).strip(),
            editable=bool(payload.get("editable", False)),
            scope_confidence=numeric_confidence,
        )


@dataclass(frozen=True)
class CodingTaskClusterPlan:
    cluster_id: str
    reason: str

    def to_payload(self) -> dict[str, str]:
        return {"cluster_id": self.cluster_id, "reason": self.reason}

    @staticmethod
    def from_payload(payload: dict[str, object]) -> "CodingTaskClusterPlan":
        return CodingTaskClusterPlan(
            cluster_id=str(payload.get("cluster_id", "")).strip(),
            reason=str(payload.get("reason", "")).strip(),
        )


@dataclass(frozen=True)
class CodingTaskImpactAnalysis:
    clusters: tuple[str, ...] = ()
    upstream: tuple[str, ...] = ()
    downstream: tuple[str, ...] = ()
    tests: tuple[str, ...] = ()
    interaction_points: tuple[str, ...] = ()

    def to_payload(self) -> dict[str, object]:
        return {
            "clusters": list(self.clusters),
            "upstream": list(self.upstream),
            "downstream": list(self.downstream),
            "tests": list(self.tests),
            "interaction_points": list(self.interaction_points),
        }

    @staticmethod
    def from_payload(payload: dict[str, object]) -> "CodingTaskImpactAnalysis":
        clusters = payload.get("clusters")
        upstream = payload.get("upstream")
        downstream = payload.get("downstream")
        tests = payload.get("tests")
        interaction_points = payload.get("interaction_points")
        return CodingTaskImpactAnalysis(
            clusters=tuple(str(item).strip() for item in clusters or () if str(item).strip()),
            upstream=tuple(str(item).strip() for item in upstream or () if str(item).strip()),
            downstream=tuple(str(item).strip() for item in downstream or () if str(item).strip()),
            tests=tuple(str(item).strip() for item in tests or () if str(item).strip()),
            interaction_points=tuple(str(item).strip() for item in interaction_points or () if str(item).strip()),
        )


@dataclass(frozen=True)
class CodingTaskPlan:
    task_type: CodingTaskType
    status: CodingTaskPlanStatus
    target_files: tuple[str, ...]
    intended_change_type: str
    expected_test_impact: str
    affected_tests: tuple[str, ...]
    validation_command: str
    clarification_needed: bool
    playtest_required: bool
    task_category: str = ""
    validation_rationale: str = ""
    file_plans: tuple[CodingTaskFilePlan, ...] = ()
    clarification_question: str = ""
    module_clusters: tuple[str, ...] = ()
    cluster_plans: tuple[CodingTaskClusterPlan, ...] = ()
    impact_analysis: CodingTaskImpactAnalysis = field(default_factory=CodingTaskImpactAnalysis)
    scope_type: CodingTaskPlanScopeType = "ambiguous"
    risk_level: CodingTaskPlanRiskLevel = "high"
    confidence: CodingTaskPlanConfidence = "low"
    selection_summary: str = ""
    expansion_summary: str = ""

    def to_payload(self) -> dict[str, object]:
        return {
            "task_type": self.task_type,
            "status": self.status,
            "target_files": list(self.target_files),
            "intended_change_type": self.intended_change_type,
            "expected_test_impact": self.expected_test_impact,
            "affected_tests": list(self.affected_tests),
            "validation_command": self.validation_command,
            "clarification_needed": self.clarification_needed,
            "playtest_required": self.playtest_required,
            "task_category": self.task_category,
            "validation_rationale": self.validation_rationale,
            "file_plans": [item.to_payload() for item in self.file_plans],
            "clarification_question": self.clarification_question,
            "module_clusters": list(self.module_clusters),
            "cluster_plans": [item.to_payload() for item in self.cluster_plans],
            "impact_analysis": self.impact_analysis.to_payload(),
            "scope_type": self.scope_type,
            "risk_level": self.risk_level,
            "confidence": self.confidence,
            "selection_summary": self.selection_summary,
            "expansion_summary": self.expansion_summary,
        }

    @staticmethod
    def from_payload(payload: dict[str, object]) -> "CodingTaskPlan":
        target_files = payload.get("target_files")
        affected_tests = payload.get("affected_tests")
        file_plans = payload.get("file_plans")
        module_clusters = payload.get("module_clusters")
        cluster_plans = payload.get("cluster_plans")
        impact_analysis = payload.get("impact_analysis")
        return CodingTaskPlan(
            task_type=str(payload.get("task_type", "bounded_refactor")).strip() or "bounded_refactor",  # type: ignore[arg-type]
            status=str(payload.get("status", "proposal_ready")).strip() or "proposal_ready",  # type: ignore[arg-type]
            target_files=tuple(str(item).strip() for item in target_files or () if str(item).strip()),
            intended_change_type=str(payload.get("intended_change_type", "")).strip(),
            expected_test_impact=str(payload.get("expected_test_impact", "")).strip(),
            affected_tests=tuple(str(item).strip() for item in affected_tests or () if str(item).strip()),
            validation_command=str(payload.get("validation_command", "")).strip(),
            clarification_needed=bool(payload.get("clarification_needed", False)),
            playtest_required=bool(payload.get("playtest_required", False)),
            task_category=str(payload.get("task_category", "")).strip(),
            validation_rationale=str(payload.get("validation_rationale", "")).strip(),
            file_plans=tuple(CodingTaskFilePlan.from_payload(item) for item in file_plans or () if isinstance(item, dict)),
            clarification_question=str(payload.get("clarification_question", "")).strip(),
            module_clusters=tuple(str(item).strip() for item in module_clusters or () if str(item).strip()),
            cluster_plans=tuple(CodingTaskClusterPlan.from_payload(item) for item in cluster_plans or () if isinstance(item, dict)),
            impact_analysis=CodingTaskImpactAnalysis.from_payload(impact_analysis) if isinstance(impact_analysis, dict) else CodingTaskImpactAnalysis(),
            scope_type=str(payload.get("scope_type", "ambiguous")).strip() or "ambiguous",  # type: ignore[arg-type]
            risk_level=str(payload.get("risk_level", "high")).strip() or "high",  # type: ignore[arg-type]
            confidence=str(payload.get("confidence", "low")).strip() or "low",  # type: ignore[arg-type]
            selection_summary=str(payload.get("selection_summary", "")).strip(),
            expansion_summary=str(payload.get("expansion_summary", "")).strip(),
        )


@dataclass(frozen=True)
class FeatureBundleCompletionAdvisory:
    repo_branch: str
    repo_status: str
    completion_summary: str
    milestone_log: str
    suggested_stage_paths: tuple[str, ...]
    suggested_commit_message: str
    readme_guidance: str
    commit_readiness_status: FeatureBundleCommitReadiness = "needs_human_review"
    commit_readiness_reason: str = ""
    included_paths: tuple[str, ...] = ()
    excluded_paths: tuple[str, ...] = ()
    ambiguous_paths: tuple[str, ...] = ()
    readme_status: FeatureBundleReadmeStatus = "clean"
    playtest_required: bool = False
    playtest_reason: str = ""
    milestone_summary: str = ""

    def to_payload(self) -> dict[str, object]:
        return {
            "repo_branch": self.repo_branch,
            "repo_status": self.repo_status,
            "completion_summary": self.completion_summary,
            "milestone_log": self.milestone_log,
            "suggested_stage_paths": list(self.suggested_stage_paths),
            "suggested_commit_message": self.suggested_commit_message,
            "readme_guidance": self.readme_guidance,
            "commit_readiness_status": self.commit_readiness_status,
            "commit_readiness_reason": self.commit_readiness_reason,
            "included_paths": list(self.included_paths),
            "excluded_paths": list(self.excluded_paths),
            "ambiguous_paths": list(self.ambiguous_paths),
            "readme_status": self.readme_status,
            "playtest_required": self.playtest_required,
            "playtest_reason": self.playtest_reason,
            "milestone_summary": self.milestone_summary,
        }

    @staticmethod
    def from_payload(payload: dict[str, object]) -> "FeatureBundleCompletionAdvisory":
        included_paths = payload.get("included_paths")
        excluded_paths = payload.get("excluded_paths")
        ambiguous_paths = payload.get("ambiguous_paths")
        stage_paths = payload.get("suggested_stage_paths")
        return FeatureBundleCompletionAdvisory(
            repo_branch=str(payload.get("repo_branch", "")).strip(),
            repo_status=str(payload.get("repo_status", "")).strip(),
            completion_summary=str(payload.get("completion_summary", "")).strip(),
            milestone_log=str(payload.get("milestone_log", "")).strip(),
            suggested_stage_paths=tuple(str(item).strip() for item in stage_paths or () if str(item).strip()),
            suggested_commit_message=str(payload.get("suggested_commit_message", "")).strip(),
            readme_guidance=str(payload.get("readme_guidance", "")).strip(),
            commit_readiness_status=str(payload.get("commit_readiness_status", "needs_human_review")).strip() or "needs_human_review",  # type: ignore[arg-type]
            commit_readiness_reason=str(payload.get("commit_readiness_reason", "")).strip(),
            included_paths=tuple(str(item).strip() for item in included_paths or () if str(item).strip()),
            excluded_paths=tuple(str(item).strip() for item in excluded_paths or () if str(item).strip()),
            ambiguous_paths=tuple(str(item).strip() for item in ambiguous_paths or () if str(item).strip()),
            readme_status=str(payload.get("readme_status", "clean")).strip() or "clean",  # type: ignore[arg-type]
            playtest_required=bool(payload.get("playtest_required", False)),
            playtest_reason=str(payload.get("playtest_reason", "")).strip(),
            milestone_summary=str(payload.get("milestone_summary", "")).strip(),
        )


@dataclass(frozen=True)
class FeatureBundleCommitPlan:
    bundle_id: str
    feature_title: str
    mode: FeatureBundleCommitMode
    repo_branch: str
    repo_status: str
    milestone_summary: str
    commit_message: str
    commit_readiness_status: FeatureBundleCommitReadiness
    commit_readiness_reason: str
    included_paths: tuple[str, ...]
    excluded_paths: tuple[str, ...]
    ambiguous_paths: tuple[str, ...]
    readme_status: FeatureBundleReadmeStatus
    readme_guidance: str
    playtest_required: bool
    playtest_reason: str
    scope_fingerprint: str = ""

    @property
    def can_execute(self) -> bool:
        return self.commit_readiness_status == "safe_to_commit"

    def to_payload(self) -> dict[str, object]:
        return {
            "bundle_id": self.bundle_id,
            "feature_title": self.feature_title,
            "mode": self.mode,
            "repo_branch": self.repo_branch,
            "repo_status": self.repo_status,
            "milestone_summary": self.milestone_summary,
            "commit_message": self.commit_message,
            "commit_readiness_status": self.commit_readiness_status,
            "commit_readiness_reason": self.commit_readiness_reason,
            "included_paths": list(self.included_paths),
            "excluded_paths": list(self.excluded_paths),
            "ambiguous_paths": list(self.ambiguous_paths),
            "readme_status": self.readme_status,
            "readme_guidance": self.readme_guidance,
            "playtest_required": self.playtest_required,
            "playtest_reason": self.playtest_reason,
            "scope_fingerprint": self.scope_fingerprint,
            "can_execute": self.can_execute,
        }

    @staticmethod
    def from_payload(payload: dict[str, object]) -> "FeatureBundleCommitPlan":
        included_paths = payload.get("included_paths")
        excluded_paths = payload.get("excluded_paths")
        ambiguous_paths = payload.get("ambiguous_paths")
        return FeatureBundleCommitPlan(
            bundle_id=str(payload.get("bundle_id", "")).strip(),
            feature_title=str(payload.get("feature_title", "")).strip(),
            mode=str(payload.get("mode", "preview")).strip() or "preview",  # type: ignore[arg-type]
            repo_branch=str(payload.get("repo_branch", "")).strip(),
            repo_status=str(payload.get("repo_status", "")).strip(),
            milestone_summary=str(payload.get("milestone_summary", "")).strip(),
            commit_message=str(payload.get("commit_message", "")).strip(),
            commit_readiness_status=str(payload.get("commit_readiness_status", "needs_human_review")).strip() or "needs_human_review",  # type: ignore[arg-type]
            commit_readiness_reason=str(payload.get("commit_readiness_reason", "")).strip(),
            included_paths=tuple(str(item).strip() for item in included_paths or () if str(item).strip()),
            excluded_paths=tuple(str(item).strip() for item in excluded_paths or () if str(item).strip()),
            ambiguous_paths=tuple(str(item).strip() for item in ambiguous_paths or () if str(item).strip()),
            readme_status=str(payload.get("readme_status", "clean")).strip() or "clean",  # type: ignore[arg-type]
            readme_guidance=str(payload.get("readme_guidance", "")).strip(),
            playtest_required=bool(payload.get("playtest_required", False)),
            playtest_reason=str(payload.get("playtest_reason", "")).strip(),
            scope_fingerprint=str(payload.get("scope_fingerprint", "")).strip(),
        )


@dataclass(frozen=True)
class FeatureBundleCommitReceipt:
    bundle_id: str
    branch: str
    commit_sha: str
    commit_message: str
    committed_paths: tuple[str, ...]
    repo_status_fingerprint: str
    committed_at: str

    def to_payload(self) -> dict[str, object]:
        return {
            "bundle_id": self.bundle_id,
            "branch": self.branch,
            "commit_sha": self.commit_sha,
            "commit_message": self.commit_message,
            "committed_paths": list(self.committed_paths),
            "repo_status_fingerprint": self.repo_status_fingerprint,
            "committed_at": self.committed_at,
        }


@dataclass(frozen=True)
class FeatureBundleMilestoneRecord:
    bundle_id: str
    feature_title: str
    milestone_summary: str
    branch: str
    commit_sha: str
    commit_message: str
    committed_paths: tuple[str, ...]
    validation_summary: str
    validation_command: str
    repo_status: str
    readme_status: FeatureBundleReadmeStatus
    readme_guidance: str
    playtest_required: bool
    playtest_reason: str
    completion_summary: str = ""
    push_remote_name: str = ""
    pushed_at: str = ""

    def to_payload(self) -> dict[str, object]:
        return {
            "bundle_id": self.bundle_id,
            "feature_title": self.feature_title,
            "milestone_summary": self.milestone_summary,
            "branch": self.branch,
            "commit_sha": self.commit_sha,
            "commit_message": self.commit_message,
            "committed_paths": list(self.committed_paths),
            "validation_summary": self.validation_summary,
            "validation_command": self.validation_command,
            "repo_status": self.repo_status,
            "readme_status": self.readme_status,
            "readme_guidance": self.readme_guidance,
            "playtest_required": self.playtest_required,
            "playtest_reason": self.playtest_reason,
            "completion_summary": self.completion_summary,
            "push_remote_name": self.push_remote_name,
            "pushed_at": self.pushed_at,
        }

    @staticmethod
    def from_payload(payload: dict[str, object]) -> "FeatureBundleMilestoneRecord":
        committed_paths = payload.get("committed_paths")
        return FeatureBundleMilestoneRecord(
            bundle_id=str(payload.get("bundle_id", "")).strip(),
            feature_title=str(payload.get("feature_title", "")).strip(),
            milestone_summary=str(payload.get("milestone_summary", "")).strip(),
            branch=str(payload.get("branch", "")).strip(),
            commit_sha=str(payload.get("commit_sha", "")).strip(),
            commit_message=str(payload.get("commit_message", "")).strip(),
            committed_paths=tuple(str(item).strip() for item in committed_paths or () if str(item).strip()),
            validation_summary=str(payload.get("validation_summary", "")).strip(),
            validation_command=str(payload.get("validation_command", "")).strip(),
            repo_status=str(payload.get("repo_status", "")).strip(),
            readme_status=str(payload.get("readme_status", "clean")).strip() or "clean",  # type: ignore[arg-type]
            readme_guidance=str(payload.get("readme_guidance", "")).strip(),
            playtest_required=bool(payload.get("playtest_required", False)),
            playtest_reason=str(payload.get("playtest_reason", "")).strip(),
            completion_summary=str(payload.get("completion_summary", "")).strip(),
            push_remote_name=str(payload.get("push_remote_name", "")).strip(),
            pushed_at=str(payload.get("pushed_at", "")).strip(),
        )


@dataclass(frozen=True)
class FeatureBundlePushPlan:
    status: FeatureBundlePushStatus
    mode: FeatureBundlePushMode
    branch: str
    remote_name: str
    command_text: str
    commit_sha: str
    reason: str = ""

    @property
    def can_execute(self) -> bool:
        return self.status == "ready_to_push"

    def to_payload(self) -> dict[str, object]:
        return {
            "status": self.status,
            "mode": self.mode,
            "branch": self.branch,
            "remote_name": self.remote_name,
            "command_text": self.command_text,
            "commit_sha": self.commit_sha,
            "reason": self.reason,
            "can_execute": self.can_execute,
        }


@dataclass(frozen=True)
class FeatureBundlePrPlan:
    status: FeatureBundlePrStatus
    mode: FeatureBundlePrMode
    bundle_id: str
    feature_title: str
    branch: str
    commit_sha: str
    title: str
    summary: str
    changed_paths: tuple[str, ...]
    validation_summary: str
    validation_command: str
    merge_readiness: FeatureBundleMergeReadiness
    merge_readiness_reason: str
    readme_note: str
    playtest_required: bool
    playtest_reason: str
    remote_name: str = ""
    next_steps: tuple[str, ...] = ()

    def to_payload(self) -> dict[str, object]:
        return {
            "status": self.status,
            "mode": self.mode,
            "bundle_id": self.bundle_id,
            "feature_title": self.feature_title,
            "branch": self.branch,
            "commit_sha": self.commit_sha,
            "title": self.title,
            "summary": self.summary,
            "changed_paths": list(self.changed_paths),
            "validation_summary": self.validation_summary,
            "validation_command": self.validation_command,
            "merge_readiness": self.merge_readiness,
            "merge_readiness_reason": self.merge_readiness_reason,
            "readme_note": self.readme_note,
            "playtest_required": self.playtest_required,
            "playtest_reason": self.playtest_reason,
            "remote_name": self.remote_name,
            "next_steps": list(self.next_steps),
        }


@dataclass(frozen=True)
class FeatureBundleRecord:
    bundle_id: str
    feature_request: str
    feature_title: str
    intended_outcome: str
    bundle_summary: str
    files: tuple[FeatureBundleFile, ...]
    assumptions: tuple[str, ...]
    risk_notes: tuple[str, ...]
    validation_plan: FeatureValidationPlan | None
    state: FeatureBundleState
    validation_state: FeatureBundleValidationState
    created_at: str
    updated_at: str
    approval_required: bool
    applied_files: tuple[str, ...] = ()
    apply_summary: str = ""
    validation_summary: str = ""
    stop_reason: str = ""
    completion_advisory: FeatureBundleCompletionAdvisory | None = None
    coding_task_plan: CodingTaskPlan | None = None

    def editable_files(self) -> tuple[FeatureBundleFile, ...]:
        return tuple(item for item in self.files if item.editable)

    def file_paths(self) -> tuple[str, ...]:
        return tuple(item.relative_path for item in self.files)

    def with_state(
        self,
        state: FeatureBundleState,
        *,
        updated_at: str,
        applied_files: tuple[str, ...] | None = None,
        apply_summary: str | None = None,
        stop_reason: str | None = None,
    ) -> FeatureBundleRecord:
        return replace(
            self,
            state=state,
            updated_at=updated_at,
            applied_files=self.applied_files if applied_files is None else applied_files,
            apply_summary=self.apply_summary if apply_summary is None else apply_summary,
            stop_reason=self.stop_reason if stop_reason is None else stop_reason,
        )

    def with_validation(
        self,
        validation_state: FeatureBundleValidationState,
        *,
        updated_at: str,
        validation_summary: str,
        state: FeatureBundleState | None = None,
    ) -> FeatureBundleRecord:
        return replace(
            self,
            validation_state=validation_state,
            validation_summary=validation_summary,
            updated_at=updated_at,
            state=self.state if state is None else state,
        )

    def with_completion_advisory(
        self,
        advisory: FeatureBundleCompletionAdvisory,
        *,
        updated_at: str,
    ) -> FeatureBundleRecord:
        return replace(self, completion_advisory=advisory, updated_at=updated_at)

    def to_payload(self) -> dict[str, object]:
        return {
            "bundle_id": self.bundle_id,
            "feature_request": self.feature_request,
            "feature_title": self.feature_title,
            "intended_outcome": self.intended_outcome,
            "bundle_summary": self.bundle_summary,
            "files": [item.to_payload() for item in self.files],
            "assumptions": list(self.assumptions),
            "risk_notes": list(self.risk_notes),
            "validation_plan": self.validation_plan.to_payload() if self.validation_plan is not None else None,
            "state": self.state,
            "validation_state": self.validation_state,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "approval_required": self.approval_required,
            "applied_files": list(self.applied_files),
            "apply_summary": self.apply_summary,
            "validation_summary": self.validation_summary,
            "stop_reason": self.stop_reason,
            "completion_advisory": self.completion_advisory.to_payload() if self.completion_advisory is not None else None,
            "coding_task_plan": self.coding_task_plan.to_payload() if self.coding_task_plan is not None else None,
        }

    @staticmethod
    def from_payload(payload: dict[str, object]) -> FeatureBundleRecord:
        files = payload.get("files")
        assumptions = payload.get("assumptions")
        risk_notes = payload.get("risk_notes")
        validation_plan = payload.get("validation_plan")
        applied_files = payload.get("applied_files")
        completion_advisory = payload.get("completion_advisory")
        coding_task_plan = payload.get("coding_task_plan")
        return FeatureBundleRecord(
            bundle_id=str(payload.get("bundle_id", "")).strip(),
            feature_request=str(payload.get("feature_request", "")).strip(),
            feature_title=str(payload.get("feature_title", "")).strip(),
            intended_outcome=str(payload.get("intended_outcome", "")).strip(),
            bundle_summary=str(payload.get("bundle_summary", "")).strip(),
            files=tuple(FeatureBundleFile.from_payload(item) for item in files or () if isinstance(item, dict)),
            assumptions=tuple(str(item).strip() for item in assumptions or () if str(item).strip()),
            risk_notes=tuple(str(item).strip() for item in risk_notes or () if str(item).strip()),
            validation_plan=FeatureValidationPlan.from_payload(validation_plan) if isinstance(validation_plan, dict) else None,
            state=str(payload.get("state", "proposed")).strip().lower() or "proposed",  # type: ignore[arg-type]
            validation_state=str(payload.get("validation_state", "not_run")).strip().lower() or "not_run",  # type: ignore[arg-type]
            created_at=str(payload.get("created_at", "")).strip(),
            updated_at=str(payload.get("updated_at", "")).strip(),
            approval_required=bool(payload.get("approval_required", False)),
            applied_files=tuple(str(item).strip() for item in applied_files or () if str(item).strip()),
            apply_summary=str(payload.get("apply_summary", "")).strip(),
            validation_summary=str(payload.get("validation_summary", "")).strip(),
            stop_reason=str(payload.get("stop_reason", "")).strip(),
            completion_advisory=FeatureBundleCompletionAdvisory.from_payload(completion_advisory) if isinstance(completion_advisory, dict) else None,
            coding_task_plan=CodingTaskPlan.from_payload(coding_task_plan) if isinstance(coding_task_plan, dict) else None,
        )
