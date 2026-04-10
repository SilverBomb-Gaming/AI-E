"""Formatting helpers for operator-visible node and dispatch state."""
from __future__ import annotations

from .node_models import NodeDescriptor, NodeDispatchRecord, NodeResolution


class NodeFormatter:
    """Render concise node registry and dispatch replies."""

    @staticmethod
    def format_list(*, nodes: tuple[NodeDescriptor, ...], current: NodeResolution) -> str:
        lines = ["[NODES]", f"Current: {current.node.node_id} | {current.node.display_name} | {current.node.role} | {current.node.status}"]
        for node in nodes:
            labels: list[str] = []
            if node.is_default:
                labels.append("default")
            if node.node_id == current.node.node_id:
                labels.append("selected" if current.source == "selected" else "active")
            suffix = f" | {', '.join(labels)}" if labels else ""
            lines.extend(
                (
                    f"- {node.node_id}",
                    f"  Role: {node.role}",
                    f"  Status: {node.status}{suffix}",
                    f"  Capabilities: {' '.join(node.capability_labels) if node.capability_labels else 'none'}",
                )
            )
        return "\n".join(lines)

    @staticmethod
    def format_detail(*, node: NodeDescriptor, current: NodeResolution) -> str:
        selection = "selected" if current.source == "selected" and current.node.node_id == node.node_id else ("default" if node.is_default else "available")
        commands = " ".join(node.capability_labels) if node.capability_labels else "none"
        lines = [
            "[NODE]",
            f"ID: {node.node_id}",
            f"Name: {node.display_name}",
            f"Role: {node.role}",
            f"Type: {node.node_type}",
            f"Status: {node.status}",
            f"Enabled: {'yes' if node.enabled else 'no'}",
            f"Transport: {node.transport}",
            f"Selection: {selection}",
            f"Machine: {node.machine_label or '-'}",
            f"Repo root: {node.repo_root or '-'}",
            f"Allowed roots: {', '.join(node.allowed_roots) if node.allowed_roots else '-'}",
            f"Current job: {node.current_job_id or '-'}",
            f"Last job: {node.last_job_id or '-'}",
            f"Last job status: {node.last_job_status or '-'}",
            f"Last result: {node.last_result_summary or '-'}",
            f"Registered: {node.registered_at or '-'}",
            f"Last heartbeat: {node.last_seen_at or '-'}",
            f"Summary: {node.summary}",
            f"Commands: {commands}",
        ]
        return "\n".join(lines)

    @staticmethod
    def format_dispatch_preview(*, record: NodeDispatchRecord) -> str:
        lines = [
            "[DISPATCH]",
            f"Target node: {record.target_node_id} | {record.target_node_name}",
            f"Target role: {record.target_node_role}",
            f"Reason: {record.routing_reason}",
            f"Job: {record.requested_command_summary}",
            f"Status: {'approval required' if record.confirmation_required else record.status}",
        ]
        return "\n".join(lines)

    @staticmethod
    def format_dispatch_status(*, record: NodeDispatchRecord) -> str:
        lines = [
            "[DISPATCH STATUS]",
            f"Job id: {record.job_id}",
            f"Status: {record.status}",
            f"Node: {record.target_node_id} | {record.target_node_name}",
            f"Role: {record.target_node_role}",
            f"Requested: {record.requested_command_summary}",
            f"Routing: {record.routing_reason}",
            f"Queued: {record.queued_at or '-'}",
            f"Started: {record.started_at or '-'}",
            f"Finished: {record.finished_at or '-'}",
            f"Result: {record.result_summary or '-'}",
        ]
        if record.failure_reason:
            lines.append(f"Failure: {record.failure_reason}")
        return "\n".join(lines)