from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

from orchestrator.utils import read_json_with_status, write_json


DEFAULT_PREVIEW_ID = "queue_preview_001"
TASK_TYPE_BY_INTENT_TYPE = {
    "system_fix": "queue_task::system_fix",
    "system_improve": "queue_task::system_improve",
    "system_expand": "queue_task::system_expand",
}


def build_queue_preview(
    decision: Dict[str, Any] | Path | str,
    bundle: Dict[str, Any] | Path | str,
) -> Dict[str, Any]:
    """Build a non-mutating queue preview from a review decision and bundle.

    Example:
        from ai_e_runtime.artifact_loader import load_and_prepare_contracts
        from ai_e_runtime.contract_adapter import adapt_contracts_to_intents
        from ai_e_runtime.intent_packager import package_intents_to_requests
        from ai_e_runtime.request_review_bundle import build_review_bundle
        from ai_e_runtime.request_review_decision import create_review_decision
        from ai_e_runtime.queue_preview_builder import build_queue_preview, export_queue_preview

        contracts = load_and_prepare_contracts()
        intents = adapt_contracts_to_intents(contracts)
        requests = package_intents_to_requests(intents)
        bundle = build_review_bundle(requests)
        decision_obj = create_review_decision(bundle, "approved")
        preview = build_queue_preview(decision_obj, bundle)
        export_queue_preview(preview, "runs/sample_clip_analysis/queue_preview_001.json")
    """

    decision_payload = _coerce_json_object(decision, kind="decision")
    bundle_payload = _coerce_json_object(bundle, kind="bundle")

    decision_value = str(decision_payload.get("decision") or "needs_changes").strip().lower()
    bundle_id = str(bundle_payload.get("bundle_id") or decision_payload.get("bundle_id") or "unknown_bundle")
    requests = [item for item in bundle_payload.get("requests", []) if isinstance(item, dict)]

    if decision_value == "approved":
        preview_items = [_build_preview_item(request) for request in requests if _is_valid_request(request)]
        preview_status = "ready_for_queue"
        explanation = "all prepared requests are eligible for future queue insertion"
    elif decision_value == "rejected":
        preview_items = []
        preview_status = "empty"
        explanation = "bundle rejected; no queue items would be inserted"
    else:
        preview_items = [_build_preview_item(request) for request in requests if _is_valid_request(request)]
        preview_status = "blocked"
        explanation = "blocked_pending_changes"

    preview = {
        "preview_id": DEFAULT_PREVIEW_ID,
        "source_bundle_id": bundle_id,
        "decision": decision_value,
        "total_requests": len(preview_items),
        "preview_status": preview_status,
        "preview_items": preview_items,
        "explanation": explanation,
    }
    print(f"[queue_preview_builder] Decision type: {decision_value}")
    print(f"[queue_preview_builder] Preview items: {len(preview_items)}")
    print(f"[queue_preview_builder] Preview status: {preview_status}")
    return preview


def export_queue_preview(preview: Dict[str, Any], output_path: Path | str) -> Path | None:
    if not isinstance(preview, dict):
        print("[queue_preview_builder] Skipping export: preview must be an object.")
        return None

    resolved_path = Path(output_path)
    write_json(resolved_path, preview)
    print(f"[queue_preview_builder] Output path: {resolved_path}")
    return resolved_path


def _coerce_json_object(value: Dict[str, Any] | Path | str, *, kind: str) -> Dict[str, Any]:
    if isinstance(value, dict):
        identifier = value.get("decision_id") or value.get("bundle_id") or f"unknown_{kind}"
        print(f"[queue_preview_builder] {kind.capitalize()} loaded: {identifier}")
        return dict(value)

    path = Path(value)
    payload, issue = read_json_with_status(path, default={})
    if issue is not None or not isinstance(payload, dict) or not payload:
        print(f"[queue_preview_builder] {kind.capitalize()} loaded: invalid_or_missing_{kind} ({path})")
        return {}

    print(f"[queue_preview_builder] {kind.capitalize()} loaded: {path}")
    return payload


def _is_valid_request(request: Dict[str, Any]) -> bool:
    request_id = str(request.get("request_id") or "").strip()
    intent_type = str(request.get("intent_type") or "").strip()
    return bool(request_id and intent_type)


def _build_preview_item(request: Dict[str, Any]) -> Dict[str, Any]:
    request_id = str(request.get("request_id") or "unknown_request").strip()
    intent_type = str(request.get("intent_type") or "unknown_intent").strip()
    return {
        "task_id": f"task_{request_id}",
        "task_type": TASK_TYPE_BY_INTENT_TYPE.get(intent_type, f"queue_task::{intent_type}"),
        "priority": str(request.get("priority") or "medium").strip() or "medium",
        "inputs": {
            "request_id": request_id,
            "action_targets": request.get("action_targets") if isinstance(request.get("action_targets"), list) else [],
        },
        "expected_changes": request.get("expected_changes") if isinstance(request.get("expected_changes"), list) else [],
        "status": "pending_execution",
    }


__all__ = [
    "DEFAULT_PREVIEW_ID",
    "TASK_TYPE_BY_INTENT_TYPE",
    "build_queue_preview",
    "export_queue_preview",
]