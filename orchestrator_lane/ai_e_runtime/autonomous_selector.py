from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Mapping, Sequence

from .time_utils import get_current_timestamp, parse_timestamp


@dataclass(frozen=True)
class CandidateScore:
    task_id: str
    total_score: int
    priority_weight: int
    readiness: int
    policy_score: int
    recency_boost: int
    execution_cost: int
    priority_value: int
    reason: str

    def to_payload(self) -> Dict[str, Any]:
        return {
            "task_id": self.task_id,
            "score": self.total_score,
            "total_score": self.total_score,
            "score_breakdown": self.score_breakdown(),
            "priority_weight": self.priority_weight,
            "readiness": self.readiness,
            "policy_score": self.policy_score,
            "recency_boost": self.recency_boost,
            "execution_cost": self.execution_cost,
            "priority_value": self.priority_value,
            "reason": self.reason,
        }

    def score_breakdown(self) -> Dict[str, int]:
        return {
            "priority_weight": self.priority_weight,
            "readiness": self.readiness,
            "policy_score": self.policy_score,
            "recency_boost": self.recency_boost,
            "execution_cost": self.execution_cost,
        }


@dataclass(frozen=True)
class ExcludedTask:
    task_id: str
    reason: str

    def to_payload(self) -> Dict[str, Any]:
        return {
            "task_id": self.task_id,
            "reason": self.reason,
            "exclusion_reason": self.reason,
        }


@dataclass(frozen=True)
class AutonomousSelectionResult:
    selected_task_id: str | None
    selected_task_score: CandidateScore | None
    top_candidates: List[CandidateScore]
    excluded_tasks: List[ExcludedTask]
    evaluated_count: int
    eligible_count: int
    reason: str
    timestamp: str

    def to_payload(self) -> Dict[str, Any]:
        return {
            "selected_task_id": self.selected_task_id,
            "score": self.selected_task_score.total_score if self.selected_task_score else None,
            "score_breakdown": self.selected_task_score.score_breakdown() if self.selected_task_score else None,
            "selected_task_score": self.selected_task_score.to_payload() if self.selected_task_score else None,
            "top_candidates": [candidate.to_payload() for candidate in self.top_candidates],
            "excluded_tasks": [entry.to_payload() for entry in self.excluded_tasks],
            "evaluated_count": self.evaluated_count,
            "eligible_count": self.eligible_count,
            "reason": self.reason,
            "timestamp": self.timestamp,
        }


def select_next_task(
    queue: Sequence[Mapping[str, Any]],
    runtime_state: Mapping[str, Any] | Any,
    *,
    root_dir: Path | None = None,
) -> AutonomousSelectionResult:
    runtime_payload = _runtime_payload(runtime_state)
    timestamp = str(runtime_payload.get("timestamp") or get_current_timestamp())
    completed_ids = {
        _task_id(task)
        for task in queue
        if str(task.get("status", "pending")).lower() == "completed" and _task_id(task)
    }
    candidate_scores: List[CandidateScore] = []
    excluded_tasks: List[ExcludedTask] = []

    for raw_task in sorted(queue, key=lambda item: _task_id(item) or ""):
        task = dict(raw_task)
        task_id = _task_id(task)
        if not task_id:
            excluded_tasks.append(ExcludedTask(task_id="unknown_task", reason="missing_task_id"))
            continue
        exclusion_reason = _exclusion_reason(task, completed_ids=completed_ids, root_dir=root_dir)
        if exclusion_reason is not None:
            excluded_tasks.append(ExcludedTask(task_id=task_id, reason=exclusion_reason))
            continue
        candidate_scores.append(_score_task(task, runtime_payload=runtime_payload))

    ranked = sorted(
        candidate_scores,
        key=lambda item: (-item.total_score, item.priority_value, item.execution_cost, item.task_id),
    )
    selected = ranked[0] if ranked else None
    reason = (
        f"Autonomous selector chose task {selected.task_id} based on highest combined readiness and policy-safe score."
        if selected
        else "Autonomous selector found no valid task after applying safety, readiness, and contract filters."
    )
    return AutonomousSelectionResult(
        selected_task_id=selected.task_id if selected else None,
        selected_task_score=selected,
        top_candidates=ranked[:3],
        excluded_tasks=excluded_tasks,
        evaluated_count=len(queue),
        eligible_count=len(ranked),
        reason=reason,
        timestamp=timestamp,
    )


