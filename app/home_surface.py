"""UI-side helpers for the AI-E v1 home screen."""
from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable, List

from .paths import ARTIFACTS_ROOT, PROJECT_ROOT


PROJECTS_LOCAL_PATH = PROJECT_ROOT / "project_registry" / "projects.local.json"
PROJECTS_EXAMPLE_PATH = PROJECT_ROOT / "project_registry" / "projects.example.json"
ORCHESTRATOR_ROOT = PROJECT_ROOT / "orchestrator_lane"
ORCHESTRATOR_RUNS_ROOT = ORCHESTRATOR_ROOT / "runs"
DEFAULT_PREVIEW_SESSION_ID = "home_screen_preview"
DEFAULT_SUBMIT_SESSION_ID = "product_surface_home"
DEFAULT_SUBMIT_CHANNEL = "product_surface_home"


@dataclass(frozen=True)
class SupportedProject:
    name: str
    path: Path
    project_type: str
    source: str
    status: str


@dataclass(frozen=True)
class RecentRunEntry:
    title: str
    source: str
    status: str
    updated_at: datetime
    updated_label: str
    detail: str
    path: Path


@dataclass(frozen=True)
class PreparedPromptPreview:
    prompt_text: str
    normalized_prompt: str
    classification: str
    target_repo: str
    target_display: str
    task_type: str
    detected_action: str
    execution_lane: str
    decision: str
    decision_state: str
    recommended_action: str
    decision_reason: str
    decision_summary: str
    next_action_label: str
    ready_for_intake: bool
    available: bool
    status_message: str


@dataclass(frozen=True)
class SubmittedPromptResult:
    ok: bool
    message: str
    decision_state: str
    queue_status: str
    request_id: str
    task_id: str


@dataclass(frozen=True)
class ReviewSurface:
    available: bool
    prompt_text: str
    request_summary: str
    normalized_prompt: str
    target_display: str
    detected_action: str
    approval_reason: str
    expected_change_scope: str
    validation_intent: str
    risk_guardrail_status: str
    status_message: str
    request_id: str
    task_type: str
    queue_status: str
    action_required: bool
    approve_enabled: bool
    reject_enabled: bool
    sandbox_enabled: bool
    bundle_payload: Dict[str, Any]


@dataclass(frozen=True)
class ReviewActionResult:
    ok: bool
    action: str
    message: str
    wired: bool
    staged_only: bool
    queue_status: str
    request_id: str
    task_id: str


@dataclass(frozen=True)
class LiveStatusSurface:
    available: bool
    status_badge: str
    status_message: str
    session_id: str
    current_phase: str
    current_task: str
    queue_remaining: str
    heartbeat_status: str
    waiting_reason: str
    approval_status: str
    final_state: str
    poll_mode: str
    request_id: str
    task_id: str
    result_ready: bool
    result_path: Path | None


def load_supported_projects() -> List[SupportedProject]:
    projects: List[SupportedProject] = []
    seen_paths: set[str] = set()
    for source, registry_path in (
        ("local_registry", PROJECTS_LOCAL_PATH),
        ("example_registry", PROJECTS_EXAMPLE_PATH),
    ):
        for project in _load_registry_projects(registry_path, source=source):
            key = str(project.path).lower()
            if key in seen_paths:
                continue
            seen_paths.add(key)
            projects.append(project)

    fallback_path = PROJECT_ROOT.parent / "BABYLON VER 2"
    if fallback_path.exists():
        key = str(fallback_path.resolve()).lower()
        if key not in seen_paths:
            projects.append(
                SupportedProject(
                    name="BABYLON VER 2",
                    path=fallback_path.resolve(),
                    project_type="unity_project",
                    source="discovered_default",
                    status="supported",
                )
            )

    projects.sort(key=lambda item: item.name.lower())
    return projects


def load_recent_runs(*, limit: int = 8) -> List[RecentRunEntry]:
    entries: List[RecentRunEntry] = []
    entries.extend(_iter_runner_artifact_entries())
    entries.extend(_iter_session_entries())
    entries.sort(key=lambda item: item.updated_at, reverse=True)
    return entries[:limit]


