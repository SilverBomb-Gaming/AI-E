import json

import pytest

import orchestrator.persistent_observation_loop as persistent_observation_loop


pytestmark = pytest.mark.fast


def test_collect_observation_artifacts_is_deterministic(tmp_path, monkeypatch):
    session_dir = _prepare_session_dir(tmp_path, "stable_session")
    _write_json(
        session_dir / "playability_report.json",
        {
            "level_id": "LEVEL_0001",
            "playability_status": "playable",
            "readiness": {"playable": True, "blocking_issues": []},
        },
    )
    _write_json(
        session_dir / "session_summary.json",
        {
            "session_id": "stable_session",
            "stop_reason": "queue_empty",
            "tasks_completed": 1,
        },
    )
    monkeypatch.setattr(persistent_observation_loop, "_runs_root", lambda: tmp_path / "runs")

    first = persistent_observation_loop.collect_observation_artifacts("stable_session")
    second = persistent_observation_loop.collect_observation_artifacts("stable_session")

    assert first == second
    assert first["collected_files"] == ["playability_report.json", "session_summary.json"]


def test_analyze_observation_patterns_classifies_canonical_signals_deterministically():
    artifacts = {
        "artifacts": {
            "playability_report": {
                "playability_status": "partially_broken",
                "readiness": {"playable": False, "blocking_issues": ["jump_mismatch", "jump_mismatch"]},
            },
            "closed_validation_result": {
                "improvement": True,
                "final_status": "playable",
                "termination_reason": "playable_reached",
                "comparison_summary": [
                    {
                        "improved": True,
                        "action_validation": {
                            "unresolved_action_count": 2,
                            "unsupported_task_ids": ["flow_a", "flow_b"],
                        },
                    }
                ],
                "final_report": {
                    "readiness": {"playable": True, "blocking_issues": ["jump_mismatch"]}
                },
            },
        }
    }

    pattern_report = persistent_observation_loop.analyze_observation_patterns(artifacts)

    assert pattern_report["improvement_trends"] == [
        "repeated_improvement: 1 improvement signal(s) observed in canonical closed-loop results."
    ]
    assert pattern_report["stagnation_signals"] == []
    assert "stable_playable_state: canonical persisted artifacts report a playable state." in pattern_report["stable_successes"]
    assert "repeated_unresolved_actions: 2 unresolved action signal(s) observed for flow_a, flow_b." in pattern_report["repeat_failures"]
    assert "recurring_blocking_issue: jump_mismatch" in pattern_report["repeat_failures"]


def test_run_persistent_observation_cycle_stops_on_stable_state_and_persists_summaries(tmp_path, monkeypatch):
    session_dir = _prepare_session_dir(tmp_path, "observed_session")
    _write_json(
        session_dir / "playability_report.json",
        {
            "level_id": "LEVEL_0001",
            "playability_status": "playable",
            "readiness": {"playable": True, "blocking_issues": []},
        },
    )
    _write_json(
        session_dir / "closed_validation_result.json",
        {
            "improvement": True,
            "final_status": "playable",
            "termination_reason": "playable_reached",
            "comparison_summary": [
                {
                    "improved": True,
                    "action_validation": {
                        "unresolved_action_count": 0,
                        "unsupported_task_ids": [],
                    },
                }
            ],
        },
    )
    _write_json(session_dir / "session_summary.json", {"session_id": "observed_session", "stop_reason": "queue_empty"})
    monkeypatch.setattr(persistent_observation_loop, "_runs_root", lambda: tmp_path / "runs")

    result = persistent_observation_loop.run_persistent_observation_cycle("observed_session", max_cycles=5)

    assert result["cycles_used"] == 2
    assert result["termination_reason"] == "stable_state_detected"
    assert result["source"] == "persistent_observation_loop"
    assert result["pattern_report"]["stable_successes"]
    for recommendation in result["recommendations"]:
        assert persistent_observation_loop.RECOMMENDATION_KEYS.issubset(recommendation.keys())

    final_summary_path = session_dir / "observation_summary.json"
    cycle_01_path = session_dir / "observation_summary_cycle_01.json"
    cycle_02_path = session_dir / "observation_summary_cycle_02.json"
    assert final_summary_path.exists()
    assert cycle_01_path.exists()
    assert cycle_02_path.exists()
    expected_text = json.dumps(result, indent=2, sort_keys=True) + "\n"
    assert final_summary_path.read_text(encoding="utf-8") == expected_text


def test_run_persistent_observation_cycle_stops_on_repeated_stagnation(tmp_path, monkeypatch):
    session_dir = _prepare_session_dir(tmp_path, "stagnation_session")
    _write_json(
        session_dir / "closed_validation_result.json",
        {
            "improvement": False,
            "final_status": "partially_broken",
            "termination_reason": "stagnation",
            "comparison_summary": [
                {
                    "improved": False,
                    "action_validation": {
                        "unresolved_action_count": 0,
                        "unsupported_task_ids": [],
                    },
                }
            ],
        },
    )
    monkeypatch.setattr(persistent_observation_loop, "_runs_root", lambda: tmp_path / "runs")

    result = persistent_observation_loop.run_persistent_observation_cycle("stagnation_session", max_cycles=4)

    assert result["cycles_used"] == 2
    assert result["termination_reason"] == "repeated_stagnation_threshold"
    assert result["pattern_report"]["stagnation_signals"] == [
        "repeated_stagnation: closed validation loop terminated due to stagnation."
    ]


def test_run_persistent_observation_cycle_has_no_execution_side_effects_outside_summary_files(tmp_path, monkeypatch):
    session_dir = _prepare_session_dir(tmp_path, "passive_session")
    _write_json(session_dir / "runtime_status.json", {"session_id": "passive_session", "status": "completed"})
    _write_json(session_dir / "session_summary.json", {"session_id": "passive_session", "stop_reason": "queue_empty"})
    monkeypatch.setattr(persistent_observation_loop, "_runs_root", lambda: tmp_path / "runs")

    before_files = sorted(path.name for path in session_dir.iterdir())
    result = persistent_observation_loop.run_persistent_observation_cycle("passive_session", max_cycles=3)
    after_files = sorted(path.name for path in session_dir.iterdir())

    assert result["termination_reason"] == "no_new_artifacts_found"
    assert after_files == sorted(
        before_files
        + [
            "observation_summary.json",
            "observation_summary_cycle_01.json",
            "observation_summary_cycle_02.json",
        ]
    )


def _prepare_session_dir(tmp_path, session_id: str):
    session_dir = tmp_path / "runs" / session_id
    session_dir.mkdir(parents=True, exist_ok=True)
    return session_dir


def _write_json(path, payload):
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")