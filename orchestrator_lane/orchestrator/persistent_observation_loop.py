from __future__ import annotations

from orchestrator.env_guard import enforce_python

enforce_python()

import json
from collections import Counter
from hashlib import sha256
from pathlib import Path


ALLOWED_ARTIFACT_FILES = {
    "action_plan.json": "action_plan",
    "closed_validation_result.json": "closed_validation_result",
    "comparison_summary.json": "comparison_summary",
    "playability_report.json": "playability_report",
    "recommendations.json": "recommendations",
    "runtime_status.json": "runtime_status",
    "session_summary.json": "session_summary",
}
RECOMMENDATION_KEYS = {
    "recommendation_id",
    "category",
    "priority",
    "title",
    "description",
    "evidence",
    "suggested_next_step",
    "requires_approval",
    "source",
}
STABLE_STATE_THRESHOLD = 2
STAGNATION_THRESHOLD = 2


def run_persistent_observation_cycle(session_id: str, max_cycles: int = 5) -> dict:
    normalized_session_id = str(session_id or "").strip()
    if not normalized_session_id:
        raise ValueError("session_id must be a non-empty string.")

    cycle_limit = max(1, int(max_cycles or 1))
    previous_signature = ""
    stable_state_streak = 0
    stagnation_streak = 0
    final_output: dict | None = None

    for cycle_index in range(1, cycle_limit + 1):
        artifacts = collect_observation_artifacts(normalized_session_id)
        pattern_report = analyze_observation_patterns(artifacts)
        recommendations = build_observation_recommendations(pattern_report)

        if pattern_report["stable_successes"]:
            stable_state_streak += 1
        else:
            stable_state_streak = 0

        if pattern_report["stagnation_signals"]:
            stagnation_streak += 1
        else:
            stagnation_streak = 0

        termination_reason = "max_cycles_reached"
        current_signature = str(artifacts.get("artifact_signature") or "")
        collected_files = list(artifacts.get("collected_files") or [])

        if not collected_files:
            termination_reason = "no_new_artifacts_found"
        elif stable_state_streak >= STABLE_STATE_THRESHOLD:
            termination_reason = "stable_state_detected"
        elif stagnation_streak >= STAGNATION_THRESHOLD:
            termination_reason = "repeated_stagnation_threshold"
        elif previous_signature and current_signature == previous_signature:
            termination_reason = "no_new_artifacts_found"
        elif cycle_index == cycle_limit:
            termination_reason = "max_cycles_reached"

        cycle_output = {
            "session_id": normalized_session_id,
            "cycles_used": cycle_index,
            "artifacts_collected": artifacts,
            "pattern_report": pattern_report,
            "recommendations": recommendations,
            "termination_reason": termination_reason,
            "source": "persistent_observation_loop",
        }
        _persist_observation_summary(normalized_session_id, cycle_output, cycle_index=cycle_index)
        final_output = cycle_output

        previous_signature = current_signature
        if termination_reason != "max_cycles_reached" or cycle_index == cycle_limit:
            break

    assert final_output is not None
    _persist_observation_summary(normalized_session_id, final_output, cycle_index=None)
    return final_output


def collect_observation_artifacts(session_id: str) -> dict:
    normalized_session_id = str(session_id or "").strip()
    if not normalized_session_id:
        raise ValueError("session_id must be a non-empty string.")

    session_dir = _session_dir(normalized_session_id)
    collected_files: list[str] = []
    artifacts_payload: dict[str, dict | list] = {}

    if session_dir.exists():
        for file_name in sorted(ALLOWED_ARTIFACT_FILES.keys()):
            artifact_path = session_dir / file_name
            if not artifact_path.exists() or not artifact_path.is_file():
                continue
            artifact_key = ALLOWED_ARTIFACT_FILES[file_name]
            artifacts_payload[artifact_key] = _read_json_artifact(artifact_path)
            collected_files.append(file_name)

    signature_input = {
        "session_id": normalized_session_id,
        "collected_files": collected_files,
        "artifacts": artifacts_payload,
    }
    artifact_signature = sha256(
        json.dumps(signature_input, indent=2, sort_keys=True).encode("utf-8")
    ).hexdigest()

    return {
        "session_id": normalized_session_id,
        "run_path": str(session_dir),
        "collected_files": collected_files,
        "artifact_counts": {
            "total_files": len(collected_files),
            **{artifact_key: int(artifact_key in artifacts_payload) for artifact_key in sorted(ALLOWED_ARTIFACT_FILES.values())},
        },
        "artifacts": artifacts_payload,
        "artifact_signature": artifact_signature,
    }