class IntakePreviewBridge:
    """Thin wrapper that reuses existing intake logic without queue mutation."""

    def __init__(self) -> None:
        self._intake_cls = None
        self._config_cls = None
        self._approve_mutation_task_fn = None
        self._build_review_bundle_fn = None
        self._create_review_decision_fn = None
        self._build_queue_preview_fn = None
        self._runtime_state_cls = None
        self._import_error: str | None = None

    def prepare_prompt(self, prompt_text: str, project: SupportedProject | None) -> PreparedPromptPreview:
        normalized = " ".join(str(prompt_text or "").split())
        target_repo = str(project.path).replace("\\", "/") if project else ""
        target_display = project.name if project else "No supported workspace selected"
        if not normalized:
            return PreparedPromptPreview(
                prompt_text=str(prompt_text or ""),
                normalized_prompt="",
                classification="empty",
                target_repo=target_repo,
                target_display=target_display,
                task_type="",
                detected_action="Awaiting prompt",
                execution_lane="",
                decision="",
                decision_state="Blocked",
                recommended_action="",
                decision_reason="Enter a prompt to see an intake decision.",
                decision_summary="",
                next_action_label="Revise request",
                ready_for_intake=False,
                available=True,
                status_message="Enter a request to stage it for the existing intake flow. Execution has not started.",
            )

        intake = self._create_intake()
        if intake is None:
            message = self._import_error or "Intake preview is unavailable."
            return PreparedPromptPreview(
                prompt_text=prompt_text,
                normalized_prompt=normalized,
                classification="unavailable",
                target_repo=target_repo,
                target_display=target_display,
                task_type="",
                detected_action="Intake unavailable",
                execution_lane="",
                decision="",
                decision_state="Blocked",
                recommended_action="",
                decision_reason=message,
                decision_summary="",
                next_action_label="Revise request",
                ready_for_intake=False,
                available=False,
                status_message=f"{message} Prompt is staged locally only; execution has not started.",
            )

        classification = intake.classify_message(normalized)
        try:
            routing = intake._resolve_intake_routing(normalized, session_id=DEFAULT_PREVIEW_SESSION_ID)
            task_type = intake._derive_task_type(normalized, routing=routing)
        except Exception as exc:  # noqa: BLE001
            return PreparedPromptPreview(
                prompt_text=prompt_text,
                normalized_prompt=normalized,
                classification=classification,
                target_repo=target_repo,
                target_display=target_display,
                task_type="",
                detected_action="Intake preview failed",
                execution_lane="",
                decision="",
                decision_state="Blocked",
                recommended_action="",
                decision_reason=str(exc),
                decision_summary="",
                next_action_label="Revise request",
                ready_for_intake=classification == "task_request",
                available=False,
                status_message=f"Intake preview failed: {exc}. Prompt is staged locally only; execution has not started.",
            )

        ready_for_intake = classification == "task_request"
        decision = str(routing.decision or routing.execution_decision or "pending_preview")
        action = str(routing.recommended_action or "review")
        lane = str(routing.execution_lane or "")
        summary = str(routing.decision_summary or routing.intelligence_summary or "Prepared for existing intake.")
        decision_state = self._decision_state(classification=classification, decision=decision)
        detected_action = self._detected_action(routing=routing, task_type=task_type)
        decision_reason = self._decision_reason(
            classification=classification,
            decision_state=decision_state,
            routing=routing,
        )
        next_action_label = self._next_action_label(decision_state)
        status_message = (
            f"Prepared for the existing intake system. "
            f"Current preview: {decision_state}. "
            f"Execution has not started."
        )
        if not ready_for_intake:
            status_message = (
                "Prompt staged, but the existing intake classifier does not currently treat it as a task request. "
                "Execution has not started."
            )

        return PreparedPromptPreview(
            prompt_text=prompt_text,
            normalized_prompt=normalized,
            classification=classification,
            target_repo=target_repo,
            target_display=target_display,
            task_type=task_type,
            detected_action=detected_action,
            execution_lane=lane,
            decision=decision,
            decision_state=decision_state,
            recommended_action=action,
            decision_reason=decision_reason,
            decision_summary=summary,
            next_action_label=next_action_label,
            ready_for_intake=decision_state == "Ready",
            available=True,
            status_message=status_message,
        )

    def submit_prompt(self, preview: PreparedPromptPreview, project: SupportedProject | None) -> SubmittedPromptResult:
        if project is None:
            return SubmittedPromptResult(
                ok=False,
                message="Select a supported project before submitting a request.",
                decision_state="Blocked",
                queue_status="",
                request_id="",
                task_id="",
            )
        if preview.decision_state != "Ready":
            return SubmittedPromptResult(
                ok=False,
                message="Only Ready requests can be submitted from this surface.",
                decision_state=preview.decision_state,
                queue_status="",
                request_id="",
                task_id="",
            )

        intake = self._create_intake()
        if intake is None:
            return SubmittedPromptResult(
                ok=False,
                message=self._import_error or "Existing intake system is unavailable.",
                decision_state="Blocked",
                queue_status="",
                request_id="",
                task_id="",
            )

        try:
            result = intake.accept_message(
                preview.prompt_text,
                session_id=DEFAULT_SUBMIT_SESSION_ID,
                channel=DEFAULT_SUBMIT_CHANNEL,
                target_repo=str(project.path).replace("\\", "/"),
            )
        except Exception as exc:  # noqa: BLE001
            return SubmittedPromptResult(
                ok=False,
                message=f"Existing intake submission failed: {exc}",
                decision_state="Blocked",
                queue_status="",
                request_id="",
                task_id="",
            )

        queue_status = str(result.queue_entry.get("status") or "pending")
        message = "Request submitted to the existing intake flow."
        if queue_status == "needs_approval":
            message = "Request submitted. AI-E marked it as awaiting approval."
        elif queue_status == "blocked":
            message = "Request submitted, but the existing intake logic blocked it."
        elif not result.created:
            message = "Request already exists in the existing intake flow."

        return SubmittedPromptResult(
            ok=True,
            message=message,
            decision_state="Ready",
            queue_status=queue_status,
            request_id=result.request_id,
            task_id=result.task_id,
        )

    def build_review_surface(
        self,
        preview: PreparedPromptPreview,
        project: SupportedProject | None,
    ) -> ReviewSurface:
        unavailable = self._unavailable_review_surface(
            preview,
            message="Approval review becomes available when a request lands in Needs approval.",
        )
        if project is None:
            return self._unavailable_review_surface(preview, message="Select a supported project before opening review.")
        if preview.decision_state != "Needs approval":
            return unavailable

        context = self._resolve_review_context(preview, project)
        if context is None:
            return self._unavailable_review_surface(
                preview,
                message=self._import_error or "Existing approval review details are unavailable.",
            )

        existing_task = self._find_existing_review_task(context["request_id"])
        queue_status = str(existing_task.get("status") or "").strip().lower() if existing_task else ""
        approval_state = str(existing_task.get("approval_state") or "").strip().lower() if existing_task else ""
        action_required = queue_status in {"", "needs_approval"}
        status_message = self._review_status_message(queue_status=queue_status, approval_state=approval_state)

        return ReviewSurface(
            available=True,
            prompt_text=preview.prompt_text,
            request_summary=self._review_request_summary(preview=preview, routing=context["routing"], project=project),
            normalized_prompt=preview.normalized_prompt,
            target_display=preview.target_display,
            detected_action=preview.detected_action,
            approval_reason=self._approval_reason(preview=preview, routing=context["routing"]),
            expected_change_scope=self._expected_change_scope(
                preview=preview,
                routing=context["routing"],
                project=project,
            ),
            validation_intent=self._validation_intent(routing=context["routing"]),
            risk_guardrail_status=self._risk_guardrail_status(
                routing=context["routing"],
                queue_status=queue_status,
                approval_state=approval_state,
            ),
            status_message=status_message,
            request_id=context["request_id"],
            task_type=context["task_type"],
            queue_status=queue_status,
            action_required=action_required,
            approve_enabled=action_required,
            reject_enabled=action_required,
            sandbox_enabled=action_required,
            bundle_payload=context["bundle_payload"],
        )

    def apply_review_action(
        self,
        review: ReviewSurface,
        *,
        action: str,
        project: SupportedProject | None,
        approved_by: str,
    ) -> ReviewActionResult:
        normalized_action = str(action or "").strip().lower()
        if not review.available:
            return ReviewActionResult(
                ok=False,
                action=normalized_action,
                message="Open a Needs approval request before taking a review action.",
                wired=False,
                staged_only=True,
                queue_status=review.queue_status,
                request_id=review.request_id,
                task_id="",
            )
        if project is None:
            return ReviewActionResult(
                ok=False,
                action=normalized_action,
                message="Select a supported project before taking a review action.",
                wired=False,
                staged_only=True,
                queue_status=review.queue_status,
                request_id=review.request_id,
                task_id="",
            )
        if normalized_action == "approve_once":
            return self._approve_review_once(review, project=project, approved_by=approved_by)
        if normalized_action == "reject":
            return self._stage_review_decision(
                review,
                decision="rejected",
                action="reject",
                notes="Rejected from the AI-E v1 review surface.",
                staged_message=(
                    "Rejected on the product surface. No queue state changed and nothing executed because "
                    "a direct reject path is not exposed yet."
                ),
            )
        if normalized_action == "sandbox_first":
            return self._stage_review_decision(
                review,
                decision="needs_changes",
                action="sandbox_first",
                notes="Operator requested sandbox-first review from the AI-E v1 review surface.",
                staged_message=(
                    "Sandbox-first was recorded as the safe next decision on the product surface. "
                    "No sandbox job was launched here and nothing executed."
                ),
            )
        return ReviewActionResult(
            ok=False,
            action=normalized_action,
            message="Unknown review action.",
            wired=False,
            staged_only=True,
            queue_status=review.queue_status,
            request_id=review.request_id,
            task_id="",
        )

    def load_live_status(
        self,
        *,
        request_id: str = "",
        task_id: str = "",
        session_id: str = "",
    ) -> LiveStatusSurface:
        normalized_request_id = str(request_id or "").strip()
        normalized_task_id = str(task_id or "").strip()
        normalized_session_id = str(session_id or "").strip()

        if self._config_cls is None or self._runtime_state_cls is None:
            try:
                self._ensure_imports()
            except Exception as exc:  # noqa: BLE001
                self._import_error = f"Existing runtime state could not load: {exc}"
                return self._unavailable_live_status(self._import_error)

        config = self._config_cls.load()
        queue_tasks = self._matching_queue_tasks(
            config,
            request_id=normalized_request_id,
            task_id=normalized_task_id,
        )
        queue_entry = queue_tasks[0] if queue_tasks else None

        resolved_session_id = normalized_session_id
        if not resolved_session_id and queue_entry is not None:
            resolved_session_id = str(queue_entry.get("current_session_id") or "").strip()
        if not resolved_session_id:
            related_task_ids = [
                task_id
                for task_id in [normalized_task_id, *[str(item.get("task_id") or "") for item in queue_tasks]]
                if task_id
            ]
            resolved_session_id = self._find_related_session_id(config, task_ids=related_task_ids)

        if resolved_session_id:
            return self._build_live_status_from_runtime(
                config,
                session_id=resolved_session_id,
                queue_entry=queue_entry,
                request_id=normalized_request_id,
                task_id=normalized_task_id,
            )

        if queue_entry is not None:
            return self._build_live_status_from_queue(
                config,
                queue_entry=queue_entry,
                queue_tasks=queue_tasks,
                request_id=normalized_request_id,
                task_id=normalized_task_id,
            )

        if normalized_request_id or normalized_task_id or normalized_session_id:
            return self._unavailable_live_status(
                "No current run or queued task is visible for this request yet."
            )

        return self._unavailable_live_status(
            "Submit or approve a request to start tracking live status."
        )

    def _create_intake(self) -> Any | None:
        if self._intake_cls is None or self._config_cls is None:
            try:
                self._ensure_imports()
            except Exception as exc:  # noqa: BLE001
                self._import_error = f"Existing intake preview could not load: {exc}"
                return None
        config = self._config_cls.load()
        return self._intake_cls(config)

    def _approve_review_once(
        self,
        review: ReviewSurface,
        *,
        project: SupportedProject,
        approved_by: str,
    ) -> ReviewActionResult:
        intake = self._create_intake()
        if intake is None or self._approve_mutation_task_fn is None:
            return ReviewActionResult(
                ok=False,
                action="approve_once",
                message=self._import_error or "Existing approval plumbing is unavailable.",
                wired=False,
                staged_only=True,
                queue_status=review.queue_status,
                request_id=review.request_id,
                task_id="",
            )

        try:
            intake_result = intake.accept_message(
                review.prompt_text,
                session_id=DEFAULT_SUBMIT_SESSION_ID,
                channel=DEFAULT_SUBMIT_CHANNEL,
                target_repo=str(project.path).replace("\\", "/"),
            )
        except Exception as exc:  # noqa: BLE001
            return ReviewActionResult(
                ok=False,
                action="approve_once",
                message=f"Existing intake submission failed during approval: {exc}",
                wired=False,
                staged_only=True,
                queue_status=review.queue_status,
                request_id=review.request_id,
                task_id="",
            )

        queue_status = str(intake_result.queue_entry.get("status") or "").strip().lower()
        approval_state = str(intake_result.queue_entry.get("approval_state") or "").strip().lower()
        task_id = intake_result.task_id
        if queue_status == "needs_approval":
            try:
                approval = self._approve_mutation_task_fn(
                    intake.config,
                    task_id=task_id,
                    approved_by=self._approved_by_name(approved_by),
                    notes="Approved once from the AI-E v1 review surface.",
                )
            except Exception as exc:  # noqa: BLE001
                return ReviewActionResult(
                    ok=False,
                    action="approve_once",
                    message=f"Existing approval handoff failed: {exc}",
                    wired=False,
                    staged_only=True,
                    queue_status=queue_status,
                    request_id=intake_result.request_id,
                    task_id=task_id,
                )

            return ReviewActionResult(
                ok=True,
                action="approve_once",
                message=(
                    "Approved once through the existing intake and approval path. "
                    "The request is now pending in the existing queue, and nothing executed from this surface."
                ),
                wired=True,
                staged_only=False,
                queue_status=approval.queue_status,
                request_id=intake_result.request_id,
                task_id=task_id,
            )

        if queue_status == "pending" and approval_state in {"approved", "auto_approved", "not_required"}:
            return ReviewActionResult(
                ok=True,
                action="approve_once",
                message=(
                    "This request is already queued without an approval hold. "
                    "No execution was started from this surface."
                ),
                wired=True,
                staged_only=False,
                queue_status=queue_status,
                request_id=intake_result.request_id,
                task_id=task_id,
            )

        if queue_status == "blocked":
            return ReviewActionResult(
                ok=False,
                action="approve_once",
                message="The existing intake logic blocked this request before approval could be recorded.",
                wired=True,
                staged_only=False,
                queue_status=queue_status,
                request_id=intake_result.request_id,
                task_id=task_id,
            )

        return ReviewActionResult(
            ok=False,
            action="approve_once",
            message="The existing intake path did not produce an approval-gated task for this request.",
            wired=True,
            staged_only=False,
            queue_status=queue_status,
            request_id=intake_result.request_id,
            task_id=task_id,
        )

    def _stage_review_decision(
        self,
        review: ReviewSurface,
        *,
        decision: str,
        action: str,
        notes: str,
        staged_message: str,
    ) -> ReviewActionResult:
        queue_status = review.queue_status
        extra_note = ""
        if queue_status == "needs_approval":
            extra_note = " An existing queue item is still awaiting approval because this action is staged only."
        if self._create_review_decision_fn is None or self._build_queue_preview_fn is None:
            return ReviewActionResult(
                ok=True,
                action=action,
                message=staged_message + extra_note,
                wired=False,
                staged_only=True,
                queue_status=queue_status,
                request_id=review.request_id,
                task_id="",
            )

        decision_obj = self._create_review_decision_fn(review.bundle_payload, decision, notes=notes)
        preview_payload = self._build_queue_preview_fn(decision_obj, review.bundle_payload)
        preview_status = str(preview_payload.get("preview_status") or "").strip().lower()
        explanation = _clean_decision_text(str(preview_payload.get("explanation") or "").replace("_", " "))
        if explanation:
            explanation = explanation.rstrip(".") + "."
        message = staged_message
        if explanation:
            message = f"{message} Existing review preview: {explanation}"
        if extra_note:
            message += extra_note
        return ReviewActionResult(
            ok=True,
            action=action,
            message=message,
            wired=False,
            staged_only=True,
            queue_status=preview_status or queue_status,
            request_id=review.request_id,
            task_id="",
        )

    def _resolve_review_context(
        self,
        preview: PreparedPromptPreview,
        project: SupportedProject,
    ) -> Dict[str, Any] | None:
        intake = self._create_intake()
        if intake is None or self._build_review_bundle_fn is None:
            return None
        normalized_prompt = preview.normalized_prompt
        target_repo = str(project.path).replace("\\", "/")
        try:
            routing = intake._resolve_intake_routing(normalized_prompt, session_id=DEFAULT_PREVIEW_SESSION_ID)
            task_type = intake._derive_task_type(normalized_prompt, routing=routing)
            request_id = intake._derive_request_id(normalized_prompt, target_repo, task_type)
        except Exception as exc:  # noqa: BLE001
            self._import_error = f"Existing approval review could not load: {exc}"
            return None
        review_request = self._build_review_request(
            preview=preview,
            routing=routing,
            project=project,
            request_id=request_id,
            task_type=task_type,
        )
        return {
            "routing": routing,
            "task_type": task_type,
            "request_id": request_id,
            "bundle_payload": self._build_review_bundle_fn([review_request]),
        }

    def _find_existing_review_task(self, request_id: str) -> Dict[str, Any] | None:
        if self._config_cls is None:
            try:
                self._ensure_imports()
            except Exception:
                return None
        config = self._config_cls.load()
        payload = _load_json(config.queue_path)
        if not isinstance(payload, dict):
            return None
        tasks = payload.get("tasks")
        if not isinstance(tasks, list):
            return None
        matches = [
            dict(task)
            for task in tasks
            if isinstance(task, dict) and str(task.get("request_id") or "").strip() == request_id
        ]
        if not matches:
            return None
        priority = {"needs_approval": 0, "pending": 1, "running": 2, "blocked": 3, "completed": 4}
        matches.sort(key=lambda item: priority.get(str(item.get("status") or "").strip().lower(), 99))
        return matches[0]

    @staticmethod
    def _unavailable_review_surface(
        preview: PreparedPromptPreview,
        *,
        message: str,
    ) -> ReviewSurface:
        return ReviewSurface(
            available=False,
            prompt_text=preview.prompt_text,
            request_summary="-",
            normalized_prompt=preview.normalized_prompt or "-",
            target_display=preview.target_display or "-",
            detected_action=preview.detected_action or "-",
            approval_reason=message,
            expected_change_scope="-",
            validation_intent="-",
            risk_guardrail_status="Approval review is not active for this request yet.",
            status_message=message,
            request_id="",
            task_type="",
            queue_status="",
            action_required=False,
            approve_enabled=False,
            reject_enabled=False,
            sandbox_enabled=False,
            bundle_payload={},
        )

    def _build_review_request(
        self,
        *,
        preview: PreparedPromptPreview,
        routing: Any,
        project: SupportedProject,
        request_id: str,
        task_type: str,
    ) -> Dict[str, Any]:
        expected_scope = self._expected_change_scope(preview=preview, routing=routing, project=project)
        validation_intent = self._validation_intent(routing=routing)
        return {
            "request_id": request_id,
            "request_type": task_type or "mutation_request",
            "intent_type": self._review_intent_type(task_type=task_type, routing=routing),
            "priority": self._review_priority(task_type=task_type),
            "action_targets": [
                text
                for text in [
                    preview.target_display,
                    str(getattr(routing, "target_level", "") or "").strip(),
                    preview.detected_action,
                ]
                if text
            ],
            "expected_changes": [
                expected_scope,
                validation_intent,
            ],
        }

    @staticmethod
    def _review_request_summary(
        *,
        preview: PreparedPromptPreview,
        routing: Any,
        project: SupportedProject,
    ) -> str:
        target_level = str(getattr(routing, "target_level", "") or "").strip()
        if target_level:
            return f"{preview.detected_action} requests a bounded change in {target_level} inside {project.name}."
        return f"{preview.detected_action} requests a bounded change inside {project.name}."

    @staticmethod
    def _approval_reason(*, preview: PreparedPromptPreview, routing: Any) -> str:
        reason = _clean_decision_text(str(preview.decision_reason or "").strip())
        if reason:
            return reason
        reason = _clean_decision_text(str(getattr(routing, "decision_summary", "") or "").strip())
        if reason:
            return reason
        return "The existing intake logic requires human approval before this request can proceed."

    @staticmethod
    def _expected_change_scope(*, preview: PreparedPromptPreview, routing: Any, project: SupportedProject) -> str:
        target_level = str(getattr(routing, "target_level", "") or "").strip()
        target_scene = str(getattr(routing, "target_scene", "") or "").strip()
        if target_level:
            return f"Limit the change to {target_level} in {project.name} through the matched bounded capability."
        if target_scene:
            scene_name = Path(target_scene).stem or "the supported scene"
            return f"Limit the change to {scene_name} in {project.name} through the matched bounded capability."
        if str(getattr(routing, "mutation_capable", False)).lower() == "true" or bool(getattr(routing, "mutation_capable", False)):
            return f"Limit the change to the supported mutation scope in {project.name}."
        return f"Limit the request to the supported project scope in {project.name}."

    @staticmethod
    def _validation_intent(*, routing: Any) -> str:
        missing_evidence = [str(item).strip() for item in getattr(routing, "missing_evidence", []) or [] if str(item).strip()]
        if bool(getattr(routing, "sandbox_first_required", False)):
            return "Validate in sandbox first before any real-target execution is allowed."
        if missing_evidence:
            return f"Expected validation should close the remaining proof gaps: {', '.join(missing_evidence)}."
        return "The existing runtime should validate the bounded change and write proof artifacts before completion."

    @staticmethod
    def _risk_guardrail_status(*, routing: Any, queue_status: str, approval_state: str) -> str:
        parts: List[str] = []
        if queue_status == "needs_approval":
            parts.append("An existing queue item is currently waiting for approval.")
        elif queue_status == "pending":
            parts.append("Approval was already recorded once and the request is queued.")
        else:
            parts.append("No execution has started; this request is still on the review surface.")

        if bool(getattr(routing, "approval_required", False)):
            parts.append("Approval gating is active.")
        trust_band = str(getattr(routing, "trust_band", "") or "").strip()
        evidence_state = str(getattr(routing, "evidence_state", "") or getattr(routing, "maturity_stage", "") or "").strip()
        if evidence_state:
            parts.append(f"Capability evidence is {evidence_state}.")
        elif trust_band:
            parts.append(f"Capability trust is {trust_band}.")
        policy_state = str(getattr(routing, "policy_state", "") or "").strip()
        if policy_state:
            parts.append(f"Policy state is {policy_state.replace('_', ' ')}.")
        content_policy_decision = str(getattr(routing, "content_policy_decision", "") or "").strip()
        if content_policy_decision == "requires_review":
            parts.append("Content policy requires owner review.")
        elif content_policy_decision == "allowed":
            parts.append("Content policy did not block the request.")
        if approval_state == "approved":
            parts.append("The current queue copy is marked approved.")
        return " ".join(parts)

    @staticmethod
    def _review_status_message(*, queue_status: str, approval_state: str) -> str:
        if queue_status == "needs_approval":
            return "This request is already awaiting approval in the existing queue. Nothing has executed yet."
        if queue_status == "pending" and approval_state in {"approved", "auto_approved", "not_required"}:
            return "Approval was already recorded for this request. It is pending in the existing queue and has not executed from this surface."
        if queue_status == "blocked":
            return "The existing queue currently marks this request as blocked."
        return "This review is staged on the product surface. No queue mutation or execution has happened yet."

    @staticmethod
    def _review_intent_type(*, task_type: str, routing: Any) -> str:
        if task_type == "stabilization_request":
            return "system_fix"
        if bool(getattr(routing, "mutation_capable", False)):
            return "system_expand"
        return "system_improve"

    @staticmethod
    def _review_priority(*, task_type: str) -> str:
        if task_type == "stabilization_request":
            return "high"
        if task_type == "mutation_request":
            return "medium"
        return "medium"

    @staticmethod
    def _approved_by_name(approved_by: str) -> str:
        clean = " ".join(str(approved_by or "").split())
        return clean or "product_surface_user"

    def _build_live_status_from_runtime(
        self,
        config: Any,
        *,
        session_id: str,
        queue_entry: Dict[str, Any] | None,
        request_id: str,
        task_id: str,
    ) -> LiveStatusSurface:
        runtime_state = self._runtime_state_cls(config, session_id)
        snapshot = runtime_state.get_snapshot()
        session_dir = config.runs_dir / session_id
        session_state = _load_json(session_dir / "session_state.json")
        result_path = self._result_path_for_session(
            session_dir=session_dir,
            last_artifact_path=snapshot.last_artifact_path,
        )
        queue_remaining_value = snapshot.queue_remaining
        if snapshot.status != "running" and isinstance(session_state, dict):
            recorded_queue_remaining = session_state.get("queue_remaining")
            if isinstance(recorded_queue_remaining, int):
                queue_remaining_value = recorded_queue_remaining
        queue_remaining = self._format_queue_remaining(queue_remaining_value)
        active_task = (
            str(snapshot.current_task_id or "").strip()
            or str(snapshot.current_plan_step or "").strip()
            or str(snapshot.last_started_task or "").strip()
            or (str(queue_entry.get("title") or "").strip() if queue_entry else "")
        )
        waiting_reason = self._live_waiting_reason(snapshot=snapshot, queue_entry=queue_entry)
        approval_status = self._live_approval_status(snapshot=snapshot, queue_entry=queue_entry)
        final_state = self._runtime_final_state(snapshot)
        status_badge = self._runtime_status_badge(snapshot=snapshot, queue_entry=queue_entry)
        heartbeat_status = self._heartbeat_status_text(runtime_state=runtime_state, snapshot=snapshot)

        return LiveStatusSurface(
            available=True,
            status_badge=status_badge,
            status_message=self._runtime_status_message(snapshot=snapshot, final_state=final_state),
            session_id=session_id,
            current_phase=f"{snapshot.phase_label} ({snapshot.phase_index}/{snapshot.phase_total})",
            current_task=active_task or "No active task reported.",
            queue_remaining=queue_remaining,
            heartbeat_status=heartbeat_status,
            waiting_reason=waiting_reason,
            approval_status=approval_status,
            final_state=final_state,
            poll_mode="Polled from existing runtime and session state.",
            request_id=request_id,
            task_id=task_id or str(snapshot.current_task_id or snapshot.last_started_task or ""),
            result_ready=result_path is not None and snapshot.status != "running",
            result_path=result_path,
        )

    def _build_live_status_from_queue(
        self,
        config: Any,
        *,
        queue_entry: Dict[str, Any],
        queue_tasks: List[Dict[str, Any]],
        request_id: str,
        task_id: str,
    ) -> LiveStatusSurface:
        queue_status = str(queue_entry.get("status") or "pending").strip().lower()
        approval_state = str(queue_entry.get("approval_state") or "").strip().lower()
        visible_queue = [
            task
            for task in self._all_queue_tasks(config)
            if str(task.get("status") or "").strip().lower() in {"pending", "running", "needs_approval"}
        ]
        queue_remaining = self._format_queue_remaining(len(visible_queue))

        waiting_reason = "No active run session is visible for this request yet."
        if queue_status == "needs_approval" or approval_state == "awaiting_approval":
            waiting_reason = "Waiting for approval before execution can begin."
        elif queue_status == "blocked":
            waiting_reason = self._queue_block_reason(queue_entry)
        elif queue_status == "completed":
            waiting_reason = "Execution has already finished for this queued request."

        approval_status = self._queue_approval_status(queue_entry)
        final_state = self._queue_final_state(queue_entry)
        result_path = self._find_related_result_path(config, queue_entry=queue_entry, task_id=task_id)

        return LiveStatusSurface(
            available=True,
            status_badge=self._queue_status_badge(queue_status=queue_status, approval_state=approval_state),
            status_message="Polled from the existing queue because no active runtime session is currently visible.",
            session_id="Not started yet",
            current_phase="Not started yet",
            current_task=str(queue_entry.get("title") or queue_entry.get("task_id") or "Queued task"),
            queue_remaining=queue_remaining,
            heartbeat_status="No active heartbeat is visible yet.",
            waiting_reason=waiting_reason,
            approval_status=approval_status,
            final_state=final_state,
            poll_mode="Polled from existing queue state.",
            request_id=request_id or str(queue_entry.get("request_id") or ""),
            task_id=task_id or str(queue_entry.get("task_id") or ""),
            result_ready=result_path is not None and queue_status in {"blocked", "completed"},
            result_path=result_path,
        )

    def _find_related_session_id(self, config: Any, *, task_ids: List[str]) -> str:
        if not task_ids or not config.runs_dir.exists():
            return ""

        matches: List[Dict[str, Any]] = []
        related = {task_id for task_id in task_ids if task_id}
        for session_dir in config.runs_dir.iterdir():
            if not session_dir.is_dir():
                continue
            state = _load_json(session_dir / "session_state.json")
            if not isinstance(state, dict):
                continue
            state_task_ids = {
                str(state.get("current_task") or "").strip(),
                str(state.get("last_started_task") or "").strip(),
                str(state.get("last_completed_task") or "").strip(),
            }
            for entry in state.get("tasks_attempted", []):
                if isinstance(entry, dict):
                    state_task_ids.add(str(entry.get("task_id") or "").strip())
            for entry in state.get("tasks_failed", []):
                if isinstance(entry, dict):
                    state_task_ids.add(str(entry.get("task_id") or "").strip())
            for entry in state.get("tasks_completed", []):
                state_task_ids.add(str(entry).strip())

            matched = related.intersection({value for value in state_task_ids if value})
            if not matched:
                continue
            matches.append(
                {
                    "session_id": session_dir.name,
                    "running": str(state.get("status") or "").strip().lower() == "running",
                    "current_match": str(state.get("current_task") or "").strip() in matched,
                    "updated_at": _entry_timestamp(session_dir, state.get("updated_at")),
                }
            )

        if not matches:
            return ""

        matches.sort(
            key=lambda item: (
                0 if item["running"] else 1,
                0 if item["current_match"] else 1,
                -item["updated_at"].timestamp(),
            )
        )
        return str(matches[0]["session_id"])

    def _matching_queue_tasks(
        self,
        config: Any,
        *,
        request_id: str,
        task_id: str,
    ) -> List[Dict[str, Any]]:
        tasks = self._all_queue_tasks(config)
        matches = []
        for task in tasks:
            candidate_task_id = str(task.get("task_id") or task.get("id") or "").strip()
            candidate_request_id = str(task.get("request_id") or "").strip()
            if task_id and candidate_task_id == task_id:
                matches.append(task)
                continue
            if request_id and candidate_request_id == request_id:
                matches.append(task)

        status_priority = {"running": 0, "pending": 1, "needs_approval": 2, "blocked": 3, "completed": 4}
        matches.sort(
            key=lambda item: (
                status_priority.get(str(item.get("status") or "").strip().lower(), 99),
                int(item.get("plan_step_index", 0) or 0),
                str(item.get("task_id") or item.get("id") or ""),
            )
        )
        return matches

    def _all_queue_tasks(self, config: Any) -> List[Dict[str, Any]]:
        payload = _load_json(config.queue_path)
        if isinstance(payload, dict):
            tasks = payload.get("tasks")
            if isinstance(tasks, list):
                return [dict(item) for item in tasks if isinstance(item, dict)]
        if isinstance(payload, list):
            return [dict(item) for item in payload if isinstance(item, dict)]
        return []

    @staticmethod
    def _runtime_status_badge(*, snapshot: Any, queue_entry: Dict[str, Any] | None) -> str:
        if snapshot.status == "running" and snapshot.current_task_id:
            return "Running"
        if snapshot.status == "running" and (snapshot.waiting_reason or snapshot.queue_remaining > 0):
            if queue_entry and str(queue_entry.get("status") or "").strip().lower() == "needs_approval":
                return "Awaiting approval"
            return "Waiting"
        final_state = IntakePreviewBridge._runtime_final_state(snapshot)
        if final_state == "Completed":
            return "Completed"
        if final_state in {"Blocked", "Failed"}:
            return final_state
        return "Status available"

    @staticmethod
    def _runtime_status_message(*, snapshot: Any, final_state: str) -> str:
        if snapshot.status == "running" and snapshot.current_task_id:
            return "AI-E is actively working on the current task."
        if snapshot.status == "running":
            return "AI-E is running, but work is currently waiting on the next runtime condition."
        if final_state == "Completed":
            return "AI-E finished this session and wrote result artifacts."
        if final_state == "Blocked":
            return "AI-E halted this session because the request could not continue safely."
        if final_state == "Failed":
            return "AI-E stopped with a non-success outcome."
        return "AI-E status is available from the most recent session artifacts."

    @staticmethod
    def _runtime_final_state(snapshot: Any) -> str:
        if snapshot.status == "running":
            return "In progress"
        stop_reason = str(snapshot.stop_reason or "").strip().lower()
        last_result = str(snapshot.last_task_result_status or "").strip().lower()
        if last_result == "completed" or stop_reason in {"queue_empty", "queue_empty_idle_timeout", "complete"}:
            return "Completed"
        if last_result == "blocked" or stop_reason in {
            "all_remaining_tasks_blocked",
            "blocked_needs_approval",
            "repeated_failure_threshold_exceeded",
        }:
            return "Blocked"
        if last_result in {"retry_scheduled", "failed"}:
            return "Failed"
        return stop_reason.replace("_", " ").title() if stop_reason else str(snapshot.status or "Unknown").title()

    @staticmethod
    def _live_waiting_reason(*, snapshot: Any, queue_entry: Dict[str, Any] | None) -> str:
        blocked_reason = str(snapshot.blocked_reason or "").strip()
        if blocked_reason:
            return blocked_reason
        waiting_reason = str(snapshot.waiting_reason or "").strip()
        if waiting_reason:
            return waiting_reason
        if queue_entry is not None:
            queue_status = str(queue_entry.get("status") or "").strip().lower()
            approval_state = str(queue_entry.get("approval_state") or "").strip().lower()
            if queue_status == "needs_approval" or approval_state == "awaiting_approval":
                return "Waiting for approval before execution can begin."
        if snapshot.status == "running" and not snapshot.current_task_id:
            return "Waiting for the next runnable step."
        return "No wait reason reported."

    @staticmethod
    def _live_approval_status(*, snapshot: Any, queue_entry: Dict[str, Any] | None) -> str:
        if queue_entry is not None:
            queue_status = str(queue_entry.get("status") or "").strip().lower()
            approval_state = str(queue_entry.get("approval_state") or "").strip().lower()
            if queue_status == "needs_approval" or approval_state == "awaiting_approval":
                return "Approval wait is active."
            if approval_state == "approved":
                return "Approval recorded once."
            if approval_state == "auto_approved":
                return "Approval was granted automatically by existing backend policy."
        if str(snapshot.status or "").strip().lower() == "running":
            for task in getattr(snapshot, "queue_tasks", []) or []:
                if str(task.get("status") or "").strip().lower() == "needs_approval":
                    return "At least one queued task is waiting for approval."
        if str(snapshot.stop_reason or "").strip().lower() == "blocked_needs_approval":
            return "Approval wait stopped this session."
        return "Approval is not currently holding this session."

    @staticmethod
    def _queue_status_badge(*, queue_status: str, approval_state: str) -> str:
        if queue_status == "needs_approval" or approval_state == "awaiting_approval":
            return "Awaiting approval"
        if queue_status == "pending":
            return "Queued"
        if queue_status == "blocked":
            return "Blocked"
        if queue_status == "completed":
            return "Completed"
        if queue_status == "running":
            return "Running"
        return "Status available"

    @staticmethod
    def _queue_approval_status(queue_entry: Dict[str, Any]) -> str:
        queue_status = str(queue_entry.get("status") or "").strip().lower()
        approval_state = str(queue_entry.get("approval_state") or "").strip().lower()
        if queue_status == "needs_approval" or approval_state == "awaiting_approval":
            return "Approval wait is active."
        if approval_state == "approved":
            return "Approval recorded once."
        if approval_state == "auto_approved":
            return "Approval was granted automatically."
        if approval_state == "blocked":
            return "Approval cannot proceed because the task is blocked."
        return "Approval is not currently blocking this task."

    @staticmethod
    def _queue_final_state(queue_entry: Dict[str, Any]) -> str:
        queue_status = str(queue_entry.get("status") or "").strip().lower()
        if queue_status == "completed":
            return "Completed"
        if queue_status == "blocked":
            return "Blocked"
        if queue_status in {"pending", "running", "needs_approval"}:
            return "Not finished yet"
        return queue_status.replace("_", " ").title() if queue_status else "Unknown"

    @staticmethod
    def _queue_block_reason(queue_entry: Dict[str, Any]) -> str:
        for candidate in (
            queue_entry.get("fail_closed_reason"),
            queue_entry.get("decision_summary"),
            queue_entry.get("content_policy_summary"),
            queue_entry.get("last_error"),
        ):
            text = _clean_decision_text(str(candidate or "").strip())
            if text:
                return text
        return "Blocked before execution."

    @staticmethod
    def _heartbeat_status_text(*, runtime_state: Any, snapshot: Any) -> str:
        age = runtime_state.heartbeat_age_seconds()
        if snapshot.status == "running":
            if age is None:
                return "Running; no heartbeat has been recorded yet."
            return f"Active heartbeat seen {int(age)}s ago."
        if snapshot.heartbeat_timestamp:
            return f"Last heartbeat at {snapshot.heartbeat_timestamp}."
        return "No heartbeat has been recorded."

    @staticmethod
    def _result_path_for_session(*, session_dir: Path, last_artifact_path: str | None) -> Path | None:
        for candidate in (
            session_dir / "session_summary.md",
            session_dir / "session_summary.json",
            session_dir / "operator_report.md",
        ):
            if candidate.exists():
                return candidate
        if last_artifact_path:
            candidate = Path(str(last_artifact_path))
            if candidate.exists():
                return candidate
        return None

    def _find_related_result_path(self, config: Any, *, queue_entry: Dict[str, Any], task_id: str) -> Path | None:
        related_session_id = self._find_related_session_id(
            config,
            task_ids=[task_id or str(queue_entry.get("task_id") or "").strip()],
        )
        if not related_session_id:
            return None
        return self._result_path_for_session(
            session_dir=config.runs_dir / related_session_id,
            last_artifact_path=None,
        )

    @staticmethod
    def _format_queue_remaining(queue_remaining: int) -> str:
        return str(max(0, int(queue_remaining or 0)))

    @staticmethod
    def _unavailable_live_status(message: str) -> LiveStatusSurface:
        return LiveStatusSurface(
            available=False,
            status_badge="Status unavailable",
            status_message=message,
            session_id="-",
            current_phase="-",
            current_task="-",
            queue_remaining="-",
            heartbeat_status="-",
            waiting_reason=message,
            approval_status="-",
            final_state="-",
            poll_mode="Polled from existing state when available.",
            request_id="",
            task_id="",
            result_ready=False,
            result_path=None,
        )

    def _ensure_imports(self) -> None:
        orchestrator_path = str(ORCHESTRATOR_ROOT)
        if orchestrator_path not in sys.path:
            sys.path.insert(0, orchestrator_path)
        from ai_e_runtime.mutation_approval import approve_mutation_task
        from ai_e_runtime.queue_preview_builder import build_queue_preview
        from ai_e_runtime.request_review_bundle import build_review_bundle
        from ai_e_runtime.request_review_decision import create_review_decision
        from ai_e_runtime.runtime_state import RuntimeState
        from ai_e_runtime.task_intake import ConversationalTaskIntake
        from orchestrator.config import OrchestratorConfig

        self._approve_mutation_task_fn = approve_mutation_task
        self._build_review_bundle_fn = build_review_bundle
        self._create_review_decision_fn = create_review_decision
        self._build_queue_preview_fn = build_queue_preview
        self._runtime_state_cls = RuntimeState
        self._intake_cls = ConversationalTaskIntake
        self._config_cls = OrchestratorConfig

    @staticmethod
    def _decision_state(*, classification: str, decision: str) -> str:
        if classification != "task_request":
            return "Blocked"
        if decision == "auto_execute":
            return "Ready"
        if decision == "sandbox_first":
            return "Sandbox first"
        if decision in {"require_approval", "require_review"}:
            return "Needs approval"
        return "Blocked"

    @staticmethod
    def _next_action_label(decision_state: str) -> str:
        if decision_state == "Ready":
            return "Submit request"
        if decision_state == "Needs approval":
            return "Open review"
        if decision_state == "Sandbox first":
            return "Run in sandbox"
        return "Revise request"

    @staticmethod
    def _detected_action(*, routing: Any, task_type: str) -> str:
        capability_title = str(getattr(routing, "capability_title", "") or "").strip()
        if capability_title:
            return capability_title
        resolved_intent = str(getattr(routing, "resolved_intent", "") or "").strip()
        if resolved_intent == "inspect":
            return "Read-only inspection"
        if resolved_intent == "mutate":
            return "Bounded mutation"
        if resolved_intent == "plan":
            return "Planning request"
        return task_type.replace("_", " ").replace("request", "").strip().title() or "General request"

    @staticmethod
    def _decision_reason(*, classification: str, decision_state: str, routing: Any) -> str:
        if classification != "task_request":
            return "The existing intake classifier does not recognize this as a runnable task request yet."

        summary_sources = []
        if decision_state == "Blocked":
            summary_sources = [
                getattr(routing, "fail_closed_reason", ""),
                getattr(routing, "decision_summary", ""),
                getattr(routing, "content_policy_summary", ""),
            ]
        elif decision_state in {"Needs approval", "Sandbox first"}:
            summary_sources = [
                getattr(routing, "decision_summary", ""),
                getattr(routing, "fail_closed_reason", ""),
                getattr(routing, "content_policy_summary", ""),
            ]
        else:
            summary_sources = [
                getattr(routing, "decision_summary", ""),
                getattr(routing, "content_policy_summary", ""),
            ]

        summary = ""
        for source in summary_sources:
            summary = _clean_decision_text(str(source or "").strip())
            if summary:
                break
        if summary:
            return summary

        if decision_state == "Ready":
            return "The existing intake logic can accept this request without an approval stop."
        if decision_state == "Needs approval":
            return "The existing intake logic requires operator approval before this request can proceed."
        if decision_state == "Sandbox first":
            return "The existing intake logic requires sandbox validation before real-target work."
        return "The existing intake logic blocked this request before execution."


