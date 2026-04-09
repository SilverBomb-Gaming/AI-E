"""In-memory registry for controller-visible execution nodes."""
from __future__ import annotations

from dataclasses import replace
from threading import RLock

from .node_models import NodeDescriptor, NodeResolution


class NodeRegistry:
    """Track registered nodes and the current operator-selected target."""

    def __init__(self, *, local_node: NodeDescriptor) -> None:
        if not local_node.node_id.strip():
            raise ValueError("Local node must define a node_id.")
        self._lock = RLock()
        self._default_node_id = local_node.node_id.strip().lower()
        self._selected_node_id = ""
        self._nodes: dict[str, NodeDescriptor] = {
            self._default_node_id: replace(local_node, node_id=self._default_node_id, is_default=True)
        }

    def list_nodes(self) -> tuple[NodeDescriptor, ...]:
        with self._lock:
            return tuple(self._nodes[node_id] for node_id in sorted(self._nodes))

    def register_node(self, node: NodeDescriptor) -> NodeDescriptor:
        node_id = node.node_id.strip().lower()
        if not node_id:
            raise ValueError("Node id is required.")
        normalized = replace(node, node_id=node_id, is_default=node_id == self._default_node_id)
        with self._lock:
            self._nodes[node_id] = normalized
            return normalized

    def get_node(self, node_id: str) -> NodeDescriptor | None:
        normalized = node_id.strip().lower()
        if not normalized:
            return None
        with self._lock:
            return self._nodes.get(normalized)

    def default_node(self) -> NodeDescriptor:
        with self._lock:
            return self._nodes[self._default_node_id]

    def selected_node_id(self) -> str:
        with self._lock:
            return self._selected_node_id

    def resolve_execution_node(self) -> NodeResolution:
        with self._lock:
            if self._selected_node_id and self._selected_node_id in self._nodes:
                return NodeResolution(node=self._nodes[self._selected_node_id], source="selected")
            self._selected_node_id = ""
            return NodeResolution(node=self._nodes[self._default_node_id], source="default")

    def select_node(self, node_id: str) -> NodeResolution | None:
        normalized = node_id.strip().lower()
        if not normalized:
            return None
        with self._lock:
            node = self._nodes.get(normalized)
            if node is None:
                return None
            self._selected_node_id = normalized if normalized != self._default_node_id else ""
            return self.resolve_execution_node()

    def clear_selection(self) -> NodeResolution:
        with self._lock:
            self._selected_node_id = ""
            return NodeResolution(node=self._nodes[self._default_node_id], source="default")