import json
import subprocess
from pathlib import Path

import pytest

from ai_e_runtime.unity_action_executor import execute_unity_action


pytestmark = pytest.mark.fast


def test_execute_unity_action_blocks_multiple_tasks(tmp_path):
    project_path = tmp_path / "BABYLON VER 2"
    launcher_path = project_path / "Tools" / "run_unity_create_debug_cube.ps1"
    launcher_path.parent.mkdir(parents=True)
    launcher_path.write_text("placeholder", encoding="utf-8")

    request = {
        "source": "sandbox_execution",
        "status": "ready_for_execution",
        "tasks": [
            {"task_id": "task_001", "action_type": "create_debug_cube"},
            {"task_id": "task_002", "action_type": "create_debug_cube"},
        ],
        "project_path": str(project_path),
    }

    result = execute_unity_action(request)

    assert result["status"] == "blocked"
    assert "exactly one task" in result["notes"][0]
    assert Path(result["output_path"]).exists()


def test_execute_unity_action_runs_explicit_request(monkeypatch, tmp_path):
    project_path = tmp_path / "BABYLON VER 2"
    launcher_path = project_path / "Tools" / "run_unity_create_debug_cube.ps1"
    output_dir = tmp_path / "orchestrator_runs"
    launcher_path.parent.mkdir(parents=True)
    launcher_path.write_text("placeholder", encoding="utf-8")
    project_path.mkdir(exist_ok=True)

    def fake_run(command, cwd, capture_output, text, check):
        artifact_path = Path(command[command.index("-ArtifactPath") + 1])
        log_path = Path(command[command.index("-LogPath") + 1])
        artifact_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "scene": "MainMenu",
                    "scene_name": "MainMenu",
                    "action_type": "create_debug_cube",
                    "created_object_name": "AIE_DebugCube_001",
                    "notes": [
                        "Created the debug cube in the active scene.",
                        "The change is reversible by deleting AIE_DebugCube_001 from the scene.",
                    ],
                    "timestamp": "2026-03-21T00:00:00Z",
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        log_path.write_text("unity log", encoding="utf-8")
        return subprocess.CompletedProcess(
            command,
            0,
            stdout="UNITY_EXIT_CODE=0\nUNITY_EXIT_REASON=success\n",
            stderr="",
        )

    monkeypatch.setattr("ai_e_runtime.unity_action_executor.subprocess.run", fake_run)

    result = execute_unity_action(
        {
            "task_id": "cube_task_001",
            "action_type": "create_debug_cube",
            "scene_name": "MainMenu",
            "project_path": str(project_path),
            "launcher_path": str(launcher_path),
            "output_dir": str(output_dir),
        }
    )

    assert result["status"] == "completed"
    assert result["scene_name"] == "MainMenu"
    assert result["created_object_name"] == "AIE_DebugCube_001"
    assert result["unity_exit_code"] == "0"

    report = json.loads(Path(result["output_path"]).read_text(encoding="utf-8"))
    assert report["status"] == "completed"


def test_execute_unity_action_fails_with_invalid_artifact(monkeypatch, tmp_path):
    project_path = tmp_path / "BABYLON VER 2"
    launcher_path = project_path / "Tools" / "run_unity_create_debug_cube.ps1"
    launcher_path.parent.mkdir(parents=True)
    launcher_path.write_text("placeholder", encoding="utf-8")
    project_path.mkdir(exist_ok=True)

    def fake_run(command, cwd, capture_output, text, check):
        artifact_path = Path(command[command.index("-ArtifactPath") + 1])
        log_path = Path(command[command.index("-LogPath") + 1])
        artifact_path.parent.mkdir(parents=True, exist_ok=True)
        artifact_path.write_text(json.dumps({"status": "success"}), encoding="utf-8")
        log_path.write_text("unity log", encoding="utf-8")
        return subprocess.CompletedProcess(
            command,
            0,
            stdout="UNITY_EXIT_CODE=0\nUNITY_EXIT_REASON=success\n",
            stderr="",
        )

    monkeypatch.setattr("ai_e_runtime.unity_action_executor.subprocess.run", fake_run)

    result = execute_unity_action(
        {
            "task_id": "cube_task_invalid",
            "action_type": "create_debug_cube",
            "scene_name": "MainMenu",
            "project_path": str(project_path),
            "launcher_path": str(launcher_path),
            "output_dir": str(tmp_path / "orchestrator_runs"),
        }
    )

    assert result["status"] == "failed"
    assert "missing required field" in result["notes"][0]


def test_execute_unity_action_accepts_expected_object_override(monkeypatch, tmp_path):
    project_path = tmp_path / "BABYLON VER 2"
    launcher_path = project_path / "Tools" / "run_unity_create_debug_cube_002.ps1"
    launcher_path.parent.mkdir(parents=True)
    launcher_path.write_text("placeholder", encoding="utf-8")
    project_path.mkdir(exist_ok=True)

    def fake_run(command, cwd, capture_output, text, check):
        artifact_path = Path(command[command.index("-ArtifactPath") + 1])
        log_path = Path(command[command.index("-LogPath") + 1])
        artifact_path.parent.mkdir(parents=True, exist_ok=True)
        artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "scene": "MainMenu",
                    "scene_name": "MainMenu",
                    "action_type": "create_debug_cube",
                    "created_object_name": "AIE_DebugCube_002",
                    "notes": [
                        "Created the second debug cube in the active scene.",
                        "Placed the cube at the deterministic position [2.0, 0.0, 3.0].",
                    ],
                    "timestamp": "2026-03-22T00:00:00Z",
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        log_path.write_text("unity log", encoding="utf-8")
        return subprocess.CompletedProcess(
            command,
            0,
            stdout="UNITY_EXIT_CODE=0\nUNITY_EXIT_REASON=success\n",
            stderr="",
        )

    monkeypatch.setattr("ai_e_runtime.unity_action_executor.subprocess.run", fake_run)

    result = execute_unity_action(
        {
            "task_id": "cube_task_002",
            "action_type": "create_debug_cube",
            "scene_name": "MainMenu",
            "project_path": str(project_path),
            "launcher_path": str(launcher_path),
            "expected_created_object_name": "AIE_DebugCube_002",
            "output_dir": str(tmp_path / "orchestrator_runs"),
        }
    )

    assert result["status"] == "completed"
    assert result["created_object_name"] == "AIE_DebugCube_002"


