from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from app.controller.execution_runner import ExecutionRunner
from app.controller.node_config import NodeConfigStore
from app.controller.node_dispatcher import NodeDispatcher
from app.controller.node_models import NodeDispatchRecord
from app.controller.profile_store import ControllerConfigStore
from app.node import bootstrap as node_bootstrap
from app.node.worker import NodeWorker
from submit_draft import main as submit_draft_main


class _FakeCommandRunner:
    def __init__(self, response: subprocess.CompletedProcess[str] | None = None) -> None:
        self.response = response or subprocess.CompletedProcess(["python", "validate_runtime.py"], 0, "validated\n", "")
        self.calls: list[tuple[tuple[str, ...], str, float]] = []

    def __call__(self, argv: tuple[str, ...], working_directory: str, timeout_seconds: float) -> subprocess.CompletedProcess[str]:
        self.calls.append((tuple(argv), working_directory, timeout_seconds))
        return self.response


class NodeDraftIntegrationTests(unittest.TestCase):
    def _bootstrap_node(
        self,
        *,
        config_dir: Path,
        registry_root: Path,
        role: str,
        display_name: str,
        repo_root: Path,
        capabilities: tuple[str, ...],
    ) -> None:
        argv = [
            "--config-dir",
            str(config_dir),
            "--registry-root",
            str(registry_root),
            "--role",
            role,
            "--display-name",
            display_name,
            "--repo-root",
            str(repo_root),
        ]
        for capability in capabilities:
            argv.extend(("--capability", capability))
        exit_code = node_bootstrap.main(argv)
        self.assertEqual(exit_code, 0)

    def _write_core_draft(self, *, draft_path: Path, repo_root: Path) -> NodeDispatchRecord:
        record = NodeDispatchRecord(
            job_id="JOB-CORE-DRAFT-001",
            status="queued",
            requested_capability_id="core.node.dispatch.run",
            requested_command_label="/run",
            requested_command_text="python validate_runtime.py",
            requested_command_summary="python validate_runtime.py",
            target_selection_mode="node_id",
            target_selector="validator-node-01",
            target_node_id="validator-node-01",
            target_node_role="validator",
            target_node_name="Validator Node 01",
            routing_reason="core draft routed to validator",
            request_source="core-draft-export",
            requester_label="AI-E Core",
            chat_id="core-draft",
            confirmation_required=True,
            confirmation_id="",
            queued_at="",
            started_at="",
            finished_at="",
            result_summary="",
            failure_reason="",
            current_job_state="queued",
            execution_payload={
                "capability_id": "core.node.dispatch.run",
                "command_kind": "run",
                "command_family": "python_script",
                "command_text": "python validate_runtime.py",
                "command_summary": "python validate_runtime.py",
                "working_directory": str(repo_root),
                "timeout_seconds": 20.0,
                "operator_reason": "Core-generated bounded run draft pending operator submission.",
                "expected_scope": "bounded node run draft",
                "argv": ["python", "validate_runtime.py"],
            },
        )
        draft_path.parent.mkdir(parents=True, exist_ok=True)
        draft_path.write_text(json.dumps(record.to_payload(), indent=2), encoding="utf-8")
        return record

    def test_submit_draft_requires_confirm_flag(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            registry_root = root / "registry"
            controller_dir = root / "controller"
            validator_dir = root / "validator"
            repo_root = Path(__file__).resolve().parents[1]

            self._bootstrap_node(
                config_dir=controller_dir,
                registry_root=registry_root,
                role="controller",
                display_name="Primary Controller",
                repo_root=repo_root,
                capabilities=("/run", "/test"),
            )
            self._bootstrap_node(
                config_dir=validator_dir,
                registry_root=registry_root,
                role="validator",
                display_name="Validator Node 01",
                repo_root=repo_root,
                capabilities=("/run",),
            )

            draft_path = root / "drafts" / "tasks" / "node-task-core-draft-001.json"
            self._write_core_draft(draft_path=draft_path, repo_root=repo_root)

            exit_code = submit_draft_main([str(draft_path), "--config-dir", str(controller_dir)])

            self.assertEqual(exit_code, 2)
            dispatcher = NodeDispatcher(registry_root=str(registry_root))
            self.assertEqual(dispatcher.list_jobs(), ())

    def test_node_pipeline_processes_core_draft_after_manual_submission(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            registry_root = root / "registry"
            controller_dir = root / "controller"
            validator_dir = root / "validator"
            repo_root = Path(__file__).resolve().parents[1]

            self._bootstrap_node(
                config_dir=controller_dir,
                registry_root=registry_root,
                role="controller",
                display_name="Primary Controller",
                repo_root=repo_root,
                capabilities=("/run", "/test"),
            )
            self._bootstrap_node(
                config_dir=validator_dir,
                registry_root=registry_root,
                role="validator",
                display_name="Validator Node 01",
                repo_root=repo_root,
                capabilities=("/run",),
            )

            runner = _FakeCommandRunner()
            worker = NodeWorker(
                controller_config_store=ControllerConfigStore(config_path=validator_dir / "controller_config.json"),
                node_config_store=NodeConfigStore(config_path=validator_dir / "node_config.json"),
                execution_runner=ExecutionRunner(command_runner=runner),
            )

            draft_path = root / "drafts" / "tasks" / "node-task-core-draft-001.json"
            draft_record = self._write_core_draft(draft_path=draft_path, repo_root=repo_root)

            self.assertIsNone(worker.run_once())
            self.assertEqual(runner.calls, [])

            exit_code = submit_draft_main([
                str(draft_path),
                "--config-dir",
                str(controller_dir),
                "--confirm-submit",
            ])
            self.assertEqual(exit_code, 0)

            dispatcher = NodeDispatcher(registry_root=str(registry_root))
            queued = dispatcher.get_job(draft_record.job_id)
            self.assertIsNotNone(queued)
            assert queued is not None
            self.assertEqual(queued.status, "queued")
            self.assertTrue(queued.queued_at)

            completed = worker.run_once()
            self.assertIsNotNone(completed)
            assert completed is not None
            self.assertEqual(completed.status, "completed")
            self.assertEqual(completed.target_node_id, "validator-node-01")
            self.assertEqual(len(runner.calls), 1)
            self.assertEqual(runner.calls[0][0], ("python", "validate_runtime.py"))


if __name__ == "__main__":
    unittest.main()