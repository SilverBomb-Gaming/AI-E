"""Durable registry for controller-visible execution nodes."""
from __future__ import annotations

import json
from dataclasses import replace
from datetime import datetime, timedelta
from pathlib import Path
from threading import RLock

from .node_config import NodeLocalConfig
from .node_models import NodeDescriptor, NodeResolution
from .profile_store import ControllerConfig


class NodeRegistry:
    """Track registered nodes, shared registry state, and the current operator selection."""

    def __init__(self, *, local_node: NodeDescriptor, registry_root: str = "", stale_after_seconds: int = 120) -> None:
        if not local_node.node_id.strip():
            raise ValueError("Local node must define a node_id.")
        self._lock = RLock()
        self._default_node_id = local_node.node_id.strip().lower()
        self._selected_node_id = ""
        self._local_node = replace(local_node, node_id=self._default_node_id, is_default=True)
        self._stale_after_seconds = max(30, int(stale_after_seconds))
        self._registry_root = Path(registry_root).resolve() if registry_root.strip() else None
        self._nodes: dict[str, NodeDescriptor] = {self._default_node_id: self._local_node}
        if self._registry_root is not None:
            self._nodes_dir().mkdir(parents=True, exist_ok=True)
            self._persist_node(self._local_node)

    @staticmethod
    def build_configured_local_node(
        *,
        controller_config: ControllerConfig,
        node_config: NodeLocalConfig,
        now_iso: str,
        fallback_node_id: str = "local",
        transport_mode: str = "in_process",
    ) -> NodeDescriptor:
        node_id = node_config.node_id.strip().lower() or fallback_node_id
        display_name = node_config.display_name.strip() or node_config.machine_label.strip() or "Local Node"
        repo_root = controller_config.repo_root.strip()
        summary_repo = Path(repo_root).name if repo_root else "configured repo"
        summary = f"{node_config.role.title()} node for {summary_repo}."
        return NodeDescriptor(
            node_id=node_id,
            display_name=display_name,
            role=node_config.role,
            node_type="local" if transport_mode == "in_process" else "shared",
            status="online" if node_config.enabled else "disabled",
            transport=transport_mode,  # type: ignore[arg-type]
            summary=summary,
            machine_label=node_config.machine_label.strip(),
            enabled=node_config.enabled,
            supports_bounded_execution=True,
            is_default=True,
            repo_root=repo_root,
            allowed_roots=tuple(root for root in controller_config.file_allowed_roots if root.strip()),
            registered_at=now_iso,
            last_seen_at=now_iso,
            capability_labels=node_config.declared_capabilities,
            metadata={"registry_root": node_config.registry_root.strip()},
        )

    def local_node(self) -> NodeDescriptor:
        with self._lock:
            return self._local_node

    def list_nodes(self) -> tuple[NodeDescriptor, ...]:
        self.refresh()
        with self._lock:
            return tuple(self._nodes[node_id] for node_id in sorted(self._nodes))

    def refresh(self) -> None:
        with self._lock:
            nodes = {self._default_node_id: self._local_node}
            if self._registry_root is not None:
                for path in sorted(self._nodes_dir().glob("*.json")):
                    node = self._read_node(path)
                    if node is None or not node.node_id:
                        continue
                    normalized = self._normalize_status(node)
                    nodes[normalized.node_id.strip().lower()] = replace(normalized, is_default=normalized.node_id.strip().lower() == self._default_node_id)
            self._nodes = nodes

    def register_node(self, node: NodeDescriptor) -> NodeDescriptor:
        node_id = node.node_id.strip().lower()
        if not node_id:
            raise ValueError("Node id is required.")
        normalized = self._normalize_status(replace(node, node_id=node_id, is_default=node_id == self._default_node_id))
        with self._lock:
            self._nodes[node_id] = normalized
            if node_id == self._default_node_id:
                self._local_node = normalized
            if self._registry_root is not None:
                self._persist_node(normalized)
            return normalized

    def update_local_node(self, **changes: object) -> NodeDescriptor:
        with self._lock:
            updated = self._normalize_status(replace(self._local_node, **changes))
            self._local_node = replace(updated, is_default=True)
            self._nodes[self._default_node_id] = self._local_node
            if self._registry_root is not None:
                self._persist_node(self._local_node)
            return self._local_node

    def get_node(self, node_id: str) -> NodeDescriptor | None:
        normalized = node_id.strip().lower()
        if not normalized:
            return None
        self.refresh()
        with self._lock:
            return self._nodes.get(normalized)

    def default_node(self) -> NodeDescriptor:
        self.refresh()
        with self._lock:
            return self._nodes[self._default_node_id]

    def selected_node_id(self) -> str:
        with self._lock:
            return self._selected_node_id or self._default_node_id

    def resolve_execution_node(self) -> NodeResolution:
        self.refresh()
        with self._lock:
            if self._selected_node_id and self._selected_node_id in self._nodes:
                return NodeResolution(node=self._nodes[self._selected_node_id], source="selected")
            self._selected_node_id = ""
            return NodeResolution(node=self._nodes[self._default_node_id], source="default")

    def select_node(self, node_id: str) -> NodeResolution | None:
        normalized = node_id.strip().lower()
        if not normalized:
            return None
        self.refresh()
        with self._lock:
            node = self._nodes.get(normalized)
            if node is None:
                return None
            self._selected_node_id = normalized if normalized != self._default_node_id else ""
            return self.resolve_execution_node()

    def clear_selection(self) -> NodeResolution:
        with self._lock:
            self._selected_node_id = ""
            return NodeResolution(node=self._local_node, source="default")

    def list_role_matches(self, *, role: str, required_command_label: str = "") -> tuple[NodeDescriptor, ...]:
        self.refresh()
        with self._lock:
            normalized_role = role.strip().lower()
            matches = [
                node
                for node in self._nodes.values()
                if node.role == normalized_role
                and node.enabled
                and node.status not in {"offline", "stale", "disabled"}
                and (not required_command_label or node.supports_command(required_command_label))
            ]
            return tuple(sorted(matches, key=lambda node: (node.status == "busy", node.node_id)))

    def registry_root(self) -> str:
        return str(self._registry_root) if self._registry_root is not None else ""

    def _nodes_dir(self) -> Path:
        if self._registry_root is None:
            raise ValueError("Node registry root is not configured.")
        return self._registry_root / "nodes"

    def _node_path(self, node_id: str) -> Path:
        return self._nodes_dir() / f"{node_id.strip().lower()}.json"

    def _persist_node(self, node: NodeDescriptor) -> None:
        path = self._node_path(node.node_id)
        temp_path = path.with_suffix(".tmp")
        temp_path.write_text(json.dumps(node.to_payload(), indent=2), encoding="utf-8")
        temp_path.replace(path)

    @staticmethod
    def _read_node(path: Path) -> NodeDescriptor | None:
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError, json.JSONDecodeError):
            return None
        if not isinstance(raw, dict):
            return None
        return NodeDescriptor.from_payload(raw)

    def _normalize_status(self, node: NodeDescriptor) -> NodeDescriptor:
        if not node.enabled:
            return replace(node, status="disabled")
        last_seen = node.last_seen_at.strip()
        if last_seen:
            try:
                parsed = datetime.fromisoformat(last_seen)
                if datetime.now(parsed.tzinfo) - parsed > timedelta(seconds=self._stale_after_seconds):
                    return replace(node, status="stale")
            except ValueError:
                pass
        return node