def test_execute_unity_action_accepts_existing_object_mutation_artifact(monkeypatch, tmp_path):
    project_path = tmp_path / "BABYLON VER 2"
    launcher_path = project_path / "Tools" / "run_unity_mutate_debug_cube_001_transform_phase1.ps1"
    launcher_path.parent.mkdir(parents=True)
    launcher_path.write_text("placeholder", encoding="utf-8")
    project_path.mkdir(exist_ok=True)

    def fake_run(command, cwd, capture_output, text, check):
        artifact_path = Path(command[command.index("-ArtifactPath") + 1])
        log_path = Path(command[command.index("-LogPath") + 1])
        artifact_path.parent.mkdir(parents=True, exist_ok=True)
        artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "scene": "MainMenu",
                    "scene_name": "MainMenu",
                    "action_type": "mutate_existing_object",
                    "mutation_type": "scale",
                    "action_mode": "absolute",
                    "target_object_name": "AIE_DebugCube_001",
                    "property_changed": "localScale",
                    "before_value": [1.0, 1.0, 1.0],
                    "after_value": [1.25, 1.0, 1.0],
                    "resolved_fileID": 1727793297,

                    "resolved_transform_fileID": 1727793301,
                    "resolution_mode_used": "fileID",
                    "policy_decision": "allow",
                    "mutation_allowed": True,
                    "scene_path": "Assets/Scenes/MainMenu.unity",
                    "notes": [
                        "Reused the existing object AIE_DebugCube_001 in the active scene.",
                        "Set localScale to the deterministic value [1.25, 1.0, 1.0].",
                    ],
                    "timestamp": "2026-03-22T00:00:00Z",
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        log_path.write_text("unity log", encoding="utf-8")
        return subprocess.CompletedProcess(
            command,
            0,
            stdout="UNITY_EXIT_CODE=0\nUNITY_EXIT_REASON=success\n",
            stderr="",
        )

    monkeypatch.setattr("ai_e_runtime.unity_action_executor.subprocess.run", fake_run)

    result = execute_unity_action(
        {
            "task_id": "mutate_cube_001",
            "action_type": "mutate_existing_object",
            "scene_name": "MainMenu",
            "project_path": str(project_path),
            "launcher_path": str(launcher_path),
            "expected_target_object_name": "AIE_DebugCube_001",
            "expected_property_changed": "localScale",
            "output_dir": str(tmp_path / "orchestrator_runs"),
        }
    )

    assert result["status"] == "completed"
    assert result["mutation_type"] == "scale"
    assert result["action_mode"] == "absolute"
    assert result["target_object_name"] == "AIE_DebugCube_001"
    assert result["property_changed"] == "localScale"
    assert result["before_value"] == [1.0, 1.0, 1.0]
    assert result["after_value"] == [1.25, 1.0, 1.0]


def test_execute_unity_action_accepts_position_mutation_artifact(monkeypatch, tmp_path):
    project_path = tmp_path / "BABYLON VER 2"
    launcher_path = project_path / "Tools" / "run_unity_mutate_debug_cube_001_transform_phase1.ps1"
    launcher_path.parent.mkdir(parents=True)
    launcher_path.write_text("placeholder", encoding="utf-8")
    project_path.mkdir(exist_ok=True)

    def fake_run(command, cwd, capture_output, text, check):
        artifact_path = Path(command[command.index("-ArtifactPath") + 1])
        log_path = Path(command[command.index("-LogPath") + 1])
        artifact_path.parent.mkdir(parents=True, exist_ok=True)
        artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "scene": "MainMenu",
                    "scene_name": "MainMenu",
                    "action_type": "mutate_existing_object",
                    "mutation_type": "position",
                    "action_mode": "absolute",
                    "target_object_name": "AIE_DebugCube_001",
                    "property_changed": "localPosition",
                    "before_value": [2.0, 0.0, 3.0],
                    "after_value": [0.0, 0.0, 3.0],
                    "resolved_fileID": 1727793297,
                    "resolved_transform_fileID": 1727793301,
                    "resolution_mode_used": "fileID",
                    "policy_decision": "allow",
                    "mutation_allowed": True,
                    "scene_path": "Assets/Scenes/MainMenu.unity",
                    "notes": ["Position mutation completed."],
                    "timestamp": "2026-03-22T00:00:00Z",
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        log_path.write_text("unity log", encoding="utf-8")
        return subprocess.CompletedProcess(
            command,
            0,
            stdout="UNITY_EXIT_CODE=0\nUNITY_EXIT_REASON=success\n",
            stderr="",
        )

    monkeypatch.setattr("ai_e_runtime.unity_action_executor.subprocess.run", fake_run)

    result = execute_unity_action(
        {
            "task_id": "mutate_cube_position_001",
            "action_type": "mutate_existing_object",
            "mutation_type": "position",
            "scene_name": "MainMenu",
            "project_path": str(project_path),
            "launcher_path": str(launcher_path),
            "expected_target_object_name": "AIE_DebugCube_001",
            "expected_property_changed": "localPosition",
            "expected_mutation_type": "position",
            "output_dir": str(tmp_path / "orchestrator_runs"),
        }
    )

    assert result["status"] == "completed"
    assert result["mutation_type"] == "position"
    assert result["action_mode"] == "absolute"
    assert result["property_changed"] == "localPosition"
    assert result["before_value"] == [2.0, 0.0, 3.0]
    assert result["after_value"] == [0.0, 0.0, 3.0]


