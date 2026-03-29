from __future__ import annotations

from orchestrator.env_guard import enforce_python

enforce_python()

import json
import subprocess
import sys
from pathlib import Path

from .continuation_queue_bridge import build_continuation_queue_entries
from .decomposer import decompose_prompt
from .decomposer_queue_persist import enqueue_prompt_tasks
from .evaluation_feedback import apply_user_selection
from .evaluation_ranker import rank_grouped_tasks
from .evaluation_recommender import recommend_from_ranked
from .evaluation_selector import group_tasks_for_selection
from .level_playability_analyzer import analyze_first_validation_target
from .playability_report_contract import build_playability_report
from .utils import read_json, slugify, write_json


def run_autonomous_cycle(prompt: str, max_iterations: int = 3):
    normalized_prompt = " ".join(str(prompt or "").strip().split())
    if not normalized_prompt:
        raise ValueError("prompt must be a non-empty string.")

    iteration_limit = max(1, int(max_iterations or 1))
    current_entries = enqueue_prompt_tasks(normalized_prompt)
    iterations: list[dict] = []
    stop_reason = "max_iterations_reached"

    for iteration_index in range(1, iteration_limit + 1):
        if not current_entries:
            stop_reason = "no_tasks_remain"
            break

        iteration_input_entries = [dict(entry) for entry in current_entries]
        session_id = _build_session_id(normalized_prompt, iteration_index)
        session_result = _run_session_runner(session_id)
        playability_report = _build_playability_report_for_iteration()
        selection_tasks = _selection_tasks_for_iteration(iteration_index, normalized_prompt, playability_report)
        grouped = group_tasks_for_selection(selection_tasks, playability_report=playability_report)
        ranked = rank_grouped_tasks(grouped, playability_report=playability_report)
        recommendations = recommend_from_ranked(ranked, playability_report=playability_report)
        selected_task_id = _top_recommended_task_id(recommendations)

        feedback = {}
        generated_continuation_entries: list[dict] = []
        persisted_continuation_entries: list[dict] = []

        if selected_task_id:
            feedback = apply_user_selection(recommendations, selected_task_id)
            generated_continuation_entries = build_continuation_queue_entries(feedback)
            persisted_continuation_entries = _append_queue_entries(generated_continuation_entries)
            current_entries = persisted_continuation_entries
        else:
            stop_reason = "no_tasks_remain"
            current_entries = []

        iterations.append(
            {
                "iteration": iteration_index,
                "session_id": session_id,
                "input_entries": iteration_input_entries,
                "session_result": session_result,
                "playability_report": playability_report,
                "grouped": grouped,
                "ranked": ranked,
                "recommendations": recommendations,
                "selected_task_id": selected_task_id,
                "feedback": feedback,
                "generated_continuation_entries": generated_continuation_entries,
                "persisted_continuation_entries": persisted_continuation_entries,
            }
        )

        if stop_reason == "no_tasks_remain":
            break

    return {
        "prompt": normalized_prompt,
        "max_iterations": iteration_limit,
        "iterations_completed": len(iterations),
        "stop_reason": stop_reason,
        "iterations": iterations,
    }


def _selection_tasks_for_iteration(iteration_index: int, prompt: str, playability_report: dict) -> list[dict]:
    redesign = playability_report.get("redesign")
    if isinstance(redesign, dict) and redesign.get("required"):
        redesign_tasks = redesign.get("tasks")
        if isinstance(redesign_tasks, list):
            normalized_tasks = [dict(task) for task in redesign_tasks if isinstance(task, dict)]
            if normalized_tasks:
                return normalized_tasks
    if iteration_index == 1:
        return decompose_prompt(prompt)
    return []


def _build_playability_report_for_iteration() -> dict:
    validation = analyze_first_validation_target()
    analysis = dict(validation.get("analysis") or {})
    stabilization_report_summary = validation.get("stabilization_report_summary")
    level_id = "LEVEL_0001"
    if isinstance(stabilization_report_summary, dict):
        level_id = str(stabilization_report_summary.get("level_id") or level_id)
    redesign_tasks = [dict(task) for task in analysis.get("redesigned_layout_tasks", []) if isinstance(task, dict)]
    return build_playability_report(
        level_id=level_id,
        analysis_result=analysis,
        redesign_tasks=redesign_tasks,
    )


