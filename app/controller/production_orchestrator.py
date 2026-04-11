"""Project-agnostic conversational production orchestration."""
from __future__ import annotations

from dataclasses import dataclass, replace
from pathlib import Path
import re
import secrets
from typing import TYPE_CHECKING

from .production_intent_router import ProductionIntentDecision, ProductionIntentRouter
from .production_state_models import (
    ProductionBlockedItem,
    ProductionBuildState,
    ProductionConversationMemory,
    ProductionNodeSnapshot,
    ProductionPendingApproval,
    ProductionPriority,
    ProductionProjectState,
    ProductionRecentChange,
    ProductionValidationState,
    normalize_engine_family,
    normalize_task_category,
)
from .production_state_store import ProductionStateStore
from .production_summary import ProductionSummaryFormatter

if TYPE_CHECKING:
    from .app_service import ControllerService
    from .evaluation_session_models import EvaluationSessionRecord
    from .node_models import NodeDescriptor, NodeDispatchRecord
    from .task_chain_models import TaskChainRecord


@dataclass(frozen=True)
class ProductionConversationOutcome:
    matched: bool
    reply: str
    summary: str
    routed_action: str
    intent: ProductionIntentDecision | None = None
    clarification: bool = False
    telemetry: dict[str, object] | None = None


class ProductionOrchestrator:
    def __init__(
        self,
        *,
        store: ProductionStateStore,
        summary_formatter: ProductionSummaryFormatter | None = None,
        intent_router: ProductionIntentRouter | None = None,
    ) -> None:
        self._store = store
        self._summary_formatter = summary_formatter or ProductionSummaryFormatter()
        self._intent_router = intent_router or ProductionIntentRouter()

    def ensure_project(
        self,
        *,
        service: ControllerService,
        chat_id: str,
        project_title: str = "",
        engine_family: str = "",
        milestone: str = "",
    ) -> ProductionProjectState:
        memory = self._store.get_chat_memory(chat_id) or ProductionConversationMemory(chat_id=chat_id)
        existing = self._store.get_project(memory.current_project_id) if memory.current_project_id else None
        if existing is not None:
            return existing
        repo_title = Path(service._config.repo_root).name if service._config.repo_root.strip() else "AI-E Project"
        inferred_engine = self._infer_engine_family(service=service)
        project = ProductionProjectState(
            project_id=self._store.generate_project_id(),
            project_title=project_title.strip() or repo_title,
            engine_family=normalize_engine_family(engine_family or inferred_engine),
            current_milestone=milestone.strip() or "active production",
            updated_at=service._now_iso(),
        )
        stored = self._store.save_project(project)
        self._store.save_chat_memory(
            replace(
                memory,
                current_project_id=stored.project_id,
                current_milestone=stored.current_milestone,
                updated_at=service._now_iso(),
            )
        )
        return stored

    def get_project_state(self, *, service: ControllerService, chat_id: str) -> ProductionProjectState:
        project = self.ensure_project(service=service, chat_id=chat_id)
        return self._merge_live_signals(service=service, chat_id=chat_id, project=project)

    def establish_project(
        self,
        *,
        service: ControllerService,
        chat_id: str,
        title: str,
        engine_family: str,
        milestone: str,
    ) -> ProductionProjectState:
        memory = self._store.get_chat_memory(chat_id) or ProductionConversationMemory(chat_id=chat_id)
        project = self._store.get_project(memory.current_project_id) if memory.current_project_id else None
        if project is None:
            project = ProductionProjectState(
                project_id=self._store.generate_project_id(),
                project_title=title.strip(),
                engine_family=normalize_engine_family(engine_family),
                current_milestone=milestone.strip() or "active production",
                updated_at=service._now_iso(),
            )
        else:
            project = replace(
                project,
                project_title=title.strip() or project.project_title,
                engine_family=normalize_engine_family(engine_family or project.engine_family),
                current_milestone=milestone.strip() or project.current_milestone,
                updated_at=service._now_iso(),
            )
        stored = self._store.save_project(project)
        self._store.save_chat_memory(
            replace(
                memory,
                current_project_id=stored.project_id,
                current_milestone=stored.current_milestone,
                updated_at=service._now_iso(),
            )
        )
        return stored

    def status_reply(self, *, service: ControllerService, chat_id: str, mobile: bool = False, focus: str = "overview") -> str:
        project = self.get_project_state(service=service, chat_id=chat_id)
        if focus == "blocked":
            return self._summary_formatter.format_blocked(project=project, mobile=mobile)
        if focus == "changes":
            return self._summary_formatter.format_changes(project=project, mobile=mobile)
        if focus == "nodes":
            return self._summary_formatter.format_nodes(project=project, mobile=mobile)
        if focus == "attention":
            return self._summary_formatter.format_attention(project=project, mobile=mobile)
        return self._summary_formatter.format_overview(project=project, mobile=mobile)

    def handle_message(self, *, service: ControllerService, chat_id: str, message: str) -> ProductionConversationOutcome:
        memory = self._store.get_chat_memory(chat_id)
        decision = self._intent_router.classify(message=message, memory=memory)
        if not decision.matched:
            return ProductionConversationOutcome(matched=False, reply="", summary="", routed_action="", intent=decision)
        if decision.needs_clarification:
            return ProductionConversationOutcome(
                matched=True,
                clarification=True,
                reply=decision.clarification_message,
                summary=decision.clarification_message,
                routed_action="clarify",
                intent=decision,
                telemetry={"clarification": True},
            )
        if decision.intent == "status_overview":
            reply = self.status_reply(service=service, chat_id=chat_id)
            self._remember_reference(service=service, chat_id=chat_id, action_summary="Reviewed production status.", action_kind="status_overview")
            return self._outcome(decision=decision, reply=reply, routed_action="status_overview")
        if decision.intent == "status_blocked":
            reply = self.status_reply(service=service, chat_id=chat_id, focus="blocked")
            self._remember_reference(service=service, chat_id=chat_id, action_summary="Reviewed blocked production work.", action_kind="status_blocked")
            return self._outcome(decision=decision, reply=reply, routed_action="status_blocked")
        if decision.intent == "status_changes":
            reply = self.status_reply(service=service, chat_id=chat_id, focus="changes", mobile=decision.mobile)
            self._remember_reference(service=service, chat_id=chat_id, action_summary="Reviewed recent production changes.", action_kind="status_changes")
            return self._outcome(decision=decision, reply=reply, routed_action="status_changes")
        if decision.intent == "status_nodes":
            reply = self.status_reply(service=service, chat_id=chat_id, focus="nodes", mobile=decision.mobile)
            self._remember_reference(service=service, chat_id=chat_id, action_summary="Reviewed node production status.", action_kind="status_nodes")
            return self._outcome(decision=decision, reply=reply, routed_action="status_nodes")
        if decision.intent == "status_attention":
            reply = self.status_reply(service=service, chat_id=chat_id, focus="attention")
            self._remember_reference(service=service, chat_id=chat_id, action_summary="Reviewed pending approvals and blockers.", action_kind="status_attention")
            return self._outcome(decision=decision, reply=reply, routed_action="status_attention")
        if decision.intent == "status_mobile":
            reply = self.status_reply(service=service, chat_id=chat_id, mobile=True)
            self._remember_reference(service=service, chat_id=chat_id, action_summary="Reviewed mobile production status.", action_kind="status_mobile")
            return self._outcome(decision=decision, reply=reply, routed_action="status_mobile")
        if decision.intent == "set_priority":
            project = self._set_priority(service=service, chat_id=chat_id, title=decision.title, category=decision.category or "systems_tools")
            reply = "\n".join(
                (
                    f"Shifted focus to {decision.title}.",
                    self._summary_formatter.format_overview(project=project, mobile=True),
                )
            )
            return self._outcome(decision=decision, reply=reply, routed_action="set_priority")
        if decision.intent == "pause_validation":
            reply = self.pause_target(service=service, chat_id=chat_id, target="validation")
            return self._outcome(decision=decision, reply=reply, routed_action="pause_validation")
        if decision.intent == "resume_validation":
            reply = self.resume_target(service=service, chat_id=chat_id, target="validation")
            return self._outcome(decision=decision, reply=reply, routed_action="resume_validation")
        if decision.intent == "pause_followup":
            reply = self.pause_target(service=service, chat_id=chat_id, target="followup")
            return self._outcome(decision=decision, reply=reply, routed_action="pause_followup")
        if decision.intent == "resume_followup":
            reply = self.resume_target(service=service, chat_id=chat_id, target="followup")
            return self._outcome(decision=decision, reply=reply, routed_action="resume_followup")
        if decision.intent == "assign_priority":
            reply = self.assign_work(service=service, chat_id=chat_id, target=decision.target or "validator", category=decision.category or "qa_validation", title=decision.title)
            return self._outcome(decision=decision, reply=reply, routed_action="assign_priority")
        if decision.intent == "move_followup":
            reply = self.assign_work(service=service, chat_id=chat_id, target="another", category="", title="")
            return self._outcome(decision=decision, reply=reply, routed_action="move_followup")
        if decision.intent == "pause_and_shift":
            pause_reply = self.pause_target(service=service, chat_id=chat_id, target=decision.category)
            project = self._set_priority(service=service, chat_id=chat_id, title=decision.title or decision.secondary_category, category=decision.secondary_category or "build_release")
            reply = "\n".join((pause_reply, f"Resumed focus on {decision.title or decision.secondary_category}.", self._summary_formatter.format_overview(project=project, mobile=True)))
            return self._outcome(decision=decision, reply=reply, routed_action="pause_and_shift")
        return ProductionConversationOutcome(matched=False, reply="", summary="", routed_action="", intent=decision)

    def set_priority(self, *, service: ControllerService, chat_id: str, title: str, category: str, node_hint: str = "") -> ProductionProjectState:
        return self._set_priority(service=service, chat_id=chat_id, title=title, category=category, node_hint=node_hint)

    def pause_target(self, *, service: ControllerService, chat_id: str, target: str) -> str:
        project = self.ensure_project(service=service, chat_id=chat_id)
        memory = self._store.get_chat_memory(chat_id) or ProductionConversationMemory(chat_id=chat_id)
        running_evals, running_chains = self._select_pausable_targets(service=service, chat_id=chat_id, target=target, memory=memory)
        if not running_evals and not running_chains:
            return self._no_active_target_reply(action="pause", memory=memory)
        stopped_evals = [service.stop_evaluation_session(item.session_id, reason="Paused from production conversation.") for item in running_evals]
        paused_chains = [service.pause_task_chain(item.chain_id, reason="Paused from production conversation.") for item in running_chains]
        updated = replace(
            project,
            recent_changes=self._prepend_change_if_meaningful(
                project.recent_changes,
                ProductionRecentChange(
                    change_id=f"CHG-{secrets.token_hex(3).upper()}",
                    summary="Paused validation work.",
                    category="qa_validation",
                    change_kind="pause",
                    related_id=(stopped_evals[0].session_id if stopped_evals else paused_chains[0].chain_id),
                    updated_at=service._now_iso(),
                ),
            ),
            updated_at=service._now_iso(),
        )
        merged = self._store.save_project(updated)
        target_kind = "evaluation" if stopped_evals else "task_chain"
        target_id = stopped_evals[0].session_id if stopped_evals else paused_chains[0].chain_id
        self._remember_reference(
            service=service,
            chat_id=chat_id,
            action_summary="Paused validation work.",
            action_kind="pause",
            follow_up_target_kind=target_kind,
            follow_up_target_id=target_id,
        )
        return "\n".join(
            (
                "Paused the current validation effort.",
                f"Affected evaluation sessions: {len(stopped_evals)} | affected chains: {len(paused_chains)}",
                self._summary_formatter.format_blocked(project=self._merge_live_signals(service=service, chat_id=chat_id, project=merged), mobile=True),
            )
        )

    def resume_target(self, *, service: ControllerService, chat_id: str, target: str) -> str:
        memory = self._store.get_chat_memory(chat_id) or ProductionConversationMemory(chat_id=chat_id)
        resumed_evals = []
        resumed_chains = []
        resumable_evals, resumable_chains = self._select_resumable_targets(service=service, chat_id=chat_id, target=target, memory=memory)
        if target == "followup" and memory.last_follow_up_target_kind == "evaluation" and memory.last_follow_up_target_id:
            session = service.get_evaluation_session(memory.last_follow_up_target_id)
            if session is not None and session.status == "running":
                return "The last paused validation effort is already running again."
        if target == "followup" and memory.last_follow_up_target_kind == "task_chain" and memory.last_follow_up_target_id:
            chain = service.get_task_chain(memory.last_follow_up_target_id)
            if chain is not None and chain.status == "running":
                return "The last paused validation chain is already running again."
        for session in resumable_evals:
            resumed_evals.append(service.start_evaluation_session(session.session_id))
        for chain in resumable_chains:
            resumed_chains.append(service.resume_task_chain(chain.chain_id))
        if not resumed_evals and not resumed_chains:
            return self._no_active_target_reply(action="resume", memory=memory)
        project = self.ensure_project(service=service, chat_id=chat_id)
        unblocked = tuple(item for item in project.blocked_items if item.category != "qa_validation")
        updated = replace(
            project,
            blocked_items=unblocked,
            recent_changes=self._prepend_change_if_meaningful(
                project.recent_changes,
                ProductionRecentChange(
                    change_id=f"CHG-{secrets.token_hex(3).upper()}",
                    summary="Resumed validation work.",
                    category="qa_validation",
                    change_kind="resume",
                    related_id=(resumed_evals[0].session_id if resumed_evals else resumed_chains[0].chain_id),
                    updated_at=service._now_iso(),
                ),
            ),
            updated_at=service._now_iso(),
        )
        self._store.save_project(updated)
        self._remember_reference(
            service=service,
            chat_id=chat_id,
            action_summary="Resumed validation work.",
            action_kind="resume",
            follow_up_target_kind="evaluation" if resumed_evals else ("task_chain" if resumed_chains else "priority"),
            follow_up_target_id=(resumed_evals[0].session_id if resumed_evals else (resumed_chains[0].chain_id if resumed_chains else "validation")),
        )
        return "\n".join(
            (
                "Resumed validation work.",
                f"Restarted evaluation sessions: {len(resumed_evals)} | resumed chains: {len(resumed_chains)}",
                self.status_reply(service=service, chat_id=chat_id, mobile=True),
            )
        )

    def assign_work(self, *, service: ControllerService, chat_id: str, target: str, category: str, title: str) -> str:
        project = self.ensure_project(service=service, chat_id=chat_id)
        live = self._merge_live_signals(service=service, chat_id=chat_id, project=project)
        priority = self._select_priority_for_assignment(live=live, title=title)
        if priority is None and title:
            live = self._set_priority(service=service, chat_id=chat_id, title=title, category=category or "systems_tools")
            priority = live.active_priorities[0] if live.active_priorities else None
        if priority is None:
            return "I need a current production priority before I can move it to another node."
        node = self._pick_node(live=live, target=target, category=category or priority.category, exclude_node_id=live.active_nodes[0].node_id if target == "another" and live.active_nodes else "")
        if node is None:
            return "I couldn't find a suitable active node for that assignment. Use /nodes to inspect available roles first."
        if priority.assigned_node_id == node.node_id:
            self._remember_reference(
                service=service,
                chat_id=chat_id,
                action_summary=f"{priority.title} is already assigned to {node.node_id}.",
                action_kind="assignment",
                priority_id=priority.priority_id,
                node_id=node.node_id,
            )
            return f"{priority.title} is already assigned to {node.node_id}."
        updated_priorities = []
        for item in live.active_priorities:
            if item.priority_id == priority.priority_id:
                updated_priorities.append(replace(item, assigned_node_id=node.node_id, assigned_node_label=node.role, updated_at=service._now_iso()))
            else:
                updated_priorities.append(item)
        updated = replace(
            live,
            active_priorities=tuple(updated_priorities),
            recent_changes=self._prepend_change_if_meaningful(
                live.recent_changes,
                ProductionRecentChange(
                    change_id=f"CHG-{secrets.token_hex(3).upper()}",
                    summary=f"Assigned {priority.title} to {node.node_id} ({node.role}).",
                    category=priority.category,
                    change_kind="assignment",
                    related_id=node.node_id,
                    updated_at=service._now_iso(),
                ),
            ),
            updated_at=service._now_iso(),
        )
        self._store.save_project(updated)
        self._remember_reference(
            service=service,
            chat_id=chat_id,
            action_summary=f"Assigned {priority.title} to {node.node_id}.",
            action_kind="assignment",
            priority_id=priority.priority_id,
            node_id=node.node_id,
        )
        return "\n".join(
            (
                f"Assigned {priority.title} to {node.node_id}.",
                self._summary_formatter.format_nodes(project=self._merge_live_signals(service=service, chat_id=chat_id, project=updated), mobile=True),
            )
        )

    def _set_priority(self, *, service: ControllerService, chat_id: str, title: str, category: str, node_hint: str = "") -> ProductionProjectState:
        project = self.ensure_project(service=service, chat_id=chat_id)
        normalized_category = normalize_task_category(category or title)
        current = next((item for item in project.active_priorities if item.status == "active"), None)
        if current is not None and current.title.lower() == title.strip().lower() and current.category == normalized_category:
            self._remember_reference(
                service=service,
                chat_id=chat_id,
                action_summary=f"Production focus is already on {current.title}.",
                action_kind="priority",
                priority_id=current.priority_id,
            )
            return self._merge_live_signals(service=service, chat_id=chat_id, project=project)
        existing = [item for item in project.active_priorities if item.title.lower() != title.lower()]
        priority = ProductionPriority(
            priority_id=f"PRI-{secrets.token_hex(3).upper()}",
            title=title.strip(),
            category=normalized_category,
            status="active",
            assigned_node_id=node_hint.strip(),
            assigned_node_label=node_hint.strip(),
            updated_at=service._now_iso(),
        )
        updated = replace(
            project,
            active_priorities=(priority, *tuple(existing))[:6],
            recent_changes=self._prepend_change_if_meaningful(
                project.recent_changes,
                ProductionRecentChange(
                    change_id=f"CHG-{secrets.token_hex(3).upper()}",
                    summary=f"Shifted production focus to {priority.title}.",
                    category=priority.category,
                    change_kind="priority",
                    related_id=priority.priority_id,
                    updated_at=service._now_iso(),
                ),
            ),
            updated_at=service._now_iso(),
        )
        stored = self._store.save_project(updated)
        self._remember_reference(
            service=service,
            chat_id=chat_id,
            action_summary=f"Shifted focus to {priority.title}.",
            action_kind="priority",
            priority_id=priority.priority_id,
        )
        return self._merge_live_signals(service=service, chat_id=chat_id, project=stored)

    def _merge_live_signals(self, *, service: ControllerService, chat_id: str, project: ProductionProjectState) -> ProductionProjectState:
        nodes = self._build_node_snapshots(service=service)
        approvals = self._build_pending_approvals(service=service, chat_id=chat_id)
        blocked = self._merge_blocked_items(service=service, chat_id=chat_id, existing=project.blocked_items)
        build_state = self._build_build_state(service=service, chat_id=chat_id, project=project)
        validation_state = self._build_validation_state(service=service, chat_id=chat_id, project=project)
        return replace(
            project,
            active_nodes=nodes,
            pending_approvals=approvals,
            blocked_items=blocked,
            build_state=build_state,
            validation_state=validation_state,
            updated_at=service._now_iso(),
        )

    def _build_node_snapshots(self, *, service: ControllerService) -> tuple[ProductionNodeSnapshot, ...]:
        jobs = service.list_dispatch_jobs()
        rows: list[ProductionNodeSnapshot] = []
        for node in service.list_registered_nodes():
            active_job = next((job for job in jobs if job.target_node_id == node.node_id and job.status in {"queued", "running"}), None)
            availability = "busy" if active_job is not None or node.status == "busy" else ("offline" if node.status in {"offline", "disabled"} else "available")
            health_state = "healthy"
            if node.status in {"offline", "disabled"}:
                health_state = "offline"
            elif node.status == "degraded":
                health_state = "degraded"
            elif node.status == "stale":
                health_state = "stale"
            elif availability == "busy":
                health_state = "busy"
            assignment = self._humanize_node_assignment(node=node, active_job=active_job, availability=availability)
            category = self._infer_task_category(" ".join((assignment, node.summary, " ".join(node.capability_labels))))
            rows.append(
                ProductionNodeSnapshot(
                    node_id=node.node_id,
                    role=node.role,
                    specialization_tags=self._specialization_tags(node=node, category=category),
                    active_task_category=category,
                    availability=availability,
                    health_state=health_state,  # type: ignore[arg-type]
                    current_assignment=assignment,
                    last_result_summary=node.last_result_summary,
                    updated_at=node.last_seen_at,
                )
            )
        return tuple(rows)

    def _build_pending_approvals(self, *, service: ControllerService, chat_id: str) -> tuple[ProductionPendingApproval, ...]:
        return tuple(
            ProductionPendingApproval(
                approval_id=item.confirmation_id,
                summary=f"{item.original_command} {item.argument_summary}".strip(),
                command_label=item.original_command,
                expires_at=item.expires_at,
            )
            for item in service.list_pending_confirmations(chat_id=chat_id)[:5]
        )

    def _merge_blocked_items(
        self,
        *,
        service: ControllerService,
        chat_id: str,
        existing: tuple[ProductionBlockedItem, ...],
    ) -> tuple[ProductionBlockedItem, ...]:
        blocked: dict[str, ProductionBlockedItem] = {item.blocked_id: item for item in existing}
        for session in service.list_evaluation_sessions():
            if session.chat_id != chat_id or session.status not in {"blocked", "stopped"}:
                continue
            blocked[f"eval:{session.session_id}"] = ProductionBlockedItem(
                blocked_id=f"eval:{session.session_id}",
                title=session.title,
                category=self._infer_task_category(" ".join((session.title, session.purpose))),
                reason=session.stop_reason or session.final_summary or session.latest_summary or session.status,
                related_kind="evaluation",
                related_id=session.session_id,
                updated_at=session.finished_at or session.last_started_at,
            )
        for chain in service.list_task_chains():
            if chain.chat_id != chat_id or chain.status not in {"blocked", "paused"}:
                continue
            blocked[f"chain:{chain.chain_id}"] = ProductionBlockedItem(
                blocked_id=f"chain:{chain.chain_id}",
                title=chain.title,
                category=self._infer_task_category(" ".join((chain.title, chain.objective))),
                reason=chain.pause_reason or chain.stop_reason or chain.final_summary or chain.latest_summary or chain.status,
                related_kind="task_chain",
                related_id=chain.chain_id,
                updated_at=chain.finished_at or chain.created_at,
            )
        return tuple(list(blocked.values())[:8])

    def _build_build_state(self, *, service: ControllerService, chat_id: str, project: ProductionProjectState) -> ProductionBuildState:
        chains = [item for item in service.list_task_chains() if item.chat_id == chat_id and self._looks_like_build(item.title, item.objective)]
        if any(item.status == "running" for item in chains):
            chain = next(item for item in chains if item.status == "running")
            return ProductionBuildState(status="running", summary=chain.latest_summary or chain.title, related_id=chain.chain_id)
        if any(item.status in {"blocked", "paused", "stopped"} for item in chains):
            chain = next(item for item in chains if item.status in {"blocked", "paused", "stopped"})
            return ProductionBuildState(status="blocked", summary=chain.final_summary or chain.latest_summary or chain.status, related_id=chain.chain_id)
        if any(item.category == "build_release" and item.status == "active" for item in project.active_priorities):
            return ProductionBuildState(status="idle", summary="Build work is prioritized but not actively running.")
        return ProductionBuildState(status="idle", summary="No active build loop is recorded.")

    def _build_validation_state(self, *, service: ControllerService, chat_id: str, project: ProductionProjectState) -> ProductionValidationState:
        sessions = [item for item in service.list_evaluation_sessions() if item.chat_id == chat_id and self._looks_like_validation(item.title, item.purpose)]
        chains = [item for item in service.list_task_chains() if item.chat_id == chat_id and self._looks_like_validation(item.title, item.objective)]
        if any(item.status == "running" for item in sessions):
            session = next(item for item in sessions if item.status == "running")
            return ProductionValidationState(status="running", summary=session.latest_summary or session.title, related_id=session.session_id)
        if any(item.status == "running" for item in chains):
            chain = next(item for item in chains if item.status == "running")
            return ProductionValidationState(status="running", summary=chain.latest_summary or chain.title, related_id=chain.chain_id)
        if any(item.status in {"blocked", "paused", "stopped"} for item in sessions + chains):
            reason = next((item.final_summary or item.latest_summary for item in sessions + chains if item.status in {"blocked", "paused", "stopped"}), "Validation is paused.")
            related_id = next((item.session_id for item in sessions if item.status in {"blocked", "stopped"}), "")
            if not related_id:
                related_id = next((item.chain_id for item in chains if item.status in {"blocked", "paused"}), "")
            return ProductionValidationState(status="blocked", summary=reason, related_id=related_id)
        if any(item.category == "qa_validation" and item.status == "active" for item in project.active_priorities):
            return ProductionValidationState(status="idle", summary="Validation is prioritized but not currently running.")
        return ProductionValidationState(status="idle", summary="No active validation loop is recorded.")

    def _pick_node(
        self,
        *,
        live: ProductionProjectState,
        target: str,
        category: str,
        exclude_node_id: str = "",
    ) -> ProductionNodeSnapshot | None:
        candidates = [item for item in live.active_nodes if item.availability != "offline" and item.node_id != exclude_node_id]
        if target == "validator":
            for item in candidates:
                if item.role == "validator":
                    return item
        if target == "another" and candidates:
            return candidates[0]
        normalized_category = normalize_task_category(category or "systems_tools")
        for item in candidates:
            if item.active_task_category == normalized_category:
                return item
        return candidates[0] if candidates else None

    def _select_priority_for_assignment(self, *, live: ProductionProjectState, title: str) -> ProductionPriority | None:
        if title:
            lowered = title.lower()
            for item in live.active_priorities:
                if lowered in item.title.lower():
                    return item
        return live.active_priorities[0] if live.active_priorities else None

    def _remember_reference(
        self,
        *,
        service: ControllerService,
        chat_id: str,
        action_summary: str,
        action_kind: str,
        priority_id: str = "",
        node_id: str = "",
        follow_up_target_kind: str = "",
        follow_up_target_id: str = "",
    ) -> None:
        memory = self._store.get_chat_memory(chat_id) or ProductionConversationMemory(chat_id=chat_id)
        self._store.save_chat_memory(
            replace(
                memory,
                last_action_summary=action_summary,
                last_meaningful_action_kind=action_kind,
                last_meaningful_action_summary=action_summary,
                most_recent_task_title=action_summary if not priority_id and not memory.most_recent_task_title else memory.most_recent_task_title,
                last_priority_id=priority_id or memory.last_priority_id,
                recently_referenced_node_id=node_id or memory.recently_referenced_node_id,
                last_follow_up_target_kind=follow_up_target_kind.strip(),
                last_follow_up_target_id=follow_up_target_id.strip(),
                updated_at=service._now_iso(),
            )
        )

    @staticmethod
    def _prepend_change(
        existing: tuple[ProductionRecentChange, ...],
        item: ProductionRecentChange,
    ) -> tuple[ProductionRecentChange, ...]:
        return (item, *existing)[:8]

    def _prepend_change_if_meaningful(
        self,
        existing: tuple[ProductionRecentChange, ...],
        item: ProductionRecentChange,
    ) -> tuple[ProductionRecentChange, ...]:
        if existing:
            top = existing[0]
            if (
                top.change_kind.strip().lower() == item.change_kind.strip().lower()
                and top.related_id.strip().lower() == item.related_id.strip().lower()
                and top.summary.strip().lower() == item.summary.strip().lower()
            ):
                return existing
        return self._prepend_change(existing, item)

    def _humanize_node_assignment(self, *, node: NodeDescriptor, active_job: NodeDispatchRecord | None, availability: str) -> str:
        if availability == "offline":
            return "offline"
        if active_job is not None:
            return self._humanize_command_text(
                text=active_job.requested_command_summary or active_job.requested_command_text,
                command_label=active_job.requested_command_label,
                fallback="processing queued work" if active_job.status == "queued" else "running bounded work",
            )
        if availability != "busy":
            return "idle"
        source = (node.last_result_summary or node.summary).strip()
        if not source:
            return "working"
        return self._humanize_command_text(text=source, command_label="", fallback="working")

    def _humanize_command_text(self, *, text: str, command_label: str, fallback: str) -> str:
        lowered = " ".join(text.lower().split())
        if not lowered:
            return fallback
        if "recognized production intent and routed to" in lowered:
            route = lowered.split("recognized production intent and routed to", 1)[1].strip(" .")
            route = route.split()[0]
            return {
                "status_overview": "reporting production status",
                "status_blocked": "reviewing blockers",
                "status_changes": "reporting recent changes",
                "status_nodes": "reviewing node activity",
                "status_attention": "checking approvals and blockers",
                "status_mobile": "preparing mobile update",
                "set_priority": "tracking production priority",
                "pause_validation": "validation paused",
                "resume_validation": "resuming validation",
                "pause_followup": "validation paused",
                "resume_followup": "resuming validation",
                "assign_priority": "reassigning work",
                "move_followup": "reassigning work",
            }.get(route, "handling production request")
        if command_label == "/test":
            return "running tests"
        if command_label == "/run":
            return "running bounded command"
        if command_label == "/prodstatus":
            return "reporting production status"
        if command_label == "/prodmobile":
            return "preparing mobile update"
        if command_label == "/prodresume":
            return "resuming validation"
        if command_label == "/prodpause":
            return "validation paused"
        if command_label == "/prodassign":
            return "reassigning work"
        if command_label == "/prodpriority":
            return "tracking production priority"
        if lowered in {"no execution result yet.", "controller ready."}:
            return "idle"
        if "paused from production conversation" in lowered:
            return "validation paused"
        if "approval" in lowered or "confirmation" in lowered:
            return "awaiting approval"
        if "queued" in lowered:
            return "queued for execution"
        if "running" in lowered and "validation" in lowered:
            return "running validation"
        if "validation" in lowered and any(token in lowered for token in ("stopped", "paused", "blocked")):
            return "validation paused"
        if availability := re.search(r"reporting|tracking|reviewing|running|awaiting|validation paused|resuming validation", lowered):
            return availability.group(0)
        return fallback

    def _select_pausable_targets(
        self,
        *,
        service: ControllerService,
        chat_id: str,
        target: str,
        memory: ProductionConversationMemory,
    ) -> tuple[list[EvaluationSessionRecord], list[TaskChainRecord]]:
        if target == "followup":
            if memory.last_follow_up_target_kind == "evaluation" and memory.last_follow_up_target_id:
                session = service.get_evaluation_session(memory.last_follow_up_target_id)
                return ([session] if session is not None and session.status == "running" and self._looks_like_validation(session.title, session.purpose) else [], [])
            if memory.last_follow_up_target_kind == "task_chain" and memory.last_follow_up_target_id:
                chain = service.get_task_chain(memory.last_follow_up_target_id)
                return ([], [chain] if chain is not None and chain.status == "running" and self._looks_like_validation(chain.title, chain.objective) else [])
        running_evals = [item for item in service.list_evaluation_sessions() if item.chat_id == chat_id and item.status == "running" and self._looks_like_validation(item.title, item.purpose)]
        running_chains = [item for item in service.list_task_chains() if item.chat_id == chat_id and item.status == "running" and self._looks_like_validation(item.title, item.objective)]
        return running_evals, running_chains

    def _select_resumable_targets(
        self,
        *,
        service: ControllerService,
        chat_id: str,
        target: str,
        memory: ProductionConversationMemory,
    ) -> tuple[list[EvaluationSessionRecord], list[TaskChainRecord]]:
        if target == "followup":
            if memory.last_follow_up_target_kind == "evaluation" and memory.last_follow_up_target_id:
                session = service.get_evaluation_session(memory.last_follow_up_target_id)
                if session is not None and self._looks_paused_validation_session(session):
                    return [session], []
            if memory.last_follow_up_target_kind == "task_chain" and memory.last_follow_up_target_id:
                chain = service.get_task_chain(memory.last_follow_up_target_id)
                if chain is not None and self._looks_paused_validation_chain(chain):
                    return [], [chain]
        resumable_evals = [item for item in service.list_evaluation_sessions() if item.chat_id == chat_id and self._looks_paused_validation_session(item)]
        resumable_chains = [item for item in service.list_task_chains() if item.chat_id == chat_id and self._looks_paused_validation_chain(item)]
        return resumable_evals, resumable_chains

    @staticmethod
    def _looks_paused_validation_session(session: EvaluationSessionRecord) -> bool:
        if session.status not in {"stopped", "blocked"}:
            return False
        stop_reason = (session.stop_reason or "").lower()
        final_summary = (session.final_summary or "").lower()
        latest_summary = (session.latest_summary or "").lower()
        return any(token in " ".join((stop_reason, final_summary, latest_summary)) for token in ("pause", "paused", "blocked"))

    @staticmethod
    def _looks_paused_validation_chain(chain: TaskChainRecord) -> bool:
        if chain.status not in {"paused", "blocked"}:
            return False
        detail = " ".join((chain.pause_reason or "", chain.stop_reason or "", chain.final_summary or "", chain.latest_summary or "")).lower()
        return any(token in detail for token in ("pause", "paused", "blocked"))

    @staticmethod
    def _no_active_target_reply(*, action: str, memory: ProductionConversationMemory) -> str:
        if memory.last_meaningful_action_kind == "priority":
            return f"The last production change was a priority shift, not a paused task I can {action}."
        if memory.last_meaningful_action_kind == "assignment":
            return f"The last production change was a node reassignment, not a paused task I can {action}."
        if action == "resume":
            return "There is no paused validation or chain to resume right now."
        return "There is no active validation or chain to pause right now."

    def _infer_engine_family(self, *, service: ControllerService) -> str:
        repo_root = Path(service._config.repo_root) if service._config.repo_root.strip() else None
        if repo_root is not None and (repo_root / "ProjectSettings").exists():
            return "unity"
        return "unknown"

    def _infer_task_category(self, text: str) -> str:
        lowered = text.lower()
        if any(token in lowered for token in ("qa", "validate", "validation", "test", "playtest")):
            return "qa_validation"
        if any(token in lowered for token in ("build", "release", "package", "deploy")):
            return "build_release"
        if any(token in lowered for token in ("performance", "fps", "profile", "optimiz")):
            return "performance"
        if any(token in lowered for token in ("content", "asset", "import", "prefab")):
            return "content_pipeline"
        if any(token in lowered for token in ("audio", "sound", "music")):
            return "audio"
        if any(token in lowered for token in ("anim", "rig")):
            return "animation"
        if any(token in lowered for token in ("ui", "ux", "hud")):
            return "ui_ux"
        if any(token in lowered for token in ("ai", "npc", "behavior")):
            return "ai_behavior"
        if any(token in lowered for token in ("research", "model", "training")):
            return "research_modeling"
        if any(token in lowered for token in ("tool", "editor", "pipeline", "system")):
            return "systems_tools"
        return "gameplay"

    def _specialization_tags(self, *, node: NodeDescriptor, category: str) -> tuple[str, ...]:
        if node.role == "validator":
            return ("validation / QA", "build / integration")
        if category == "performance":
            return ("performance analysis", "systems / tools")
        if category == "content_pipeline":
            return ("content prep", "content pipeline")
        if category == "research_modeling":
            return ("model / research", "systems / tools")
        if category == "build_release":
            return ("build / integration", "validation / QA")
        return ("gameplay systems", "systems / tools")

    @staticmethod
    def _looks_like_validation(title: str, detail: str) -> bool:
        lowered = f"{title} {detail}".lower()
        return any(token in lowered for token in ("validation", "qa", "test", "playtest", "verify"))

    @staticmethod
    def _looks_like_build(title: str, detail: str) -> bool:
        lowered = f"{title} {detail}".lower()
        return any(token in lowered for token in ("build", "release", "package", "integration"))

    @staticmethod
    def _outcome(*, decision: ProductionIntentDecision, reply: str, routed_action: str) -> ProductionConversationOutcome:
        return ProductionConversationOutcome(
            matched=True,
            reply=reply,
            summary=reply.splitlines()[0] if reply else decision.rationale,
            routed_action=routed_action,
            intent=decision,
            telemetry={
                "production_intent": decision.to_payload(),
                "production_routed_action": routed_action,
            },
        )