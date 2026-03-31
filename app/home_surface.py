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

    def _create_intake(self) -> Any | None:
        if self._intake_cls is None or self._config_cls is None:
            try:
                self._ensure_imports()
            except Exception as exc:  # noqa: BLE001
                self._import_error = f"Existing intake preview could not load: {exc}"
                return None
        config = self._config_cls.load()
        return self._intake_cls(config)

    def _ensure_imports(self) -> None:
        orchestrator_path = str(ORCHESTRATOR_ROOT)
        if orchestrator_path not in sys.path:
            sys.path.insert(0, orchestrator_path)
        from ai_e_runtime.task_intake import ConversationalTaskIntake
        from orchestrator.config import OrchestratorConfig

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
