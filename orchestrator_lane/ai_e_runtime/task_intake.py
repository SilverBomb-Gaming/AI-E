from __future__ import annotations

import hashlib
import os
import re
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Dict, List

from .autonomous_decision import DecisionRuntimeContext, evaluate_autonomous_decision
from .capability_intelligence import assess_capability_intelligence, assess_mutation_without_capability
from .capability_registry import CapabilityRegistry, RuntimeCapability
from .clarification_guidance import (
    clarification_options_for_prompt,
    clarification_options_for_session_followup,
)
from .content_policy import ensure_project_content_profile, evaluate_content_policy, load_project_content_profile
from .experiment_tracking import (
    EXPERIMENT_DECISION_RESOLUTION,
    EXPERIMENT_NAVIGATION_RESOLUTION,
    EXPERIMENT_REVIEW_RESOLUTION,
    build_experiment_navigation_preview,
    build_current_experiment_decisions,
    build_current_experiment_review,
    build_experiment_decision_preview,
    is_experiment_decision_prompt,
    is_experiment_decisions_prompt,
    is_experiment_navigation_prompt,
    is_experiment_review_prompt,
)
from .generic_capabilities import generic_capability_definition_for_capability_id
from .goal_composition import (
    GOAL_COMPOSITION_RESOLUTION,
    GoalCompositionResolution,
    resolve_goal_composition_prompt,
    unsupported_goal_composition_message,
)
from .goal_intent_mapping import (
    GOAL_INTENT_MAPPING_RESOLUTION,
    GoalIntentResolution,
    resolve_goal_intent_prompt,
    unsupported_goal_intent_message,
)
from .intent_normalizer import entity_confirmation_message, normalize_prompt, resolve_prompt
from .level_0001_entity_transform_mutation import (
    resolve_entity_transform_route,
    unsupported_entity_transform_prompt_message,
)
from .progress import phase_payload
from orchestrator.architecture_blueprint import ConversationalRequest
from orchestrator.config import OrchestratorConfig
from orchestrator.request_schema_loader import validate_request_payload
from orchestrator.utils import ensure_dir, read_json, write_json

from .planner import RuleBasedPlanner
from .planner_task_graph import build_plan_task_graph
from .predefined_plans import match_predefined_plan, unsupported_predefined_plan_message
from .session_tuning import (
    DIRECT_PROMPT_RESOLUTION,
    SESSION_FOLLOWUP_RESOLUTION,
    SessionFollowUpResolution,
    is_session_followup_prompt,
    resolve_session_followup_prompt,
)
from .state_store import StateStore
from .time_utils import get_current_timestamp


_DEFAULT_CHANNEL = "operator_console"
_DEFAULT_SESSION_ID = "operator_session"
_DEFAULT_TARGET_REPO_ENV_VAR = "AI_E_DEFAULT_TARGET_REPO"
_DEFAULT_REQUESTED_ARTIFACTS = [
    "request_analysis.json",
    "task_graph.json",
    "runtime_task.json",
]


@dataclass(frozen=True)
class IntakeArtifacts:
    request_payload_path: Path
    task_graph_path: Path

    runtime_task_payload_paths: List[Path]

    @property
    def runtime_task_payload_path(self) -> Path:
        return self.runtime_task_payload_paths[0]


@dataclass(frozen=True)
class IntakeRouting:
    requested_intent: str
    resolved_intent: str
    requested_execution_lane: str
    execution_lane: str
    downgraded: bool
    downgrade_reason: str | None
    approval_required: bool
    mutation_capable: bool
    capability_id: str | None = None
    capability_title: str | None = None
    generic_capability_definition: Dict[str, Any] | None = None
    handler_name: str | None = None
    agent_type: str | None = None
    target_level: str | None = None
    target_scene: str | None = None
    trust_score: int = 0
    trust_band: str | None = None
    policy_state: str | None = None
    execution_decision: str | None = None
    recommended_action: str | None = None
    sandbox_first_required: bool = False
    auto_execution_enabled: bool = False
    auto_execution_reason: str | None = None
    missing_evidence: List[str] | None = None
    intelligence_summary: str | None = None
    maturity_stage: str | None = None
    evidence_state: str | None = None
    eligible_for_auto: bool = False
    times_attempted: int = 0
    times_passed: int = 0
    last_validation_result: str | None = None
    last_rollback_result: str | None = None
    sandbox_verified: bool = False
    real_target_verified: bool = False
    rollback_verified: bool = False
    rating_system: str | None = None
    rating_target: str | None = None
    rating_locked: bool = False
    content_policy_match: str | None = None
    content_policy_decision: str | None = None
    required_rating_upgrade: str | None = None
    requested_content_dimensions: Dict[str, Any] | None = None
    content_policy_summary: str | None = None
    decision: str | None = None
    decision_reason: str | None = None
    decision_summary: str | None = None
    decision_auto_execute: bool = False
    decision_approval_required: bool = False
    decision_sandbox_first: bool = False
    decision_review_required: bool = False
    decision_blocked: bool = False
    content_policy_block: bool = False
    capability_supported: bool = False
    promotion_basis: str | None = None
    fail_closed_reason: str | None = None
    mapped_prompt: str | None = None
    entity_mapping_applied: bool = False
    entity_mapping_sources: List[str] | None = None
    confirmation_required: bool = False
    confirmation_message: str | None = None
    clarification_options: List[str] | None = None
    plan_key: str | None = None
    plan_title: str | None = None
    plan_step_titles: List[str] | None = None
    plan_step_prompts: List[str] | None = None
    plan_expected_outcome: str | None = None
    plan_execution_mode: str | None = None
    resolution_source: str | None = None
    resolved_from_prompt: str | None = None
    session_resolution_note: str | None = None
    goal_components: List[str] | None = None
    state_family: str | None = None
    previous_tier: str | None = None
    requested_tier: str | None = None
    revert_requested: bool = False
    revert_summary: str | None = None

    def to_payload(self) -> Dict[str, Any]:
        return {
            "requested_intent": self.requested_intent,
            "resolved_intent": self.resolved_intent,
            "requested_execution_lane": self.requested_execution_lane,
            "execution_lane": self.execution_lane,
            "downgraded": self.downgraded,
            "downgrade_reason": self.downgrade_reason,
            "approval_required": self.approval_required,
            "mutation_capable": self.mutation_capable,
            "capability_id": self.capability_id,
            "capability_title": self.capability_title,
            "generic_capability_definition": dict(self.generic_capability_definition or {}),
            "handler_name": self.handler_name,
            "agent_type": self.agent_type,
            "target_level": self.target_level,
            "target_scene": self.target_scene,
            "trust_score": self.trust_score,
            "trust_band": self.trust_band,
            "policy_state": self.policy_state,
            "execution_decision": self.execution_decision,
            "recommended_action": self.recommended_action,
            "sandbox_first_required": self.sandbox_first_required,
            "auto_execution_enabled": self.auto_execution_enabled,
            "auto_execution_reason": self.auto_execution_reason,
            "missing_evidence": list(self.missing_evidence or []),
            "intelligence_summary": self.intelligence_summary,
            "maturity_stage": self.maturity_stage or self.evidence_state,
            "evidence_state": self.evidence_state,
            "eligible_for_auto": self.eligible_for_auto,
            "times_attempted": self.times_attempted,
            "times_passed": self.times_passed,
            "last_validation_result": self.last_validation_result,
            "last_rollback_result": self.last_rollback_result,
            "sandbox_verified": self.sandbox_verified,
            "real_target_verified": self.real_target_verified,
            "rollback_verified": self.rollback_verified,
            "rating_system": self.rating_system,
            "rating_target": self.rating_target,
            "rating_locked": self.rating_locked,
            "content_policy_match": self.content_policy_match,
            "content_policy_decision": self.content_policy_decision,
            "required_rating_upgrade": self.required_rating_upgrade,
            "requested_content_dimensions": dict(self.requested_content_dimensions or {}),
            "content_policy_summary": self.content_policy_summary,
            "decision": self.decision,
            "decision_reason": self.decision_reason,
            "decision_summary": self.decision_summary,
            "decision_auto_execute": self.decision_auto_execute,
            "decision_approval_required": self.decision_approval_required,
            "decision_sandbox_first": self.decision_sandbox_first,
            "decision_review_required": self.decision_review_required,
            "decision_blocked": self.decision_blocked,
            "content_policy_block": self.content_policy_block,
            "capability_supported": self.capability_supported,
            "promotion_basis": self.promotion_basis,
            "fail_closed_reason": self.fail_closed_reason,
            "mapped_prompt": self.mapped_prompt,
            "entity_mapping_applied": self.entity_mapping_applied,
            "entity_mapping_sources": list(self.entity_mapping_sources or []),
            "confirmation_required": self.confirmation_required,
            "confirmation_message": self.confirmation_message,
            "clarification_options": list(self.clarification_options or []),
            "plan_key": self.plan_key,
            "plan_title": self.plan_title,
            "plan_step_titles": list(self.plan_step_titles or []),
            "plan_step_prompts": list(self.plan_step_prompts or []),
            "plan_expected_outcome": self.plan_expected_outcome,
            "plan_execution_mode": self.plan_execution_mode,
            "resolution_source": self.resolution_source,
            "resolved_from_prompt": self.resolved_from_prompt,
            "session_resolution_note": self.session_resolution_note,
            "goal_components": list(self.goal_components or []),
            "state_family": self.state_family,
            "previous_tier": self.previous_tier,
            "requested_tier": self.requested_tier,
            "revert_requested": self.revert_requested,
            "revert_summary": self.revert_summary,
        }