def _load_registry_projects(path: Path, *, source: str) -> List[SupportedProject]:
    payload = _load_json(path)
    if not isinstance(payload, dict):
        return []
    raw_projects = payload.get("projects")
    if not isinstance(raw_projects, list):
        return []

    projects: List[SupportedProject] = []
    for item in raw_projects:
        if not isinstance(item, dict):
            continue
        project_path = Path(str(item.get("path") or "")).expanduser()
        if not project_path.exists():
            continue
        status = str(item.get("status") or "supported").strip().lower()
        if status not in {"active", "supported", "ready", "stable"}:
            continue
        name = str(item.get("name") or project_path.name).strip() or project_path.name
        project_type = str(item.get("type") or "workspace").strip() or "workspace"
        projects.append(
            SupportedProject(
                name=name,
                path=project_path.resolve(),
                project_type=project_type,
                source=source,
                status=status,
            )
        )
    return projects


def _iter_runner_artifact_entries() -> Iterable[RecentRunEntry]:
    if not ARTIFACTS_ROOT.exists():
        return []
    entries: List[RecentRunEntry] = []
    for run_dir in ARTIFACTS_ROOT.iterdir():
        if not run_dir.is_dir():
            continue
        proof_summary = _load_json(run_dir / "proof_summary.json")
        if isinstance(proof_summary, dict):
            entries.append(
                RecentRunEntry(
                    title=str(proof_summary.get("prompt_text") or run_dir.name),
                    source="proof",
                    status=str(proof_summary.get("status") or "unknown"),
                    updated_at=_entry_timestamp(run_dir, proof_summary.get("timestamp")),
                    updated_label=_format_timestamp(_entry_timestamp(run_dir, proof_summary.get("timestamp"))),
                    detail=str(proof_summary.get("message") or "Proof artifact"),
                    path=run_dir,
                )
            )
            continue

        run_summary = _load_json(run_dir / "run_summary.json")
        if isinstance(run_summary, dict):
            status = str(run_summary.get("status") or run_summary.get("attach_status") or "unknown")
            title = str(run_summary.get("map_id") or run_dir.name)
            entries.append(
                RecentRunEntry(
                    title=title,
                    source="capture",
                    status=status,
                    updated_at=_entry_timestamp(run_dir, run_summary.get("timestamp")),
                    updated_label=_format_timestamp(_entry_timestamp(run_dir, run_summary.get("timestamp"))),
                    detail=str(run_summary.get("exe_path") or "Control panel run"),
                    path=run_dir,
                )
            )
    return entries


