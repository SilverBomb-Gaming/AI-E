from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

from orchestrator.utils import read_json_with_status, write_json


DEFAULT_SANDBOX_QUEUE_ID = "sandbox_queue_001"
DEFAULT_SANDBOX_STAGE_ID = "sandbox_execution_stage_001"
DEFAULT_SANDBOX_QUEUE_PATH = Path("runs") / "sample_clip_analysis" / "sandbox_queue.json"


def write_to_sandbox_queue(gate_result: Dict[str, Any] | Path | str) -> Dict[str, Any]:
    """Write queue-eligible items to a sandbox queue file only.

    Example:
        from ai_e_runtime.queue_insertion_gate import evaluate_queue_insertion
        from ai_e_runtime.queue_sandbox_executor import write_to_sandbox_queue

        gate_result = evaluate_queue_insertion(
            "runs/sample_clip_analysis/queue_preview_001.json",
            "runs/sample_clip_analysis/review_decision_001.json",
        )
        sandbox_result = write_to_sandbox_queue(gate_result)
    """

    gate_payload = _coerce_gate_result(gate_result)
    allowed = bool(gate_payload.get("allowed"))
    eligible_items = [item for item in gate_payload.get("eligible_items", []) if isinstance(item, dict)]
    output_path = _resolve_output_path()

    if not allowed:
        result = {
            "execution_stage_id": DEFAULT_SANDBOX_STAGE_ID,
            "status": "blocked",
            "tasks_written": 0,
            "output_path": str(output_path),
        }
        print("[queue_sandbox_executor] blocked")
        print("[queue_sandbox_executor] Tasks written: 0")
        print(f"[queue_sandbox_executor] Output path: {output_path}")
        return result

    sandbox_queue = {
        "queue_id": DEFAULT_SANDBOX_QUEUE_ID,
        "source": "sandbox_execution",
        "tasks": [dict(item) for item in eligible_items],
        "status": "ready_for_execution",
    }
    write_json(output_path, sandbox_queue)

    result = {
        "execution_stage_id": DEFAULT_SANDBOX_STAGE_ID,
        "status": "sandbox_ready",
        "tasks_written": len(eligible_items),
        "output_path": str(output_path),
    }
    print("[queue_sandbox_executor] allowed")
    print(f"[queue_sandbox_executor] Tasks written: {len(eligible_items)}")
    print(f"[queue_sandbox_executor] Output path: {output_path}")
    return result


def _coerce_gate_result(value: Dict[str, Any] | Path | str) -> Dict[str, Any]:
    if isinstance(value, dict):
        identifier = value.get("gate_id") or "unknown_gate_result"
        print(f"[queue_sandbox_executor] Gate result loaded: {identifier}")
        return dict(value)

    path = Path(value)
    payload, issue = read_json_with_status(path, default={})
    if issue is not None or not isinstance(payload, dict) or not payload:
        print(f"[queue_sandbox_executor] Gate result loaded: invalid_or_missing_gate_result ({path})")
        return {}

    print(f"[queue_sandbox_executor] Gate result loaded: {path}")
    return payload


def _resolve_output_path() -> Path:
    return Path(__file__).resolve().parents[1] / DEFAULT_SANDBOX_QUEUE_PATH


__all__ = [
    "DEFAULT_SANDBOX_QUEUE_ID",
    "DEFAULT_SANDBOX_QUEUE_PATH",
    "DEFAULT_SANDBOX_STAGE_ID",
    "write_to_sandbox_queue",
]