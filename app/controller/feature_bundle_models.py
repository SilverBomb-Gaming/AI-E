"""Bounded multi-file feature bundle models."""
from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Literal


FeatureBundleState = Literal["proposed", "applying", "applied", "validated", "failed", "invalidated"]
FeatureBundleValidationState = Literal["not_run", "passed", "failed", "timed_out"]


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
class FeatureBundleCompletionAdvisory:
    repo_branch: str
    repo_status: str
    completion_summary: str
    milestone_log: str
    suggested_stage_paths: tuple[str, ...]
    suggested_commit_message: str
    readme_guidance: str

    def to_payload(self) -> dict[str, object]:
        return {
            "repo_branch": self.repo_branch,
            "repo_status": self.repo_status,
            "completion_summary": self.completion_summary,
            "milestone_log": self.milestone_log,
            "suggested_stage_paths": list(self.suggested_stage_paths),
            "suggested_commit_message": self.suggested_commit_message,
            "readme_guidance": self.readme_guidance,
        }

    @staticmethod
    def from_payload(payload: dict[str, object]) -> "FeatureBundleCompletionAdvisory":
        stage_paths = payload.get("suggested_stage_paths")
        return FeatureBundleCompletionAdvisory(
            repo_branch=str(payload.get("repo_branch", "")).strip(),
            repo_status=str(payload.get("repo_status", "")).strip(),
            completion_summary=str(payload.get("completion_summary", "")).strip(),
            milestone_log=str(payload.get("milestone_log", "")).strip(),
            suggested_stage_paths=tuple(str(item).strip() for item in stage_paths or () if str(item).strip()),
            suggested_commit_message=str(payload.get("suggested_commit_message", "")).strip(),
            readme_guidance=str(payload.get("readme_guidance", "")).strip(),
        )


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
        }

    @staticmethod
    def from_payload(payload: dict[str, object]) -> FeatureBundleRecord:
        files = payload.get("files")
        assumptions = payload.get("assumptions")
        risk_notes = payload.get("risk_notes")
        validation_plan = payload.get("validation_plan")
        applied_files = payload.get("applied_files")
        completion_advisory = payload.get("completion_advisory")
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
        )