def test_execute_unity_action_accepts_rotation_mutation_artifact(monkeypatch, tmp_path):
    project_path = tmp_path / "BABYLON VER 2"
    launcher_path = project_path / "Tools" / "run_unity_mutate_debug_cube_001_transform_phase1.ps1"
    launcher_path.parent.mkdir(parents=True)
    launcher_path.write_text("placeholder", encoding="utf-8")
    project_path.mkdir(exist_ok=True)

    def fake_run(command, cwd, capture_output, text, check):
        artifact_path = Path(command[command.index("-ArtifactPath") + 1])
        log_path = Path(command[command.index("-LogPath") + 1])
        artifact_path.parent.mkdir(parents=True, exist_ok=True)
        artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "scene": "MainMenu",
                    "scene_name": "MainMenu",
                    "action_type": "mutate_existing_object",
                    "mutation_type": "rotation",
                    "action_mode": "absolute",
                    "target_object_name": "AIE_DebugCube_001",
                    "property_changed": "localEulerAngles",
                    "before_value": [0.0, 45.0, 0.0],
                    "after_value": [0.0, 0.0, 0.0],
                    "resolved_fileID": 1727793297,
                    "resolved_transform_fileID": 1727793301,
                    "resolution_mode_used": "fileID",
                    "policy_decision": "allow",
                    "mutation_allowed": True,
                    "scene_path": "Assets/Scenes/MainMenu.unity",
                    "notes": ["Rotation mutation completed."],
                    "timestamp": "2026-03-22T00:00:00Z",
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        log_path.write_text("unity log", encoding="utf-8")
        return subprocess.CompletedProcess(
            command,
            0,
            stdout="UNITY_EXIT_CODE=0\nUNITY_EXIT_REASON=success\n",
            stderr="",
        )

    monkeypatch.setattr("ai_e_runtime.unity_action_executor.subprocess.run", fake_run)

    result = execute_unity_action(
        {
            "task_id": "mutate_cube_rotation_001",
            "action_type": "mutate_existing_object",
            "mutation_type": "rotation",
            "scene_name": "MainMenu",
            "project_path": str(project_path),
            "launcher_path": str(launcher_path),
            "expected_target_object_name": "AIE_DebugCube_001",
            "expected_property_changed": "localEulerAngles",
            "expected_mutation_type": "rotation",
            "output_dir": str(tmp_path / "orchestrator_runs"),
        }
    )

    assert result["status"] == "completed"
    assert result["mutation_type"] == "rotation"
    assert result["action_mode"] == "absolute"
    assert result["property_changed"] == "localEulerAngles"
    assert result["before_value"] == [0.0, 45.0, 0.0]
    assert result["after_value"] == [0.0, 0.0, 0.0]


def test_execute_unity_action_accepts_offset_position_mutation_artifact(monkeypatch, tmp_path):
    project_path = tmp_path / "BABYLON VER 2"
    launcher_path = project_path / "Tools" / "run_unity_mutate_debug_cube_001_transform_phase1.ps1"
    launcher_path.parent.mkdir(parents=True)
    launcher_path.write_text("placeholder", encoding="utf-8")
    project_path.mkdir(exist_ok=True)

    def fake_run(command, cwd, capture_output, text, check):
        assert command[command.index("-ActionMode") + 1] == "offset"
        assert json.loads(command[command.index("-ActionValue") + 1]) == [-2.0, 0.0, 0.0]

        artifact_path = Path(command[command.index("-ArtifactPath") + 1])
        log_path = Path(command[command.index("-LogPath") + 1])
        artifact_path.parent.mkdir(parents=True, exist_ok=True)
        artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "scene": "MainMenu",
                    "scene_name": "MainMenu",
                    "action_type": "mutate_existing_object",
                    "mutation_type": "position",
                    "action_mode": "offset",
                    "target_object_name": "AIE_DebugCube_001",
                    "property_changed": "localPosition",
                    "before_value": [2.0, 0.0, 3.0],
                    "after_value": [0.0, 0.0, 3.0],
                    "resolved_fileID": 1727793297,
                    "resolved_transform_fileID": 1727793301,
                    "resolution_mode_used": "fileID",
                    "policy_decision": "allow",
                    "mutation_allowed": True,
                    "scene_path": "Assets/Scenes/MainMenu.unity",
                    "notes": ["Offset position mutation completed."],
                    "timestamp": "2026-03-22T00:00:00Z",
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        log_path.write_text("unity log", encoding="utf-8")
        return subprocess.CompletedProcess(
            command,
            0,
            stdout="UNITY_EXIT_CODE=0\nUNITY_EXIT_REASON=success\n",
            stderr="",
        )

    monkeypatch.setattr("ai_e_runtime.unity_action_executor.subprocess.run", fake_run)

    result = execute_unity_action(
        {
            "task_id": "mutate_cube_position_offset_001",
            "action_type": "mutate_existing_object",
            "mutation_type": "position",
            "action_mode": "offset",
            "offset_value": [-2.0, 0.0, 0.0],
            "scene_name": "MainMenu",
            "project_path": str(project_path),
            "launcher_path": str(launcher_path),
            "expected_target_object_name": "AIE_DebugCube_001",
            "expected_property_changed": "localPosition",
            "expected_mutation_type": "position",
            "output_dir": str(tmp_path / "orchestrator_runs"),
        }
    )

    assert result["status"] == "completed"
    assert result["mutation_type"] == "position"
    assert result["action_mode"] == "offset"
    assert result["before_value"] == [2.0, 0.0, 3.0]
    assert result["after_value"] == [0.0, 0.0, 3.0]


