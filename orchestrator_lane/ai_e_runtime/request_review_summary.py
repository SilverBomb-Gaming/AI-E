from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Iterable, List

from orchestrator.utils import read_json_with_status, safe_write_text


def generate_review_summary(bundle: Dict[str, Any] | Path | str) -> str:
    """Generate a human-readable markdown summary from a review bundle object or JSON path.

    Example:
        from ai_e_runtime.artifact_loader import load_and_prepare_contracts
        from ai_e_runtime.contract_adapter import adapt_contracts_to_intents
        from ai_e_runtime.intent_packager import package_intents_to_requests
        from ai_e_runtime.request_review_bundle import build_review_bundle
        from ai_e_runtime.request_review_summary import export_review_summary

        contracts = load_and_prepare_contracts()
        intents = adapt_contracts_to_intents(contracts)
        requests = package_intents_to_requests(intents)
        bundle = build_review_bundle(requests)
        export_review_summary(bundle, "runs/sample_clip_analysis/review_bundle_001.md")
    """

    bundle_payload = _coerce_bundle(bundle)
    bundle_id = str(bundle_payload.get("bundle_id") or "unknown_bundle")
    request_summary = dict(bundle_payload.get("request_type_summary") or {})
    requests = [item for item in bundle_payload.get("requests", []) if isinstance(item, dict)]

    lines: List[str] = [
        "# AI-E Review Summary",
        "",
        "## Bundle Info",
        f"- bundle_id: {bundle_id}",
        f"- created_from: {bundle_payload.get('created_from', 'unknown')}",
        f"- total_requests: {bundle_payload.get('total_requests', len(requests))}",
        f"- review_status: {bundle_payload.get('review_status', 'unknown')}",
        "",
        "## Request Summary",
    ]

    if request_summary:
        for request_type in sorted(request_summary):
            lines.append(f"- {request_type}: {request_summary[request_type]}")
    else:
        lines.append("- none")

    lines.extend(["", "## Requests Breakdown", ""])
    if requests:
        for request in requests:
            lines.extend(_format_request_block(request))
    else:
        lines.append("No valid requests were included in this review bundle.")

    lines.extend(
        [
            "",
            "## Notes",
            "- This summary is a dry-run review artifact generated from prepared execution requests.",
            "- No execution has occurred and no queue mutation has been performed.",
            "",
        ]
    )
    return "\n".join(lines)


def export_review_summary(bundle: Dict[str, Any] | Path | str, output_path: Path | str) -> Path | None:
    markdown = generate_review_summary(bundle)
    resolved_path = Path(output_path)
    safe_write_text(resolved_path, markdown)
    print(f"[request_review_summary] Markdown file created.")
    print(f"[request_review_summary] Output path: {resolved_path}")
    return resolved_path


def _coerce_bundle(bundle: Dict[str, Any] | Path | str) -> Dict[str, Any]:
    if isinstance(bundle, dict):
        print(f"[request_review_summary] Bundle loaded: {bundle.get('bundle_id', 'unknown_bundle')}")
        return dict(bundle)

    bundle_path = Path(bundle)
    payload, issue = read_json_with_status(bundle_path, default={})
    if issue is not None or not isinstance(payload, dict) or not payload:
        print(f"[request_review_summary] Bundle loaded: invalid_or_missing_bundle ({bundle_path})")
        return {
            "bundle_id": "invalid_or_missing_bundle",
            "created_from": "unknown",
            "total_requests": 0,
            "request_type_summary": {},
            "requests": [],
            "review_status": "unavailable",
        }

    print(f"[request_review_summary] Bundle loaded: {bundle_path}")
    return payload


def _format_request_block(request: Dict[str, Any]) -> List[str]:
    request_id = str(request.get("request_id") or "unknown_request")
    lines = [
        f"### {request_id}",
        f"- intent_type: {request.get('intent_type', 'unknown')}",
        f"- priority: {request.get('priority', 'unknown')}",
        "- action_targets:",
    ]
    lines.extend(_format_list_items(request.get("action_targets")))
    lines.append("- expected_changes:")
    lines.extend(_format_list_items(request.get("expected_changes")))
    lines.append("")
    return lines


def _format_list_items(values: Any) -> List[str]:
    if not isinstance(values, list) or not values:
        return ["  - none"]
    items: List[str] = []
    for value in values:
        text = str(value).strip()
        if text:
            items.append(f"  - {text}")
    return items or ["  - none"]


__all__ = ["export_review_summary", "generate_review_summary"]