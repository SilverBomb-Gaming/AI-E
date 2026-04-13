"""Durable project-agnostic production state models."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


ProductionTaskCategory = Literal[
    "gameplay",
    "ai_behavior",
    "ui_ux",
    "systems_tools",
    "animation",
    "audio",
    "content_pipeline",
    "performance",
    "build_release",
    "qa_validation",
    "research_modeling",
]
ProductionPriorityStatus = Literal["active", "blocked", "paused", "completed"]
ProductionAvailability = Literal["available", "busy", "offline"]
ProductionHealthState = Literal["healthy", "busy", "degraded", "offline", "stale"]
ProductionBuildStatus = Literal["idle", "running", "blocked", "passed", "failed"]
ProductionValidationStatus = Literal["idle", "running", "blocked", "passed", "failed"]


TASK_TAXONOMY: tuple[ProductionTaskCategory, ...] = (
    "gameplay",
    "ai_behavior",
    "ui_ux",
    "systems_tools",
    "animation",
    "audio",
    "content_pipeline",
    "performance",
    "build_release",
    "qa_validation",
    "research_modeling",
)


def normalize_task_category(value: str) -> ProductionTaskCategory:
    normalized = value.strip().lower().replace("-", "_")
    if normalized in TASK_TAXONOMY:
        return normalized  # type: ignore[return-value]
    return "systems_tools"


def normalize_engine_family(value: str) -> str:
    normalized = value.strip().lower().replace("-", "_")
    if normalized in {"unity", "godot", "unreal", "custom", "unknown"}:
        return normalized
    return "unknown"


@dataclass(frozen=True)
class ProductionPriority:
    priority_id: str
    title: str
    category: ProductionTaskCategory
    status: ProductionPriorityStatus
    assigned_node_id: str = ""
    assigned_node_label: str = ""
    notes: str = ""
    updated_at: str = ""

    def to_payload(self) -> dict[str, object]:
        return {
            "priority_id": self.priority_id,
            "title": self.title,
            "category": self.category,
            "status": self.status,
            "assigned_node_id": self.assigned_node_id,
            "assigned_node_label": self.assigned_node_label,
            "notes": self.notes,
            "updated_at": self.updated_at,
        }

    @staticmethod
    def from_payload(payload: dict[str, object]) -> "ProductionPriority":
        return ProductionPriority(
            priority_id=str(payload.get("priority_id", "")).strip(),
            title=str(payload.get("title", "")).strip(),
            category=normalize_task_category(str(payload.get("category", "systems_tools"))),
            status=str(payload.get("status", "active")).strip().lower() or "active",  # type: ignore[arg-type]
            assigned_node_id=str(payload.get("assigned_node_id", "")).strip(),
            assigned_node_label=str(payload.get("assigned_node_label", "")).strip(),
            notes=str(payload.get("notes", "")).strip(),
            updated_at=str(payload.get("updated_at", "")).strip(),
        )


@dataclass(frozen=True)
class ProductionBlockedItem:
    blocked_id: str
    title: str
    category: ProductionTaskCategory
    reason: str
    related_kind: str = ""
    related_id: str = ""
    updated_at: str = ""

    def to_payload(self) -> dict[str, object]:
        return {
            "blocked_id": self.blocked_id,
            "title": self.title,
            "category": self.category,
            "reason": self.reason,
            "related_kind": self.related_kind,
            "related_id": self.related_id,
            "updated_at": self.updated_at,
        }

    @staticmethod
    def from_payload(payload: dict[str, object]) -> "ProductionBlockedItem":
        return ProductionBlockedItem(
            blocked_id=str(payload.get("blocked_id", "")).strip(),
            title=str(payload.get("title", "")).strip(),
            category=normalize_task_category(str(payload.get("category", "systems_tools"))),
            reason=str(payload.get("reason", "")).strip(),
            related_kind=str(payload.get("related_kind", "")).strip(),
            related_id=str(payload.get("related_id", "")).strip(),
            updated_at=str(payload.get("updated_at", "")).strip(),
        )


@dataclass(frozen=True)
class ProductionNodeSnapshot:
    node_id: str
    role: str
    specialization_tags: tuple[str, ...]
    active_task_category: ProductionTaskCategory
    availability: ProductionAvailability
    health_state: ProductionHealthState
    current_assignment: str
    last_result_summary: str
    updated_at: str = ""

    def to_payload(self) -> dict[str, object]:
        return {
            "node_id": self.node_id,
            "role": self.role,
            "specialization_tags": list(self.specialization_tags),
            "active_task_category": self.active_task_category,
            "availability": self.availability,
            "health_state": self.health_state,
            "current_assignment": self.current_assignment,
            "last_result_summary": self.last_result_summary,
            "updated_at": self.updated_at,
        }

    @staticmethod
    def from_payload(payload: dict[str, object]) -> "ProductionNodeSnapshot":
        tags = payload.get("specialization_tags")
        return ProductionNodeSnapshot(
            node_id=str(payload.get("node_id", "")).strip(),
            role=str(payload.get("role", "")).strip(),
            specialization_tags=tuple(str(item).strip() for item in tags or () if str(item).strip()),
            active_task_category=normalize_task_category(str(payload.get("active_task_category", "systems_tools"))),
            availability=str(payload.get("availability", "available")).strip().lower() or "available",  # type: ignore[arg-type]
            health_state=str(payload.get("health_state", "healthy")).strip().lower() or "healthy",  # type: ignore[arg-type]
            current_assignment=str(payload.get("current_assignment", "")).strip(),
            last_result_summary=str(payload.get("last_result_summary", "")).strip(),
            updated_at=str(payload.get("updated_at", "")).strip(),
        )


@dataclass(frozen=True)
class ProductionRecentChange:
    change_id: str
    summary: str
    category: ProductionTaskCategory
    change_kind: str
    related_id: str = ""
    updated_at: str = ""

    def to_payload(self) -> dict[str, object]:
        return {
            "change_id": self.change_id,
            "summary": self.summary,
            "category": self.category,
            "change_kind": self.change_kind,
            "related_id": self.related_id,
            "updated_at": self.updated_at,
        }

    @staticmethod
    def from_payload(payload: dict[str, object]) -> "ProductionRecentChange":
        return ProductionRecentChange(
            change_id=str(payload.get("change_id", "")).strip(),
            summary=str(payload.get("summary", "")).strip(),
            category=normalize_task_category(str(payload.get("category", "systems_tools"))),
            change_kind=str(payload.get("change_kind", "note")).strip(),
            related_id=str(payload.get("related_id", "")).strip(),
            updated_at=str(payload.get("updated_at", "")).strip(),
        )


@dataclass(frozen=True)
class ProductionPendingApproval:
    approval_id: str
    summary: str
    command_label: str
    expires_at: str = ""

    def to_payload(self) -> dict[str, object]:
        return {
            "approval_id": self.approval_id,
            "summary": self.summary,
            "command_label": self.command_label,
            "expires_at": self.expires_at,
        }

    @staticmethod
    def from_payload(payload: dict[str, object]) -> "ProductionPendingApproval":
        return ProductionPendingApproval(
            approval_id=str(payload.get("approval_id", "")).strip(),
            summary=str(payload.get("summary", "")).strip(),
            command_label=str(payload.get("command_label", "")).strip(),
            expires_at=str(payload.get("expires_at", "")).strip(),
        )


@dataclass(frozen=True)
class ProductionBuildState:
    status: ProductionBuildStatus
    summary: str
    related_id: str = ""

    def to_payload(self) -> dict[str, object]:
        return {"status": self.status, "summary": self.summary, "related_id": self.related_id}

    @staticmethod
    def from_payload(payload: dict[str, object]) -> "ProductionBuildState":
        return ProductionBuildState(
            status=str(payload.get("status", "idle")).strip().lower() or "idle",  # type: ignore[arg-type]
            summary=str(payload.get("summary", "No build signal recorded.")).strip() or "No build signal recorded.",
            related_id=str(payload.get("related_id", "")).strip(),
        )


@dataclass(frozen=True)
class ProductionValidationState:
    status: ProductionValidationStatus
    summary: str
    related_id: str = ""

    def to_payload(self) -> dict[str, object]:
        return {"status": self.status, "summary": self.summary, "related_id": self.related_id}

    @staticmethod
    def from_payload(payload: dict[str, object]) -> "ProductionValidationState":
        return ProductionValidationState(
            status=str(payload.get("status", "idle")).strip().lower() or "idle",  # type: ignore[arg-type]
            summary=str(payload.get("summary", "No validation signal recorded.")).strip() or "No validation signal recorded.",
            related_id=str(payload.get("related_id", "")).strip(),
        )


@dataclass(frozen=True)
class ProductionProjectState:
    project_id: str
    project_title: str
    engine_family: str
    current_milestone: str
    active_priorities: tuple[ProductionPriority, ...] = ()
    blocked_items: tuple[ProductionBlockedItem, ...] = ()
    active_nodes: tuple[ProductionNodeSnapshot, ...] = ()
    recent_changes: tuple[ProductionRecentChange, ...] = ()
    pending_approvals: tuple[ProductionPendingApproval, ...] = ()
    build_state: ProductionBuildState = field(default_factory=lambda: ProductionBuildState(status="idle", summary="No build signal recorded."))
    validation_state: ProductionValidationState = field(default_factory=lambda: ProductionValidationState(status="idle", summary="No validation signal recorded."))
    updated_at: str = ""

    def to_payload(self) -> dict[str, object]:
        return {
            "project_id": self.project_id,
            "project_title": self.project_title,
            "engine_family": self.engine_family,
            "current_milestone": self.current_milestone,
            "active_priorities": [item.to_payload() for item in self.active_priorities],
            "blocked_items": [item.to_payload() for item in self.blocked_items],
            "active_nodes": [item.to_payload() for item in self.active_nodes],
            "recent_changes": [item.to_payload() for item in self.recent_changes],
            "pending_approvals": [item.to_payload() for item in self.pending_approvals],
            "build_state": self.build_state.to_payload(),
            "validation_state": self.validation_state.to_payload(),
            "updated_at": self.updated_at,
        }

    @staticmethod
    def from_payload(payload: dict[str, object]) -> "ProductionProjectState":
        return ProductionProjectState(
            project_id=str(payload.get("project_id", "")).strip(),
            project_title=str(payload.get("project_title", "")).strip(),
            engine_family=normalize_engine_family(str(payload.get("engine_family", "unknown"))),
            current_milestone=str(payload.get("current_milestone", "")).strip(),
            active_priorities=tuple(
                ProductionPriority.from_payload(item)
                for item in payload.get("active_priorities", ())
                if isinstance(item, dict)
            ),
            blocked_items=tuple(
                ProductionBlockedItem.from_payload(item)
                for item in payload.get("blocked_items", ())
                if isinstance(item, dict)
            ),
            active_nodes=tuple(
                ProductionNodeSnapshot.from_payload(item)
                for item in payload.get("active_nodes", ())
                if isinstance(item, dict)
            ),
            recent_changes=tuple(
                ProductionRecentChange.from_payload(item)
                for item in payload.get("recent_changes", ())
                if isinstance(item, dict)
            ),
            pending_approvals=tuple(
                ProductionPendingApproval.from_payload(item)
                for item in payload.get("pending_approvals", ())
                if isinstance(item, dict)
            ),
            build_state=ProductionBuildState.from_payload(payload.get("build_state", {}) if isinstance(payload.get("build_state"), dict) else {}),
            validation_state=ProductionValidationState.from_payload(payload.get("validation_state", {}) if isinstance(payload.get("validation_state"), dict) else {}),
            updated_at=str(payload.get("updated_at", "")).strip(),
        )


@dataclass(frozen=True)
class ProductionConversationMemory:
    chat_id: str
    current_project_id: str = ""
    current_milestone: str = ""
    most_recent_task_title: str = ""
    most_recent_task_category: str = ""
    recently_referenced_node_id: str = ""
    last_priority_id: str = ""
    last_blocked_item_id: str = ""
    last_pending_approval_id: str = ""
    last_follow_up_target_kind: str = ""
    last_follow_up_target_id: str = ""
    last_meaningful_action_kind: str = ""
    last_meaningful_action_summary: str = ""
    last_action_summary: str = ""
    updated_at: str = ""

    def to_payload(self) -> dict[str, object]:
        return {
            "chat_id": self.chat_id,
            "current_project_id": self.current_project_id,
            "current_milestone": self.current_milestone,
            "most_recent_task_title": self.most_recent_task_title,
            "most_recent_task_category": self.most_recent_task_category,
            "recently_referenced_node_id": self.recently_referenced_node_id,
            "last_priority_id": self.last_priority_id,
            "last_blocked_item_id": self.last_blocked_item_id,
            "last_pending_approval_id": self.last_pending_approval_id,
            "last_follow_up_target_kind": self.last_follow_up_target_kind,
            "last_follow_up_target_id": self.last_follow_up_target_id,
            "last_meaningful_action_kind": self.last_meaningful_action_kind,
            "last_meaningful_action_summary": self.last_meaningful_action_summary,
            "last_action_summary": self.last_action_summary,
            "updated_at": self.updated_at,
        }

    @staticmethod
    def from_payload(payload: dict[str, object]) -> "ProductionConversationMemory":
        return ProductionConversationMemory(
            chat_id=str(payload.get("chat_id", "")).strip(),
            current_project_id=str(payload.get("current_project_id", "")).strip(),
            current_milestone=str(payload.get("current_milestone", "")).strip(),
            most_recent_task_title=str(payload.get("most_recent_task_title", "")).strip(),
            most_recent_task_category=str(payload.get("most_recent_task_category", "")).strip(),
            recently_referenced_node_id=str(payload.get("recently_referenced_node_id", "")).strip(),
            last_priority_id=str(payload.get("last_priority_id", "")).strip(),
            last_blocked_item_id=str(payload.get("last_blocked_item_id", "")).strip(),
            last_pending_approval_id=str(payload.get("last_pending_approval_id", "")).strip(),
            last_follow_up_target_kind=str(payload.get("last_follow_up_target_kind", "")).strip(),
            last_follow_up_target_id=str(payload.get("last_follow_up_target_id", "")).strip(),
            last_meaningful_action_kind=str(payload.get("last_meaningful_action_kind", "")).strip(),
            last_meaningful_action_summary=str(payload.get("last_meaningful_action_summary", "")).strip(),
            last_action_summary=str(payload.get("last_action_summary", "")).strip(),
            updated_at=str(payload.get("updated_at", "")).strip(),
        )