def test_execute_unity_action_accepts_offset_rotation_mutation_artifact(monkeypatch, tmp_path):
    project_path = tmp_path / "BABYLON VER 2"
    launcher_path = project_path / "Tools" / "run_unity_mutate_debug_cube_001_transform_phase1.ps1"
    launcher_path.parent.mkdir(parents=True)
    launcher_path.write_text("placeholder", encoding="utf-8")
    project_path.mkdir(exist_ok=True)

    def fake_run(command, cwd, capture_output, text, check):
        assert command[command.index("-ActionMode") + 1] == "offset"
        assert json.loads(command[command.index("-ActionValue") + 1]) == [0.0, -45.0, 0.0]

        artifact_path = Path(command[command.index("-ArtifactPath") + 1])
        log_path = Path(command[command.index("-LogPath") + 1])
        artifact_path.parent.mkdir(parents=True, exist_ok=True)
        artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "scene": "MainMenu",
                    "scene_name": "MainMenu",
                    "action_type": "mutate_existing_object",
                    "mutation_type": "rotation",
                    "action_mode": "offset",
                    "target_object_name": "AIE_DebugCube_001",
                    "property_changed": "localEulerAngles",
                    "before_value": [0.0, 45.0, 0.0],
                    "after_value": [0.0, 0.0, 0.0],
                    "resolved_fileID": 1727793297,
                    "resolved_transform_fileID": 1727793301,
                    "resolution_mode_used": "fileID",
                    "policy_decision": "allow",
                    "mutation_allowed": True,
                    "scene_path": "Assets/Scenes/MainMenu.unity",
                    "notes": ["Offset rotation mutation completed."],
                    "timestamp": "2026-03-22T00:00:00Z",
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        log_path.write_text("unity log", encoding="utf-8")
        return subprocess.CompletedProcess(
            command,
            0,
            stdout="UNITY_EXIT_CODE=0\nUNITY_EXIT_REASON=success\n",
            stderr="",
        )

    monkeypatch.setattr("ai_e_runtime.unity_action_executor.subprocess.run", fake_run)

    result = execute_unity_action(
        {
            "task_id": "mutate_cube_rotation_offset_001",
            "action_type": "mutate_existing_object",
            "mutation_type": "rotation",
            "action_mode": "offset",
            "offset_value": [0.0, -45.0, 0.0],
            "scene_name": "MainMenu",
            "project_path": str(project_path),
            "launcher_path": str(launcher_path),
            "expected_target_object_name": "AIE_DebugCube_001",
            "expected_property_changed": "localEulerAngles",
            "expected_mutation_type": "rotation",
            "output_dir": str(tmp_path / "orchestrator_runs"),
        }
    )

    assert result["status"] == "completed"
    assert result["mutation_type"] == "rotation"
    assert result["action_mode"] == "offset"
    assert result["before_value"] == [0.0, 45.0, 0.0]
    assert result["after_value"] == [0.0, 0.0, 0.0]


def test_execute_unity_action_accepts_success_artifact_when_wrapper_omits_exit_code(monkeypatch, tmp_path):
    project_path = tmp_path / "BABYLON VER 2"
    launcher_path = project_path / "Tools" / "run_unity_mutate_debug_cube_001_transform_phase1.ps1"
    launcher_path.parent.mkdir(parents=True)
    launcher_path.write_text("placeholder", encoding="utf-8")
    project_path.mkdir(exist_ok=True)

    def fake_run(command, cwd, capture_output, text, check):
        artifact_path = Path(command[command.index("-ArtifactPath") + 1])
        log_path = Path(command[command.index("-LogPath") + 1])
        artifact_path.parent.mkdir(parents=True, exist_ok=True)
        artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "scene": "MainMenu",
                    "scene_name": "MainMenu",
                    "action_type": "mutate_existing_object",
                    "mutation_type": "position",
                    "action_mode": "offset",
                    "target_object_name": "AIE_DebugCube_001",
                    "property_changed": "localPosition",
                    "before_value": [2.0, 0.0, 3.0],
                    "after_value": [0.0, 0.0, 3.0],
                    "resolved_fileID": 1727793297,
                    "resolved_transform_fileID": 1727793301,
                    "resolution_mode_used": "fileID",
                    "policy_decision": "allow",
                    "mutation_allowed": True,
                    "scene_path": "Assets/Scenes/MainMenu.unity",
                    "notes": ["Offset mutation completed despite missing wrapper sentinel."],
                    "timestamp": "2026-03-22T00:00:00Z",
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        log_path.write_text("unity log", encoding="utf-8")
        return subprocess.CompletedProcess(command, 1, stdout="", stderr="")

    monkeypatch.setattr("ai_e_runtime.unity_action_executor.subprocess.run", fake_run)

    result = execute_unity_action(
        {
            "task_id": "mutate_cube_offset_missing_exit_001",
            "action_type": "mutate_existing_object",
            "mutation_type": "position",
            "action_mode": "offset",
            "offset_value": [-2.0, 0.0, 0.0],
            "scene_name": "MainMenu",
            "project_path": str(project_path),
            "launcher_path": str(launcher_path),
            "expected_target_object_name": "AIE_DebugCube_001",
            "expected_property_changed": "localPosition",
            "expected_mutation_type": "position",
            "output_dir": str(tmp_path / "orchestrator_runs"),
        }
    )

    assert result["status"] == "completed"
    assert result["unity_exit_code"] == "UNKNOWN"
    assert result["unity_exit_reason"] == "wrapper did not emit UNITY_EXIT_CODE"
    assert result["action_mode"] == "offset"
    assert result["after_value"] == [0.0, 0.0, 3.0]


