"""Structured build-planning models derived from translated intent drafts."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


BuildPlanState = Literal["ready", "blocked"]


@dataclass(frozen=True)
class BuildPlanTaskGroup:
    name: str
    objective: str
    tasks: tuple[str, ...]

    def to_payload(self) -> dict[str, object]:
        return {
            "name": self.name,
            "objective": self.objective,
            "tasks": list(self.tasks),
        }


@dataclass(frozen=True)
class BuildPlanPhase:
    name: str
    goal: str
    task_groups: tuple[BuildPlanTaskGroup, ...]
    dependencies: tuple[str, ...]

    def to_payload(self) -> dict[str, object]:
        return {
            "name": self.name,
            "goal": self.goal,
            "task_groups": [group.to_payload() for group in self.task_groups],
            "dependencies": list(self.dependencies),
        }


@dataclass(frozen=True)
class BuildPlan:
    plan_id: str
    translation_session_id: str
    intent_id: str
    request_type: str
    title: str
    summary: str
    state: BuildPlanState
    phases: tuple[BuildPlanPhase, ...]
    cross_phase_dependencies: tuple[str, ...]
    blockers: tuple[str, ...]
    assumptions: tuple[str, ...]
    confirmed_values: tuple[str, ...]
    next_step: str
    operator_handoff: str

    def to_payload(self) -> dict[str, object]:
        return {
            "plan_id": self.plan_id,
            "translation_session_id": self.translation_session_id,
            "intent_id": self.intent_id,
            "request_type": self.request_type,
            "title": self.title,
            "summary": self.summary,
            "state": self.state,
            "phases": [phase.to_payload() for phase in self.phases],
            "cross_phase_dependencies": list(self.cross_phase_dependencies),
            "blockers": list(self.blockers),
            "assumptions": list(self.assumptions),
            "confirmed_values": list(self.confirmed_values),
            "next_step": self.next_step,
            "operator_handoff": self.operator_handoff,
        }