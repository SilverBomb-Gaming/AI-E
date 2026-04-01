"""UI-side helpers for the AI-E v1 home screen."""
from __future__ import annotations

import json
import sys
import threading
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
DEFAULT_SANDBOX_SESSION_LIMIT_SECONDS = 10 * 60
DEFAULT_SANDBOX_HEARTBEAT_INTERVAL_SECONDS = 1
DEFAULT_SANDBOX_POLL_INTERVAL_SECONDS = 1
DEFAULT_SANDBOX_IDLE_TIMEOUT_SECONDS = 2
DEFAULT_SANDBOX_IDLE_TIMEOUT_POLL_LIMIT = 2

_BACKGROUND_SUPERVISOR_THREADS: dict[str, threading.Thread] = {}
_BACKGROUND_SUPERVISOR_LOCK = threading.Lock()


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
class HistoryEntry:
    title: str
    source: str
    project_display: str
    final_status: str
    updated_at: datetime
    updated_label: str
    summary: str
    path: Path
    session_summary_path: Path | None
    rerun_prompt: str
    rerun_project_path: str


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


@dataclass(frozen=True)
class ProofArtifactLink:
    label: str
    kind: str
    path: Path


@dataclass(frozen=True)
class ProofResultSurface:
    available: bool
    title: str
    source: str
    original_request: str
    normalized_request: str
    target_display: str
    detected_action: str
    final_verdict: str
    before_after_summary: str
    change_summary: str
    validation_outcome: str
    proof_status: str
    timestamp_label: str
    key_steps: List[str]
    validation_checks: List[str]
    raw_artifacts: List[ProofArtifactLink]
    primary_artifact_path: Path | None
    rerun_prompt: str
    rerun_project_path: str
    status_message: str


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
    return [
        RecentRunEntry(
            title=entry.title,
            source=entry.source.lower(),
            status=entry.final_status.lower(),
            updated_at=entry.updated_at,
            updated_label=entry.updated_label,
            detail=entry.summary,
            path=entry.path,
        )
        for entry in load_history_entries(limit=limit)
    ]


def load_history_entries(
    *,
    supported_projects: List[SupportedProject] | None = None,
    limit: int | None = None,
) -> List[HistoryEntry]:
    entries: List[HistoryEntry] = []
    projects = supported_projects or []
    seen_paths: set[str] = set()
    for run_dir in _history_candidate_dirs():
        key = str(run_dir.resolve()).lower()
        if key in seen_paths:
            continue
        seen_paths.add(key)
        proof = load_proof_result_surface(run_dir, supported_projects=projects)
        if not proof.available:
            continue
        entries.append(
            HistoryEntry(
                title=_history_title(proof),
                source=_history_source_label(proof.source),
                project_display=_history_project_display(proof.target_display),
                final_status=_history_final_status(proof.proof_status),
                updated_at=_entry_timestamp(run_dir, _history_timestamp_hint(run_dir)),
                updated_label=_format_timestamp(_entry_timestamp(run_dir, _history_timestamp_hint(run_dir))),
                summary=_history_summary(proof),
                path=run_dir,
                session_summary_path=_history_session_summary_path(run_dir),
                rerun_prompt=proof.rerun_prompt,
                rerun_project_path=proof.rerun_project_path,
            )
        )

    entries.sort(key=lambda item: item.updated_at, reverse=True)
    if isinstance(limit, int) and limit >= 0:
        return entries[:limit]
    return entries


def load_proof_result_surface(
    target: Path | str,
    *,
    supported_projects: List[SupportedProject] | None = None,
) -> ProofResultSurface:
    candidate = Path(str(target))
    run_dir = candidate if candidate.is_dir() else candidate.parent
    if not run_dir.exists():
        return _unavailable_proof_result_surface(
            "AI-E could not find saved result details for this item. Open a different finished run, or prepare a new request."
        )

    proof_summary = _load_json(run_dir / "proof_summary.json")
    if isinstance(proof_summary, dict):
        return _proof_result_from_proof_summary(run_dir, proof_summary, supported_projects=supported_projects or [])

    session_summary = _load_json(run_dir / "session_summary.json")
    if isinstance(session_summary, dict):
        return _proof_result_from_session_summary(run_dir, session_summary)

    run_summary = _load_json(run_dir / "run_summary.json")
    if isinstance(run_summary, dict):
        return _proof_result_from_run_summary(run_dir, run_summary, supported_projects=supported_projects or [])

    return _unavailable_proof_result_surface(
        "This item does not have a supported result summary yet. Open another saved run, or prepare a new request."
    )


