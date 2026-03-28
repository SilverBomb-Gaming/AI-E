from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Iterable, List

from orchestrator.utils import write_json


DEFAULT_BUNDLE_ID = "review_bundle_001"
DEFAULT_CREATED_FROM = "gameplay_clip_pipeline"
DEFAULT_REVIEW_STATUS = "pending_owner_review"


def build_review_bundle(requests: Iterable[Any]) -> Dict[str, Any]:
    """Build a human-review bundle from prepared execution requests.

    Example:
        from ai_e_runtime.artifact_loader import load_and_prepare_contracts
        from ai_e_runtime.contract_adapter import adapt_contracts_to_intents
        from ai_e_runtime.intent_packager import package_intents_to_requests
        from ai_e_runtime.request_review_bundle import build_review_bundle, export_review_bundle

        contracts = load_and_prepare_contracts()
        intents = adapt_contracts_to_intents(contracts)
        requests = package_intents_to_requests(intents)
        bundle = build_review_bundle(requests)
        export_review_bundle(bundle, "runs/sample_clip_analysis/review_bundle_001.json")
    """

    request_list = list(requests or [])
    print(f"[request_review_bundle] Received {len(request_list)} request(s).")

    valid_requests: List[Dict[str, Any]] = []
    for index, request in enumerate(request_list, start=1):
        if not isinstance(request, dict):
            print(f"[request_review_bundle] Skipping invalid request #{index}: expected object.")
            continue
        request_id = str(request.get("request_id") or "").strip()
        if not request_id:
            print(f"[request_review_bundle] Skipping invalid request #{index}: missing request_id.")
            continue
        request_type = str(request.get("request_type") or "").strip()
        if not request_type:
            print(f"[request_review_bundle] Skipping request {request_id}: missing request_type.")
            continue
        valid_requests.append(dict(request))

    bundle = {
        "bundle_id": DEFAULT_BUNDLE_ID,
        "created_from": DEFAULT_CREATED_FROM,
        "total_requests": len(valid_requests),
        "request_type_summary": _request_type_summary(valid_requests),
        "requests": valid_requests,
        "review_status": DEFAULT_REVIEW_STATUS,
    }
    print(f"[request_review_bundle] Built review bundle with {len(valid_requests)} request(s).")
    return bundle


def export_review_bundle(bundle: Dict[str, Any], output_path: Path | str) -> Path | None:
    if not isinstance(bundle, dict):
        print("[request_review_bundle] Skipping export: bundle must be an object.")
        return None

    requests = bundle.get("requests")
    if not isinstance(requests, list):
        print("[request_review_bundle] Skipping export: bundle requests must be a list.")
        return None

    resolved_path = Path(output_path)
    write_json(resolved_path, bundle)
    print(f"[request_review_bundle] Exported {len(requests)} request(s).")
    print(f"[request_review_bundle] Output path: {resolved_path}")
    return resolved_path


def _request_type_summary(requests: Iterable[Dict[str, Any]]) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for request in requests:
        request_type = str(request.get("request_type") or "unknown")
        counts[request_type] = counts.get(request_type, 0) + 1
    return counts


__all__ = [
    "DEFAULT_BUNDLE_ID",
    "DEFAULT_CREATED_FROM",
    "DEFAULT_REVIEW_STATUS",
    "build_review_bundle",
    "export_review_bundle",
]