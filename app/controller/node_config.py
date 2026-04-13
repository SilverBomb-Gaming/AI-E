"""Persistent per-node identity and registry settings."""
from __future__ import annotations

import json
import re
import socket
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from ..platform import get_platform_adapter
from ..platform.base import BasePlatformAdapter
from .node_models import NodeRole


def _default_machine_label() -> str:
    return socket.gethostname().strip() or "unknown-host"


@dataclass
class NodeLocalConfig:
    schema_version: int = 1
    node_id: str = ""
    display_name: str = ""
    role: NodeRole = "controller"
    machine_label: str = field(default_factory=_default_machine_label)
    enabled: bool = True
    registry_root: str = ""
    heartbeat_interval_seconds: int = 15
    stale_after_seconds: int = 120
    declared_capabilities: tuple[str, ...] = ("/run", "/test")


class NodeConfigStore:
    def __init__(self, platform_adapter: BasePlatformAdapter | None = None, *, config_path: str | Path | None = None) -> None:
        self._platform = platform_adapter or get_platform_adapter()
        default_path = Path(self._platform.controller_state_dir()) / "node_config.json"
        self._config_path = Path(config_path or default_path)
        self._config_path.parent.mkdir(parents=True, exist_ok=True)
        self.last_load_error = ""
        self.last_save_error = ""

    @property
    def path(self) -> Path:
        return self._config_path

    def exists(self) -> bool:
        return self._config_path.exists()

    def load(self) -> NodeLocalConfig:
        if not self._config_path.exists():
            self.last_load_error = ""
            return NodeLocalConfig()
        try:
            raw = json.loads(self._config_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError, ValueError) as exc:
            self.last_load_error = str(exc)
            return NodeLocalConfig()
        if not isinstance(raw, dict):
            self.last_load_error = "Node config file did not contain a JSON object."
            return NodeLocalConfig()
        self.last_load_error = ""
        return self._from_payload(raw)

    def save(self, config: NodeLocalConfig) -> None:
        try:
            self._config_path.write_text(json.dumps(asdict(config), indent=2), encoding="utf-8")
            self.last_save_error = ""
        except OSError as exc:
            self.last_save_error = str(exc)
            raise

    def _from_payload(self, raw: dict[str, Any]) -> NodeLocalConfig:
        declared_capabilities = raw.get("declared_capabilities")
        return NodeLocalConfig(
            schema_version=int(raw.get("schema_version", 1)),
            node_id=str(raw.get("node_id", "")).strip(),
            display_name=str(raw.get("display_name", "")).strip(),
            role=str(raw.get("role", "controller")).strip().lower() or "controller",  # type: ignore[arg-type]
            machine_label=str(raw.get("machine_label", _default_machine_label())).strip() or _default_machine_label(),
            enabled=bool(raw.get("enabled", True)),
            registry_root=str(raw.get("registry_root", "")).strip(),
            heartbeat_interval_seconds=max(5, int(raw.get("heartbeat_interval_seconds", 15))),
            stale_after_seconds=max(30, int(raw.get("stale_after_seconds", 120))),
            declared_capabilities=tuple(str(item).strip() for item in declared_capabilities or ("/run", "/test") if str(item).strip()),
        )


def generate_node_id(*, role: NodeRole, display_name: str, machine_label: str) -> str:
    base = display_name.strip() or machine_label.strip() or role
    normalized = re.sub(r"[^a-z0-9]+", "-", base.lower()).strip("-") or role
    role_prefix = role.strip().lower()
    if not normalized.startswith(role_prefix):
        normalized = f"{role_prefix}-{normalized}"
    return normalized[:48]