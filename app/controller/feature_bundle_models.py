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


@dataclass(frozen=True)
class FeatureValidationPlan:
    command_text: str
    rationale: str

    def to_payload(self) -> dict[str, str]:
        return {"command_text": self.command_text, "rationale": self.rationale}


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
        }