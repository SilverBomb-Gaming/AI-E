from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List

from orchestrator.utils import read_json_with_status


DEFAULT_SANDBOX_DISPATCH_ID = "sandbox_dispatch_001"


def dispatch_sandbox_queue(queue: Dict[str, Any] | Path | str) -> Dict[str, Any]:
    """Simulate sequential execution of sandbox queue tasks without side effects.

    Example:
        from ai_e_runtime.sandbox_execution_dispatcher import dispatch_sandbox_queue

        report = dispatch_sandbox_queue("runs/sample_clip_analysis/sandbox_queue.json")
    """

    queue_payload = _coerce_queue(queue)
    tasks = [task for task in queue_payload.get("tasks", []) if isinstance(task, dict)]

    print(f"[sandbox_execution_dispatcher] Tasks to execute: {len(tasks)}")

    executed_tasks: List[Dict[str, Any]] = []
    for task in tasks:
        task_id = str(task.get("task_id") or "unknown_task").strip() or "unknown_task"
        normalized_type = _normalize_task_type(task.get("task_type"))
        print(f"[sandbox_execution_dispatcher] Executing task: {task_id} ({normalized_type})")
        executed_tasks.append(_dispatch_task(task, normalized_type))

    report = {
        "dispatch_id": DEFAULT_SANDBOX_DISPATCH_ID,
        "total_tasks": len(tasks),
        "executed_tasks": executed_tasks,
        "status": "completed",
    }
    print("[sandbox_execution_dispatcher] Final status: completed")
    return report


def simulate_repair(task: Dict[str, Any]) -> Dict[str, Any]:
    task_id = str(task.get("task_id") or "unknown_task").strip() or "unknown_task"
    print(f"[sandbox_execution_dispatcher] simulate_repair: would fix identified issue for {task_id}")
    return {
        "task_id": task_id,
        "action": "repair",
        "status": "simulated",
        "details": "would fix identified issue",
    }


def simulate_optimization(task: Dict[str, Any]) -> Dict[str, Any]:
    task_id = str(task.get("task_id") or "unknown_task").strip() or "unknown_task"
    print(f"[sandbox_execution_dispatcher] simulate_optimization: would optimize identified flow for {task_id}")
    return {
        "task_id": task_id,
        "action": "optimization",
        "status": "simulated",
        "details": "would optimize identified flow",
    }


def simulate_expansion(task: Dict[str, Any]) -> Dict[str, Any]:
    task_id = str(task.get("task_id") or "unknown_task").strip() or "unknown_task"
    print(f"[sandbox_execution_dispatcher] simulate_expansion: would expand identified gameplay space for {task_id}")
    return {
        "task_id": task_id,
        "action": "expansion",
        "status": "simulated",
        "details": "would expand identified gameplay space",
    }


def _coerce_queue(value: Dict[str, Any] | Path | str) -> Dict[str, Any]:
    if isinstance(value, dict):
        identifier = value.get("queue_id") or "unknown_sandbox_queue"
        print(f"[sandbox_execution_dispatcher] Queue loaded: {identifier}")
        return dict(value)

    path = Path(value)
    payload, issue = read_json_with_status(path, default={})
    if issue is not None or not isinstance(payload, dict) or not payload:
        print(f"[sandbox_execution_dispatcher] Queue loaded: invalid_or_missing_sandbox_queue ({path})")
        return {}

    print(f"[sandbox_execution_dispatcher] Queue loaded: {path}")
    return payload


def _normalize_task_type(task_type: Any) -> str:
    value = str(task_type or "").strip().lower()
    if value.startswith("queue_task::"):
        return value.split("::", 1)[1]
    return value


def _dispatch_task(task: Dict[str, Any], normalized_type: str) -> Dict[str, Any]:
    if normalized_type == "system_fix":
        return simulate_repair(task)
    if normalized_type == "system_improve":
        return simulate_optimization(task)
    if normalized_type == "system_expand":
        return simulate_expansion(task)

    task_id = str(task.get("task_id") or "unknown_task").strip() or "unknown_task"
    print(f"[sandbox_execution_dispatcher] Unsupported task type for {task_id}: {normalized_type or 'unknown'}")
    return {
        "task_id": task_id,
        "action": normalized_type or "unknown",
        "status": "simulated",
        "details": "no simulation mapping available",
    }


__all__ = [
    "DEFAULT_SANDBOX_DISPATCH_ID",
    "dispatch_sandbox_queue",
    "simulate_expansion",
    "simulate_optimization",
    "simulate_repair",
]