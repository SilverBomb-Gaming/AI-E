import json
from pathlib import Path

import pytest

from orchestrator.level_playability_analyzer import analyze_first_validation_target
from orchestrator.playability_report_contract import build_playability_report
from orchestrator.report_persistence import save_playability_report


pytestmark = pytest.mark.fast


VALID_PLAYABILITY_STATUSES = {"playable", "partially_broken", "not_playable"}
REQUIRED_TOP_LEVEL_KEYS = {
    "level_id",
    "timestamp",
    "playability_status",
    "analysis",
    "redesign",
    "metrics",
    "readiness",
    "recommendations",
}
REQUIRED_METRIC_KEYS = {
    "max_jump_required",
    "player_jump_capacity",
    "gap_violations",
    "unreachable_count",
}
REQUIRED_REDESIGN_TASK_KEYS = {
    "task_id",
    "title",
    "description",
    "domain",
    "subdomain",
    "intent",
    "constraints",
    "evaluation",
}


def test_playability_report_contract_shape_is_stable():
    report = _build_current_report()

    assert REQUIRED_TOP_LEVEL_KEYS.issubset(report.keys())
    assert report["playability_status"] in VALID_PLAYABILITY_STATUSES
    assert REQUIRED_METRIC_KEYS.issubset(report["metrics"].keys())
    assert isinstance(report["readiness"].get("blocking_issues"), list)
    assert isinstance(report["redesign"].get("tasks"), list)
    assert report["redesign"]["tasks"]
    for task in report["redesign"]["tasks"]:
        assert REQUIRED_REDESIGN_TASK_KEYS.issubset(task.keys())


def test_playability_report_matches_golden_snapshot_except_timestamp():
    current_report = _normalize_report(_build_current_report())
    snapshot_report = _normalize_report(_load_snapshot_report())

    assert current_report == snapshot_report


def test_save_playability_report_writes_sorted_json(tmp_path):
    report = _build_current_report()
    destination = tmp_path / "playability_report.json"

    save_playability_report(report, str(destination))

    expected_text = json.dumps(report, indent=2, sort_keys=True) + "\n"
    assert destination.read_text(encoding="utf-8") == expected_text
    assert json.loads(destination.read_text(encoding="utf-8")) == report


def _build_current_report() -> dict:
    validation = analyze_first_validation_target()
    analysis = dict(validation.get("analysis") or {})
    return build_playability_report(
        level_id=str(validation.get("stabilization_report_summary", {}).get("level_id") or "LEVEL_0001"),
        analysis_result=analysis,
        redesign_tasks=[dict(task) for task in analysis.get("redesigned_layout_tasks", []) if isinstance(task, dict)],
    )


def _load_snapshot_report() -> dict:
    fixture_path = Path(__file__).resolve().parent / "fixtures" / "playability_report_snapshot.json"
    return json.loads(fixture_path.read_text(encoding="utf-8"))


def _normalize_report(report: dict) -> dict:
    normalized = json.loads(json.dumps(report))
    normalized["timestamp"] = "<normalized-timestamp>"
    return normalized