from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

from orchestrator.utils import read_json_with_status, write_json

from .time_utils import get_current_timestamp


ALLOWED_REVIEW_DECISIONS = {"approved", "rejected", "needs_changes"}
DEFAULT_DECISION_ID = "review_decision_001"
DEFAULT_DECIDED_BY = "owner"
DEFAULT_DECISION_FALLBACK = "needs_changes"


def create_review_decision(
    bundle: Dict[str, Any] | Path | str,
    decision: str,
    notes: str | None = None,
    summary_path: Path | str | None = None,
) -> Dict[str, Any]:
    """Create a dry-run owner decision record from a review bundle.

    Example:
        from pathlib import Path
        from ai_e_runtime.artifact_loader import load_and_prepare_contracts
        from ai_e_runtime.contract_adapter import adapt_contracts_to_intents
        from ai_e_runtime.intent_packager import package_intents_to_requests
        from ai_e_runtime.request_review_bundle import build_review_bundle, export_review_bundle
        from ai_e_runtime.request_review_summary import export_review_summary
        from ai_e_runtime.request_review_decision import create_review_decision, export_review_decision

        contracts = load_and_prepare_contracts()
        intents = adapt_contracts_to_intents(contracts)
        requests = package_intents_to_requests(intents)
        bundle = build_review_bundle(requests)
        export_review_bundle(bundle, "runs/sample_clip_analysis/review_bundle_001.json")
        export_review_summary(bundle, "runs/sample_clip_analysis/review_bundle_001.md")
        decision_obj = create_review_decision(bundle, "needs_changes", notes="Dry-run owner review.")
        export_review_decision(decision_obj, "runs/sample_clip_analysis/review_decision_001.json")
    """

    bundle_payload = _coerce_bundle(bundle)
    normalized_decision = _normalize_decision(decision)
    bundle_id = str(bundle_payload.get("bundle_id") or "unknown_bundle")
    requests = [item for item in bundle_payload.get("requests", []) if isinstance(item, dict)]
    approved_requests = []
    if normalized_decision == "approved":
        approved_requests = [str(item.get("request_id")).strip() for item in requests if str(item.get("request_id") or "").strip()]

    if summary_path is not None:
        print(f"[request_review_decision] Summary path provided: {Path(summary_path)}")

    decision_obj = {
        "decision_id": DEFAULT_DECISION_ID,
        "bundle_id": bundle_id,
        "decision": normalized_decision,
        "decided_by": DEFAULT_DECIDED_BY,
        "timestamp": get_current_timestamp(),
        "notes": notes or "",
        "total_requests": len(requests),
        "approved_requests": approved_requests,
    }
    print(f"[request_review_decision] Decision recorded: {normalized_decision}")
    return decision_obj


def export_review_decision(decision_obj: Dict[str, Any], output_path: Path | str) -> Path | None:
    if not isinstance(decision_obj, dict):
        print("[request_review_decision] Skipping export: decision object must be an object.")
        return None

    resolved_path = Path(output_path)
    write_json(resolved_path, decision_obj)
    print(f"[request_review_decision] Output path: {resolved_path}")
    return resolved_path


def _coerce_bundle(bundle: Dict[str, Any] | Path | str) -> Dict[str, Any]:
    if isinstance(bundle, dict):
        print(f"[request_review_decision] Bundle loaded: {bundle.get('bundle_id', 'unknown_bundle')}")
        return dict(bundle)

    bundle_path = Path(bundle)
    payload, issue = read_json_with_status(bundle_path, default={})
    if issue is not None or not isinstance(payload, dict) or not payload:
        print(f"[request_review_decision] Bundle loaded: invalid_or_missing_bundle ({bundle_path})")
        return {
            "bundle_id": "invalid_or_missing_bundle",
            "requests": [],
        }

    print(f"[request_review_decision] Bundle loaded: {bundle_path}")
    return payload


def _normalize_decision(decision: str) -> str:
    normalized = str(decision or "").strip().lower()
    if normalized in ALLOWED_REVIEW_DECISIONS:
        return normalized
    print(
        f"[request_review_decision] Unknown decision '{decision}'. "
        f"Falling back to '{DEFAULT_DECISION_FALLBACK}'."
    )
    return DEFAULT_DECISION_FALLBACK


__all__ = [
    "ALLOWED_REVIEW_DECISIONS",
    "DEFAULT_DECIDED_BY",
    "DEFAULT_DECISION_FALLBACK",
    "DEFAULT_DECISION_ID",
    "create_review_decision",
    "export_review_decision",
]