def format_selection_report(result: AutonomousSelectionResult) -> str:
    summary = result.reason
    facts = [f"{result.evaluated_count} tasks evaluated"]
    if result.excluded_tasks:
        facts.append(f"{len(result.excluded_tasks)} tasks excluded during filtering")
    if result.selected_task_score is not None:
        facts.append(f"top score: {result.selected_task_score.total_score}")
        facts.append(f"selected task: {result.selected_task_score.task_id}")

    assumptions = [
        "scoring weights unchanged from v1",
        "selection remains deterministic for the same queue state and runtime inputs",
    ]
    if not result.excluded_tasks:
        assumptions.append("no missing dependencies")

    recommendations = [
        "continue autonomous loop" if result.selected_task_id else "wait until a valid task becomes selectable",
        "monitor scoring distribution for tuning",
    ]
    if result.excluded_tasks:
        recommendations.append(
            "review excluded tasks and resolve dependency, approval, or contract issues if they should become runnable"
        )

    lines = [
        "SUMMARY",
        summary,
        "",
        "FACTS",
        *[f"- {item}" for item in facts],
        "",
        "ASSUMPTIONS",
        *[f"- {item}" for item in assumptions],
        "",
        "RECOMMENDATIONS",
        *[f"- {item}" for item in recommendations],
        "",
        "TIMESTAMP",
        result.timestamp,
        "",
    ]
    return "\n".join(lines)


def _runtime_payload(runtime_state: Mapping[str, Any] | Any) -> Dict[str, Any]:
    if isinstance(runtime_state, Mapping):
        return dict(runtime_state)
    if hasattr(runtime_state, "to_payload"):
        payload = runtime_state.to_payload()
        if isinstance(payload, Mapping):
            return dict(payload)
    return {}


def _exclusion_reason(
    task: Mapping[str, Any],
    *,
    completed_ids: set[str],
    root_dir: Path | None,
) -> str | None:
    task_id = _task_id(task) or "unknown_task"
    status = str(task.get("status", "pending")).lower()
    if status in {"completed", "blocked", "running"}:
        return f"status_{status}"
    if status not in {"pending", "needs_approval"}:
        return f"status_{status or 'unknown'}"
    if str(task.get("content_policy_decision") or "").lower() == "blocked" or bool(task.get("content_policy_block", False)):
        return "content_policy_blocked"
    if str(task.get("decision") or "").lower() == "block" or bool(task.get("decision_blocked", False)):
        return "decision_blocked"
    dependencies = task.get("dependencies", [])
    if isinstance(dependencies, list):
        missing = [str(item) for item in dependencies if str(item) not in completed_ids]
        if missing:
            return "missing_dependencies"
    if not _has_valid_contract(task, root_dir=root_dir):
        return "invalid_contract_format"
    approval_state = str(task.get("approval_state") or "not_required").lower()
    auto_allowed = bool(task.get("decision_auto_execute", False)) or str(task.get("decision") or "").lower() == "auto_execute"
    if status == "needs_approval" and not auto_allowed:
        return "awaiting_approval"
    if approval_state in {"awaiting_approval", "blocked"} and not auto_allowed:
        return "awaiting_approval"
    return None


