import json
from pathlib import Path

import pytest

from ai_e_runtime.autonomous_selector import format_selection_report, select_next_task


pytestmark = pytest.mark.fast


def test_selector_excludes_blocked_unready_and_invalid_tasks_and_scores_best_candidate(tmp_path):
    root_dir = tmp_path
    valid_a = _write_runtime_payload(root_dir, "TASK_READY_FAST")
    valid_b = _write_runtime_payload(root_dir, "TASK_READY_SLOW")
    valid_dep = _write_runtime_payload(root_dir, "TASK_DEPENDENT")
    valid_approval = _write_runtime_payload(root_dir, "TASK_APPROVAL")
    valid_blocked = _write_runtime_payload(root_dir, "TASK_POLICY_BLOCKED")

    queue = [
        {
            "task_id": "TASK_READY_FAST",
            "status": "pending",
            "priority": 25,
            "task_type": "diagnostic_step",
            "contract_path": valid_a,
            "created_at": "2026-03-18 16:00:00 -04:00 (Eastern Time — New York)",
        },
        {
            "task_id": "TASK_READY_SLOW",
            "status": "pending",
            "priority": 50,
            "task_type": "implementation_step",
            "execution_seconds": 12,
            "contract_path": valid_b,
            "created_at": "2026-03-18 17:50:00 -04:00 (Eastern Time — New York)",
        },
        {
            "task_id": "TASK_DEPENDENT",
            "status": "pending",
            "priority": 10,
            "dependencies": ["MISSING_STEP"],
            "contract_path": valid_dep,
        },
        {
            "task_id": "TASK_APPROVAL",
            "status": "needs_approval",
            "priority": 10,
            "approval_state": "awaiting_approval",
            "decision": "require_approval",
            "contract_path": valid_approval,
        },
        {
            "task_id": "TASK_POLICY_BLOCKED",
            "status": "pending",
            "priority": 1,
            "content_policy_decision": "blocked",
            "contract_path": valid_blocked,
        },
        {
            "task_id": "TASK_INVALID_CONTRACT",
            "status": "pending",
            "priority": 1,
            "contract_path": "contracts/test_runtime/does_not_exist.json",
        },
    ]

    result = select_next_task(
        queue,
        {"timestamp": "2026-03-18 18:00:00 -04:00 (Eastern Time — New York)"},
        root_dir=root_dir,
    )

    assert result.selected_task_id == "TASK_READY_FAST"
    assert result.selected_task_score is not None
    assert result.selected_task_score.total_score > 0
    payload = result.to_payload()
    assert payload["score"] == result.selected_task_score.total_score
    assert payload["score_breakdown"]["priority_weight"] == result.selected_task_score.priority_weight
    assert payload["top_candidates"][0]["score"] == result.selected_task_score.total_score
    assert payload["top_candidates"][0]["score_breakdown"]["readiness"] == 1
    assert [candidate.task_id for candidate in result.top_candidates[:2]] == ["TASK_READY_FAST", "TASK_READY_SLOW"]
    assert {entry.task_id: entry.reason for entry in result.excluded_tasks} == {
        "TASK_APPROVAL": "awaiting_approval",
        "TASK_DEPENDENT": "missing_dependencies",
        "TASK_INVALID_CONTRACT": "invalid_contract_format",
        "TASK_POLICY_BLOCKED": "content_policy_blocked",
    }


def test_selector_prefers_starved_task_when_priority_and_policy_are_equal(tmp_path):
    root_dir = tmp_path
    older = _write_runtime_payload(root_dir, "TASK_OLDER")
    newer = _write_runtime_payload(root_dir, "TASK_NEWER")

    queue = [
        {
            "task_id": "TASK_OLDER",
            "status": "pending",
            "priority": 50,
            "contract_path": older,
            "last_attempt_timestamp": "2026-03-18 16:30:00 -04:00 (Eastern Time — New York)",
        },
        {
            "task_id": "TASK_NEWER",
            "status": "pending",
            "priority": 50,
            "contract_path": newer,
            "last_attempt_timestamp": "2026-03-18 17:55:00 -04:00 (Eastern Time — New York)",
        },
    ]

    result = select_next_task(
        queue,
        {"timestamp": "2026-03-18 18:00:00 -04:00 (Eastern Time — New York)"},
        root_dir=root_dir,
    )

    assert result.selected_task_id == "TASK_OLDER"
    assert result.selected_task_score is not None
    assert result.selected_task_score.recency_boost > result.top_candidates[1].recency_boost


def test_selection_report_uses_plain_text_contract(tmp_path):
    root_dir = tmp_path
    valid = _write_runtime_payload(root_dir, "TASK_REPORT")
    result = select_next_task(
        [
            {
                "task_id": "TASK_REPORT",
                "status": "pending",
                "priority": 25,
                "contract_path": valid,
            }
        ],
        {"timestamp": "2026-03-18 18:00:00 -04:00 (Eastern Time — New York)"},
        root_dir=root_dir,
    )

    report = format_selection_report(result)
    lines = report.splitlines()

    assert lines[0] == "SUMMARY"
    assert "FACTS" in lines
    assert "ASSUMPTIONS" in lines
    assert "RECOMMENDATIONS" in lines
    assert "- selected task: TASK_REPORT" in report
    assert lines[-2] == "TIMESTAMP"
    assert lines[-1] == "2026-03-18 18:00:00 -04:00 (Eastern Time — New York)"


def _write_runtime_payload(root_dir: Path, task_id: str) -> str:
    payload_dir = root_dir / "contracts" / "test_runtime"
    payload_dir.mkdir(parents=True, exist_ok=True)
    path = payload_dir / f"{task_id}.json"
    path.write_text(
        json.dumps({"runtime_task": {"task_id": task_id, "agent_type": "copilot_coder_agent"}}, indent=2),
        encoding="utf-8",
    )
    return str(path.relative_to(root_dir)).replace("\\", "/")