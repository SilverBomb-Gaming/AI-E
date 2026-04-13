"""Human-readable production summary helpers."""
from __future__ import annotations

from .production_state_models import ProductionBlockedItem, ProductionPendingApproval, ProductionPriority, ProductionProjectState


class ProductionSummaryFormatter:
    def format_overview(self, *, project: ProductionProjectState, mobile: bool = False) -> str:
        if mobile:
            return self._format_mobile_overview(project=project)
        lines = ["[PRODUCTION]", self._project_line(project)]
        lines.append(self._priority_line(project.active_priorities))
        lines.append(self._blocker_line(project.blocked_items))
        lines.append(self._approval_line(project.pending_approvals))
        lines.append(self._node_line(project))
        lines.append(f"Build: {project.build_state.status} | {self._trim_summary(project.build_state.summary, 72)}")
        lines.append(f"Validation: {project.validation_state.status} | {self._trim_summary(project.validation_state.summary, 72)}")
        recent = self._meaningful_changes(project=project, limit=3)
        if recent:
            lines.append("Recent:")
            lines.extend(f"- {item.summary}" for item in recent)
        return "\n".join(lines)

    def format_blocked(self, *, project: ProductionProjectState, mobile: bool = False) -> str:
        lines = ["[BLOCKED]"]
        if not project.blocked_items:
            lines.append("No blocked production work is recorded.")
            return "\n".join(lines)
        rows = project.blocked_items[:3] if mobile else project.blocked_items[:6]
        lines.extend(f"- {item.title} | {item.category} | {item.reason}" for item in rows)
        return "\n".join(lines)

    def format_changes(self, *, project: ProductionProjectState, mobile: bool = False) -> str:
        lines = ["[RECENT CHANGES]"]
        rows = self._meaningful_changes(project=project, limit=3 if mobile else 6)
        if not rows:
            lines.append("No recent production changes are recorded yet.")
            return "\n".join(lines)
        lines.extend(f"- {item.summary}" for item in rows)
        return "\n".join(lines)

    def format_nodes(self, *, project: ProductionProjectState, mobile: bool = False) -> str:
        lines = ["[NODE STATUS]"]
        if not project.active_nodes:
            lines.append("No active nodes are recorded.")
            return "\n".join(lines)
        rows = project.active_nodes[:3] if mobile else project.active_nodes[:8]
        for item in rows:
            tags = ", ".join(item.specialization_tags[:2]) if item.specialization_tags else item.active_task_category
            lines.append(f"- {item.node_id} | {item.availability} | {tags}")
            if not mobile:
                lines.append(f"  Work: {item.current_assignment or 'idle'}")
        return "\n".join(lines)

    def format_attention(self, *, project: ProductionProjectState, mobile: bool = False) -> str:
        lines = ["[ATTENTION]"]
        if project.pending_approvals:
            rows = project.pending_approvals[:2] if mobile else project.pending_approvals[:5]
            lines.append("Pending approvals:")
            lines.extend(f"- {item.summary}" for item in rows)
        if project.blocked_items:
            rows = project.blocked_items[:2] if mobile else project.blocked_items[:4]
            lines.append("Blockers:")
            lines.extend(f"- {item.title} | {item.reason}" for item in rows)
        if len(lines) == 1:
            lines.append("Nothing urgent needs operator attention right now.")
        return "\n".join(lines)

    @staticmethod
    def _priority_line(priorities: tuple[ProductionPriority, ...]) -> str:
        if not priorities:
            return "Priority: none recorded"
        active = [item for item in priorities if item.status == "active"] or list(priorities[:2])
        summary = "; ".join(f"{item.title} ({item.category})" for item in active[:2])
        return f"Priority: {summary}"

    @staticmethod
    def _node_line(project: ProductionProjectState) -> str:
        busy = [item for item in project.active_nodes if item.availability == "busy"]
        if busy:
            return f"Nodes: {len(busy)} busy / {len(project.active_nodes)} active"
        return f"Nodes: {len(project.active_nodes)} active, none currently busy"

    @staticmethod
    def _blocker_line(blocked_items: tuple[ProductionBlockedItem, ...]) -> str:
        if not blocked_items:
            return "Blockers: none"
        top = blocked_items[0]
        suffix = f" +{len(blocked_items) - 1} more" if len(blocked_items) > 1 else ""
        return f"Blockers: {top.title}{suffix}"

    @staticmethod
    def _approval_line(approvals: tuple[ProductionPendingApproval, ...]) -> str:
        if not approvals:
            return "Approvals: none pending"
        return f"Approvals: {approvals[0].summary}" + (f" +{len(approvals) - 1} more" if len(approvals) > 1 else "")

    @staticmethod
    def _project_line(project: ProductionProjectState) -> str:
        engine = project.engine_family or "unknown"
        milestone = project.current_milestone or "unset"
        return f"{project.project_title} | {engine} | {milestone}"

    @staticmethod
    def _trim_summary(summary: str, limit: int) -> str:
        trimmed = " ".join(summary.split())
        if len(trimmed) <= limit:
            return trimmed
        return trimmed[: limit - 3].rstrip() + "..."

    def _meaningful_changes(self, *, project: ProductionProjectState, limit: int) -> list:
        rows = []
        seen: set[tuple[str, str, str]] = set()
        for item in project.recent_changes:
            key = (item.change_kind.strip().lower(), item.related_id.strip().lower(), item.summary.strip().lower())
            if key in seen:
                continue
            seen.add(key)
            rows.append(item)
            if len(rows) >= limit:
                break
        return rows

    def _format_mobile_overview(self, *, project: ProductionProjectState) -> str:
        recent = self._meaningful_changes(project=project, limit=1)
        lines = [f"[MOBILE] {project.project_title}"]
        lines.append(self._priority_line(project.active_priorities).replace("Priority: ", "Pri: "))
        lines.append(self._node_line(project))
        lines.append(self._blocker_line(project.blocked_items).replace("Blockers: ", "Blocked: "))
        lines.append(self._approval_line(project.pending_approvals))
        lines.append(f"Build: {project.build_state.status}")
        lines.append(f"Validation: {project.validation_state.status}")
        if recent:
            lines.append(f"Last: {self._trim_summary(recent[0].summary, 64)}")
        return "\n".join(lines)