def analyze_observation_patterns(artifacts: dict) -> dict:
    payload = dict(artifacts.get("artifacts") or {})
    playability_report = _as_dict(payload.get("playability_report"))
    closed_validation_result = _as_dict(payload.get("closed_validation_result"))
    comparison_summary = _as_list_of_dicts(closed_validation_result.get("comparison_summary"))

    improvement_trends: list[str] = []
    stagnation_signals: list[str] = []
    repeat_failures: list[str] = []
    stable_successes: list[str] = []

    improved_entries = [entry for entry in comparison_summary if bool(entry.get("improved"))]
    if improved_entries or bool(closed_validation_result.get("improvement")):
        improvement_trends.append(
            f"repeated_improvement: {max(1, len(improved_entries))} improvement signal(s) observed in canonical closed-loop results."
        )

    if str(closed_validation_result.get("termination_reason") or "") == "stagnation":
        stagnation_signals.append(
            "repeated_stagnation: closed validation loop terminated due to stagnation."
        )
    elif comparison_summary and all(not bool(entry.get("improved")) for entry in comparison_summary):
        stagnation_signals.append(
            "repeated_stagnation: comparison summaries show no material improvement across observed iterations."
        )

    unresolved_task_ids: list[str] = []
    unresolved_count = 0
    for entry in comparison_summary:
        validation = _as_dict(entry.get("action_validation"))
        unresolved_count += int(validation.get("unresolved_action_count", 0) or 0)
        unresolved_task_ids.extend(_as_string_list(validation.get("unsupported_task_ids")))
    if unresolved_count > 0 or unresolved_task_ids:
        unique_ids = ", ".join(sorted(set(unresolved_task_ids))) or "unknown targets"
        repeat_failures.append(
            f"repeated_unresolved_actions: {unresolved_count} unresolved action signal(s) observed for {unique_ids}."
        )

    if _is_playable_state(playability_report) or str(closed_validation_result.get("final_status") or "") == "playable":
        stable_successes.append(
            "stable_playable_state: canonical persisted artifacts report a playable state."
        )

    blocking_issue_counter = Counter()
    blocking_issue_counter.update(_extract_blocking_issues(playability_report))
    blocking_issue_counter.update(_extract_blocking_issues(_as_dict(closed_validation_result.get("final_report"))))
    recurring_issues = sorted(issue for issue, count in blocking_issue_counter.items() if count > 1)
    for issue in recurring_issues:
        repeat_failures.append(
            f"recurring_blocking_issue: {issue}"
        )

    return {
        "improvement_trends": improvement_trends,
        "stagnation_signals": stagnation_signals,
        "repeat_failures": repeat_failures,
        "stable_successes": stable_successes,
    }


