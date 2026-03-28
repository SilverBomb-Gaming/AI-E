from __future__ import annotations

from typing import Any, Dict, Iterable, List


DEFAULT_STATUS = "prepared"
DEFAULT_EXECUTION_MODE = "manual_review"
DEFAULT_CREATED_FROM = "gameplay_clip_pipeline"


def package_intents_to_requests(intents: Iterable[Any]) -> List[Dict[str, Any]]:
    """Wrap read-only execution intents into future execution-request envelopes.

    Example:
        from ai_e_runtime.artifact_loader import load_and_prepare_contracts
        from ai_e_runtime.contract_adapter import adapt_contracts_to_intents
        from ai_e_runtime.intent_packager import package_intents_to_requests

        contracts = load_and_prepare_contracts()
        intents = adapt_contracts_to_intents(contracts)
        requests = package_intents_to_requests(intents)
    """

    intent_list = list(intents or [])
    print(f"[intent_packager] Received {len(intent_list)} intent(s).")

    requests: List[Dict[str, Any]] = []
    for index, intent in enumerate(intent_list, start=1):
        if not isinstance(intent, dict):
            print(f"[intent_packager] Skipping invalid intent #{index}: expected object.")
            continue

        source_intent_id = str(intent.get("intent_id") or "").strip()
        if not source_intent_id:
            print(f"[intent_packager] Skipping invalid intent #{index}: missing intent_id.")
            continue

        intent_type = str(intent.get("intent_type") or "").strip()
        if not intent_type:
            print(f"[intent_packager] Skipping intent {source_intent_id}: missing intent_type.")
            continue

        priority = str(intent.get("priority") or "medium").strip() or "medium"
        action_targets = intent.get("action_targets")
        expected_changes = intent.get("expected_changes")

        requests.append(
            {
                "request_id": _build_request_id(source_intent_id),
                "request_type": _build_request_type(intent_type),
                "source_intent_id": source_intent_id,
                "intent_type": intent_type,
                "priority": priority,
                "action_targets": action_targets if isinstance(action_targets, list) else [],
                "expected_changes": expected_changes if isinstance(expected_changes, list) else [],
                "status": DEFAULT_STATUS,
                "execution_mode": DEFAULT_EXECUTION_MODE,
                "created_from": DEFAULT_CREATED_FROM,
            }
        )

    summary = _request_type_summary(requests)
    print(f"[intent_packager] Created {len(requests)} execution request(s).")
    print(f"[intent_packager] Request types summary: {summary}")
    return requests


def _build_request_id(source_intent_id: str) -> str:
    return f"request_{source_intent_id}"


def _build_request_type(intent_type: str) -> str:
    return f"execution_request::{intent_type}"


def _request_type_summary(requests: Iterable[Dict[str, Any]]) -> str:
    counts: Dict[str, int] = {}
    for request in requests:
        request_type = str(request.get("request_type") or "unknown")
        counts[request_type] = counts.get(request_type, 0) + 1
    if not counts:
        return "none"
    return ", ".join(f"{request_type}={counts[request_type]}" for request_type in sorted(counts))


__all__ = [
    "DEFAULT_CREATED_FROM",
    "DEFAULT_EXECUTION_MODE",
    "DEFAULT_STATUS",
    "package_intents_to_requests",
]