@dataclass(frozen=True)
class IntakeResult:
    task_id: str
    task_ids: List[str]
    request_id: str
    plan_id: str
    title: str
    task_type: str
    target_repo: str
    queue_entry: Dict[str, Any]
    queue_entries: List[Dict[str, Any]]
    artifacts: IntakeArtifacts
    created: bool
    plan_summary: str
    plan_step_titles: List[str]
    routing: IntakeRouting

    @property
    def is_multi_step(self) -> bool:
        return len(self.task_ids) > 1


class ConversationalTaskIntake:
    """Converts operator messages into deterministic, runnable queue tasks."""

    _TASK_REQUEST_VERBS = (
        "increase",
        "decrease",
        "reduce",
        "stabilize",
        "fix",
        "restore",
        "repair",
        "inspect",
        "audit",
        "review",
        "report",
        "expand",
        "improve",
        "make",
        "enable",
        "build",
        "create",
        "add",
        "investigate",
        "analyze",
        "validate",
        "check",
    )
    _PLAN_REQUEST_VERBS = (
        "plan",
        "outline",
        "decompose",
        "map out",
        "brainstorm",
    )
    _MUTATION_REQUEST_VERBS = (
        "increase",
        "decrease",
        "reduce",
        "stabilize",
        "fix",
        "restore",
        "repair",
        "expand",
        "improve",
        "make",
        "enable",
        "build",
        "create",
        "add",
        "generate",
        "place",
        "patch",
        "modify",
    )
    _WORLD_MUTATION_ACTION_HINTS = (
        "move",
        "reposition",
        "shift",
        "nudge",
        "translate",
        "faster",
        "slower",
        "remove",
        "delete",
        "clear",
    )
    _WORLD_MUTATION_DOMAIN_HINTS = (
        "level_0001",
        "babylon",
        "zombie",
        "runner",
        "encounter",
        "spawn",
        "spawner",
        "enemy",
        "character",
        "player",
        "weapon",
        "scene",
        "arena",
        "unity",
    )
    _WORLD_MUTATION_DIRECTION_HINTS = (
        "forward",
        "backward",
        "left",
        "right",
        "up",
        "down",
    )

    def __init__(self, config: OrchestratorConfig) -> None:
        self.config = config
        self.requests_dir = ensure_dir(self.config.contracts_dir / "intake" / "requests")
        self.task_graphs_dir = ensure_dir(self.config.contracts_dir / "intake" / "task_graphs")
        self.runtime_tasks_dir = ensure_dir(self.config.contracts_dir / "intake" / "runtime_tasks")
        ensure_project_content_profile(config)
        self.planner = RuleBasedPlanner()
        self.capability_registry = CapabilityRegistry(config)

    def accept_message(
        self,
        operator_message: str,
        *,
        session_id: str = _DEFAULT_SESSION_ID,
        channel: str = _DEFAULT_CHANNEL,
        target_repo: str | None = None,
        simulated_delay_seconds: float | None = None,
    ) -> IntakeResult:
        normalized_prompt = self._normalize_prompt(operator_message)
        if not normalized_prompt:
            raise ValueError("operator message must not be empty")

        self._record_session_progress(session_id, **phase_payload("intake"))
        resolved_target_repo = target_repo or self._derive_target_repo(normalized_prompt)
        routing = self._resolve_intake_routing(normalized_prompt, session_id=session_id, target_repo=resolved_target_repo)
        execution_prompt = self._execution_prompt_for_routing(normalized_prompt, routing=routing)
        self._record_session_progress(session_id, **phase_payload("policy_check"))
        task_type = self._derive_task_type(normalized_prompt, routing=routing)
        request_id = self._derive_request_id(normalized_prompt, resolved_target_repo, task_type)
        title = self._derive_title(normalized_prompt)
        request_payload = self._build_request_payload(
            normalized_prompt,
            request_id=request_id,
            session_id=session_id,
            channel=channel,
            target_repo=resolved_target_repo,
            task_type=task_type,
            routing=routing,
        )
        request = validate_request_payload(request_payload)
        plan = self.planner.plan(
            execution_prompt,
            target_repo=resolved_target_repo,
            request_id=request_id,
        )

        queue_payload = read_json(self.config.queue_path, default={"tasks": []})
        tasks = list(queue_payload.get("tasks", []))
        task_id_prefix = self._derive_task_id_prefix(request_id, tasks, multi_step=len(plan.steps) > 1)

        request_path = self.requests_dir / f"{request_id}.json"
        task_graph_path = self.task_graphs_dir / f"{request_id}.json"
        task_graph = build_plan_task_graph(plan, request_id=request_id, task_id_prefix=task_id_prefix)
        runtime_task_payload_paths: List[Path] = []

        request_wrapper = {"conversational_request": request.to_payload()}
        task_graph_wrapper = {"task_graph": task_graph.to_payload()}

        write_json(request_path, request_wrapper)
        write_json(task_graph_path, task_graph_wrapper)

        queue_entries: List[Dict[str, Any]] = []
        created = False
        single_step = len(task_graph.nodes) == 1
        initial_queue_status = "blocked" if routing.decision == "block" else (
            "needs_approval" if routing.decision in {"require_approval", "sandbox_first", "require_review"} and routing.execution_lane == "approval_required_mutation" else "pending"
        )
        initial_auto_execution_enabled = routing.auto_execution_enabled and routing.decision == "auto_execute"
        initial_approval_state = "blocked" if initial_queue_status == "blocked" else (
            "awaiting_approval" if initial_queue_status == "needs_approval" else ("auto_approved" if initial_auto_execution_enabled else "not_required")
        )
        waiting_reason = None
        blocked_reason = None
        if initial_queue_status == "needs_approval":
            waiting_reason = "Waiting for operator approval."
        elif initial_queue_status == "blocked":
            blocked_reason = routing.content_policy_summary or "Blocked before execution."
        self._record_session_progress(
            session_id,
            **phase_payload(
                "approval_auto_decision",
                waiting_reason=waiting_reason,
                blocked_reason=blocked_reason,
            ),
        )
        approved_by = "system_intelligence_v1" if initial_auto_execution_enabled else None
        approved_at = get_current_timestamp() if initial_auto_execution_enabled else None
        approval_notes = routing.auto_execution_reason if initial_auto_execution_enabled else ""
        for node in task_graph.nodes:
            step_prompt = str(getattr(node, "operator_prompt", "") or normalized_prompt).strip() or normalized_prompt
            preserve_request_resolution = str(routing.resolution_source or "") in {
                SESSION_FOLLOWUP_RESOLUTION,
                GOAL_INTENT_MAPPING_RESOLUTION,
                GOAL_COMPOSITION_RESOLUTION,
            }
            if len(task_graph.nodes) > 1 or (step_prompt != normalized_prompt and not preserve_request_resolution):
                step_routing = self._resolve_intake_routing(
                    step_prompt,
                    session_id=session_id,
                    target_repo=resolved_target_repo,
                )
                step_task_type = self._derive_task_type(step_prompt, routing=step_routing)
            else:
                step_routing = routing
                step_task_type = task_type
            if preserve_request_resolution and step_routing is not routing:
                step_routing = replace(
                    step_routing,
                    mapped_prompt=routing.mapped_prompt,
                    resolution_source=routing.resolution_source,
                    resolved_from_prompt=routing.resolved_from_prompt,
                    session_resolution_note=routing.session_resolution_note,
                    goal_components=list(routing.goal_components or []),
                    plan_key=routing.plan_key,
                    plan_title=routing.plan_title,
                    plan_step_titles=list(routing.plan_step_titles or []),
                    plan_step_prompts=list(routing.plan_step_prompts or []),
                    plan_expected_outcome=routing.plan_expected_outcome,
                    plan_execution_mode=routing.plan_execution_mode,
                )
            if routing.confirmation_required:
                confirmation_message = routing.confirmation_message or routing.decision_summary or "Confirmation is required before AI-E can continue."
                step_routing = replace(
                    step_routing,
                    execution_decision="blocked",
                    recommended_action=routing.recommended_action or "confirm_supported_target",
                    decision="block",
                    decision_reason="confirmation_required",
                    decision_summary=confirmation_message,
                    decision_blocked=True,
                    fail_closed_reason=confirmation_message,
                    mutation_capable=False,
                    approval_required=False,
                    sandbox_first_required=False,
                    auto_execution_enabled=False,
                    auto_execution_reason=None,
                    capability_supported=True,
                    confirmation_required=True,
                    confirmation_message=confirmation_message,
                    mapped_prompt=routing.mapped_prompt,
                    entity_mapping_applied=routing.entity_mapping_applied,
                    entity_mapping_sources=routing.entity_mapping_sources,
                    resolution_source=routing.resolution_source,
                    resolved_from_prompt=routing.resolved_from_prompt,
                    session_resolution_note=routing.session_resolution_note,
                    goal_components=routing.goal_components,
                    state_family=routing.state_family,
                    previous_tier=routing.previous_tier,
                    requested_tier=routing.requested_tier,
                    revert_requested=routing.revert_requested,
                    revert_summary=routing.revert_summary,
                )
            queue_status = "blocked" if step_routing.decision == "block" else (
                "needs_approval" if step_routing.decision in {"require_approval", "sandbox_first", "require_review"} and step_routing.execution_lane == "approval_required_mutation" else "pending"
            )
            auto_execution_enabled = step_routing.auto_execution_enabled and step_routing.decision == "auto_execute"
            approval_state = "blocked" if queue_status == "blocked" else (
                "awaiting_approval" if queue_status == "needs_approval" else ("auto_approved" if auto_execution_enabled else "not_required")
            )
            runtime_task_payload_path = self.runtime_tasks_dir / f"{node.task_id}.json"
            runtime_task_payload_paths.append(runtime_task_payload_path)
            runtime_task_wrapper = {
                "runtime_task": {
                    "task_id": node.task_id,
                    "request_id": request_id,
                    "plan_id": plan.plan_id,
                    "plan_key": routing.plan_key,
                    "plan_step_index": node.step_index,
                    "plan_step_title": node.title,
                    "plan_total_steps": len(plan.steps),
                    "plan_summary": plan.summary_text(),
                    "plan_title": plan.title,
                    "plan_expected_outcome": plan.expected_outcome,
                    "title": title if single_step else node.title,
                    "task_type": task_type if single_step else step_task_type,
                    "source_prompt": normalized_prompt,
                    "session_context_id": session_id,
                    "target_repo": resolved_target_repo,
                    "agent_type": step_routing.agent_type if step_routing.mutation_capable and step_routing.agent_type else "read_only_inspector_agent",
                    "execution_mode": step_routing.execution_lane if step_routing.requested_intent == "mutate" or step_routing.mutation_capable else node.execution_mode,
                    "requested_intent": step_routing.requested_intent,
                    "resolved_intent": step_routing.resolved_intent,
                    "requested_execution_lane": step_routing.requested_execution_lane,
                    "execution_lane": step_routing.execution_lane,
                    "downgraded": step_routing.downgraded,
                    "downgrade_reason": step_routing.downgrade_reason,
                    "approval_required": step_routing.approval_required,
                    "mutation_capable": step_routing.mutation_capable,
                    "capability_id": step_routing.capability_id,
                    "capability_title": step_routing.capability_title,
                    "generic_capability_definition": dict(step_routing.generic_capability_definition or {}),
                    "handler_name": step_routing.handler_name,
                    "maturity_stage": step_routing.maturity_stage or step_routing.evidence_state,
                    "trust_score": step_routing.trust_score,
                    "trust_band": step_routing.trust_band,
                    "policy_state": step_routing.policy_state,
                    "execution_decision": step_routing.execution_decision,
                    "recommended_action": step_routing.recommended_action,
                    "sandbox_first_required": step_routing.sandbox_first_required,
                    "auto_execution_enabled": step_routing.auto_execution_enabled,
                    "auto_execution_reason": step_routing.auto_execution_reason,
                    "missing_evidence": list(step_routing.missing_evidence or []),
                    "intelligence_summary": step_routing.intelligence_summary,
                    "evidence_state": step_routing.evidence_state,
                    "eligible_for_auto": step_routing.eligible_for_auto,
                    "times_attempted": step_routing.times_attempted,
                    "times_passed": step_routing.times_passed,
                    "last_validation_result": step_routing.last_validation_result,
                    "last_rollback_result": step_routing.last_rollback_result,
                    "sandbox_verified": step_routing.sandbox_verified,
                    "real_target_verified": step_routing.real_target_verified,
                    "rollback_verified": step_routing.rollback_verified,
                    "rating_system": step_routing.rating_system,
                    "rating_target": step_routing.rating_target,
                    "rating_locked": step_routing.rating_locked,
                    "content_policy_match": step_routing.content_policy_match,
                    "content_policy_decision": step_routing.content_policy_decision,
                    "required_rating_upgrade": step_routing.required_rating_upgrade,
                    "requested_content_dimensions": dict(step_routing.requested_content_dimensions or {}),
                    "content_policy_summary": step_routing.content_policy_summary,
                    "decision": step_routing.decision,
                    "decision_reason": step_routing.decision_reason,
                    "decision_summary": step_routing.decision_summary,
                    "decision_auto_execute": step_routing.decision_auto_execute,
                    "decision_approval_required": step_routing.decision_approval_required,
                    "decision_sandbox_first": step_routing.decision_sandbox_first,
                    "decision_review_required": step_routing.decision_review_required,
                    "decision_blocked": step_routing.decision_blocked,
                    "content_policy_block": step_routing.content_policy_block,
                    "capability_supported": step_routing.capability_supported,
                    "promotion_basis": step_routing.promotion_basis,
                    "fail_closed_reason": step_routing.fail_closed_reason,
                    "clarification_options": list(step_routing.clarification_options or []),
                    "approval_state": approval_state,
                    "approved_by": approved_by,
                    "approved_at": approved_at,
                    "approval_notes": approval_notes,
                    "target_level": step_routing.target_level,
                    "target_scene": step_routing.target_scene,
                    "resolution_source": step_routing.resolution_source or DIRECT_PROMPT_RESOLUTION,
                    "resolved_from_prompt": step_routing.resolved_from_prompt,
                    "session_resolution_note": step_routing.session_resolution_note,
                    "goal_components": list(step_routing.goal_components or []),
                    "state_family": step_routing.state_family,
                    "previous_tier": step_routing.previous_tier,
                    "requested_tier": step_routing.requested_tier,
                    "revert_requested": step_routing.revert_requested,
                    "revert_summary": step_routing.revert_summary,
                    "mapped_prompt": step_routing.mapped_prompt,
                    "capability_evidence_path": str(self.capability_registry.evidence_path),
                    "operator_prompt": step_prompt,
                    "created_at": get_current_timestamp(),
                    "requested_artifacts": list(_DEFAULT_REQUESTED_ARTIFACTS),
                    "task_graph_path": self._relative(task_graph_path),
                    "request_payload_path": self._relative(request_path),
                    "dependencies": list(node.dependencies),
                    "simulated_delay_seconds": self._resolve_simulated_delay_seconds(simulated_delay_seconds),
                }
            }
            write_json(runtime_task_payload_path, runtime_task_wrapper)

            queue_entry = self._build_queue_entry(
                task_id=node.task_id,
                request=request,
                title=title if single_step else node.title,
                task_type=task_type if single_step else step_task_type,
                target_repo=resolved_target_repo,
                runtime_task_payload_path=runtime_task_payload_path,
                request_path=request_path,
                task_graph_path=task_graph_path,
                plan_id=plan.plan_id,
                plan_step_index=node.step_index,
                plan_total_steps=len(plan.steps),
                plan_step_title=node.title,
                dependencies=node.dependencies,
                priority=self._derive_priority(task_type, request.operator_prompt) if single_step else node.priority,
                routing=step_routing,
                status=queue_status,
            )

            existing = self._find_existing_task(tasks, node.task_id)
            if existing is None:
                tasks.append(queue_entry)
                queue_entries.append(queue_entry)
                created = True
            else:
                queue_entries.append(dict(existing))

        queue_payload["tasks"] = tasks
        write_json(self.config.queue_path, queue_payload)
        self._register_plan_state(
            session_id=session_id,
            plan_id=plan.plan_id,
            plan_summary=plan.summary_text(),
            plan_steps=plan.plan_step_titles(),
        )

        return IntakeResult(
            task_id=queue_entries[0]["task_id"],
            task_ids=[entry["task_id"] for entry in queue_entries],
            request_id=request_id,
            plan_id=plan.plan_id,
            title=title,
            task_type=task_type,
            target_repo=resolved_target_repo,
            queue_entry=queue_entries[0],
            queue_entries=queue_entries,
            artifacts=IntakeArtifacts(
                request_payload_path=request_path,
                task_graph_path=task_graph_path,
                runtime_task_payload_paths=runtime_task_payload_paths,
            ),
            created=created,
            plan_summary=plan.summary_text(),
            plan_step_titles=plan.plan_step_titles(),
            routing=routing,
        )

    def classify_message(self, operator_message: str) -> str:
        raw_message = str(operator_message or "").strip()
        if not raw_message:
            return "empty"
        if raw_message.endswith("?"):
            return "not_task_request"
        normalized = self._normalize_prompt(raw_message).lower()
        if not normalized:
            return "not_task_request"
        if is_experiment_decision_prompt(normalized) or is_experiment_decisions_prompt(normalized):
            return "task_request"
        if is_experiment_review_prompt(normalized):
            return "task_request"
        if is_experiment_navigation_prompt(normalized):
            return "task_request"
        if is_session_followup_prompt(normalized):
            return "task_request"
        if normalized.startswith(self._TASK_REQUEST_VERBS):
            return "task_request"
        lookup_prompt = resolve_prompt(normalized).lookup_prompt
        if match_predefined_plan(lookup_prompt) is not None:
            return "task_request"
        if self._looks_like_world_mutation_request(lookup_prompt):
            return "task_request"
        if any(
            token in lookup_prompt
            for token in (
                "level_0001",
                "zombie",
                "runner",
                "encounter",
                "spawn",
                "spawner",
                "racer",
                "platformer",
                "jump",
                "gravity",
                "monkee",
                "enemy",
                "character",
                "kbm",
                "weapon",
                "babylon",
                "unity",
            )
        ):
            return "task_request"
        return "not_task_request"

    def _build_request_payload(
        self,
        normalized_prompt: str,
        *,
        request_id: str,
        session_id: str,
        channel: str,
        target_repo: str,
        task_type: str,
        routing: IntakeRouting,
    ) -> Dict[str, Any]:
        return {
            "request_id": request_id,
            "session_id": session_id,
            "channel": channel,
            "operator_prompt": normalized_prompt,
            "created_at": get_current_timestamp(),
            "intent": task_type,
            "clarification_needed": routing.confirmation_required,
            "context": {
                "target_repo": target_repo,
                "execution_mode": routing.execution_lane if routing.requested_intent == "mutate" or routing.mutation_capable else "bounded_read_only",
                "source": "ai_e_runtime.task_intake",
                "resolved_execution_prompt": self._execution_prompt_for_routing(normalized_prompt, routing=routing),
                "routing": routing.to_payload(),
            },
            "constraints": [
                "Preserve deterministic queue behavior.",
                "Remain bounded to the declared execution lane.",
                "Do not mutate outside the capability scope when mutation is enabled.",
            ],
            "requested_artifacts": list(_DEFAULT_REQUESTED_ARTIFACTS),
        }

    def _build_queue_entry(
        self,
        *,
        task_id: str,
        request: ConversationalRequest,
        title: str,
        task_type: str,
        target_repo: str,
        runtime_task_payload_path: Path,
        request_path: Path,
        task_graph_path: Path,
        plan_id: str,
        plan_step_index: int,
        plan_total_steps: int,
        plan_step_title: str,
        dependencies: List[str],
        priority: int,
        routing: IntakeRouting,
        status: str,
    ) -> Dict[str, Any]:
        return {
            "id": task_id,
            "task_id": task_id,
            "title": title,
            "task_type": task_type,
            "status": status,
            "priority": priority,
            "target_repo": target_repo,
            "agent_type": routing.agent_type if routing.mutation_capable and routing.agent_type else "read_only_inspector_agent",
            "agents": [
                routing.agent_type if routing.mutation_capable and routing.agent_type else "read_only_inspector_agent",
                "validator_agent",
                "artifact_summarizer_agent",
            ],
            "contract_path": self._relative(runtime_task_payload_path),
            "request_payload_path": self._relative(request_path),
            "task_graph_path": self._relative(task_graph_path),
            "request_id": request.request_id,
            "source_prompt": request.operator_prompt,
            "request_fingerprint": self._prompt_fingerprint(request.operator_prompt, target_repo, task_type),
            "execution_mode": routing.execution_lane if routing.requested_intent == "mutate" or routing.mutation_capable else "bounded_read_only",
            "requested_intent": routing.requested_intent,
            "resolved_intent": routing.resolved_intent,
            "requested_execution_lane": routing.requested_execution_lane,
            "execution_lane": routing.execution_lane,
            "downgraded": routing.downgraded,
            "downgrade_reason": routing.downgrade_reason,
            "approval_required": routing.approval_required,
            "mutation_capable": routing.mutation_capable,
            "capability_id": routing.capability_id,
            "capability_title": routing.capability_title,
            "generic_capability_definition": dict(routing.generic_capability_definition or {}),
            "handler_name": routing.handler_name,
            "trust_score": routing.trust_score,
            "trust_band": routing.trust_band,
            "policy_state": routing.policy_state,
            "execution_decision": routing.execution_decision,
            "recommended_action": routing.recommended_action,
            "sandbox_first_required": routing.sandbox_first_required,
            "auto_execution_enabled": routing.auto_execution_enabled,
            "auto_execution_reason": routing.auto_execution_reason,
            "missing_evidence": list(routing.missing_evidence or []),
            "intelligence_summary": routing.intelligence_summary,
            "maturity_stage": routing.maturity_stage or routing.evidence_state,
            "evidence_state": routing.evidence_state,
            "eligible_for_auto": routing.eligible_for_auto,
            "times_attempted": routing.times_attempted,
            "times_passed": routing.times_passed,
            "last_validation_result": routing.last_validation_result,
            "last_rollback_result": routing.last_rollback_result,
            "sandbox_verified": routing.sandbox_verified,
            "real_target_verified": routing.real_target_verified,
            "rollback_verified": routing.rollback_verified,
            "rating_system": routing.rating_system,
            "rating_target": routing.rating_target,
            "rating_locked": routing.rating_locked,
            "content_policy_match": routing.content_policy_match,
            "content_policy_decision": routing.content_policy_decision,
            "required_rating_upgrade": routing.required_rating_upgrade,
            "requested_content_dimensions": dict(routing.requested_content_dimensions or {}),
            "content_policy_summary": routing.content_policy_summary,
            "decision": routing.decision,
            "decision_reason": routing.decision_reason,
            "decision_summary": routing.decision_summary,
            "decision_auto_execute": routing.decision_auto_execute,
            "decision_approval_required": routing.decision_approval_required,
            "decision_sandbox_first": routing.decision_sandbox_first,
            "decision_review_required": routing.decision_review_required,
            "decision_blocked": routing.decision_blocked,
            "content_policy_block": routing.content_policy_block,
            "capability_supported": routing.capability_supported,
            "promotion_basis": routing.promotion_basis,
            "fail_closed_reason": routing.fail_closed_reason,
            "clarification_options": list(routing.clarification_options or []),
            "approval_state": "blocked" if status == "blocked" else ("awaiting_approval" if status == "needs_approval" else ("auto_approved" if routing.auto_execution_enabled and routing.decision == "auto_execute" else "not_required")),
            "approved_by": "system_intelligence_v1" if routing.auto_execution_enabled and routing.decision == "auto_execute" else None,
            "approved_at": get_current_timestamp() if routing.auto_execution_enabled and routing.decision == "auto_execute" else None,
            "approval_notes": routing.auto_execution_reason or "" if routing.auto_execution_enabled and routing.decision == "auto_execute" else "",
            "plan_id": plan_id,
            "plan_step_index": plan_step_index,
            "plan_total_steps": plan_total_steps,
            "plan_step_title": plan_step_title,
            "dependencies": list(dependencies),
            "retry_count": 0,
            "current_session_id": None,
            "last_error": "",
        }

    def _derive_request_id(self, prompt: str, target_repo: str, task_type: str) -> str:
        digest = self._prompt_fingerprint(prompt, target_repo, task_type)[:12].upper()
        return f"REQ_{digest}"

    def _derive_task_id_prefix(self, request_id: str, tasks: List[Dict[str, Any]], *, multi_step: bool) -> str:
        base = f"INTAKE_{request_id.split('_', 1)[1]}"
        existing_ids = {
            str(task.get("task_id") or task.get("id") or "")
            for task in tasks
        }
        if not multi_step and base not in existing_ids:
            return base
        prefix_matches = {task_id for task_id in existing_ids if task_id == base or task_id.startswith(base + "__")}
        if not prefix_matches:
            return base
        index = 1
        while True:
            candidate = f"{base}__RERUN_{index:02d}"
            if not any(task_id == candidate or task_id.startswith(candidate + "__") for task_id in existing_ids):
                return candidate
            index += 1

    def _derive_title(self, prompt: str) -> str:
        text = re.sub(r"\s+", " ", prompt).strip()
        if len(text) <= 88:
            return text[0].upper() + text[1:]
        return text[:85].rstrip() + "..."

    def _derive_target_repo(self, prompt: str) -> str:
        lower = resolve_prompt(prompt).lookup_prompt.lower()
        babylon_markers = (
            "level_0001",
            "babylon",
            "zombie",
            "runner",
            "encounter",
            "spawn",
            "spawner",
            "enemy",
            "character",
            "kbm",
            "weapon",
            "unity",
        )
        if any(token in lower for token in babylon_markers):
            return resolve_default_target_repo(self.config, prompt=prompt)
        return str(self.config.root_dir).replace("\\", "/")

    def _derive_task_type(self, prompt: str, *, routing: IntakeRouting | None = None) -> str:
        if routing is not None and str(routing.resolution_source or "") in {
            EXPERIMENT_REVIEW_RESOLUTION,
            EXPERIMENT_DECISION_RESOLUTION,
            EXPERIMENT_NAVIGATION_RESOLUTION,
        }:
            return "experiment_review_request"
        if routing is not None and routing.plan_key:
            return "mutation_plan_request"
        if routing is not None and routing.mutation_capable:
            return "mutation_request"
        if routing is not None and routing.requested_intent == "mutate" and routing.resolved_intent == "mutate":
            return "mutation_request"
        lower = prompt.lower()
        if any(token in lower for token in ("stabilize", "fix", "restore", "repair")):
            return "stabilization_request"
        if any(token in lower for token in ("inspect", "audit", "review", "report")):
            return "read_only_inspection_request"
        if any(token in lower for token in ("expand", "improve", "make", "enable")):
            return "bounded_activation_request"
        return "general_request"

    def _resolve_intake_routing(self, prompt: str, *, session_id: str, target_repo: str | None = None) -> IntakeRouting:
        resolution = resolve_prompt(prompt)
        normalized = resolution.normalized_prompt.lower()
        lookup_prompt = resolution.lookup_prompt.lower()
        mapping_sources = [mapping.source_term for mapping in resolution.applied_entity_mappings]
        session_state = self._load_session_followup_state(session_id)
        if is_experiment_navigation_prompt(normalized):
            navigation_preview = build_experiment_navigation_preview(normalized, session_state) or {}
            overview = str(navigation_preview.get("overview") or "").strip()
            plan_title = str(navigation_preview.get("title") or "Experiment navigation").strip()
            plan_steps = [
                str(item).strip()
                for item in (navigation_preview.get("lines") or [])
                if str(item).strip()
            ]
            decision_reason = str(navigation_preview.get("decision_reason") or "experiment_navigation").strip()
            blocked = bool(navigation_preview.get("blocked"))
            return IntakeRouting(
                requested_intent="inspect",
                resolved_intent="inspect",
                requested_execution_lane="read_only_inspection",
                execution_lane="read_only_inspection",
                downgraded=False,
                downgrade_reason=None,
                approval_required=False,
                mutation_capable=False,
                intelligence_summary=overview,
                decision="block",
                decision_reason=decision_reason,
                decision_summary=overview,
                decision_blocked=blocked,
                mapped_prompt=lookup_prompt,
                entity_mapping_applied=resolution.entity_mapping_applied,
                entity_mapping_sources=mapping_sources,
                recommended_action=str(navigation_preview.get("recommended_action") or "refresh_summary").strip(),
                clarification_options=[
                    str(item).strip()
                    for item in (navigation_preview.get("clarification_options") or [])
                    if str(item).strip()
                ],
                plan_title=plan_title,
                plan_step_titles=plan_steps,
                plan_expected_outcome=str(navigation_preview.get("expected_outcome") or "Review only. No execution will start.").strip(),
                plan_execution_mode=str(navigation_preview.get("plan_execution_mode") or "Explicit experiment navigation").strip(),
                resolution_source=EXPERIMENT_NAVIGATION_RESOLUTION,
                resolved_from_prompt=normalized,
                session_resolution_note=overview,
                fail_closed_reason=overview if blocked else None,
            )
        if is_experiment_decision_prompt(normalized):
            decision_preview, review_block_message = build_experiment_decision_preview(normalized, session_state)
            if review_block_message is not None:
                return IntakeRouting(
                    requested_intent="inspect",
                    resolved_intent="inspect",
                    requested_execution_lane="read_only_inspection",
                    execution_lane="read_only_inspection",
                    downgraded=False,
                    downgrade_reason=None,
                    approval_required=False,
                    mutation_capable=False,
                    intelligence_summary=review_block_message,
                    decision="block",
                    decision_reason="no_active_experiment",
                    decision_summary=review_block_message,
                    decision_blocked=True,
                    mapped_prompt=lookup_prompt,
                    entity_mapping_applied=resolution.entity_mapping_applied,
                    entity_mapping_sources=mapping_sources,
                    plan_title="Experiment decision",
                    plan_step_titles=[],
                    plan_expected_outcome="Review only. No execution will start.",
                    plan_execution_mode="Current session decision update",
                    resolution_source=EXPERIMENT_DECISION_RESOLUTION,
                    resolved_from_prompt=normalized,
                    session_resolution_note=review_block_message,
                    fail_closed_reason=review_block_message,
                )
            decision_preview = decision_preview or {}
            overview = str(decision_preview.get("overview") or "").strip()
            return IntakeRouting(
                requested_intent="inspect",
                resolved_intent="inspect",
                requested_execution_lane="read_only_inspection",
                execution_lane="read_only_inspection",
                downgraded=False,
                downgrade_reason=None,
                approval_required=False,
                mutation_capable=False,
                intelligence_summary=overview,
                decision="block",
                decision_reason="experiment_decision_update",
                decision_summary=overview,
                mapped_prompt=lookup_prompt,
                entity_mapping_applied=resolution.entity_mapping_applied,
                entity_mapping_sources=mapping_sources,
                recommended_action="record_experiment_decision",
                plan_title=str(decision_preview.get("title") or "Experiment decision").strip(),
                plan_step_titles=[
                    str(item).strip()
                    for item in (decision_preview.get("variant_lines") or [])
                    if str(item).strip()
                ],
                plan_expected_outcome="Review only. No execution will start.",
                plan_execution_mode="Current session decision update",
                resolution_source=EXPERIMENT_DECISION_RESOLUTION,
                resolved_from_prompt=normalized,
                session_resolution_note=overview,
            )
        if is_experiment_decisions_prompt(normalized):
            experiment_review, review_block_message = build_current_experiment_decisions(session_state)
            if review_block_message is not None:
                return IntakeRouting(
                    requested_intent="inspect",
                    resolved_intent="inspect",
                    requested_execution_lane="read_only_inspection",
                    execution_lane="read_only_inspection",
                    downgraded=False,
                    downgrade_reason=None,
                    approval_required=False,
                    mutation_capable=False,
                    intelligence_summary=review_block_message,
                    decision="block",
                    decision_reason="no_active_experiment",
                    decision_summary=review_block_message,
                    decision_blocked=True,
                    mapped_prompt=lookup_prompt,
                    entity_mapping_applied=resolution.entity_mapping_applied,
                    entity_mapping_sources=mapping_sources,
                    plan_title="Current experiment decisions",
                    plan_step_titles=[],
                    plan_expected_outcome="Review only. No execution will start.",
                    plan_execution_mode="Current session summary",
                    resolution_source=EXPERIMENT_DECISION_RESOLUTION,
                    resolved_from_prompt=normalized,
                    session_resolution_note=review_block_message,
                    fail_closed_reason=review_block_message,
                )
            experiment_review = experiment_review or {}
            overview = str(experiment_review.get("overview") or "").strip()
            return IntakeRouting(
                requested_intent="inspect",
                resolved_intent="inspect",
                requested_execution_lane="read_only_inspection",
                execution_lane="read_only_inspection",
                downgraded=False,
                downgrade_reason=None,
                approval_required=False,
                mutation_capable=False,
                intelligence_summary=overview,
                decision="block",
                decision_reason="experiment_decision_summary",
                decision_summary=overview,
                mapped_prompt=lookup_prompt,
                entity_mapping_applied=resolution.entity_mapping_applied,
                entity_mapping_sources=mapping_sources,
                recommended_action="refresh_summary",
                plan_title="Current experiment decisions",
                plan_step_titles=[
                    str(item).strip()
                    for item in (experiment_review.get("variant_lines") or [])
                    if str(item).strip()
                ],
                plan_expected_outcome="Review only. No execution will start.",
                plan_execution_mode="Current session summary",
                resolution_source=EXPERIMENT_DECISION_RESOLUTION,
                resolved_from_prompt=normalized,
                session_resolution_note=overview,
            )
        if is_experiment_review_prompt(normalized):
            experiment_review, review_block_message = build_current_experiment_review(session_state)
            if review_block_message is not None:
                return IntakeRouting(
                    requested_intent="inspect",
                    resolved_intent="inspect",
                    requested_execution_lane="read_only_inspection",
                    execution_lane="read_only_inspection",
                    downgraded=False,
                    downgrade_reason=None,
                    approval_required=False,
                    mutation_capable=False,
                    intelligence_summary=review_block_message,
                    decision="block",
                    decision_reason="no_active_experiment",
                    decision_summary=review_block_message,
                    decision_blocked=True,
                    fail_closed_reason=review_block_message,
                    mapped_prompt=lookup_prompt,
                    entity_mapping_applied=resolution.entity_mapping_applied,
                    entity_mapping_sources=mapping_sources,
                    plan_title="Current experiment variants",
                    plan_step_titles=[],
                    plan_expected_outcome="Review only. No execution will start.",
                    plan_execution_mode="Current session summary",
                    resolution_source=EXPERIMENT_REVIEW_RESOLUTION,
                    resolved_from_prompt=normalized,
                    session_resolution_note=review_block_message,
                )
            experiment_review = experiment_review or {}
            overview = str(experiment_review.get("overview") or "").strip()
            return IntakeRouting(
                requested_intent="inspect",
                resolved_intent="inspect",
                requested_execution_lane="read_only_inspection",
                execution_lane="read_only_inspection",
                downgraded=False,
                downgrade_reason=None,
                approval_required=False,
                mutation_capable=False,
                intelligence_summary=overview,
                decision="block",
                decision_reason="experiment_review",
                decision_summary=overview,
                mapped_prompt=lookup_prompt,
                entity_mapping_applied=resolution.entity_mapping_applied,
                entity_mapping_sources=mapping_sources,
                recommended_action="refresh_summary",
                plan_title="Current experiment variants",
                plan_step_titles=[
                    str(item).strip()
                    for item in (experiment_review.get("variant_lines") or [])
                    if str(item).strip()
                ],
                plan_expected_outcome="Review only. No execution will start.",
                plan_execution_mode="Current session summary",
                resolution_source=EXPERIMENT_REVIEW_RESOLUTION,
                resolved_from_prompt=normalized,
                session_resolution_note=overview,
            )
        followup_resolution, followup_block_message = resolve_session_followup_prompt(
            normalized,
            session_state=session_state,
        )
        if followup_block_message is not None:
            return self._blocked_mutation_route_routing(
                requested_execution_lane="approval_required_mutation",
                session_id=session_id,
                route_issue=followup_block_message,
                mapped_prompt=lookup_prompt,
                entity_mapping_applied=resolution.entity_mapping_applied,
                entity_mapping_sources=mapping_sources,
                clarification_options=clarification_options_for_session_followup(
                    normalized,
                    session_state=session_state,
                ),
            )
        effective_lookup_prompt = (
            followup_resolution.canonical_prompt.lower().strip()
            if followup_resolution is not None
            else lookup_prompt
        )
        goal_intent_resolution = resolve_goal_intent_prompt(effective_lookup_prompt)
        if goal_intent_resolution is not None:
            effective_lookup_prompt = goal_intent_resolution.canonical_prompt.lower().strip()
        goal_composition_resolution = None
        goal_composition_block_message = None
        if goal_intent_resolution is None:
            goal_composition_resolution = resolve_goal_composition_prompt(effective_lookup_prompt)
            if goal_composition_resolution is not None:
                effective_lookup_prompt = goal_composition_resolution.canonical_prompt.lower().strip()
            else:
                goal_composition_block_message = unsupported_goal_composition_message(effective_lookup_prompt)
        requested_intent = self._classify_requested_intent(effective_lookup_prompt)
        requested_execution_lane = self._requested_lane_for_intent(requested_intent)
        if goal_composition_block_message is not None and requested_intent == "mutate":
            return self._blocked_mutation_route_routing(
                requested_execution_lane=requested_execution_lane,
                session_id=session_id,
                route_issue=goal_composition_block_message,
                mapped_prompt=effective_lookup_prompt,
                entity_mapping_applied=resolution.entity_mapping_applied,
                entity_mapping_sources=mapping_sources,
                clarification_options=clarification_options_for_prompt(lookup_prompt),
            )
        predefined_plan = match_predefined_plan(effective_lookup_prompt)
        if predefined_plan is not None:
            step_capabilities: List[RuntimeCapability] = []
            step_titles = [step.title for step in predefined_plan.steps]
            step_prompts = [step.operator_prompt for step in predefined_plan.steps]
            for step in predefined_plan.steps:
                capability = self.capability_registry.match(step.operator_prompt)
                if capability is None:
                    return self._blocked_mutation_route_routing(
                        requested_execution_lane=requested_execution_lane,
                        session_id=session_id,
                        route_issue=(
                            f"AI-E could not build the '{predefined_plan.title}' plan because "
                            f"step {step.step_index} '{step.title}' is not supported yet."
                        ),
                        mapped_prompt=predefined_plan.canonical_prompt,
                        entity_mapping_applied=resolution.entity_mapping_applied,
                        entity_mapping_sources=mapping_sources,
                        clarification_options=clarification_options_for_prompt(lookup_prompt),
                    )
                preflight_issue = self._resolve_mutation_route_issue(
                    prompt=step.operator_prompt,
                    capability=capability,
                    target_repo=target_repo,
                )
                if preflight_issue is not None:
                    return self._blocked_mutation_route_routing(
                        requested_execution_lane=requested_execution_lane,
                        session_id=session_id,
                        route_issue=(
                            f"AI-E could not build the '{predefined_plan.title}' plan because "
                            f"step {step.step_index} '{step.title}' is unavailable: {preflight_issue}"
                        ),
                        mapped_prompt=predefined_plan.canonical_prompt,
                        entity_mapping_applied=resolution.entity_mapping_applied,
                        entity_mapping_sources=mapping_sources,
                        clarification_options=clarification_options_for_prompt(lookup_prompt),
                    )
                step_capabilities.append(capability)

            primary_capability = step_capabilities[0]
            routing = replace(
                self._routing_for_capability(primary_capability),
                capability_title=predefined_plan.title,
                mapped_prompt=predefined_plan.canonical_prompt,
                plan_key=predefined_plan.plan_key,
                plan_title=predefined_plan.title,
                plan_step_titles=step_titles,
                plan_step_prompts=step_prompts,
                plan_expected_outcome=predefined_plan.expected_outcome,
                plan_execution_mode=predefined_plan.execution_mode_label,
                intelligence_summary=predefined_plan.expected_outcome,
                entity_mapping_applied=resolution.entity_mapping_applied,
                entity_mapping_sources=mapping_sources,
            )
            routing = self._apply_resolution_metadata(
                routing,
                followup_resolution=followup_resolution,
                goal_intent_resolution=goal_intent_resolution,
                goal_composition_resolution=goal_composition_resolution,
                mapped_prompt=predefined_plan.canonical_prompt,
            )
            routing = self._apply_content_policy(
                prompt=effective_lookup_prompt,
                routing=routing,
                capability=primary_capability,
                session_id=session_id,
            )
            routing = replace(
                routing,
                decision_summary=(
                    (
                        (str(routing.session_resolution_note or "").strip() + " ")
                        if str(routing.resolution_source or "") in {
                            SESSION_FOLLOWUP_RESOLUTION,
                            GOAL_INTENT_MAPPING_RESOLUTION,
                            GOAL_COMPOSITION_RESOLUTION,
                        }
                        else ""
                    )
                    + f"{predefined_plan.title} will run {len(step_titles)} bounded step(s) in "
                    f"{predefined_plan.execution_mode_label.lower()}: "
                    + " ".join(f"{index + 1}. {title}." for index, title in enumerate(step_titles))
                    + f" Expected outcome: {predefined_plan.expected_outcome}"
                ),
            )
            confirmation_message = entity_confirmation_message(resolution)
            if confirmation_message:
                return replace(
                    routing,
                    execution_decision="blocked",
                    recommended_action="confirm_plan",
                    decision="block",
                    decision_reason="confirmation_required",
                    decision_summary=confirmation_message,
                    decision_blocked=True,
                    fail_closed_reason=confirmation_message,
                    mutation_capable=False,
                    approval_required=False,
                    sandbox_first_required=False,
                    auto_execution_enabled=False,
                    auto_execution_reason=None,
                    capability_supported=True,
                    confirmation_required=True,
                    confirmation_message=confirmation_message,
                    mapped_prompt=predefined_plan.canonical_prompt,
                )
            return routing
        capability = self.capability_registry.match(effective_lookup_prompt)
        if capability is not None:
            preflight_issue = self._resolve_mutation_route_issue(
                prompt=effective_lookup_prompt,
                capability=capability,
                target_repo=target_repo,
            )
            if preflight_issue is not None:
                return self._blocked_mutation_route_routing(
                    requested_execution_lane=requested_execution_lane,
                    session_id=session_id,
                    route_issue=preflight_issue,
                    mapped_prompt=effective_lookup_prompt,
                    entity_mapping_applied=resolution.entity_mapping_applied,
                    entity_mapping_sources=mapping_sources,
                    clarification_options=clarification_options_for_prompt(lookup_prompt),
                )
            routing = replace(
                self._routing_for_capability(capability),
                mapped_prompt=effective_lookup_prompt,
                entity_mapping_applied=resolution.entity_mapping_applied,
                entity_mapping_sources=mapping_sources,
            )
            routing = self._apply_resolution_metadata(
                routing,
                followup_resolution=followup_resolution,
                goal_intent_resolution=goal_intent_resolution,
                goal_composition_resolution=goal_composition_resolution,
                mapped_prompt=effective_lookup_prompt,
            )
            confirmation_message = entity_confirmation_message(resolution)
            if confirmation_message:
                return replace(
                    routing,
                    execution_decision="blocked",
                    recommended_action="confirm_supported_target",
                    decision="block",
                    decision_reason="confirmation_required",
                    decision_summary=confirmation_message,
                    decision_blocked=True,
                    fail_closed_reason=confirmation_message,
                    mutation_capable=False,
                    approval_required=False,
                    sandbox_first_required=False,
                    auto_execution_enabled=False,
                    auto_execution_reason=None,
                    capability_supported=True,
                    confirmation_required=True,
                    confirmation_message=confirmation_message,
                )
            routing = self._apply_content_policy(
                prompt=effective_lookup_prompt,
                routing=routing,
                capability=capability,
                session_id=session_id,
            )
            if (
                str(routing.resolution_source or "") in {
                    SESSION_FOLLOWUP_RESOLUTION,
                    GOAL_INTENT_MAPPING_RESOLUTION,
                    GOAL_COMPOSITION_RESOLUTION,
                }
                and routing.session_resolution_note
            ):
                return replace(
                    routing,
                    decision_summary=f"{routing.session_resolution_note} {routing.decision_summary or ''}".strip(),
                )
            return routing
        if requested_intent == "mutate":
            if goal_composition_block_message is not None:
                return self._blocked_mutation_route_routing(
                    requested_execution_lane=requested_execution_lane,
                    session_id=session_id,
                    route_issue=goal_composition_block_message,
                    mapped_prompt=effective_lookup_prompt,
                    entity_mapping_applied=resolution.entity_mapping_applied,
                    entity_mapping_sources=mapping_sources,
                    clarification_options=clarification_options_for_prompt(lookup_prompt),
                )
            goal_block_message = unsupported_goal_intent_message(lookup_prompt)
            if goal_block_message is not None:
                return self._blocked_mutation_route_routing(
                    requested_execution_lane=requested_execution_lane,
                    session_id=session_id,
                    route_issue=goal_block_message,
                    mapped_prompt=effective_lookup_prompt,
                    entity_mapping_applied=resolution.entity_mapping_applied,
                    entity_mapping_sources=mapping_sources,
                    clarification_options=clarification_options_for_prompt(lookup_prompt),
                )
            unsupported_plan_message = unsupported_predefined_plan_message(effective_lookup_prompt)
            if unsupported_plan_message is not None:
                return self._blocked_mutation_route_routing(
                    requested_execution_lane=requested_execution_lane,
                    session_id=session_id,
                    route_issue=unsupported_plan_message,
                    mapped_prompt=effective_lookup_prompt,
                    entity_mapping_applied=resolution.entity_mapping_applied,
                    entity_mapping_sources=mapping_sources,
                    clarification_options=clarification_options_for_prompt(lookup_prompt),
                )
            unsupported_message = unsupported_entity_transform_prompt_message(effective_lookup_prompt)
            if unsupported_message is not None:
                return self._blocked_mutation_route_routing(
                    requested_execution_lane=requested_execution_lane,
                    session_id=session_id,
                    route_issue=unsupported_message,
                    mapped_prompt=effective_lookup_prompt,
                    entity_mapping_applied=resolution.entity_mapping_applied,
                    entity_mapping_sources=mapping_sources,
                    clarification_options=clarification_options_for_prompt(lookup_prompt),
                )
            intelligence = assess_mutation_without_capability()
            routing = self._apply_content_policy(prompt=effective_lookup_prompt, routing=IntakeRouting(
                requested_intent="mutate",
                resolved_intent="mutate",
                requested_execution_lane=requested_execution_lane,
                execution_lane=requested_execution_lane,
                downgraded=False,
                downgrade_reason=None,
                approval_required=False,
                mutation_capable=False,
                trust_score=intelligence.trust_score,
                trust_band=intelligence.trust_band,
                policy_state=intelligence.policy_state,
                execution_decision=intelligence.execution_decision,
                recommended_action=intelligence.recommended_action,
                sandbox_first_required=intelligence.sandbox_first_required,
                auto_execution_enabled=intelligence.auto_execution_enabled,
                auto_execution_reason=intelligence.auto_execution_reason,
                missing_evidence=list(intelligence.missing_evidence),
                intelligence_summary=intelligence.summary,
                mapped_prompt=effective_lookup_prompt,
                entity_mapping_applied=resolution.entity_mapping_applied,
                entity_mapping_sources=mapping_sources,
            ), session_id=session_id)
            routing = self._apply_resolution_metadata(
                routing,
                followup_resolution=followup_resolution,
                goal_intent_resolution=goal_intent_resolution,
                goal_composition_resolution=goal_composition_resolution,
                mapped_prompt=effective_lookup_prompt,
            )
            if (
                str(routing.resolution_source or "") in {
                    SESSION_FOLLOWUP_RESOLUTION,
                    GOAL_INTENT_MAPPING_RESOLUTION,
                    GOAL_COMPOSITION_RESOLUTION,
                }
                and routing.session_resolution_note
            ):
                return replace(
                    routing,
                    intelligence_summary=routing.session_resolution_note,
                    decision_summary=f"{routing.session_resolution_note} {routing.decision_summary or ''}".strip(),
                )
            return routing
        if requested_intent == "plan":
            return self._apply_content_policy(prompt=effective_lookup_prompt, routing=IntakeRouting(
                requested_intent="plan",
                resolved_intent="inspect",
                requested_execution_lane=requested_execution_lane,
                execution_lane="read_only_inspection",
                downgraded=True,
                downgrade_reason="No dedicated plan-only execution lane is available in the current runtime; routing to bounded read-only inspection.",
                approval_required=False,
                mutation_capable=False,
                mapped_prompt=effective_lookup_prompt,
                entity_mapping_applied=resolution.entity_mapping_applied,
                entity_mapping_sources=mapping_sources,
            ), session_id=session_id)
        if requested_intent == "inspect":
            return self._apply_content_policy(prompt=effective_lookup_prompt, routing=IntakeRouting(
                requested_intent="inspect",
                resolved_intent="inspect",
                requested_execution_lane="read_only_inspection",
                execution_lane="read_only_inspection",
                downgraded=False,
                downgrade_reason=None,
                approval_required=False,
                mutation_capable=False,
                mapped_prompt=effective_lookup_prompt,
                entity_mapping_applied=resolution.entity_mapping_applied,
                entity_mapping_sources=mapping_sources,
            ), session_id=session_id)
        return self._apply_content_policy(prompt=effective_lookup_prompt, routing=IntakeRouting(
            requested_intent="ambiguous",
            resolved_intent="inspect",
            requested_execution_lane="read_only_inspection",
            execution_lane="read_only_inspection",
            downgraded=False,
            downgrade_reason=None,
            approval_required=False,
            mutation_capable=False,
            mapped_prompt=effective_lookup_prompt,
            entity_mapping_applied=resolution.entity_mapping_applied,
            entity_mapping_sources=mapping_sources,
        ), session_id=session_id)

    def _routing_for_capability(self, capability: RuntimeCapability) -> IntakeRouting:
        intelligence = assess_capability_intelligence(capability)
        effective_approval_required = capability.approval_required
        effective_eligible_for_auto = capability.eligible_for_auto
        if intelligence.execution_decision == "auto_execute":
            effective_approval_required = False
            effective_eligible_for_auto = True
        return IntakeRouting(
            requested_intent="mutate",
            resolved_intent="mutate",
            requested_execution_lane=capability.requested_execution_lane,
            execution_lane=capability.requested_execution_lane,
            downgraded=False,
            downgrade_reason=None,
            approval_required=effective_approval_required,
            mutation_capable=True,
            capability_id=capability.capability_id,
            capability_title=capability.title,
            generic_capability_definition=generic_capability_definition_for_capability_id(capability.capability_id),
            handler_name=capability.handler_name,
            agent_type=capability.agent_type,
            target_level=capability.target_level,
            target_scene=capability.target_scene,
            trust_score=intelligence.trust_score,
            trust_band=intelligence.trust_band,
            policy_state=intelligence.policy_state,
            execution_decision=intelligence.execution_decision,
            recommended_action=intelligence.recommended_action,
            sandbox_first_required=intelligence.sandbox_first_required,
            auto_execution_enabled=intelligence.auto_execution_enabled,
            auto_execution_reason=intelligence.auto_execution_reason,
            missing_evidence=list(intelligence.missing_evidence),
            intelligence_summary=intelligence.summary,
            maturity_stage=capability.evidence_state,
            evidence_state=capability.evidence_state,
            eligible_for_auto=effective_eligible_for_auto,
            times_attempted=capability.times_attempted,
            times_passed=capability.times_passed,
            last_validation_result=capability.last_validation_result,
            last_rollback_result=capability.last_rollback_result,
            sandbox_verified=capability.sandbox_verified,
            real_target_verified=capability.real_target_verified,
            rollback_verified=capability.rollback_verified,
        )

    def _apply_content_policy(
        self,
        *,
        prompt: str,
        routing: IntakeRouting,
        capability: RuntimeCapability | None = None,
        session_id: str,
    ) -> IntakeRouting:
        profile = load_project_content_profile(self.config)
        assessment = evaluate_content_policy(
            prompt,
            profile=profile,
            capability_tags=capability.content_tags if capability is not None else None,
        )

        execution_decision = routing.execution_decision
        recommended_action = routing.recommended_action
        approval_required = routing.approval_required
        auto_execution_enabled = routing.auto_execution_enabled
        auto_execution_reason = routing.auto_execution_reason

        if routing.requested_intent == "mutate" or routing.mutation_capable:
            if assessment.content_policy_decision == "requires_review":
                execution_decision = "approval_required"
                recommended_action = "requires_review"
                approval_required = True
                auto_execution_enabled = False
                auto_execution_reason = None
            elif assessment.content_policy_decision == "blocked":
                execution_decision = "blocked"
                recommended_action = "blocked"
                approval_required = False
                auto_execution_enabled = False
                auto_execution_reason = None

        runtime_context = self._load_runtime_context(session_id)
        decision = evaluate_autonomous_decision(
            requested_intent=routing.requested_intent,
            resolved_intent=routing.resolved_intent,
            mutation_capable=routing.mutation_capable,
            capability_supported=capability is not None or routing.requested_intent != "mutate",
            eligible_for_auto=routing.eligible_for_auto,
            approval_required_by_capability=approval_required,
            intelligence_execution_decision=execution_decision,
            intelligence_summary=routing.intelligence_summary,
            auto_execution_reason=auto_execution_reason,
            missing_evidence=list(routing.missing_evidence or []),
            content_policy_decision=assessment.content_policy_decision,
            content_policy_summary=assessment.summary,
            rating_locked=assessment.rating_locked,
            runtime_context=runtime_context,
        )

        if decision.decision == "require_review":
            execution_decision = "require_review"
            recommended_action = "requires_review"
            approval_required = True
            auto_execution_enabled = False
            auto_execution_reason = None
        elif decision.decision == "require_approval":
            execution_decision = "approval_required"
            recommended_action = "approval_required"
            approval_required = True
            auto_execution_enabled = False
            auto_execution_reason = None
        elif decision.decision == "sandbox_first":
            execution_decision = "sandbox_first"
            recommended_action = "sandbox_first"
            approval_required = True
            auto_execution_enabled = False
            auto_execution_reason = None
        elif decision.decision == "block":
            execution_decision = "blocked"
            recommended_action = "blocked"
            approval_required = False
            auto_execution_enabled = False
            auto_execution_reason = None
        elif decision.decision == "auto_execute":
            execution_decision = "auto_execute" if routing.mutation_capable else (routing.execution_decision or "auto_execute")
            recommended_action = "auto_execute"
            approval_required = False

        return replace(
            routing,
            approval_required=approval_required,
            execution_decision=execution_decision,
            recommended_action=recommended_action,
            auto_execution_enabled=auto_execution_enabled,
            auto_execution_reason=auto_execution_reason,
            rating_system=assessment.rating_system,
            rating_target=assessment.rating_target,
            rating_locked=assessment.rating_locked,
            content_policy_match=assessment.content_policy_match,
            content_policy_decision=assessment.content_policy_decision,
            required_rating_upgrade=assessment.required_rating_upgrade,
            requested_content_dimensions=dict(assessment.requested_content_dimensions),
            content_policy_summary=assessment.summary,
            decision=decision.decision,
            decision_reason=decision.decision_reason,
            decision_summary=decision.decision_summary,
            decision_auto_execute=decision.auto_execute,
            decision_approval_required=decision.approval_required,
            decision_sandbox_first=decision.sandbox_first,
            decision_review_required=decision.review_required,
            decision_blocked=decision.blocked,
            content_policy_block=decision.content_policy_block,
            capability_supported=decision.capability_supported,
            promotion_basis=decision.promotion_basis,
            fail_closed_reason=decision.fail_closed_reason,
        )

    def _resolve_mutation_route_issue(
        self,
        *,
        prompt: str,
        capability: RuntimeCapability,
        target_repo: str | None,
    ) -> str | None:
        if capability.agent_type != "level_0001_entity_transform_mutation_agent":
            return None
        resolved_target_repo = str(target_repo or self._derive_target_repo(prompt) or "").strip()
        if not resolved_target_repo:
            return "No deterministic entity-transform route matched the prompt because no supported project path was selected."
        _, route_issue = resolve_entity_transform_route(Path(resolved_target_repo), prompt)
        return route_issue

    def _blocked_mutation_route_routing(
        self,
        *,
        requested_execution_lane: str,
        session_id: str,
        route_issue: str,
        mapped_prompt: str | None = None,
        entity_mapping_applied: bool = False,
        entity_mapping_sources: List[str] | None = None,
        clarification_options: List[str] | None = None,
    ) -> IntakeRouting:
        intelligence = assess_mutation_without_capability()
        normalized_options = [str(option).strip() for option in (clarification_options or []) if str(option).strip()]
        routing = self._apply_content_policy(
            prompt=mapped_prompt or "",
            routing=IntakeRouting(
                requested_intent="mutate",
                resolved_intent="mutate",
                requested_execution_lane=requested_execution_lane,
                execution_lane=requested_execution_lane,
                downgraded=False,
                downgrade_reason=None,
                approval_required=False,
                mutation_capable=False,
                trust_score=intelligence.trust_score,
                trust_band=intelligence.trust_band,
                policy_state=intelligence.policy_state,
                execution_decision=intelligence.execution_decision,
                recommended_action=intelligence.recommended_action,
                sandbox_first_required=intelligence.sandbox_first_required,
                auto_execution_enabled=intelligence.auto_execution_enabled,
                auto_execution_reason=intelligence.auto_execution_reason,
                missing_evidence=list(intelligence.missing_evidence),
                intelligence_summary=route_issue,
                mapped_prompt=mapped_prompt,
                entity_mapping_applied=entity_mapping_applied,
                entity_mapping_sources=entity_mapping_sources,
                clarification_options=normalized_options,
            ),
            session_id=session_id,
        )
        return replace(
            routing,
            intelligence_summary=route_issue,
            decision="block",
            decision_reason="clarification_required" if normalized_options else "route_missing",
            decision_summary=f"Decision: block - {route_issue}",
            fail_closed_reason=route_issue,
            clarification_options=normalized_options,
            recommended_action="clarify_request" if normalized_options else routing.recommended_action,
            plan_title="Clarify target" if normalized_options else routing.plan_title,
            plan_step_titles=normalized_options if normalized_options else routing.plan_step_titles,
            plan_expected_outcome=(
                "Clarification only. No execution will start until you choose one explicit supported request."
                if normalized_options
                else routing.plan_expected_outcome
            ),
            plan_execution_mode="Clarification required" if normalized_options else routing.plan_execution_mode,
        )

    def _load_runtime_context(self, session_id: str) -> DecisionRuntimeContext:
        state_store = StateStore(self.config.runs_dir, session_id)
        if not state_store.state_path.exists():
            return DecisionRuntimeContext()
        state = state_store.load()
        return DecisionRuntimeContext(
            session_phase=str(state.get("session_phase") or "") or None,
            waiting_reason=str(state.get("waiting_reason") or "") or None,
            blocked_reason=str(state.get("blocked_reason") or "") or None,
            current_task_id=str(state.get("current_task") or "") or None,
            queue_remaining=int(state.get("queue_remaining", 0) or 0),
        )

    def _record_session_progress(self, session_id: str, **progress_fields: Any) -> None:
        state_store = StateStore(self.config.runs_dir, session_id)
        if not state_store.state_path.exists():
            return
        state = state_store.load()
        state.update(progress_fields)
        state_store.save(state)

    def _classify_requested_intent(self, normalized_prompt: str) -> str:
        if is_experiment_decision_prompt(normalized_prompt) or is_experiment_decisions_prompt(normalized_prompt):
            return "inspect"
        if is_experiment_review_prompt(normalized_prompt):
            return "inspect"
        if is_session_followup_prompt(normalized_prompt):
            return "mutate"
        if match_predefined_plan(normalized_prompt) is not None:
            return "mutate"
        if any(self._contains_phrase(normalized_prompt, phrase) for phrase in self._PLAN_REQUEST_VERBS):
            return "plan"
        if any(self._contains_phrase(normalized_prompt, phrase) for phrase in self._MUTATION_REQUEST_VERBS):
            return "mutate"
        if self._looks_like_world_mutation_request(normalized_prompt):
            return "mutate"
        if any(self._contains_phrase(normalized_prompt, phrase) for phrase in ("inspect", "audit", "review", "report", "investigate", "analyze", "validate", "check")):
            return "inspect"
        return "ambiguous"

    def _looks_like_world_mutation_request(self, normalized_prompt: str) -> bool:
        has_action_hint = any(self._contains_phrase(normalized_prompt, phrase) for phrase in self._WORLD_MUTATION_ACTION_HINTS)
        if not has_action_hint:
            return False
        has_domain_hint = any(hint in normalized_prompt for hint in self._WORLD_MUTATION_DOMAIN_HINTS)
        has_direction_hint = any(self._contains_phrase(normalized_prompt, phrase) for phrase in self._WORLD_MUTATION_DIRECTION_HINTS)
        return has_domain_hint or has_direction_hint

    def _requested_lane_for_intent(self, requested_intent: str) -> str:
        if requested_intent == "mutate":
            return "approval_required_mutation"
        if requested_intent == "plan":
            return "plan_only"
        if requested_intent == "inspect":
            return "read_only_inspection"
        return "unsupported_intent"

    def _contains_phrase(self, normalized_prompt: str, phrase: str) -> bool:
        if " " in phrase:
            return phrase in normalized_prompt
        return re.search(rf"\b{re.escape(phrase)}\b", normalized_prompt) is not None

    def _derive_priority(self, task_type: str, prompt: str) -> int:
        lower = prompt.lower()
        if "urgent" in lower or "critical" in lower:
            return 10
        if task_type == "stabilization_request":
            return 25
        if task_type == "read_only_inspection_request":
            return 40
        return 50

    def _find_existing_task(self, tasks: List[Dict[str, Any]], task_id: str) -> Dict[str, Any] | None:
        for task in tasks:
            if str(task.get("task_id") or task.get("id") or "") == task_id:
                return task
        return None

    def _normalize_prompt(self, operator_message: str) -> str:
        return normalize_prompt(operator_message)

    def _execution_prompt_for_routing(self, original_prompt: str, *, routing: IntakeRouting) -> str:
        mapped_prompt = str(getattr(routing, "mapped_prompt", "") or "").strip()
        if mapped_prompt and str(getattr(routing, "resolution_source", "") or "") in {
            SESSION_FOLLOWUP_RESOLUTION,
            GOAL_INTENT_MAPPING_RESOLUTION,
            GOAL_COMPOSITION_RESOLUTION,
        }:
            return mapped_prompt
        return original_prompt

    def _load_session_followup_state(self, session_id: str) -> Dict[str, Any]:
        state_store = StateStore(self.config.runs_dir, session_id)
        if not state_store.state_path.exists():
            return {}
        return state_store.load()

    def _apply_resolution_metadata(
        self,
        routing: IntakeRouting,
        *,
        followup_resolution: SessionFollowUpResolution | None,
        goal_intent_resolution: GoalIntentResolution | None,
        goal_composition_resolution: GoalCompositionResolution | None,
        mapped_prompt: str,
    ) -> IntakeRouting:
        if followup_resolution is not None:
            return replace(
                routing,
                mapped_prompt=mapped_prompt,
                resolution_source=followup_resolution.resolution_source,
                resolved_from_prompt=followup_resolution.original_prompt,
                session_resolution_note=followup_resolution.resolution_note,
                goal_components=None,
                state_family=followup_resolution.state_family,
                previous_tier=followup_resolution.previous_tier,
                requested_tier=followup_resolution.requested_tier,
                revert_requested=followup_resolution.revert_requested,
                revert_summary=followup_resolution.revert_summary,
            )
        if goal_intent_resolution is not None:
            return replace(
                routing,
                mapped_prompt=mapped_prompt,
                resolution_source=goal_intent_resolution.resolution_source,
                resolved_from_prompt=goal_intent_resolution.original_prompt,
                session_resolution_note=goal_intent_resolution.resolution_note,
                goal_components=list(goal_intent_resolution.goal_components),
                state_family=None,
                previous_tier=None,
                requested_tier=None,
                revert_requested=False,
                revert_summary=None,
            )
        if goal_composition_resolution is not None:
            return replace(
                routing,
                mapped_prompt=mapped_prompt,
                resolution_source=goal_composition_resolution.resolution_source,
                resolved_from_prompt=goal_composition_resolution.original_prompt,
                session_resolution_note=goal_composition_resolution.resolution_note,
                goal_components=list(goal_composition_resolution.goal_components),
                state_family=None,
                previous_tier=None,
                requested_tier=None,
                revert_requested=False,
                revert_summary=None,
            )
        return replace(
            routing,
            mapped_prompt=mapped_prompt,
            resolution_source=DIRECT_PROMPT_RESOLUTION,
            resolved_from_prompt="",
            session_resolution_note="",
            goal_components=None,
            state_family=None,
            previous_tier=None,
            requested_tier=None,
            revert_requested=False,
            revert_summary=None,
        )

    def _resolve_simulated_delay_seconds(self, simulated_delay_seconds: float | None) -> float:
        if simulated_delay_seconds is not None:
            return max(0.0, float(simulated_delay_seconds))
        raw = os.getenv("AI_E_TASK_INTAKE_SIMULATED_DELAY_SECONDS", "0")
        try:
            return max(0.0, float(raw))
        except (TypeError, ValueError):
            return 0.0

    def _prompt_fingerprint(self, prompt: str, target_repo: str, task_type: str) -> str:
        key = "|".join([prompt.strip().lower(), target_repo.strip().lower(), task_type.strip().lower()])
        return hashlib.sha1(key.encode("utf-8")).hexdigest()

    def _relative(self, path: Path) -> str:
        return str(path.relative_to(self.config.root_dir)).replace("\\", "/")

    def _register_plan_state(
        self,
        *,
        session_id: str,
        plan_id: str,
        plan_summary: str,
        plan_steps: List[str],
    ) -> None:
        state_store = StateStore(self.config.runs_dir, session_id)
        if not state_store.state_path.exists():
            return
        state = state_store.load()
        state_store.register_generated_plan(
            state,
            plan_id=plan_id,
            plan_summary=plan_summary,
            plan_steps=plan_steps,
        )


def resolve_default_target_repo(config: OrchestratorConfig, prompt: str | None = None) -> str:
    env_target_repo = os.getenv(_DEFAULT_TARGET_REPO_ENV_VAR, "").strip()
    if env_target_repo:
        return str(Path(env_target_repo)).replace("\\", "/")

    configured_target_repo = _configured_default_target_repo(config)
    if configured_target_repo is not None:
        return str(configured_target_repo).replace("\\", "/")

    return str(config.root_dir).replace("\\", "/")


def _configured_default_target_repo(config: OrchestratorConfig) -> Path | None:
    configured_value = getattr(config, "default_target_repo", None)
    if configured_value:
        return Path(str(configured_value))

    candidate = config.root_dir / "targets" / "default"
    if candidate.exists():
        return candidate
    return None


__all__ = ["ConversationalTaskIntake", "IntakeArtifacts", "IntakeResult", "IntakeRouting", "resolve_default_target_repo"]