def test_execute_unity_action_accepts_active_state_mutation_artifact(monkeypatch, tmp_path):
    project_path = tmp_path / "BABYLON VER 2"
    launcher_path = project_path / "Tools" / "run_unity_mutate_debug_cube_001_transform_phase1.ps1"
    launcher_path.parent.mkdir(parents=True)
    launcher_path.write_text("placeholder", encoding="utf-8")
    project_path.mkdir(exist_ok=True)

    def fake_run(command, cwd, capture_output, text, check):
        artifact_path = Path(command[command.index("-ArtifactPath") + 1])
        log_path = Path(command[command.index("-LogPath") + 1])
        artifact_path.parent.mkdir(parents=True, exist_ok=True)
        artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "scene": "MainMenu",
                    "scene_name": "MainMenu",
                    "action_type": "mutate_existing_object",
                    "mutation_type": "active_state",
                    "action_mode": "set",
                    "target_object_name": "AIE_DebugCube_001",
                    "property_changed": "activeSelf",
                    "before_value": True,
                    "after_value": False,
                    "resolved_fileID": 1727793297,
                    "resolved_transform_fileID": 1727793301,
                    "resolution_mode_used": "fileID",
                    "policy_decision": "allow",
                    "mutation_allowed": True,
                    "scene_path": "Assets/Scenes/MainMenu.unity",
                    "notes": ["Active-state mutation completed."],
                    "timestamp": "2026-03-22T00:00:00Z",
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        log_path.write_text("unity log", encoding="utf-8")
        return subprocess.CompletedProcess(
            command,
            0,
            stdout="UNITY_EXIT_CODE=0\nUNITY_EXIT_REASON=success\n",
            stderr="",
        )

    monkeypatch.setattr("ai_e_runtime.unity_action_executor.subprocess.run", fake_run)

    result = execute_unity_action(
        {
            "task_id": "mutate_cube_active_state_001",
            "action_type": "mutate_existing_object",
            "mutation_type": "active_state",
            "action_mode": "set",
            "set_value": False,
            "scene_name": "MainMenu",
            "project_path": str(project_path),
            "launcher_path": str(launcher_path),
            "expected_target_object_name": "AIE_DebugCube_001",
            "expected_property_changed": "activeSelf",
            "expected_mutation_type": "active_state",
            "output_dir": str(tmp_path / "orchestrator_runs"),
        }
    )

    assert result["status"] == "completed"
    assert result["mutation_type"] == "active_state"
    assert result["action_mode"] == "set"
    assert result["property_changed"] == "activeSelf"
    assert result["before_value"] is True
    assert result["after_value"] is False


