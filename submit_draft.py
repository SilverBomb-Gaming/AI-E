from __future__ import annotations

import argparse
from dataclasses import replace
from datetime import datetime
import json
from pathlib import Path
import sys

from app.controller.node_config import NodeConfigStore
from app.controller.node_dispatcher import NodeDispatcher
from app.controller.node_models import NodeDispatchRecord
from app.controller.node_registry import NodeRegistry
from app.controller.profile_store import ControllerConfigStore


_BLOCKED_COMMAND_OPERATOR_TOKENS = ("&&", "||", ";", "&", ">>", ">", "<", "|")


def _now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Submit a Core-generated Node draft into the shared-directory node pipeline.")
    parser.add_argument("draft_path", help="Path to a NodeDispatchRecord-compatible draft JSON file.")
    parser.add_argument("--config-dir", default="", help="Directory containing controller_config.json and node_config.json.")
    parser.add_argument("--registry-root", default="", help="Explicit shared registry root. Overrides --config-dir if provided.")
    parser.add_argument("--confirm-submit", action="store_true", help="Required operator confirmation flag before the draft is submitted.")
    return parser.parse_args(argv)


def _load_raw_draft(path: Path) -> dict[str, object]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("Draft file must contain a JSON object.")
    return raw


def _resolve_registry_root(*, config_dir: str, registry_root: str) -> tuple[Path, NodeRegistry]:
    if registry_root.strip():
        resolved_root = Path(registry_root).resolve()
        if not resolved_root.exists():
            raise ValueError(f"Registry root does not exist: {resolved_root}")
        config_path_root = Path(config_dir).resolve() if config_dir.strip() else Path.cwd()
        controller_store = ControllerConfigStore(config_path=config_path_root / "controller_config.json")
        node_store = NodeConfigStore(config_path=config_path_root / "node_config.json")
    else:
        if not config_dir.strip():
            raise ValueError("Either --config-dir or --registry-root must be provided.")
        config_path_root = Path(config_dir).resolve()
        controller_store = ControllerConfigStore(config_path=config_path_root / "controller_config.json")
        node_store = NodeConfigStore(config_path=config_path_root / "node_config.json")
        node_config = node_store.load()
        if not node_config.registry_root.strip():
            raise ValueError("Node config does not define registry_root.")
        resolved_root = Path(node_config.registry_root).resolve()

    controller_config = controller_store.load()
    node_config = node_store.load()
    local_node = NodeRegistry.build_configured_local_node(
        controller_config=controller_config,
        node_config=node_config,
        now_iso=_now_iso(),
        fallback_node_id="submit-draft",
        transport_mode="shared_directory",
    )
    registry = NodeRegistry(local_node=local_node, registry_root=str(resolved_root), stale_after_seconds=node_config.stale_after_seconds)
    registry.refresh()
    return resolved_root, registry


def _validate_record(raw: dict[str, object], *, registry: NodeRegistry) -> NodeDispatchRecord:
    record = NodeDispatchRecord.from_payload(raw)

    if not record.job_id.strip():
        raise ValueError("Draft record is missing job_id.")
    if record.status != "queued":
        raise ValueError("Draft record must keep status='queued'.")
    if record.requested_command_label not in {"/run", "/test"}:
        raise ValueError("Draft record must target /run or /test.")
    if not record.target_node_id.strip():
        raise ValueError("Draft record must define target_node_id.")
    if not record.target_selector.strip() or record.target_selector.strip().lower() != record.target_node_id.strip().lower():
        raise ValueError("Draft record target_selector must explicitly match target_node_id.")
    if record.target_selection_mode != "node_id":
        raise ValueError("Draft record must use target_selection_mode='node_id'.")
    if not record.requested_command_text.strip() or any(token in record.requested_command_text for token in _BLOCKED_COMMAND_OPERATOR_TOKENS):
        raise ValueError("Draft record contains an unsafe requested command.")
    if not record.confirmation_required:
        raise ValueError("Draft record must preserve confirmation_required=True for operator-gated submission.")
    if record.current_job_state and record.current_job_state != "queued":
        raise ValueError("Draft record current_job_state must remain queued before submission.")

    payload = record.execution_payload
    argv = payload.get("argv") if isinstance(payload, dict) else None
    if not isinstance(payload, dict):
        raise ValueError("Draft record must include an execution_payload object.")
    if not str(payload.get("capability_id", "")).strip():
        raise ValueError("Draft execution_payload must include capability_id.")
    if str(payload.get("command_kind", "")).strip() not in {"run", "test", "build"}:
        raise ValueError("Draft execution_payload command_kind is invalid.")
    if str(payload.get("command_family", "")).strip() not in {"generic", "unittest", "pytest", "python_script"}:
        raise ValueError("Draft execution_payload command_family is invalid.")
    if not str(payload.get("command_text", "")).strip() or any(token in str(payload.get("command_text", "")) for token in _BLOCKED_COMMAND_OPERATOR_TOKENS):
        raise ValueError("Draft execution_payload command_text is unsafe.")
    if not str(payload.get("working_directory", "")).strip():
        raise ValueError("Draft execution_payload must include working_directory.")
    if not isinstance(argv, list) or not argv or any(not str(item).strip() for item in argv):
        raise ValueError("Draft execution_payload argv must be a non-empty list of command tokens.")

    target_node = registry.get_node(record.target_node_id)
    if target_node is None:
        raise ValueError(f"Target node '{record.target_node_id}' is not registered.")
    if target_node.status in {"offline", "stale", "disabled"}:
        raise ValueError(f"Target node '{record.target_node_id}' is not available for dispatch.")
    if not target_node.supports_command(record.requested_command_label):
        raise ValueError(f"Target node '{record.target_node_id}' does not declare {record.requested_command_label}.")

    return record


def submit_draft(*, draft_path: str, config_dir: str = "", registry_root: str = "", confirm_submit: bool = False) -> NodeDispatchRecord:
    if not confirm_submit:
        raise ValueError("Manual submission requires --confirm-submit. Core drafts cannot bypass operator confirmation.")

    path = Path(draft_path).resolve()
    if not path.exists() or not path.is_file():
        raise ValueError(f"Draft file was not found: {path}")

    resolved_registry_root, registry = _resolve_registry_root(config_dir=config_dir, registry_root=registry_root)
    raw = _load_raw_draft(path)
    record = _validate_record(raw, registry=registry)
    dispatcher = NodeDispatcher(registry_root=str(resolved_registry_root))
    existing = dispatcher.get_job(record.job_id)
    if existing is not None:
        raise ValueError(f"Dispatch job '{record.job_id}' already exists in the registry.")

    submitted = replace(
        record,
        status="queued",
        queued_at=_now_iso(),
        started_at="",
        finished_at="",
        result_summary="",
        failure_reason="",
        current_job_state="queued",
        confirmation_id=record.confirmation_id.strip() or f"MANUAL-SUBMIT-{record.job_id}",
    )
    return dispatcher.create_job(record=submitted)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    try:
        resolved_registry_root, _ = _resolve_registry_root(config_dir=args.config_dir, registry_root=args.registry_root)
        submitted = submit_draft(
            draft_path=args.draft_path,
            config_dir=args.config_dir,
            registry_root=args.registry_root,
            confirm_submit=bool(args.confirm_submit),
        )
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(str(exc), file=sys.stderr)
        return 2

    print(
        json.dumps(
            {
                "status": "submitted",
                "job_id": submitted.job_id,
                "target_node_id": submitted.target_node_id,
                "requested_command_label": submitted.requested_command_label,
                "confirmation_id": submitted.confirmation_id,
                "registry_root": str(resolved_registry_root),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())