def _top_recommended_task_id(recommendations: dict) -> str:
    for _, group_payload in sorted(recommendations.items(), key=lambda item: item[0]):
        recommended_task = group_payload.get("recommended_task")
        if not isinstance(recommended_task, dict):
            continue
        task_id = str(recommended_task.get("task_id") or "").strip()
        if task_id:
            return task_id
    return ""


def _build_session_id(prompt: str, iteration_index: int) -> str:
    return f"autonomous_loop_{slugify(prompt)}_{iteration_index:02d}"


def _run_session_runner(session_id: str) -> dict:
    root_dir = Path(__file__).resolve().parents[1]
    command = [
        str(_python_executable(root_dir)),
        str(root_dir / "session_runner.py"),
        "--session-id",
        session_id,
        "--stop-when-queue-empty",
        "--idle-timeout-seconds",
        "5",
        "--idle-timeout-poll-limit",
        "1",
    ]
    result = subprocess.run(
        command,
        cwd=root_dir,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"session_runner failed for {session_id} with exit code {result.returncode}: {result.stderr.strip() or result.stdout.strip()}"
        )

    session_dir = root_dir / "runs" / session_id
    return {
        "returncode": result.returncode,
        "stdout": result.stdout.strip(),
        "stderr": result.stderr.strip(),
        "session_summary": read_json(session_dir / "session_summary.json", default={}),
        "runtime_status": read_json(session_dir / "runtime_status.json", default={}),
    }


def _python_executable(root_dir: Path) -> Path:
    venv_python = root_dir.parent / ".venv" / "Scripts" / "python.exe"
    if venv_python.exists():
        return venv_python
    return Path(sys.executable)


def _append_queue_entries(entries: list[dict]) -> list[dict]:
    root_dir = Path(__file__).resolve().parents[1]
    queue_path = root_dir / "backlog" / "queue.json"
    payload = read_json(queue_path, default={"tasks": []})
    existing_tasks = payload.get("tasks")
    if not isinstance(existing_tasks, list):
        existing_tasks = []
        payload["tasks"] = existing_tasks

    existing_ids = {
        str(task.get("task_id") or "").strip()
        for task in existing_tasks
        if str(task.get("task_id") or "").strip()
    }
    persisted_entries: list[dict] = []

    for entry in entries:
        normalized_entry = dict(entry)
        original_task_id = str(normalized_entry.get("task_id") or "task").strip() or "task"
        resolved_task_id = _resolve_task_id(original_task_id, existing_ids)
        if resolved_task_id != original_task_id:
            normalized_entry["task_id"] = resolved_task_id
            _rewrite_contract_for_task(root_dir, normalized_entry, original_task_id, resolved_task_id)
            normalized_entry["contract_path"] = _relative_contract_path(resolved_task_id)
        existing_ids.add(resolved_task_id)
        existing_tasks.append(normalized_entry)
        persisted_entries.append(normalized_entry)

    write_json(queue_path, payload)
    return persisted_entries


def _resolve_task_id(base_task_id: str, existing_ids: set[str]) -> str:
    if base_task_id not in existing_ids:
        return base_task_id
    suffix = 2
    while True:
        candidate = f"{base_task_id}_{suffix}"
        if candidate not in existing_ids:
            return candidate
        suffix += 1


def _rewrite_contract_for_task(root_dir: Path, entry: dict, original_task_id: str, resolved_task_id: str) -> None:
    existing_contract_path = root_dir / _relative_contract_path(original_task_id)
    payload = read_json(existing_contract_path, default={})
    runtime_task = payload.get("runtime_task")
    if not isinstance(runtime_task, dict):
        runtime_task = {}
        payload["runtime_task"] = runtime_task
    runtime_task["task_id"] = resolved_task_id
    runtime_task["title"] = str(entry.get("title") or runtime_task.get("title") or "Generated task")
    write_json(root_dir / _relative_contract_path(resolved_task_id), payload)


def _relative_contract_path(task_id: str) -> str:
    return f"contracts/generated_runtime/{task_id}.json"


if __name__ == "__main__":
    print(json.dumps(run_autonomous_cycle("extend map with 4 variations", max_iterations=2), indent=2))