def test_execute_unity_action_returns_blocked_result_from_deny_artifact(monkeypatch, tmp_path):
    project_path = tmp_path / "BABYLON VER 2"
    launcher_path = project_path / "Tools" / "run_unity_mutate_debug_cube_001_transform_phase1.ps1"
    launcher_path.parent.mkdir(parents=True)
    launcher_path.write_text("placeholder", encoding="utf-8")
    project_path.mkdir(exist_ok=True)

    def fake_run(command, cwd, capture_output, text, check):
        artifact_path = Path(command[command.index("-ArtifactPath") + 1])
        log_path = Path(command[command.index("-LogPath") + 1])
        artifact_path.parent.mkdir(parents=True, exist_ok=True)
        artifact_path.write_text(
            json.dumps(
                {
                    "status": "failure",
                    "scene": "MainMenu",
                    "scene_name": "MainMenu",
                    "action_type": "mutate_existing_object",
                    "mutation_type": "position",
                    "action_mode": "offset",
                    "target_object_name": "AIE_DebugCube_001",
                    "property_changed": "localPosition",
                    "before_value": [],
                    "after_value": [],
                    "resolved_fileID": 0,
                    "resolved_transform_fileID": 0,
                    "resolution_mode_used": "fileID",
                    "target_resolution_status": "invalid_request",
                    "failure_reason": "required_resolution_mode_unmet",
                    "policy_decision": "deny",
                    "mutation_allowed": False,
                    "scene_path": "Assets/Scenes/MainMenu.unity",
                    "notes": [
                        "Existing-object position mutation stopped before any scene mutation because contract-based preflight using fileID did not authorize mutation.",
                        "Required resolution mode 'fileID' was requested but target_fileID was not provided.",
                    ],
                    "timestamp": "2026-03-22T00:00:00Z",
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        log_path.write_text("unity log", encoding="utf-8")
        return subprocess.CompletedProcess(
            command,
            1,
            stdout="UNITY_EXIT_CODE=1\nUNITY_EXIT_REASON=preflight denied\n",
            stderr="",
        )

    monkeypatch.setattr("ai_e_runtime.unity_action_executor.subprocess.run", fake_run)

    result = execute_unity_action(
        {
            "task_id": "mutate_cube_blocked_001",
            "action_type": "mutate_existing_object",
            "mutation_type": "position",
            "action_mode": "offset",
            "scene_name": "MainMenu",
            "project_path": str(project_path),
            "launcher_path": str(launcher_path),
            "expected_target_object_name": "AIE_DebugCube_001",
            "expected_property_changed": "localPosition",
            "expected_mutation_type": "position",
            "output_dir": str(tmp_path / "orchestrator_runs"),
        }
    )

    assert result["status"] == "blocked"
    assert result["mutation_type"] == "position"
    assert result["action_mode"] == "offset"
    assert result["policy_decision"] == "deny"
    assert result["mutation_allowed"] is False


def test_execute_unity_action_accepts_scale_rollback_artifact(monkeypatch, tmp_path):
    project_path = tmp_path / "BABYLON VER 2"
    launcher_path = project_path / "Tools" / "run_unity_mutate_debug_cube_001_transform_phase1.ps1"
    launcher_path.parent.mkdir(parents=True)
    launcher_path.write_text("placeholder", encoding="utf-8")
    project_path.mkdir(exist_ok=True)

    def fake_run(command, cwd, capture_output, text, check):
        assert command[command.index("-EnableRollback") + 1] == "true"

        artifact_path = Path(command[command.index("-ArtifactPath") + 1])
        log_path = Path(command[command.index("-LogPath") + 1])
        artifact_path.parent.mkdir(parents=True, exist_ok=True)
        artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "scene": "MainMenu",
                    "scene_name": "MainMenu",
                    "action_type": "mutate_existing_object",
                    "mutation_type": "scale",
                    "action_mode": "offset",
                    "target_object_name": "AIE_DebugCube_001",
                    "property_changed": "localScale",
                    "before_value": [1.0, 1.0, 1.0],
                    "after_value": [1.25, 1.0, 1.0],
                    "baseline_value": [1.0, 1.0, 1.0],
                    "mutated_value": [1.25, 1.0, 1.0],
                    "restored_value": [1.0, 1.0, 1.0],
                    "rollback_status": "restored",
                    "resolved_fileID": 1727793297,
                    "resolved_transform_fileID": 1727793301,
                    "resolution_mode_used": "fileID",
                    "policy_decision": "allow",
                    "mutation_allowed": True,
                    "scene_path": "Assets/Scenes/MainMenu.unity",
                    "notes": ["Scale rollback mutation completed."],
                    "timestamp": "2026-03-22T00:00:00Z",
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        log_path.write_text("unity log", encoding="utf-8")
        return subprocess.CompletedProcess(
            command,
            0,
            stdout="UNITY_EXIT_CODE=0\nUNITY_EXIT_REASON=success\n",
            stderr="",
        )

    monkeypatch.setattr("ai_e_runtime.unity_action_executor.subprocess.run", fake_run)

    result = execute_unity_action(
        {
            "task_id": "mutate_cube_scale_rollback_001",
            "action_type": "mutate_existing_object",
            "mutation_type": "scale",
            "action_mode": "offset",
            "offset_value": [0.25, 0.0, 0.0],
            "rollback_enabled": True,
            "scene_name": "MainMenu",
            "project_path": str(project_path),
            "launcher_path": str(launcher_path),
            "expected_target_object_name": "AIE_DebugCube_001",
            "expected_property_changed": "localScale",
            "expected_mutation_type": "scale",
            "output_dir": str(tmp_path / "orchestrator_runs"),
        }
    )

    assert result["status"] == "completed"
    assert result["baseline_value"] == [1.0, 1.0, 1.0]
    assert result["mutated_value"] == [1.25, 1.0, 1.0]
    assert result["restored_value"] == [1.0, 1.0, 1.0]
    assert result["rollback_status"] == "restored"


def test_execute_unity_action_accepts_position_rollback_artifact(monkeypatch, tmp_path):
    project_path = tmp_path / "BABYLON VER 2"
    launcher_path = project_path / "Tools" / "run_unity_mutate_debug_cube_001_transform_phase1.ps1"
    launcher_path.parent.mkdir(parents=True)
    launcher_path.write_text("placeholder", encoding="utf-8")
    project_path.mkdir(exist_ok=True)

    def fake_run(command, cwd, capture_output, text, check):
        assert command[command.index("-EnableRollback") + 1] == "true"

        artifact_path = Path(command[command.index("-ArtifactPath") + 1])
        log_path = Path(command[command.index("-LogPath") + 1])
        artifact_path.parent.mkdir(parents=True, exist_ok=True)
        artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "scene": "MainMenu",
                    "scene_name": "MainMenu",
                    "action_type": "mutate_existing_object",
                    "mutation_type": "position",
                    "action_mode": "offset",
                    "target_object_name": "AIE_DebugCube_001",
                    "property_changed": "localPosition",
                    "before_value": [2.0, 0.0, 3.0],
                    "after_value": [0.0, 0.0, 3.0],
                    "baseline_value": [2.0, 0.0, 3.0],
                    "mutated_value": [0.0, 0.0, 3.0],
                    "restored_value": [2.0, 0.0, 3.0],
                    "rollback_status": "restored",
                    "resolved_fileID": 1727793297,
                    "resolved_transform_fileID": 1727793301,
                    "resolution_mode_used": "fileID",
                    "policy_decision": "allow",
                    "mutation_allowed": True,
                    "scene_path": "Assets/Scenes/MainMenu.unity",
                    "notes": ["Position rollback mutation completed."],
                    "timestamp": "2026-03-22T00:00:00Z",
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        log_path.write_text("unity log", encoding="utf-8")
        return subprocess.CompletedProcess(
            command,
            0,
            stdout="UNITY_EXIT_CODE=0\nUNITY_EXIT_REASON=success\n",
            stderr="",
        )

    monkeypatch.setattr("ai_e_runtime.unity_action_executor.subprocess.run", fake_run)

    result = execute_unity_action(
        {
            "task_id": "mutate_cube_position_rollback_001",
            "action_type": "mutate_existing_object",
            "mutation_type": "position",
            "action_mode": "offset",
            "offset_value": [-2.0, 0.0, 0.0],
            "rollback_enabled": True,
            "scene_name": "MainMenu",
            "project_path": str(project_path),
            "launcher_path": str(launcher_path),
            "expected_target_object_name": "AIE_DebugCube_001",
            "expected_property_changed": "localPosition",
            "expected_mutation_type": "position",
            "output_dir": str(tmp_path / "orchestrator_runs"),
        }
    )

    assert result["status"] == "completed"
    assert result["baseline_value"] == [2.0, 0.0, 3.0]
    assert result["mutated_value"] == [0.0, 0.0, 3.0]
    assert result["restored_value"] == [2.0, 0.0, 3.0]
    assert result["rollback_status"] == "restored"


def test_execute_unity_action_accepts_rotation_rollback_artifact(monkeypatch, tmp_path):
    project_path = tmp_path / "BABYLON VER 2"
    launcher_path = project_path / "Tools" / "run_unity_mutate_debug_cube_001_transform_phase1.ps1"
    launcher_path.parent.mkdir(parents=True)
    launcher_path.write_text("placeholder", encoding="utf-8")
    project_path.mkdir(exist_ok=True)

    def fake_run(command, cwd, capture_output, text, check):
        assert command[command.index("-EnableRollback") + 1] == "true"

        artifact_path = Path(command[command.index("-ArtifactPath") + 1])
        log_path = Path(command[command.index("-LogPath") + 1])
        artifact_path.parent.mkdir(parents=True, exist_ok=True)
        artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "scene": "MainMenu",
                    "scene_name": "MainMenu",
                    "action_type": "mutate_existing_object",
                    "mutation_type": "rotation",
                    "action_mode": "offset",
                    "target_object_name": "AIE_DebugCube_001",
                    "property_changed": "localEulerAngles",
                    "before_value": [0.0, 45.0, 0.0],
                    "after_value": [0.0, 0.0, 0.0],
                    "baseline_value": [0.0, 45.0, 0.0],
                    "mutated_value": [0.0, 0.0, 0.0],
                    "restored_value": [0.0, 45.0, 0.0],
                    "rollback_status": "restored",
                    "resolved_fileID": 1727793297,
                    "resolved_transform_fileID": 1727793301,
                    "resolution_mode_used": "fileID",
                    "policy_decision": "allow",
                    "mutation_allowed": True,
                    "scene_path": "Assets/Scenes/MainMenu.unity",
                    "notes": ["Rotation rollback mutation completed."],
                    "timestamp": "2026-03-22T00:00:00Z",
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        log_path.write_text("unity log", encoding="utf-8")
        return subprocess.CompletedProcess(
            command,
            0,
            stdout="UNITY_EXIT_CODE=0\nUNITY_EXIT_REASON=success\n",
            stderr="",
        )

    monkeypatch.setattr("ai_e_runtime.unity_action_executor.subprocess.run", fake_run)

    result = execute_unity_action(
        {
            "task_id": "mutate_cube_rotation_rollback_001",
            "action_type": "mutate_existing_object",
            "mutation_type": "rotation",
            "action_mode": "offset",
            "offset_value": [0.0, -45.0, 0.0],
            "rollback_enabled": True,
            "scene_name": "MainMenu",
            "project_path": str(project_path),
            "launcher_path": str(launcher_path),
            "expected_target_object_name": "AIE_DebugCube_001",
            "expected_property_changed": "localEulerAngles",
            "expected_mutation_type": "rotation",
            "output_dir": str(tmp_path / "orchestrator_runs"),
        }
    )

    assert result["status"] == "completed"
    assert result["baseline_value"] == [0.0, 45.0, 0.0]
    assert result["mutated_value"] == [0.0, 0.0, 0.0]
    assert result["restored_value"] == [0.0, 45.0, 0.0]
    assert result["rollback_status"] == "restored"


def test_execute_unity_action_accepts_active_state_rollback_artifact(monkeypatch, tmp_path):
    project_path = tmp_path / "BABYLON VER 2"
    launcher_path = project_path / "Tools" / "run_unity_mutate_debug_cube_001_transform_phase1.ps1"
    launcher_path.parent.mkdir(parents=True)
    launcher_path.write_text("placeholder", encoding="utf-8")
    project_path.mkdir(exist_ok=True)

    def fake_run(command, cwd, capture_output, text, check):
        assert command[command.index("-EnableRollback") + 1] == "true"

        artifact_path = Path(command[command.index("-ArtifactPath") + 1])
        log_path = Path(command[command.index("-LogPath") + 1])
        artifact_path.parent.mkdir(parents=True, exist_ok=True)
        artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "scene": "MainMenu",
                    "scene_name": "MainMenu",
                    "action_type": "mutate_existing_object",
                    "mutation_type": "active_state",
                    "action_mode": "set",
                    "target_object_name": "AIE_DebugCube_001",
                    "property_changed": "activeSelf",
                    "before_value": False,
                    "after_value": True,
                    "baseline_value": False,
                    "mutated_value": True,
                    "restored_value": False,
                    "rollback_status": "restored",
                    "resolved_fileID": 1727793297,
                    "resolved_transform_fileID": 1727793301,
                    "resolution_mode_used": "fileID",
                    "policy_decision": "allow",
                    "mutation_allowed": True,
                    "scene_path": "Assets/Scenes/MainMenu.unity",
                    "notes": ["Active-state rollback mutation completed."],
                    "timestamp": "2026-03-22T00:00:00Z",
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        log_path.write_text("unity log", encoding="utf-8")
        return subprocess.CompletedProcess(
            command,
            0,
            stdout="UNITY_EXIT_CODE=0\nUNITY_EXIT_REASON=success\n",
            stderr="",
        )

    monkeypatch.setattr("ai_e_runtime.unity_action_executor.subprocess.run", fake_run)

    result = execute_unity_action(
        {
            "task_id": "mutate_cube_active_state_rollback_001",
            "action_type": "mutate_existing_object",
            "mutation_type": "active_state",
            "action_mode": "set",
            "set_value": True,
            "rollback_enabled": True,
            "scene_name": "MainMenu",
            "project_path": str(project_path),
            "launcher_path": str(launcher_path),
            "expected_target_object_name": "AIE_DebugCube_001",
            "expected_property_changed": "activeSelf",
            "expected_mutation_type": "active_state",
            "output_dir": str(tmp_path / "orchestrator_runs"),
        }
    )

    assert result["status"] == "completed"
    assert result["baseline_value"] is False
    assert result["mutated_value"] is True
    assert result["restored_value"] is False
    assert result["rollback_status"] == "restored"


def test_execute_unity_action_returns_blocked_rollback_result_without_attempt(monkeypatch, tmp_path):
    project_path = tmp_path / "BABYLON VER 2"
    launcher_path = project_path / "Tools" / "run_unity_mutate_debug_cube_001_transform_phase1.ps1"
    launcher_path.parent.mkdir(parents=True)
    launcher_path.write_text("placeholder", encoding="utf-8")
    project_path.mkdir(exist_ok=True)

    def fake_run(command, cwd, capture_output, text, check):
        assert command[command.index("-EnableRollback") + 1] == "true"

        artifact_path = Path(command[command.index("-ArtifactPath") + 1])
        log_path = Path(command[command.index("-LogPath") + 1])
        artifact_path.parent.mkdir(parents=True, exist_ok=True)
        artifact_path.write_text(
            json.dumps(
                {
                    "status": "failure",
                    "scene": "MainMenu",
                    "scene_name": "MainMenu",
                    "action_type": "mutate_existing_object",
                    "mutation_type": "position",
                    "action_mode": "offset",
                    "target_object_name": "AIE_DebugCube_001",
                    "property_changed": "localPosition",
                    "before_value": [],
                    "after_value": [],
                    "baseline_value": [],
                    "mutated_value": [],
                    "restored_value": [],
                    "rollback_status": "not_attempted",
                    "resolved_fileID": 0,
                    "resolved_transform_fileID": 0,
                    "resolution_mode_used": "fileID",
                    "target_resolution_status": "invalid_request",
                    "failure_reason": "required_resolution_mode_unmet",
                    "policy_decision": "deny",
                    "mutation_allowed": False,
                    "scene_path": "Assets/Scenes/MainMenu.unity",
                    "notes": [
                        "Existing-object position mutation with action mode offset stopped before any scene mutation because contract-based preflight using fileID did not authorize mutation.",
                        "No rollback attempt was made because no mutation was allowed."
                    ],
                    "timestamp": "2026-03-22T00:00:00Z",
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        log_path.write_text("unity log", encoding="utf-8")
        return subprocess.CompletedProcess(
            command,
            1,
            stdout="UNITY_EXIT_CODE=1\nUNITY_EXIT_REASON=preflight denied\n",
            stderr="",
        )

    monkeypatch.setattr("ai_e_runtime.unity_action_executor.subprocess.run", fake_run)

    result = execute_unity_action(
        {
            "task_id": "mutate_cube_blocked_rollback_001",
            "action_type": "mutate_existing_object",
            "mutation_type": "position",
            "action_mode": "offset",
            "offset_value": [-2.0, 0.0, 0.0],
            "rollback_enabled": True,
            "scene_name": "MainMenu",
            "project_path": str(project_path),
            "launcher_path": str(launcher_path),
            "expected_target_object_name": "AIE_DebugCube_001",
            "expected_property_changed": "localPosition",
            "expected_mutation_type": "position",
            "output_dir": str(tmp_path / "orchestrator_runs"),
        }
    )

    assert result["status"] == "blocked"
    assert result["rollback_status"] == "not_attempted"
    assert result["baseline_value"] == []
    assert result["mutated_value"] == []
    assert result["restored_value"] == []


def test_execute_unity_action_writes_running_result_before_mutation_subprocess_returns(monkeypatch, tmp_path):
    project_path = tmp_path / "BABYLON VER 2"
    launcher_path = project_path / "Tools" / "run_unity_mutate_debug_cube_001_transform_phase1.ps1"
    output_dir = tmp_path / "orchestrator_runs"
    launcher_path.parent.mkdir(parents=True)
    launcher_path.write_text("placeholder", encoding="utf-8")
    project_path.mkdir(exist_ok=True)

    def fake_run(command, cwd, capture_output, text, check):
        result_path = output_dir / "mutate-cube-queue-001_execution_result.json"
        assert result_path.exists()

        running_report = json.loads(result_path.read_text(encoding="utf-8"))
        assert running_report["status"] == "running"
        assert running_report["target_object_name"] == "AIE_DebugCube_001"
        assert running_report["property_changed"] == "localScale"
        assert running_report["action_mode"] == "absolute"
        assert command[command.index("-MutationType") + 1] == "scale"
        assert command[command.index("-ActionMode") + 1] == "absolute"

        artifact_path = Path(command[command.index("-ArtifactPath") + 1])
        log_path = Path(command[command.index("-LogPath") + 1])
        artifact_path.parent.mkdir(parents=True, exist_ok=True)
        artifact_path.write_text(
            json.dumps(
                {
                    "status": "success",
                    "scene": "MainMenu",
                    "scene_name": "MainMenu",
                    "action_type": "mutate_existing_object",
                    "mutation_type": "scale",
                    "action_mode": "absolute",
                    "target_object_name": "AIE_DebugCube_001",
                    "property_changed": "localScale",
                    "before_value": [1.25, 1.0, 1.0],
                    "after_value": [1.25, 1.0, 1.0],
                    "resolved_fileID": 1727793297,
                    "resolved_transform_fileID": 1727793301,
                    "resolution_mode_used": "fileID",
                    "policy_decision": "allow",
                    "mutation_allowed": True,
                    "scene_path": "Assets/Scenes/MainMenu.unity",
                    "notes": [
                        "Identity-only diagnostic executed with no scene mutation.",
                        "YAML mapping was anchored to exact local file identifiers for the target GameObject and Transform.",
                    ],
                    "timestamp": "2026-03-22T16:17:12Z",
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        log_path.write_text("unity log", encoding="utf-8")
        return subprocess.CompletedProcess(
            command,
            0,
            stdout="UNITY_EXIT_CODE=0\nUNITY_EXIT_REASON=success\n",
            stderr="",
        )

    monkeypatch.setattr("ai_e_runtime.unity_action_executor.subprocess.run", fake_run)

    result = execute_unity_action(
        {
            "task_id": "mutate_cube_queue_001",
            "action_type": "mutate_existing_object",
            "scene_name": "MainMenu",
            "project_path": str(project_path),
            "launcher_path": str(launcher_path),
            "expected_target_object_name": "AIE_DebugCube_001",
            "expected_property_changed": "localScale",
            "output_dir": str(output_dir),
        }
    )

    assert result["status"] == "completed"
    final_report = json.loads(Path(result["output_path"]).read_text(encoding="utf-8"))
    assert final_report["status"] == "completed"
    assert final_report["target_object_name"] == "AIE_DebugCube_001"