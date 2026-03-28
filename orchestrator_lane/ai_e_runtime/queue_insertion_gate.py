from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List

from orchestrator.utils import read_json_with_status


DEFAULT_GATE_ID = "queue_insertion_gate_001"


def evaluate_queue_insertion(
    preview: Dict[str, Any] | Path | str,
    decision: Dict[str, Any] | Path | str,
) -> Dict[str, Any]:
    """Determine whether queue insertion would be allowed without mutating the queue.

    Example:
        from ai_e_runtime.queue_preview_builder import build_queue_preview
        from ai_e_runtime.queue_insertion_gate import evaluate_queue_insertion

        gate_result = evaluate_queue_insertion(
            "runs/sample_clip_analysis/queue_preview_001.json",
            "runs/sample_clip_analysis/review_decision_001.json",
        )
    """

    preview_payload = _coerce_json_object(preview, kind="preview")
    decision_payload = _coerce_json_object(decision, kind="decision")

    decision_value = str(decision_payload.get("decision") or "needs_changes").strip().lower()
    preview_status = str(preview_payload.get("preview_status") or "blocked").strip().lower()
    preview_items = [item for item in preview_payload.get("preview_items", []) if isinstance(item, dict)]

    allowed = False
    eligible_items: List[Dict[str, Any]] = []
    if decision_value == "approved" and preview_status == "ready_for_queue":
        allowed = True
        eligible_items = [dict(item) for item in preview_items]
        reason = "decision approved and preview is ready_for_queue"
    elif decision_value == "approved":
        reason = f"decision approved but preview status is {preview_status or 'unknown'}"
    elif decision_value == "rejected":
        reason = "decision rejected; queue insertion is not allowed"
    else:
        reason = "decision needs_changes; queue insertion is blocked"

    result = {
        "gate_id": DEFAULT_GATE_ID,
        "decision": decision_value,
        "allowed": allowed,
        "reason": reason,
        "eligible_items": eligible_items,
    }
    print(f"[queue_insertion_gate] Decision: {decision_value}")
    print(f"[queue_insertion_gate] {'allowed' if allowed else 'blocked'}")
    print(f"[queue_insertion_gate] Eligible items: {len(eligible_items)}")
    return result


def _coerce_json_object(value: Dict[str, Any] | Path | str, *, kind: str) -> Dict[str, Any]:
    if isinstance(value, dict):
        identifier = value.get("preview_id") or value.get("decision_id") or f"unknown_{kind}"
        print(f"[queue_insertion_gate] {kind.capitalize()} loaded: {identifier}")
        return dict(value)

    path = Path(value)
    payload, issue = read_json_with_status(path, default={})
    if issue is not None or not isinstance(payload, dict) or not payload:
        print(f"[queue_insertion_gate] {kind.capitalize()} loaded: invalid_or_missing_{kind} ({path})")
        return {}

    print(f"[queue_insertion_gate] {kind.capitalize()} loaded: {path}")
    return payload


__all__ = ["DEFAULT_GATE_ID", "evaluate_queue_insertion"]