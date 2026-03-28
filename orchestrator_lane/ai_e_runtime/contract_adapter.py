from __future__ import annotations

from typing import Any, Dict, Iterable, List


INTENT_TYPE_BY_CONTRACT_TYPE = {
    "repair": "system_fix",
    "optimization": "system_improve",
    "expansion": "system_expand",
}


def adapt_contracts_to_intents(contracts: Iterable[Any]) -> List[Dict[str, Any]]:
    """Convert normalized contracts into read-only execution intents.

    Example:
        from ai_e_runtime.artifact_loader import load_and_prepare_contracts
        from ai_e_runtime.contract_adapter import adapt_contracts_to_intents

        contracts = load_and_prepare_contracts()
        intents = adapt_contracts_to_intents(contracts)
    """

    contract_list = list(contracts or [])
    print(f"[contract_adapter] Received {len(contract_list)} contract(s).")

    intents: List[Dict[str, Any]] = []
    for index, contract in enumerate(contract_list, start=1):
        if not isinstance(contract, dict):
            print(f"[contract_adapter] Skipping invalid contract #{index}: expected object.")
            continue

        source_contract_id = str(contract.get("contract_id") or "").strip()
        if not source_contract_id:
            print(f"[contract_adapter] Skipping invalid contract #{index}: missing contract_id.")
            continue

        contract_type = str(contract.get("contract_type") or "").strip().lower()
        intent_type = INTENT_TYPE_BY_CONTRACT_TYPE.get(contract_type)
        if intent_type is None:
            print(
                f"[contract_adapter] Skipping contract {source_contract_id}: "
                f"unknown contract_type '{contract.get('contract_type')}'."
            )
            continue

        priority = str(contract.get("priority") or "medium").strip() or "medium"
        inputs = contract.get("inputs")
        expected_changes = contract.get("expected_changes")

        intents.append(
            {
                "intent_id": _build_intent_id(source_contract_id),
                "intent_type": intent_type,
                "source_contract_id": source_contract_id,
                "priority": priority,
                "action_targets": _derive_action_targets(inputs),
                "expected_changes": expected_changes if isinstance(expected_changes, list) else [],
            }
        )

    summary = _intent_type_summary(intents)
    print(f"[contract_adapter] Created {len(intents)} intent(s).")
    print(f"[contract_adapter] Intent types summary: {summary}")
    return intents


def _build_intent_id(source_contract_id: str) -> str:
    return f"intent_{source_contract_id}"


def _derive_action_targets(inputs: Any) -> List[str]:
    if not isinstance(inputs, dict):
        return []

    segments = inputs.get("segments")
    if isinstance(segments, list):
        targets = [str(item).strip() for item in segments if str(item).strip()]
        if targets:
            return targets

    fallback_targets = [key for key, value in inputs.items() if value]
    return [str(item).strip() for item in fallback_targets if str(item).strip()]


def _intent_type_summary(intents: Iterable[Dict[str, Any]]) -> str:
    counts: Dict[str, int] = {}
    for intent in intents:
        intent_type = str(intent.get("intent_type") or "unknown")
        counts[intent_type] = counts.get(intent_type, 0) + 1
    if not counts:
        return "none"
    return ", ".join(f"{intent_type}={counts[intent_type]}" for intent_type in sorted(counts))


__all__ = ["INTENT_TYPE_BY_CONTRACT_TYPE", "adapt_contracts_to_intents"]