def _has_valid_contract(task: Mapping[str, Any], *, root_dir: Path | None) -> bool:
    contract_value = task.get("contract_path") or task.get("payload_path")
    if not contract_value:
        return False
    candidate = Path(str(contract_value))
    if not candidate.is_absolute():
        if root_dir is None:
            return False
        candidate = (Path(root_dir) / candidate).resolve()
    if not candidate.exists() or candidate.suffix.lower() != ".json":
        return False
    try:
        raw = json.loads(candidate.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    if not isinstance(raw, dict):
        return False
    payload = raw.get("runtime_task", raw)
    if not isinstance(payload, dict):
        return False
    task_id = _task_id(task)
    payload_task_id = str(payload.get("task_id") or payload.get("id") or "")
    return bool(task_id and payload_task_id and payload_task_id == task_id)


def _score_task(task: Mapping[str, Any], *, runtime_payload: Mapping[str, Any]) -> CandidateScore:
    task_id = _task_id(task) or "unknown_task"
    priority_value = _priority_value(task)
    priority_weight = _priority_weight(priority_value)
    readiness = 1
    policy_score = _policy_score(task)
    recency_boost = _recency_boost(task, runtime_payload=runtime_payload)
    execution_cost = _execution_cost(task)
    total_score = (priority_weight * 3) + (readiness * 2) + (policy_score * 3) + recency_boost - execution_cost
    reason = (
        f"priority_weight={priority_weight}, readiness={readiness}, policy_score={policy_score}, "
        f"recency_boost={recency_boost}, execution_cost={execution_cost}"
    )
    return CandidateScore(
        task_id=task_id,
        total_score=total_score,
        priority_weight=priority_weight,
        readiness=readiness,
        policy_score=policy_score,
        recency_boost=recency_boost,
        execution_cost=execution_cost,
        priority_value=priority_value,
        reason=reason,
    )


def _priority_value(task: Mapping[str, Any]) -> int:
    try:
        return int(task.get("priority", 50) or 50)
    except (TypeError, ValueError):
        return 50


def _priority_weight(priority_value: int) -> int:
    if priority_value <= 10:
        return 5
    if priority_value <= 25:
        return 4
    if priority_value <= 50:
        return 3
    if priority_value <= 100:
        return 2
    return 1


def _policy_score(task: Mapping[str, Any]) -> int:
    decision = str(task.get("content_policy_decision") or "allowed").lower()
    if decision == "requires_review":
        return 1
    return 2


def _recency_boost(task: Mapping[str, Any], *, runtime_payload: Mapping[str, Any]) -> int:
    current_timestamp = str(runtime_payload.get("timestamp") or get_current_timestamp())
    reference_fields = (
        "last_attempt_timestamp",
        "last_retry_timestamp",
        "approved_at",
        "created_at",
    )
    reference_value = next((str(task.get(field) or "").strip() for field in reference_fields if str(task.get(field) or "").strip()), "")
    if not reference_value:
        return 2
    try:
        current = parse_timestamp(current_timestamp)
        previous = parse_timestamp(reference_value)
    except ValueError:
        return 1
    age_seconds = max(0.0, (current - previous).total_seconds())
    if age_seconds >= 1800:
        return 2
    if age_seconds >= 600:
        return 1
    return 0


def _execution_cost(task: Mapping[str, Any]) -> int:
    cost = 0
    delay_raw = task.get("simulated_delay_seconds", task.get("execution_seconds", 0))
    try:
        delay = float(delay_raw or 0)
    except (TypeError, ValueError):
        delay = 0.0
    if delay >= 10:
        cost += 2
    elif delay >= 3:
        cost += 1

    task_type = str(task.get("task_type") or "").lower()
    execution_lane = str(task.get("execution_lane") or "").lower()
    if bool(task.get("mutation_capable", False)) or execution_lane == "approval_required_mutation":
        cost += 2
    elif any(token in task_type for token in ("implementation", "validation", "runtime_test", "world_interaction")):
        cost += 1
    return cost


def _task_id(task: Mapping[str, Any]) -> str:
    for key in ("task_id", "id"):
        value = task.get(key)
        if value:
            return str(value)
    return ""


__all__ = [
    "AutonomousSelectionResult",
    "CandidateScore",
    "ExcludedTask",
    "format_selection_report",
    "select_next_task",
]