class IntakePreviewBridge:
    """Thin wrapper that reuses the current intake logic without changing request state."""

    def __init__(self) -> None:
        self._intake_cls = None
        self._config_cls = None
        self._approve_mutation_task_fn = None
        self._build_review_bundle_fn = None
        self._create_review_decision_fn = None
        self._build_queue_preview_fn = None
        self._runtime_state_cls = None
        self._supervisor_cls = None
        self._supervisor_config_cls = None
        self._import_error: str | None = None

    def prepare_prompt(self, prompt_text: str, project: SupportedProject | None) -> PreparedPromptPreview:
        normalized = " ".join(str(prompt_text or "").split())
        target_repo = str(project.path).replace("\\", "/") if project else ""
        target_display = project.name if project else "Select a supported project to continue"
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
                decision_reason="Enter a request, then choose Prepare Request to see what AI-E will do next.",
                decision_summary="",
                next_action_label="Revise request",
                ready_for_intake=False,
                available=True,
                status_message="Enter a request to prepare it. AI-E has not started any work. Then review the decision before submitting it.",
            )

        intake = self._create_intake()
        if intake is None:
            message = self._import_error or "Request preview is unavailable. Try again, or revise the request to stay within supported scope."
            return PreparedPromptPreview(
                prompt_text=prompt_text,
                normalized_prompt=normalized,
                classification="unavailable",
                target_repo=target_repo,
                target_display=target_display,
                task_type="",
                detected_action="Request preview unavailable",
                execution_lane="",
                decision="",
                decision_state="Blocked",
                recommended_action="",
                decision_reason=message,
                decision_summary="",
                next_action_label="Revise request",
                ready_for_intake=False,
                available=False,
                status_message=f"{message} This request is prepared locally only. AI-E has not started any work.",
            )

        classification = intake.classify_message(normalized)
        try:
            routing = intake._resolve_intake_routing(
                normalized,
                session_id=DEFAULT_PREVIEW_SESSION_ID,
                target_repo=target_repo,
            )
            task_type = intake._derive_task_type(normalized, routing=routing)
        except Exception as exc:  # noqa: BLE001
            return PreparedPromptPreview(
                prompt_text=prompt_text,
                normalized_prompt=normalized,
                classification=classification,
                target_repo=target_repo,
                target_display=target_display,
                task_type="",
                detected_action="Request preview unavailable",
                execution_lane="",
                decision="",
                decision_state="Blocked",
                recommended_action="",
                decision_reason=f"{exc}. Revise the request and prepare it again.",
                decision_summary="",
                next_action_label="Revise request",
                ready_for_intake=classification == "task_request",
                available=False,
                status_message=f"Request preview failed: {exc}. Revise the request and prepare it again. AI-E has not started any work.",
            )

        ready_for_intake = classification == "task_request"
        decision = str(routing.decision or routing.execution_decision or "pending_preview")
        action = str(routing.recommended_action or "review")
        lane = str(routing.execution_lane or "")
        summary = str(routing.decision_summary or routing.intelligence_summary or "Prepared for review.")
        decision_state = self._decision_state(classification=classification, decision=decision)
        detected_action = self._detected_action(routing=routing, task_type=task_type)
        decision_reason = self._decision_reason(
            classification=classification,
            decision_state=decision_state,
            routing=routing,
        )
        next_action_label = self._next_action_label(decision_state)
        status_message = (
            f"Prepared for AI-E review. "
            f"Current decision: {decision_state}. "
            f"AI-E has not started any work."
        )
        if not ready_for_intake:
            status_message = (
                "This request is prepared, but AI-E does not recognize it as a supported request yet. "
                "Revise the request to stay within supported scope. AI-E has not started any work."
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
                message="Select a supported project before submitting a request, then prepare it again.",
                decision_state="Blocked",
                queue_status="",
                request_id="",
                task_id="",
            )
        if preview.decision_state != "Ready":
            return SubmittedPromptResult(
                ok=False,
                message="Only Ready requests can be submitted here. Revise the request or open review based on the current decision.",
                decision_state=preview.decision_state,
                queue_status="",
                request_id="",
                task_id="",
            )

        intake = self._create_intake()
        if intake is None:
            return SubmittedPromptResult(
                ok=False,
                message=self._import_error or "AI-E could not submit this request right now. Try again, or revise the request before retrying.",
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
                message=f"AI-E could not submit this request: {exc}. Try again, or revise the request before retrying.",
                decision_state="Blocked",
                queue_status="",
                request_id="",
                task_id="",
            )

        queue_status = str(result.queue_entry.get("status") or "pending")
        message = "Request submitted."
        if queue_status == "needs_approval":
            message = "Request submitted. AI-E is waiting for approval. Open review to confirm the safe next step."
        elif queue_status == "blocked":
            message = "Request submitted, but AI-E blocked it. Revise the request to stay within supported scope."
        elif not result.created:
            message = "This request was already submitted. Refresh status or open History to follow it."

        return SubmittedPromptResult(
            ok=True,
            message=message,
            decision_state="Ready",
            queue_status=queue_status,
            request_id=result.request_id,
            task_id=result.task_id,
        )

    def run_sandbox_prompt(
        self,
        preview: PreparedPromptPreview,
        *,
        project: SupportedProject | None,
        approved_by: str,
    ) -> ReviewActionResult:
        if project is None:
            return ReviewActionResult(
                ok=False,
                action="sandbox_first",
                message="Select a supported project before running in sandbox, then prepare the request again.",
                wired=False,
                staged_only=True,
                queue_status="",
                request_id="",
                task_id="",
            )
        if preview.decision_state != "Sandbox first":
            return ReviewActionResult(
                ok=False,
                action="sandbox_first",
                message="Only requests marked Sandbox first can run here. Prepare the request again to confirm the current decision.",
                wired=False,
                staged_only=True,
                queue_status=preview.decision.lower().strip(),
                request_id="",
                task_id="",
            )
        return self._start_sandbox_execution(
            prompt_text=preview.prompt_text,
            project=project,
            approved_by=approved_by,
            approval_notes="Sandbox-first run started from the AI-E v1 intake surface.",
        )

    def build_review_surface(
        self,
        preview: PreparedPromptPreview,
        project: SupportedProject | None,
    ) -> ReviewSurface:
        unavailable = self._unavailable_review_surface(
            preview,
            message="Review opens when a request needs approval. Prepare a request that needs approval to continue here.",
        )
        if project is None:
            return self._unavailable_review_surface(
                preview,
                message="Select a supported project before opening review, then prepare the request again.",
            )
        if preview.decision_state != "Needs approval":
            return unavailable

        context = self._resolve_review_context(preview, project)
        if context is None:
            return self._unavailable_review_surface(
                preview,
                message=self._import_error or "Review details are unavailable. Try again, or revise the request before reopening review.",
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
                message="Open a request that needs approval before taking a review action. Otherwise, revise the request or submit a Ready request.",
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
                message="Select a supported project before taking a review action, then reopen review.",
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
                    "Rejected here. AI-E did not run anything, and a direct reject action is not available yet."
                ),
            )
        if normalized_action == "sandbox_first":
            return self._start_sandbox_execution(
                prompt_text=review.prompt_text,
                project=project,
                approved_by=approved_by,
                approval_notes="Sandbox-first run started from the AI-E v1 review surface.",
            )
        return ReviewActionResult(
            ok=False,
            action=normalized_action,
            message="This review action is not available here. Return to the request and choose one of the shown review options.",
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
                self._import_error = f"Saved run details could not load: {exc}"
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
                "No run is visible for this request yet. Refresh status after submitting it, or open History to review earlier results."
            )

        return self._unavailable_live_status(
            "Submit or approve a request to start tracking it here. You can also open History to review earlier results."
        )

    def _create_intake(self) -> Any | None:
        if self._intake_cls is None or self._config_cls is None:
            try:
                self._ensure_imports()
            except Exception as exc:  # noqa: BLE001
                self._import_error = f"Request preview could not load: {exc}. Try again, or revise the request before preparing it."
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
                message=self._import_error or "Approval is unavailable right now. Try again, or return to the request and revise it.",
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
                message=f"AI-E could not submit this request for approval: {exc}. Try again, or revise the request before retrying.",
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
                    message=f"AI-E could not finish approval handoff: {exc}. Try again, or return to the request and revise it.",
                    wired=False,
                    staged_only=True,
                    queue_status=queue_status,
                    request_id=intake_result.request_id,
                    task_id=task_id,
                )

            return ReviewActionResult(
                ok=True,
                action="approve_once",
                message="Approved once. This request is now waiting to run, and AI-E did not start it from this surface. Refresh status to follow it.",
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
                message="This request is already waiting to run and does not need more review here. Refresh status to follow it.",
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
                message="AI-E blocked this request before approval could be recorded. Revise the request to stay within supported scope.",
                wired=True,
                staged_only=False,
                queue_status=queue_status,
                request_id=intake_result.request_id,
                task_id=task_id,
            )

        return ReviewActionResult(
            ok=False,
            action="approve_once",
            message="This request did not return an approval-required item. Return to the request and review the current intake decision.",
            wired=True,
            staged_only=False,
            queue_status=queue_status,
            request_id=intake_result.request_id,
            task_id=task_id,
        )

    def _start_sandbox_execution(
        self,
        *,
        prompt_text: str,
        project: SupportedProject,
        approved_by: str,
        approval_notes: str,
    ) -> ReviewActionResult:
        intake = self._create_intake()
        if (
            intake is None
            or self._approve_mutation_task_fn is None
            or self._supervisor_cls is None
            or self._supervisor_config_cls is None
        ):
            return ReviewActionResult(
                ok=False,
                action="sandbox_first",
                message=self._import_error or "Sandbox run is unavailable right now. Try again, or revise the request before retrying.",
                wired=False,
                staged_only=True,
                queue_status="",
                request_id="",
                task_id="",
            )

        try:
            intake_result = intake.accept_message(
                prompt_text,
                session_id=DEFAULT_SUBMIT_SESSION_ID,
                channel=DEFAULT_SUBMIT_CHANNEL,
                target_repo=str(project.path).replace("\\", "/"),
            )
        except Exception as exc:  # noqa: BLE001
            return ReviewActionResult(
                ok=False,
                action="sandbox_first",
                message=f"AI-E could not start this sandbox run: {exc}. Try again, or revise the request before retrying.",
                wired=False,
                staged_only=True,
                queue_status="",
                request_id="",
                task_id="",
            )

        queue_entry = dict(intake_result.queue_entry or {})
        queue_status = str(queue_entry.get("status") or "").strip().lower()
        approval_state = str(queue_entry.get("approval_state") or "").strip().lower()
        request_id = intake_result.request_id
        task_id = intake_result.task_id

        if queue_status == "blocked":
            return ReviewActionResult(
                ok=False,
                action="sandbox_first",
                message="AI-E blocked this request before sandbox execution could begin. Revise the request to stay within supported scope.",
                wired=True,
                staged_only=False,
                queue_status=queue_status,
                request_id=request_id,
                task_id=task_id,
            )

        if queue_status == "completed":
            return ReviewActionResult(
                ok=True,
                action="sandbox_first",
                message="This sandbox run is already complete. Open the result summary to review what changed.",
                wired=True,
                staged_only=False,
                queue_status=queue_status,
                request_id=request_id,
                task_id=task_id,
            )

        if queue_status == "running":
            return ReviewActionResult(
                ok=True,
                action="sandbox_first",
                message="Sandbox run is already in progress. Live status is tracking it now.",
                wired=True,
                staged_only=False,
                queue_status=queue_status,
                request_id=request_id,
                task_id=task_id,
            )

        if queue_status == "needs_approval":
            try:
                approval = self._approve_mutation_task_fn(
                    intake.config,
                    task_id=task_id,
                    approved_by=self._approved_by_name(approved_by),
                    notes=approval_notes,
                )
            except Exception as exc:  # noqa: BLE001
                return ReviewActionResult(
                    ok=False,
                    action="sandbox_first",
                    message=f"AI-E could not hand this request into sandbox execution: {exc}. Try again, or revise the request before retrying.",
                    wired=False,
                    staged_only=True,
                    queue_status=queue_status,
                    request_id=request_id,
                    task_id=task_id,
                )
            queue_status = str(approval.queue_status or "").strip().lower()
            approval_state = "approved"

        if queue_status == "pending" and approval_state in {"approved", "auto_approved", "not_required"}:
            session_id = self._sandbox_session_id(request_id)
            launched = self._launch_supervisor_session(intake.config, session_id=session_id)
            message = (
                "Sandbox run started. Live status is now tracking it."
                if launched
                else "Sandbox run is already active. Live status is now tracking it."
            )
            return ReviewActionResult(
                ok=True,
                action="sandbox_first",
                message=message,
                wired=True,
                staged_only=False,
                queue_status=queue_status,
                request_id=request_id,
                task_id=task_id,
            )

        return ReviewActionResult(
            ok=False,
            action="sandbox_first",
            message="AI-E could not hand this request into sandbox execution. Review the current status, then try again if needed.",
            wired=True,
            staged_only=False,
            queue_status=queue_status,
            request_id=request_id,
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
            extra_note = " This request is still waiting for approval because this action is staged only. Open review again when you are ready to continue."
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
            message = f"{message} Review preview: {explanation}"
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
            routing = intake._resolve_intake_routing(
                normalized_prompt,
                session_id=DEFAULT_PREVIEW_SESSION_ID,
                target_repo=target_repo,
            )
            task_type = intake._derive_task_type(normalized_prompt, routing=routing)
            request_id = intake._derive_request_id(normalized_prompt, target_repo, task_type)
        except Exception as exc:  # noqa: BLE001
            self._import_error = f"Review details could not load: {exc}. Try again, or revise the request before reopening review."
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
            risk_guardrail_status="Review opens only for requests that need approval. Prepare a request that needs approval to continue here.",
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
        return "This request needs one-time approval before it can continue. Open review to confirm the safe next step."

    @staticmethod
    def _expected_change_scope(*, preview: PreparedPromptPreview, routing: Any, project: SupportedProject) -> str:
        target_level = str(getattr(routing, "target_level", "") or "").strip()
        target_scene = str(getattr(routing, "target_scene", "") or "").strip()
        if target_level:
            return f"Limit the change to {target_level} in {project.name}."
        if target_scene:
            scene_name = Path(target_scene).stem or "the supported scene"
            return f"Limit the change to {scene_name} in {project.name}."
        if str(getattr(routing, "mutation_capable", False)).lower() == "true" or bool(getattr(routing, "mutation_capable", False)):
            return f"Limit the change to the approved edit scope in {project.name}."
        return f"Keep the request within the supported scope in {project.name}."

    @staticmethod
    def _validation_intent(*, routing: Any) -> str:
        missing_evidence = [str(item).strip() for item in getattr(routing, "missing_evidence", []) or [] if str(item).strip()]
        if bool(getattr(routing, "sandbox_first_required", False)):
            return "Validate in sandbox first before real changes are allowed."
        if missing_evidence:
            return f"AI-E should confirm the remaining proof checks: {', '.join(missing_evidence)}."
        return "AI-E should validate the change before marking it complete."

    @staticmethod
    def _risk_guardrail_status(*, routing: Any, queue_status: str, approval_state: str) -> str:
        parts: List[str] = []
        if queue_status == "needs_approval":
            parts.append("This request is waiting for approval.")
        elif queue_status == "pending":
            parts.append("Approval has already been recorded once. This request is waiting to run.")
        else:
            parts.append("No work has started yet. This request is still in review.")

        if bool(getattr(routing, "approval_required", False)):
            parts.append("One-time approval is required.")
        trust_band = str(getattr(routing, "trust_band", "") or "").strip()
        evidence_state = str(getattr(routing, "evidence_state", "") or getattr(routing, "maturity_stage", "") or "").strip()
        if evidence_state:
            parts.append(f"Proof coverage is {evidence_state}.")
        elif trust_band:
            parts.append(f"Confidence level is {trust_band}.")
        policy_state = str(getattr(routing, "policy_state", "") or "").strip()
        if policy_state:
            parts.append(f"Safety policy status is {policy_state.replace('_', ' ')}.")
        content_policy_decision = str(getattr(routing, "content_policy_decision", "") or "").strip()
        if content_policy_decision == "requires_review":
            parts.append("Safety review is required.")
        elif content_policy_decision == "allowed":
            parts.append("Safety review did not block this request.")
        if approval_state == "approved":
            parts.append("Approval has already been recorded once.")
        return " ".join(parts)

    @staticmethod
    def _review_status_message(*, queue_status: str, approval_state: str) -> str:
        if queue_status == "needs_approval":
            return "This request is waiting for approval. AI-E has not started any work. Approve it once, reject it, or keep it staged for sandbox-first review."
        if queue_status == "pending" and approval_state in {"approved", "auto_approved", "not_required"}:
            return "Approval was already recorded for this request. It is waiting to run. Refresh status to follow it."
        if queue_status == "blocked":
            return "AI-E has blocked this request. Revise it to stay within supported scope before preparing it again."
        return "This review is prepared only. AI-E has not started any work. Choose a review action when you are ready."

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

    @staticmethod
    def _sandbox_session_id(request_id: str) -> str:
        normalized = "".join(char.lower() if char.isalnum() else "_" for char in str(request_id or "").strip())
        compact = "_".join(part for part in normalized.split("_") if part)
        return f"product_surface_sandbox_{compact or 'request'}"

    def _launch_supervisor_session(self, config: Any, *, session_id: str) -> bool:
        if self._session_is_running(config, session_id=session_id):
            return False

        with _BACKGROUND_SUPERVISOR_LOCK:
            existing = _BACKGROUND_SUPERVISOR_THREADS.get(session_id)
            if existing is not None and existing.is_alive():
                return False

            def _run() -> None:
                try:
                    supervisor = self._supervisor_cls(
                        config,
                        self._supervisor_config_cls(
                            session_limit_seconds=DEFAULT_SANDBOX_SESSION_LIMIT_SECONDS,
                            heartbeat_interval_seconds=DEFAULT_SANDBOX_HEARTBEAT_INTERVAL_SECONDS,
                            poll_interval_seconds=DEFAULT_SANDBOX_POLL_INTERVAL_SECONDS,
                            idle_timeout_seconds=DEFAULT_SANDBOX_IDLE_TIMEOUT_SECONDS,
                            idle_timeout_poll_limit=DEFAULT_SANDBOX_IDLE_TIMEOUT_POLL_LIMIT,
                            session_id=session_id,
                            stop_when_queue_empty=True,
                        ),
                    )
                    supervisor.run()
                finally:
                    with _BACKGROUND_SUPERVISOR_LOCK:
                        _BACKGROUND_SUPERVISOR_THREADS.pop(session_id, None)

            worker = threading.Thread(
                target=_run,
                name=f"ai-e-sandbox-{session_id}",
                daemon=True,
            )
            _BACKGROUND_SUPERVISOR_THREADS[session_id] = worker

        worker.start()
        return True

    def _session_is_running(self, config: Any, *, session_id: str) -> bool:
        if not session_id or self._runtime_state_cls is None:
            return False
        snapshot = self._runtime_state_cls(config, session_id).get_snapshot()
        return str(snapshot.status or "").strip().lower() == "running"

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
            current_task=active_task or "No active task is reported yet. Refresh status after AI-E starts work.",
            queue_remaining=queue_remaining,
            heartbeat_status=heartbeat_status,
            waiting_reason=waiting_reason,
            approval_status=approval_status,
            final_state=final_state,
            poll_mode="Updated from saved run details.",
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

        waiting_reason = "No live run is visible for this request yet. Refresh status after submitting it."
        if queue_status == "needs_approval" or approval_state == "awaiting_approval":
            waiting_reason = "Waiting for approval before execution can begin. Open review to confirm the safe next step."
        elif queue_status == "blocked":
            waiting_reason = self._queue_block_reason(queue_entry)
        elif queue_status == "completed":
            waiting_reason = "This request has already finished. Open the result summary to review what happened."

        approval_status = self._queue_approval_status(queue_entry)
        final_state = self._queue_final_state(queue_entry)
        result_path = self._find_related_result_path(config, queue_entry=queue_entry, task_id=task_id)

        return LiveStatusSurface(
            available=True,
            status_badge=self._queue_status_badge(queue_status=queue_status, approval_state=approval_state),
            status_message="Updated from saved request details because no live run is visible yet. Refresh status after the request starts.",
            session_id="Not started yet",
            current_phase="Not started yet",
            current_task=str(queue_entry.get("title") or queue_entry.get("task_id") or "Prepared request"),
            queue_remaining=queue_remaining,
            heartbeat_status="No active heartbeat yet. Refresh status if this request should already be running.",
            waiting_reason=waiting_reason,
            approval_status=approval_status,
            final_state=final_state,
            poll_mode="Updated from saved request details.",
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
            return "AI-E is running, but it is waiting on the next step. Refresh status to check for progress."
        if final_state == "Completed":
            return "AI-E finished this run and saved the result. Open the result summary to review it."
        if final_state == "Blocked":
            return "AI-E halted this run because the request could not continue safely. Revise the request or open History to review earlier results."
        if final_state == "Failed":
            return "AI-E stopped without a successful result. Refresh status, or open History to review earlier results."
        return "AI-E status comes from the most recent saved run details. Refresh status to check again."

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
            return "Waiting for the next runnable step. Refresh status to check for progress."
        return "No pause reason was reported. Refresh status, or open History if you expect this run to be finished."

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
                return "Approval was granted automatically."
        if str(snapshot.status or "").strip().lower() == "running":
            for task in getattr(snapshot, "queue_tasks", []) or []:
                if str(task.get("status") or "").strip().lower() == "needs_approval":
                    return "At least one request is waiting for approval."
        if str(snapshot.stop_reason or "").strip().lower() == "blocked_needs_approval":
            return "Approval wait stopped this session."
        return "Approval is not currently holding this run."

    @staticmethod
    def _queue_status_badge(*, queue_status: str, approval_state: str) -> str:
        if queue_status == "needs_approval" or approval_state == "awaiting_approval":
            return "Awaiting approval"
        if queue_status == "pending":
            return "Waiting to run"
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
            return "Approval cannot proceed because this request is blocked. Revise the request before preparing it again."
        return "Approval is not holding this request."

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
        return "AI-E blocked this request before it started. Revise the request to stay within supported scope, then prepare it again."

    @staticmethod
    def _heartbeat_status_text(*, runtime_state: Any, snapshot: Any) -> str:
        age = runtime_state.heartbeat_age_seconds()
        if snapshot.status == "running":
            if age is None:
                return "Running, but no heartbeat has been saved yet. Refresh status to check for progress."
            return f"Active heartbeat seen {int(age)}s ago."
        if snapshot.heartbeat_timestamp:
            return f"Last heartbeat at {snapshot.heartbeat_timestamp}."
        return "No heartbeat has been saved. Refresh status if you expect active work."

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
            status_badge="Status not available",
            status_message=message,
            session_id="-",
            current_phase="-",
            current_task="-",
            queue_remaining="-",
            heartbeat_status="-",
            waiting_reason=message,
            approval_status="-",
            final_state="-",
            poll_mode="Updated from saved details when available. Refresh status to check again.",
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
        from ai_e_runtime.supervisor import Supervisor, SupervisorConfig
        from ai_e_runtime.task_intake import ConversationalTaskIntake
        from orchestrator.config import OrchestratorConfig

        self._approve_mutation_task_fn = approve_mutation_task
        self._build_review_bundle_fn = build_review_bundle
        self._create_review_decision_fn = create_review_decision
        self._build_queue_preview_fn = build_queue_preview
        self._runtime_state_cls = RuntimeState
        self._supervisor_cls = Supervisor
        self._supervisor_config_cls = SupervisorConfig
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
            return "AI-E does not recognize this as a supported request yet. Revise the request to stay within supported scope, then prepare it again."

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
            return "AI-E can accept this request without extra review. Submit it when you are ready."
        if decision_state == "Needs approval":
            return "This request needs one-time approval before it can continue. Open review to confirm the safe next step."
        if decision_state == "Sandbox first":
            return "This request should run in sandbox first before real changes are allowed. Keep it staged, or revise it to stay within supported scope."
        return "AI-E blocked this request before it could continue. Revise the request to stay within supported scope, then prepare it again."


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
                    detail=str(proof_summary.get("message") or "Saved result"),
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


def _history_candidate_dirs() -> List[Path]:
    candidates: List[Path] = []
    for root in (ARTIFACTS_ROOT, ORCHESTRATOR_RUNS_ROOT):
        if not root.exists():
            continue
        for run_dir in root.iterdir():
            if run_dir.is_dir():
                candidates.append(run_dir)
    return candidates


def _history_project_display(target_display: str) -> str:
    text = str(target_display or "").strip()
    if not text or text.lower().startswith("not recorded") or text.lower().startswith("not shown"):
        return "Project not shown"
    return text


def _history_source_label(source: str) -> str:
    normalized = str(source or "").strip().lower()
    if normalized == "proof":
        return "Result"
    if normalized == "capture":
        return "Observation"
    if normalized == "session":
        return "Session"
    return "Saved"


def _history_title(proof: ProofResultSurface) -> str:
    source = str(proof.source or "").strip().lower()
    if source == "proof":
        return proof.original_request or proof.detected_action or proof.title or "Result"
    if source == "capture":
        title = proof.title.strip()
        lowered = title.lower()
        if lowered.startswith("run "):
            title = title.replace("Run ", "", 1).strip()
        elif lowered.startswith("observation run:"):
            title = title.split(":", 1)[1].strip()
        elif lowered == "observation run":
            title = ""
        title = title or proof.target_display or "Observation run"
        if title == "Observation run":
            return title
        return f"Observation run: {title}"
    if source == "session":
        action = str(proof.detected_action or "").strip()
        if action and action.lower() not in {"persistent session run", "session review"}:
            return f"Session: {action}"
        return "Session review"
    return proof.title or "Saved result"


def _history_final_status(proof_status: str) -> str:
    normalized = str(proof_status or "").strip().lower()
    if normalized in {"passed", "completed"}:
        return "Passed"
    if normalized == "blocked":
        return "Blocked"
    if normalized == "failed":
        return "Failed"
    return "Saved"


def _history_summary(proof: ProofResultSurface) -> str:
    summary_candidates: List[str] = []
    if proof.source == "proof":
        summary_candidates = [proof.change_summary, proof.validation_outcome, proof.final_verdict, proof.before_after_summary]
    elif proof.source == "capture":
        summary_candidates = [proof.final_verdict, proof.validation_outcome, proof.before_after_summary]
    else:
        summary_candidates = [proof.final_verdict, proof.change_summary, proof.validation_outcome]

    for candidate in summary_candidates:
        text = _history_sentence(candidate)
        if text:
            return text
    if proof.key_steps:
        return _history_sentence(proof.key_steps[0]) or str(proof.key_steps[0]).strip()
    return "Open this result to review the saved details."


def _history_sentence(text: str) -> str:
    clean = str(text or "").strip()
    if not clean:
        return ""
    lowered = clean.lower()
    if (
        lowered.startswith("not recorded")
        or lowered.startswith("not shown")
        or "does not include a clear change summary" in lowered
        or "without a clear change summary" in lowered
        or lowered.startswith("detailed validation checks are not available")
    ):
        return ""
    sentence_break = clean.find(". ")
    if sentence_break >= 0:
        return clean[: sentence_break + 1].strip()
    return clean


def _history_timestamp_hint(run_dir: Path) -> Any:
    for filename in ("proof_summary.json", "session_summary.json", "run_summary.json"):
        payload = _load_json(run_dir / filename)
        if isinstance(payload, dict) and payload.get("timestamp"):
            return payload.get("timestamp")
    return None


def _history_session_summary_path(run_dir: Path) -> Path | None:
    for candidate in (run_dir / "session_summary.md", run_dir / "session_summary.json"):
        if candidate.exists():
            return candidate
    return None


def _proof_result_from_proof_summary(
    run_dir: Path,
    proof_summary: dict[str, Any],
    *,
    supported_projects: List[SupportedProject],
) -> ProofResultSurface:
    original_request = str(proof_summary.get("prompt_text") or "").strip()
    translated_request = str(
        ((proof_summary.get("prompt") or {}) if isinstance(proof_summary.get("prompt"), dict) else {}).get(
            "translated_command"
        )
        or ""
    ).strip()
    mutation = proof_summary.get("mutation") if isinstance(proof_summary.get("mutation"), dict) else {}
    validations = proof_summary.get("validations") if isinstance(proof_summary.get("validations"), dict) else {}
    playmode = proof_summary.get("playmode") if isinstance(proof_summary.get("playmode"), dict) else {}
    prompt_info = proof_summary.get("prompt") if isinstance(proof_summary.get("prompt"), dict) else {}
    router_info = proof_summary.get("router") if isinstance(proof_summary.get("router"), dict) else {}

    key_steps: List[str] = []
    if prompt_info:
        key_steps.append(f"Prompt translation: {_humanize_status(prompt_info.get('status') or prompt_info.get('router_status'))}.")
    if router_info:
        route_kind = str(router_info.get("route_kind") or "").strip()
        route_text = f" ({_humanize_text(route_kind)})" if route_kind else ""
        key_steps.append(f"Routing: {_humanize_status(router_info.get('status'))}{route_text}.")
    if mutation:
        mutation_status = _humanize_status(mutation.get("status"))
        step_name = _humanize_text(mutation.get("step_name") or mutation.get("action_type"))
        object_name = str(mutation.get("object_name") or "").strip()
        object_text = f" on {object_name}" if object_name else ""
        key_steps.append(f"Mutation: {mutation_status} - {step_name}{object_text}.")
    if playmode:
        ticks = playmode.get("ticks_observed")
        ticks_text = f" after {ticks} ticks" if isinstance(ticks, int) else ""
        key_steps.append(f"Validation: {_humanize_status(playmode.get('status'))}{ticks_text}.")

    proof_status = _proof_status_from_summary(proof_summary, validations=validations)
    validation_checks = _validation_check_lines(validations)
    validation_outcome = _proof_validation_outcome(proof_status=proof_status, validations=validations, playmode=playmode)
    target_display = _project_display_from_path(
        proof_summary.get("babylon_project_path"),
        supported_projects=supported_projects,
    )
    before_after_summary = _proof_before_after_summary(mutation)
    change_summary = _proof_change_summary(mutation)
    raw_artifacts: List[ProofArtifactLink] = []
    _append_artifact_link(raw_artifacts, label="Result summary", kind="summary", candidate=run_dir / "proof_summary.json")
    _append_artifact_link(raw_artifacts, label="Request details", kind="prompt", candidate=_artifact_effective_path(prompt_info, "artifact"))
    _append_artifact_link(raw_artifacts, label="Request log", kind="log", candidate=_artifact_effective_path(prompt_info, "log"))
    _append_artifact_link(raw_artifacts, label="Routing details", kind="router", candidate=_artifact_effective_path(router_info, "artifact"))
    _append_artifact_link(raw_artifacts, label="Routing log", kind="log", candidate=_artifact_effective_path(router_info, "log"))
    _append_artifact_link(raw_artifacts, label="Change details", kind="mutation", candidate=_artifact_effective_path(mutation, "artifact"))
    _append_artifact_link(raw_artifacts, label="Change log", kind="log", candidate=_artifact_effective_path(mutation, "log"))
    _append_artifact_link(raw_artifacts, label="Validation details", kind="validation", candidate=_artifact_effective_path(playmode, "artifact"))
    _append_artifact_link(raw_artifacts, label="Validation log", kind="log", candidate=_artifact_effective_path(playmode, "log"))

    return ProofResultSurface(
        available=True,
        title=original_request or _proof_title_from_mutation(mutation) or "Verified result",
        source="proof",
        original_request=original_request or "The original request is not available in this saved result.",
        normalized_request=translated_request if translated_request and translated_request != original_request else "",
        target_display=target_display,
        detected_action=_humanize_text(mutation.get("step_name") or mutation.get("action_type")) or "Verified change",
        final_verdict=_proof_final_verdict(
            proof_status=proof_status,
            proof_summary=proof_summary,
            mutation=mutation,
            validations=validations,
        ),
        before_after_summary=before_after_summary,
        change_summary=change_summary,
        validation_outcome=validation_outcome,
        proof_status=proof_status,
        timestamp_label=_format_timestamp(_entry_timestamp(run_dir, proof_summary.get("timestamp"))),
        key_steps=key_steps,
        validation_checks=validation_checks,
        raw_artifacts=raw_artifacts,
        primary_artifact_path=raw_artifacts[0].path if raw_artifacts else None,
        rerun_prompt=original_request,
        rerun_project_path=str(proof_summary.get("babylon_project_path") or "").strip(),
        status_message="Loaded from the saved result and supporting files.",
    )


def _proof_result_from_run_summary(
    run_dir: Path,
    run_summary: dict[str, Any],
    *,
    supported_projects: List[SupportedProject],
) -> ProofResultSurface:
    artifacts = run_summary.get("artifacts") if isinstance(run_summary.get("artifacts"), dict) else {}
    screenshots = artifacts.get("screenshots") if isinstance(artifacts.get("screenshots"), dict) else {}
    input_summary = artifacts.get("input") if isinstance(artifacts.get("input"), dict) else {}
    audio_summary = artifacts.get("audio") if isinstance(artifacts.get("audio"), dict) else {}
    focus = run_summary.get("focus") if isinstance(run_summary.get("focus"), dict) else {}
    warnings = run_summary.get("warnings") if isinstance(run_summary.get("warnings"), list) else []
    screenshot_count = int(screenshots.get("count", 0) or 0)
    status = str(run_summary.get("status") or run_summary.get("attach_status") or "").strip().lower()

    key_steps = [
        f"Connection: {_humanize_status(run_summary.get('attach_status'))} via {_humanize_text(run_summary.get('attach_method')) or 'selected method'}.",
        f"Screenshots available: {screenshot_count} ({_humanize_status(screenshots.get('status'))}).",
        f"Input recording: {_humanize_status(input_summary.get('status'))}.",
        f"Audio recording: {_humanize_status(audio_summary.get('status'))}.",
    ]
    validation_checks = [
        f"Focus tracking: {'Supported' if bool(focus.get('supported')) else 'Not supported'}.",
        f"Target focus time: {round(float(focus.get('target_focus_seconds', 0.0) or 0.0), 2)}s.",
    ]
    if warnings:
        validation_checks.extend(f"Warning: {str(item).strip()}" for item in warnings if str(item).strip())
    validation_outcome = _capture_validation_outcome(screenshot_count=screenshot_count, warnings=warnings)
    raw_artifacts: List[ProofArtifactLink] = []
    _append_artifact_link(raw_artifacts, label="Run summary", kind="summary", candidate=run_dir / "run_summary.json")
    for item in screenshots.get("items", []):
        if isinstance(item, dict):
            _append_artifact_link(
                raw_artifacts,
                label=f"Screenshot {_humanize_text(item.get('label')) or 'capture'}",
                kind="image",
                candidate=item.get("path"),
            )

    return ProofResultSurface(
        available=True,
        title=_capture_result_title(run_summary, run_dir),
        source="capture",
        original_request="This saved observation does not include the original request.",
        normalized_request="",
        target_display=_project_display_from_path(run_summary.get("exe_path"), supported_projects=supported_projects),
        detected_action="Observation run",
        final_verdict=_run_summary_verdict(run_summary, warnings=warnings),
        before_after_summary=(
            "Before and after screenshots are available for this run."
            if screenshot_count >= 2
            else ("One screenshot is available for this run." if screenshot_count == 1 else "")
        ),
        change_summary="This run recorded observations and diagnostics only.",
        validation_outcome=validation_outcome,
        proof_status=_run_summary_status(status),
        timestamp_label=_format_timestamp(_entry_timestamp(run_dir, run_summary.get("timestamp"))),
        key_steps=key_steps,
        validation_checks=validation_checks,
        raw_artifacts=raw_artifacts,
        primary_artifact_path=raw_artifacts[0].path if raw_artifacts else None,
        rerun_prompt="",
        rerun_project_path="",
        status_message="Loaded from the saved observation and supporting files.",
    )


def _proof_result_from_session_summary(run_dir: Path, session_summary: dict[str, Any]) -> ProofResultSurface:
    loop_visibility = session_summary.get("loop_visibility") if isinstance(session_summary.get("loop_visibility"), dict) else {}
    selector_visibility = (
        session_summary.get("selector_visibility") if isinstance(session_summary.get("selector_visibility"), dict) else {}
    )
    stop_reason = str(session_summary.get("stop_reason") or session_summary.get("status") or "").strip()
    final_status = str(session_summary.get("final_status") or "").strip()
    selected_task = str(selector_visibility.get("selected_task") or "").strip()
    tasks_attempted = int(session_summary.get("tasks_attempted", 0) or 0)
    tasks_completed = int(session_summary.get("tasks_completed", 0) or 0)
    tasks_blocked = int(session_summary.get("tasks_blocked", 0) or 0)
    integrity_issues = session_summary.get("integrity_issues") if isinstance(session_summary.get("integrity_issues"), list) else []

    key_steps = [
        f"Planned work attempted: {tasks_attempted} task(s).",
        f"Completed: {tasks_completed} task(s).",
        f"Blocked: {tasks_blocked} task(s).",
    ]
    if selected_task:
        key_steps.insert(0, f"Selected task: {selected_task}.")
    selector_reason = str(selector_visibility.get("reason") or "").strip()
    if selector_reason:
        key_steps.append(selector_reason.rstrip(".") + ".")

    validation_checks = [
        f"Last task result: {_humanize_status(loop_visibility.get('last_task_result_status') or stop_reason)}.",
        f"Integrity issues: {len(integrity_issues)}.",
    ]
    validation_outcome = (
        "No integrity issues were reported in this session."
        if not integrity_issues
        else f"{len(integrity_issues)} integrity issue(s) were reported in this session."
    )
    raw_artifacts: List[ProofArtifactLink] = []
    _append_artifact_link(raw_artifacts, label="Session summary", kind="summary", candidate=run_dir / "session_summary.json")
    _append_artifact_link(raw_artifacts, label="Session report", kind="report", candidate=run_dir / "session_summary.md")
    _append_artifact_link(raw_artifacts, label="Support report", kind="report", candidate=run_dir / "operator_report.md")

    return ProofResultSurface(
        available=True,
        title=_session_result_title(session_summary, selected_task=selected_task, run_dir=run_dir),
        source="session",
        original_request="This saved session does not include the original request.",
        normalized_request="",
        target_display="Project not shown in this saved session.",
        detected_action=selected_task or "Session review",
        final_verdict=_session_summary_verdict(
            stop_reason,
            final_status=final_status,
            tasks_completed=tasks_completed,
            tasks_blocked=tasks_blocked,
        ),
        before_after_summary="",
        change_summary=_session_change_summary(tasks_completed=tasks_completed, tasks_blocked=tasks_blocked),
        validation_outcome=validation_outcome,
        proof_status=_session_summary_status(
            stop_reason,
            final_status=final_status,
            tasks_completed=tasks_completed,
            tasks_blocked=tasks_blocked,
        ),
        timestamp_label=_format_timestamp(_entry_timestamp(run_dir, session_summary.get("timestamp"))),
        key_steps=key_steps,
        validation_checks=validation_checks,
        raw_artifacts=raw_artifacts,
        primary_artifact_path=raw_artifacts[0].path if raw_artifacts else None,
        rerun_prompt="",
        rerun_project_path="",
        status_message="Loaded from the saved session details and reports.",
    )


def _proof_before_after_summary(mutation: dict[str, Any]) -> str:
    object_name = str(mutation.get("object_name") or "The target object").strip()
    previous_position = mutation.get("previous_position")
    new_position = mutation.get("new_position")
    if isinstance(previous_position, list) and isinstance(new_position, list):
        return f"{object_name} moved from {_format_vector(previous_position)} to {_format_vector(new_position)}."
    if isinstance(new_position, list):
        return f"{object_name} ended at {_format_vector(new_position)}. The starting position is not available in this result."
    if isinstance(previous_position, list):
        return f"{object_name} started at {_format_vector(previous_position)}. The ending position is not available in this result."
    if mutation.get("position_changed") is True:
        return f"{object_name} changed position, but full before-and-after details are not available in this result."
    return ""


def _proof_change_summary(mutation: dict[str, Any]) -> str:
    if not mutation:
        return "This result does not include a clear change summary."
    object_name = str(mutation.get("object_name") or "target object").strip()
    action_type = _humanize_text(mutation.get("action_type") or mutation.get("step_name")) or "mutation"
    if mutation.get("position_changed") is True:
        distance = mutation.get("movement_distance")
        distance_text = f" Recorded movement: {distance} unit(s)." if isinstance(distance, (int, float)) else ""
        return f"AI-E moved {object_name} using {action_type}.{distance_text}"
    return f"AI-E applied {action_type} to {object_name}."


def _proof_title_from_mutation(mutation: dict[str, Any]) -> str:
    action_type = _humanize_text(mutation.get("action_type") or mutation.get("step_name"))
    object_name = str(mutation.get("object_name") or "").strip()
    if action_type and object_name:
        return f"{action_type} - {object_name}"
    return action_type or object_name


def _proof_final_verdict(
    *,
    proof_status: str,
    proof_summary: dict[str, Any],
    mutation: dict[str, Any],
    validations: dict[str, Any],
) -> str:
    raw_message = _clean_decision_text(str(proof_summary.get("message") or "").strip())
    object_name = str(mutation.get("object_name") or "").strip()
    if proof_status == "Passed":
        if object_name:
            return f"{object_name} changed successfully and the recorded checks passed."
        return "Requested change completed successfully and the recorded checks passed."
    if proof_status == "Failed":
        if validations:
            return "Requested change ran, but one or more recorded checks failed."
        return "Requested change did not finish cleanly."
    if proof_status == "Blocked":
        return "Requested change was stopped before it could complete."
    if raw_message:
        return raw_message
    return "Result saved with partial details."


def _proof_validation_outcome(*, proof_status: str, validations: dict[str, Any], playmode: dict[str, Any]) -> str:
    summary = _validation_summary(validations)
    if summary:
        return summary
    playmode_status = str(playmode.get("status") or "").strip()
    if proof_status == "Blocked":
        return "Validation stopped before detailed checks were saved."
    if playmode_status:
        return f"Validation was {_humanize_status(playmode_status).lower()}, but detailed checks are not available in this result."
    return "Detailed validation checks are not available in this result."


def _proof_status_from_summary(proof_summary: dict[str, Any], *, validations: dict[str, Any]) -> str:
    status = str(proof_summary.get("status") or "").strip().lower()
    message = str(proof_summary.get("message") or "").strip().lower()
    if "blocked" in message or status == "blocked":
        return "Blocked"
    if validations and any(value is False for value in validations.values()):
        return "Failed"
    if status in {"success", "ok", "passed"} or "passed" in message:
        return "Passed"
    if status in {"failed", "error"}:
        return "Failed"
    return _humanize_status(status) or "Saved"


def _run_summary_status(status: str) -> str:
    if status in {"ok", "connected", "success"}:
        return "Completed"
    if status == "blocked":
        return "Blocked"
    if status in {"failed", "error", "disconnected", "attention", "warning", "not_running"}:
        return "Failed"
    return _humanize_status(status) or "Saved"


def _run_summary_verdict(run_summary: dict[str, Any], *, warnings: List[Any]) -> str:
    status = str(run_summary.get("status") or run_summary.get("attach_status") or "").strip().lower()
    if status in {"ok", "connected", "success"}:
        if warnings:
            return "Observation run completed, with warnings to review."
        return "Observation run completed cleanly."
    if status == "blocked":
        return "Observation run was blocked before it could finish."
    if status in {"failed", "error", "disconnected", "attention", "warning", "not_running"}:
        return "Observation run ended without a clean result."
    return "Observation run was saved with partial details."


def _capture_validation_outcome(*, screenshot_count: int, warnings: List[Any]) -> str:
    screenshot_text = (
        "No screenshots are shown for this observation run."
        if screenshot_count <= 0
        else (f"{screenshot_count} screenshot was saved." if screenshot_count == 1 else f"{screenshot_count} screenshots were saved.")
    )
    if warnings:
        warning_text = "1 warning was recorded." if len(warnings) == 1 else f"{len(warnings)} warnings were recorded."
        return f"{screenshot_text} {warning_text}"
    return f"{screenshot_text} No warnings were recorded."


def _capture_result_title(run_summary: dict[str, Any], run_dir: Path) -> str:
    map_id = str(run_summary.get("map_id") or "").strip()
    if map_id:
        return f"Observation run: {map_id}"
    return "Observation run"


def _session_summary_status(stop_reason: str, *, final_status: str, tasks_completed: int, tasks_blocked: int) -> str:
    normalized_final = final_status.strip().lower()
    normalized = stop_reason.strip().lower()
    if normalized_final in {"playable", "passed", "success", "completed"}:
        return "Completed"
    if normalized_final in {"failed", "error"}:
        return "Failed"
    if normalized in {"queue_empty", "queue_empty_idle_timeout", "complete"} and tasks_completed > 0 and tasks_blocked == 0:
        return "Completed"
    if normalized in {"queue_empty_idle_timeout"} and tasks_completed == 0 and tasks_blocked == 0:
        return "Failed"
    if normalized in {"blocked_needs_approval", "all_remaining_tasks_blocked", "repeated_failure_threshold_exceeded"}:
        return "Blocked"
    if tasks_blocked > 0:
        return "Blocked"
    if tasks_completed > 0:
        return "Completed"
    return _humanize_status(normalized) or "Saved"


def _session_summary_verdict(stop_reason: str, *, final_status: str, tasks_completed: int, tasks_blocked: int) -> str:
    normalized_final = final_status.strip().lower()
    normalized = stop_reason.strip().lower()
    if normalized_final == "playable":
        return "Session reached a playable outcome."
    if normalized_final in {"passed", "success", "completed"}:
        return "Session finished successfully."
    if normalized_final in {"failed", "error"}:
        return "Session ended without a successful outcome."
    if normalized in {"queue_empty", "queue_empty_idle_timeout", "complete"}:
        return f"Session finished after completing {tasks_completed} task(s)."
    if normalized == "queue_empty_idle_timeout" and tasks_completed == 0 and tasks_blocked == 0:
        return "Session ended after waiting without completing work."
    if normalized == "blocked_needs_approval":
        return "Session paused because more work needs approval."
    if normalized == "repeated_failure_threshold_exceeded":
        return "Session stopped after the repeated failure threshold was reached."
    if normalized == "all_remaining_tasks_blocked":
        return "Session stopped because the remaining work was blocked."
    if tasks_blocked > 0:
        return f"Session ended with {tasks_blocked} blocked task(s)."
    return "Session ended with partial details."


def _session_change_summary(*, tasks_completed: int, tasks_blocked: int) -> str:
    if tasks_completed > 0:
        blocked_text = f" {tasks_blocked} task(s) were blocked." if tasks_blocked else ""
        return f"AI-E completed {tasks_completed} task(s) in this session.{blocked_text}"
    if tasks_blocked > 0:
        return f"This session recorded blocked work, but no completed change summary is available. {tasks_blocked} task(s) were blocked."
    return "This session ended without a clear change summary."


def _session_result_title(session_summary: dict[str, Any], *, selected_task: str, run_dir: Path) -> str:
    if selected_task:
        return f"Session: {selected_task}"
    return "Session review"


def _validation_check_lines(validations: dict[str, Any]) -> List[str]:
    lines: List[str] = []
    for key, value in validations.items():
        lines.append(f"{_humanize_text(key)}: {'Passed' if bool(value) else 'Failed'}.")
    return lines


def _validation_summary(validations: dict[str, Any]) -> str:
    if not validations:
        return ""
    total = len(validations)
    passed = sum(1 for value in validations.values() if bool(value))
    if passed == total:
        return "All recorded checks passed."
    if passed == 0:
        return f"All {total} recorded check(s) failed."
    return f"{passed} of {total} recorded check(s) passed."


def _project_display_from_path(raw_path: Any, *, supported_projects: List[SupportedProject]) -> str:
    text = str(raw_path or "").strip()
    if not text:
        return "Project not shown in this result."
    try:
        candidate = Path(text).resolve()
    except OSError:
        candidate = Path(text)
    normalized = str(candidate).lower()
    for project in supported_projects:
        if str(project.path).lower() == normalized:
            return project.name
    if candidate.suffix:
        return candidate.stem or candidate.name
    return candidate.name or text


def _artifact_effective_path(payload: dict[str, Any], key: str) -> str:
    artifact = payload.get(key)
    if not isinstance(artifact, dict):
        return ""
    return str(
        artifact.get("effective_path")
        or artifact.get("copied_path")
        or artifact.get("original_path")
        or ""
    ).strip()


def _append_artifact_link(
    raw_artifacts: List[ProofArtifactLink],
    *,
    label: str,
    kind: str,
    candidate: Any,
) -> None:
    text = str(candidate or "").strip()
    if not text:
        return
    path = Path(text)
    if not path.exists():
        return
    if any(existing.path == path for existing in raw_artifacts):
        return
    raw_artifacts.append(ProofArtifactLink(label=label, kind=kind, path=path))


def _unavailable_proof_result_surface(message: str) -> ProofResultSurface:
    return ProofResultSurface(
        available=False,
        title="Result not available",
        source="",
        original_request="",
        normalized_request="",
        target_display="",
        detected_action="",
        final_verdict=message,
        before_after_summary="",
        change_summary="",
        validation_outcome="",
        proof_status="Unavailable",
        timestamp_label="",
        key_steps=[],
        validation_checks=[],
        raw_artifacts=[],
        primary_artifact_path=None,
        rerun_prompt="",
        rerun_project_path="",
        status_message=message,
    )


def _load_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    payload: Any = None
    for encoding in ("utf-8", "utf-8-sig"):
        try:
            payload = json.loads(path.read_text(encoding=encoding))
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            payload = None
            continue
        break
    return payload if isinstance(payload, dict) else None


def _entry_timestamp(path: Path, raw_timestamp: Any) -> datetime:
    if isinstance(raw_timestamp, str):
        parsed = _parse_timestamp(raw_timestamp)
        if parsed is not None:
            return parsed
    return datetime.fromtimestamp(path.stat().st_mtime).astimezone()


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


def _humanize_text(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    return text.replace("_", " ").replace("-", " ").strip().capitalize()


def _humanize_status(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return "Not shown"
    return text.replace("_", " ").strip().capitalize()


def _format_vector(values: List[Any]) -> str:
    formatted = ", ".join(f"{float(value):g}" if isinstance(value, (int, float)) else str(value) for value in values)
    return f"({formatted})"


def _clean_decision_text(text: str) -> str:
    clean = str(text or "").strip()
    if clean.lower().startswith("decision:"):
        parts = clean.split("-", 1)
        if len(parts) == 2:
            return parts[1].strip().rstrip(".") + "."
    return clean