def build_observation_recommendations(pattern_report: dict) -> list[dict]:
    normalized_report = dict(pattern_report or {})
    recommendations: list[dict] = []

    recommendations.extend(
        _build_recommendations_for_category(
            normalized_report.get("repeat_failures"),
            category="failure_pattern",
            priority=90,
            title="Review repeated observation failures",
            description="Observed canonical artifacts show repeated unresolved actions or blocking issues.",
            suggested_next_step="Review report-driven redesign and scene-action coverage before any approved execution change.",
            requires_approval=True,
        )
    )
    recommendations.extend(
        _build_recommendations_for_category(
            normalized_report.get("stagnation_signals"),
            category="stagnation_pattern",
            priority=80,
            title="Investigate repeated stagnation",
            description="Observed canonical artifacts show repeated stagnation without meaningful improvement.",
            suggested_next_step="Inspect canonical comparison summaries and decide whether a bounded corrective milestone is warranted.",
            requires_approval=True,
        )
    )
    recommendations.extend(
        _build_recommendations_for_category(
            normalized_report.get("improvement_trends"),
            category="improvement_pattern",
            priority=40,
            title="Capture stable improvement evidence",
            description="Observed canonical artifacts show repeatable improvement signals.",
            suggested_next_step="Review improvement evidence and decide whether to preserve it as a formal verified baseline.",
            requires_approval=True,
        )
    )
    recommendations.extend(
        _build_recommendations_for_category(
            normalized_report.get("stable_successes"),
            category="stable_success",
            priority=20,
            title="Maintain stable playable state",
            description="Observed canonical artifacts indicate a stable playable result.",
            suggested_next_step="Continue bounded observation and preserve the validated state unless an approved expansion is requested.",
            requires_approval=False,
        )
    )

    if recommendations:
        return recommendations

    return [
        {
            "recommendation_id": "observation_recommendation_01",
            "category": "monitoring",
            "priority": 10,
            "title": "Continue bounded observation",
            "description": "No qualifying observation patterns were detected in canonical persisted artifacts.",
            "evidence": ["No qualifying observation patterns detected."],
            "suggested_next_step": "Wait for additional canonical artifacts before proposing any approved changes.",
            "requires_approval": False,
            "source": "persistent_observation_loop",
        }
    ]


def _build_recommendations_for_category(
    evidence_items: object,
    *,
    category: str,
    priority: int,
    title: str,
    description: str,
    suggested_next_step: str,
    requires_approval: bool,
) -> list[dict]:
    evidence = _as_string_list(evidence_items)
    if not evidence:
        return []
    recommendation_id = f"{category}_01"
    return [
        {
            "recommendation_id": recommendation_id,
            "category": category,
            "priority": priority,
            "title": title,
            "description": description,
            "evidence": evidence,
            "suggested_next_step": suggested_next_step,
            "requires_approval": requires_approval,
            "source": "persistent_observation_loop",
        }
    ]


def _persist_observation_summary(session_id: str, payload: dict, cycle_index: int | None) -> None:
    destination_name = "observation_summary.json"
    if cycle_index is not None:
        destination_name = f"observation_summary_cycle_{cycle_index:02d}.json"
    destination = _session_dir(session_id) / destination_name
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _read_json_artifact(path: Path) -> dict | list:
    return json.loads(path.read_text(encoding="utf-8"))


def _session_dir(session_id: str) -> Path:
    return _runs_root() / session_id


def _runs_root() -> Path:
    return Path(__file__).resolve().parents[1] / "runs"


def _is_playable_state(report: dict) -> bool:
    readiness = _as_dict(report.get("readiness"))
    if bool(readiness.get("playable")):
        return True
    return str(report.get("playability_status") or "") == "playable"


def _extract_blocking_issues(report: dict) -> list[str]:
    readiness = _as_dict(report.get("readiness"))
    return _as_string_list(readiness.get("blocking_issues"))


def _as_dict(value: object) -> dict:
    return dict(value) if isinstance(value, dict) else {}


def _as_list_of_dicts(value: object) -> list[dict]:
    if not isinstance(value, list):
        return []
    return [dict(item) for item in value if isinstance(item, dict)]


def _as_string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


__all__ = [
    "RECOMMENDATION_KEYS",
    "analyze_observation_patterns",
    "build_observation_recommendations",
    "collect_observation_artifacts",
    "run_persistent_observation_cycle",
]