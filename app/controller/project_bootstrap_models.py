"""Structured models for explicit phase-1 project bootstrap proposals."""
from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Literal


ProjectBootstrapType = Literal["python_script", "python_cli", "desktop_app", "simple_library"]
ProjectBootstrapState = Literal["proposed", "executing", "completed", "failed"]


@dataclass(frozen=True)
class ProjectBootstrapFileSpec:
    relative_path: str
    reason: str
    content: str

    @property
    def path(self) -> str:
        return self.relative_path

    @property
    def purpose(self) -> str:
        return self.reason

    @property
    def contents(self) -> str:
        return self.content

    def to_payload(self) -> dict[str, str]:
        return {
            "relative_path": self.relative_path,
            "reason": self.reason,
            "content": self.content,
        }

    def to_create_command_argument(self) -> str:
        lines = [self.relative_path]
        if self.reason:
            lines.append(f"Reason: {self.reason}")
        lines.append("@@ CONTENT")
        lines.append(self.content)
        return "\n".join(lines)


@dataclass(frozen=True)
class ProjectBootstrapExecutionRecord:
    relative_path: str
    capability_id: str
    outcome: str
    reason_code: str
    summary: str

    def to_payload(self) -> dict[str, str]:
        return {
            "relative_path": self.relative_path,
            "capability_id": self.capability_id,
            "outcome": self.outcome,
            "reason_code": self.reason_code,
            "summary": self.summary,
        }


@dataclass(frozen=True)
class BootstrapResult:
    project_type: ProjectBootstrapType
    created_files: tuple[str, ...]
    summary: str

    def to_payload(self) -> dict[str, object]:
        return {
            "project_type": self.project_type,
            "created_files": list(self.created_files),
            "summary": self.summary,
        }


@dataclass(frozen=True)
class ProjectBootstrapProposal:
    bootstrap_id: str
    translation_session_id: str
    plan_id: str
    intent_id: str
    project_type: ProjectBootstrapType
    title: str
    summary: str
    source_intent_summary: str
    files: tuple[ProjectBootstrapFileSpec, ...]
    follow_up_commands: tuple[str, ...]
    warnings: tuple[str, ...]
    next_step: str
    created_at: str
    updated_at: str
    state: ProjectBootstrapState = "proposed"
    completed_files: tuple[ProjectBootstrapExecutionRecord, ...] = ()
    stop_reason: str = ""

    def with_state(
        self,
        state: ProjectBootstrapState,
        *,
        updated_at: str,
        completed_files: tuple[ProjectBootstrapExecutionRecord, ...] | None = None,
        stop_reason: str | None = None,
    ) -> "ProjectBootstrapProposal":
        return replace(
            self,
            state=state,
            updated_at=updated_at,
            completed_files=self.completed_files if completed_files is None else completed_files,
            stop_reason=self.stop_reason if stop_reason is None else stop_reason,
        )

    def to_payload(self) -> dict[str, object]:
        return {
            "bootstrap_id": self.bootstrap_id,
            "translation_session_id": self.translation_session_id,
            "plan_id": self.plan_id,
            "intent_id": self.intent_id,
            "project_type": self.project_type,
            "title": self.title,
            "summary": self.summary,
            "source_intent_summary": self.source_intent_summary,
            "files": [file_spec.to_payload() for file_spec in self.files],
            "follow_up_commands": list(self.follow_up_commands),
            "warnings": list(self.warnings),
            "next_step": self.next_step,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "state": self.state,
            "completed_files": [record.to_payload() for record in self.completed_files],
            "stop_reason": self.stop_reason,
        }


BootstrapFileSpec = ProjectBootstrapFileSpec
BootstrapPlan = ProjectBootstrapProposal