def _iter_session_entries() -> Iterable[RecentRunEntry]:
    if not ORCHESTRATOR_RUNS_ROOT.exists():
        return []
    entries: List[RecentRunEntry] = []
    for run_dir in ORCHESTRATOR_RUNS_ROOT.iterdir():
        if not run_dir.is_dir():
            continue
        session_summary = _load_json(run_dir / "session_summary.json")
        if not isinstance(session_summary, dict):
            continue
        status = str(
            session_summary.get("final_status")
            or session_summary.get("stop_reason")
            or session_summary.get("status")
            or "unknown"
        )
        detail_parts = [
            str(session_summary.get("source") or "").strip(),
            str(session_summary.get("stop_reason") or "").strip(),
        ]
        detail = " | ".join(part for part in detail_parts if part)
        entries.append(
            RecentRunEntry(
                title=str(session_summary.get("session_id") or run_dir.name),
                source="session",
                status=status,
                updated_at=_entry_timestamp(run_dir, session_summary.get("timestamp")),
                updated_label=_format_timestamp(_entry_timestamp(run_dir, session_summary.get("timestamp"))),
                detail=detail or "Persistent session",
                path=run_dir,
            )
        )
    return entries


def _load_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return None
    return payload if isinstance(payload, dict) else None


def _entry_timestamp(path: Path, raw_timestamp: Any) -> datetime:
    if isinstance(raw_timestamp, str):
        parsed = _parse_timestamp(raw_timestamp)
        if parsed is not None:
            return parsed
    return datetime.fromtimestamp(path.stat().st_mtime)


def _parse_timestamp(raw_timestamp: str) -> datetime | None:
    text = str(raw_timestamp or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone()
    except ValueError:
        return None


def _format_timestamp(timestamp: datetime) -> str:
    return timestamp.strftime("%Y-%m-%d %H:%M")


def _clean_decision_text(text: str) -> str:
    clean = str(text or "").strip()
    if clean.lower().startswith("decision:"):
        parts = clean.split("-", 1)
        if len(parts) == 2:
            return parts[1].strip().rstrip(".") + "."
    return clean
