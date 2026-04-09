"""Formatting helpers for Telegram-visible node state."""
from __future__ import annotations

from .node_models import NodeDescriptor, NodeResolution


class NodeFormatter:
    """Render concise node registry replies for Telegram."""

    @staticmethod
    def format_list(*, nodes: tuple[NodeDescriptor, ...], current: NodeResolution) -> str:
        lines = ["Nodes", f"Current: {current.node.node_id} | {current.node.display_name} | {current.node.node_type} | {current.node.status}"]
        for node in nodes:
            labels: list[str] = []
            if node.is_default:
                labels.append("default")
            if node.node_id == current.node.node_id:
                labels.append("selected" if current.source == "selected" else "active")
            suffix = f" | {', '.join(labels)}" if labels else ""
            lines.append(f"- {node.node_id} | {node.display_name} | {node.node_type} | {node.status}{suffix}")
        return "\n".join(lines)

    @staticmethod
    def format_detail(*, node: NodeDescriptor, current: NodeResolution) -> str:
        selection = "selected" if current.source == "selected" and current.node.node_id == node.node_id else ("default" if node.is_default else "available")
        commands = " ".join(node.capability_labels) if node.capability_labels else "none"
        lines = [
            "Node view",
            f"ID: {node.node_id}",
            f"Name: {node.display_name}",
            f"Type: {node.node_type}",
            f"Status: {node.status}",
            f"Transport: {node.transport}",
            f"Selection: {selection}",
            f"Summary: {node.summary}",
            f"Commands: {commands}",
        ]
        if node.last_seen_at:
            lines.append(f"Last seen: {node.last_seen_at}")
        return "\n".join(lines)