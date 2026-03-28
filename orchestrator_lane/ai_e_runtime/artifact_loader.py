from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple


ALLOWED_CONTRACT_TYPES = {"repair", "optimization", "expansion"}
DEFAULT_PRIORITY = "medium"
_SAMPLE_ARTIFACT_DIR_ENV_VAR = "AI_E_SAMPLE_ARTIFACT_DIR"
_REQUIRED_METRIC_GROUPS = (
    "movement_metrics",
    "camera_metrics",
    "combat_metrics",
    "environment_metrics",
    "pacing_metrics",
)


def load_and_prepare_contracts(artifact_dir: Path | str | None = None) -> List[Dict[str, Any]]:
    """Load gameplay clip artifacts, validate them, and normalize contracts for future execution."""

    resolved_dir = resolve_artifact_dir(artifact_dir)
    if resolved_dir is None or not resolved_dir.exists():
        expected_dir = Path(artifact_dir) if artifact_dir is not None else default_artifact_dir()
        print(f"[artifact_loader] Artifact directory not found: {expected_dir}")
        print("[artifact_loader] Produced 0 normalized contracts.")
        return []

    artifact_paths = sorted(path for path in resolved_dir.glob("*.json") if path.is_file())
    print(f"[artifact_loader] Loading artifacts from {resolved_dir}")

    if not artifact_paths:
        print("[artifact_loader] No artifact files found.")
        print("[artifact_loader] Produced 0 normalized contracts.")
        return []

    normalized_contracts: List[Dict[str, Any]] = []
    for artifact_path in artifact_paths:
        print(f"[artifact_loader] Loading artifact {artifact_path.name}")
        payload = _read_artifact_payload(artifact_path)
        if payload is None:
            print(f"[artifact_loader] Validation failed for {artifact_path.name}: unreadable JSON artifact")
            continue

        is_valid, errors = validate_artifact_payload(payload)
        if not is_valid:
            print(f"[artifact_loader] Validation failed for {artifact_path.name}: {'; '.join(errors)}")
            continue

        clip_id = str(payload.get("clip_id") or artifact_path.stem)
        contracts = payload.get("contracts") or []
        before_count = len(normalized_contracts)
        normalized_contracts.extend(_normalize_contracts(clip_id, contracts, artifact_path.name))
        produced = len(normalized_contracts) - before_count
        print(f"[artifact_loader] Validation passed for {artifact_path.name}")
        print(f"[artifact_loader] Produced {produced} contract(s) from {clip_id}")

    print(f"[artifact_loader] Produced {len(normalized_contracts)} normalized contracts.")
    return normalized_contracts


def resolve_artifact_dir(artifact_dir: Path | str | None = None) -> Path | None:
    if artifact_dir is not None:
        return Path(artifact_dir)

    for candidate in _artifact_dir_candidates():
        if candidate.exists():
            return candidate
    return None


def default_artifact_dir() -> Path:
    return _artifact_dir_candidates()[0]


def validate_artifact_payload(payload: Dict[str, Any]) -> Tuple[bool, List[str]]:
    errors: List[str] = []

    if not isinstance(payload.get("clip_id"), str) or not str(payload.get("clip_id")).strip():
        errors.append("missing clip_id")

    segments = payload.get("segments")
    if not isinstance(segments, list) or not segments:
        errors.append("segments must be a non-empty array")

    for metric_group in _REQUIRED_METRIC_GROUPS:
        if not isinstance(payload.get(metric_group), dict):
            errors.append(f"missing or invalid {metric_group}")

    contracts = payload.get("contracts")
    if not isinstance(contracts, list) or not contracts:
        errors.append("contracts must be a non-empty array")
    else:
        for index, contract in enumerate(contracts, start=1):
            if not isinstance(contract, dict):
                errors.append(f"contract #{index} must be an object")
                continue
            contract_type = str(contract.get("contract_type") or "").strip().lower()
            if contract_type not in ALLOWED_CONTRACT_TYPES:
                errors.append(f"contract #{index} has invalid contract_type '{contract.get('contract_type')}'")

    return not errors, errors


def _normalize_contracts(clip_id: str, contracts: Iterable[Any], artifact_name: str) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []
    for index, contract in enumerate(contracts, start=1):
        if not isinstance(contract, dict):
            print(f"[artifact_loader] Skipping non-object contract #{index} in {artifact_name}")
            continue

        contract_id = str(contract.get("contract_id") or f"{clip_id}_contract_{index:02d}").strip()
        contract_type = str(contract.get("contract_type") or "").strip().lower()
        if contract_type not in ALLOWED_CONTRACT_TYPES:
            print(f"[artifact_loader] Skipping contract {contract_id}: invalid contract_type '{contract.get('contract_type')}'")
            continue

        priority = str(contract.get("priority") or DEFAULT_PRIORITY).strip() or DEFAULT_PRIORITY
        inputs = contract.get("inputs")
        expected_changes = contract.get("expected_changes")
        normalized.append(
            {
                "contract_id": contract_id,
                "contract_type": contract_type,
                "priority": priority,
                "inputs": inputs if isinstance(inputs, dict) else {},
                "expected_changes": expected_changes if isinstance(expected_changes, list) else [],
            }
        )
    return normalized


def _read_artifact_payload(path: Path) -> Dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"[artifact_loader] Failed to read {path.name}: {exc}")
        return None
    if not isinstance(payload, dict):
        print(f"[artifact_loader] Failed to read {path.name}: top-level JSON must be an object")
        return None
    return payload


def _artifact_dir_candidates() -> List[Path]:
    repo_root = Path(__file__).resolve().parents[1]
    configured_dir = _configured_artifact_dir()
    candidates = [repo_root / "runs" / "sample_clip_analysis"]
    if configured_dir is not None:
        candidates.insert(0, configured_dir)
    return candidates


def _configured_artifact_dir() -> Path | None:
    raw = os.getenv(_SAMPLE_ARTIFACT_DIR_ENV_VAR, "").strip()
    if not raw:
        return None
    return Path(raw)


__all__ = [
    "ALLOWED_CONTRACT_TYPES",
    "DEFAULT_PRIORITY",
    "default_artifact_dir",
    "load_and_prepare_contracts",
    "resolve_artifact_dir",
    "validate_artifact_payload",
]