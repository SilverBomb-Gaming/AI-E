from __future__ import annotations

import subprocess
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

from app.controller.app_service import ControllerService
from app.controller.execution_runner import ExecutionRunner
from app.controller.profile_store import ControllerConfigStore
from app.controller.telegram_service import TelegramInboundMessage
from app.controller.workflow_models import WorkflowRecord
from app.platform.secrets import InMemorySecretStore

from tests.test_telegram_commands import (
    VALID_TOKEN,
    _FakeOllamaAdapter,
    _FakeOpenAIAdapter,
    _FakeRuntimeManager,
    _FakeTelegramService,
    _report,
    _wait_until,
)


class _LoopCommandRunner:
    def __init__(self, *responses: subprocess.CompletedProcess[str] | BaseException) -> None:
        self._responses = list(responses)
        self.calls: list[tuple[tuple[str, ...], str, float]] = []

    def __call__(self, argv: tuple[str, ...], working_directory: str, timeout_seconds: float) -> subprocess.CompletedProcess[str]:
        self.calls.append((tuple(argv), working_directory, timeout_seconds))
        if self._responses:
            response = self._responses.pop(0)
            if isinstance(response, BaseException):
                raise response
            return response
        return subprocess.CompletedProcess(list(argv), 0, "Ran 1 test in 0.01s\n\nOK\n", "")


class DevLoopStabilityTests(unittest.TestCase):
    def _make_service(
        self,
        *,
        tmp_dir: str,
        telegram_service: _FakeTelegramService | None = None,
        command_runner: _LoopCommandRunner | None = None,
    ) -> tuple[ControllerService, ControllerConfigStore, InMemorySecretStore, _FakeTelegramService, _LoopCommandRunner]:
        config_store = ControllerConfigStore(config_path=Path(tmp_dir) / "controller_config.json")
        secret_store = InMemorySecretStore()
        tg = telegram_service or _FakeTelegramService()
        runner = command_runner or _LoopCommandRunner()
        service = ControllerService(
            runtime_manager=_FakeRuntimeManager(runtime_state="running"),
            config_store=config_store,
            secret_store=secret_store,
            provider_adapters={"ollama": _FakeOllamaAdapter(), "openai": _FakeOpenAIAdapter()},
            telegram_service=tg,
            execution_runner=ExecutionRunner(command_runner=runner, default_timeout_seconds=5.0),
        )
        self.addCleanup(service.shutdown)
        service.validate_provider(provider="ollama")
        service.save_telegram_settings(telegram_token=VALID_TOKEN)
        service.validate_telegram()
        service.test_telegram_connection()
        service._latest_health_report = _report("health", "ok", "info", "Healthy")
        service._latest_security_report = _report("security", "ok", "info", "Safe")
        return service, config_store, secret_store, tg, runner

    def _run_single_update(self, service: ControllerService, telegram_service: _FakeTelegramService) -> str:
        service._telegram_service = telegram_service
        service.start_telegram_loop()
        self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 1))
        service.stop_telegram_loop()
        return telegram_service.sent_messages[0][1]

    def _configure_scopes(self, *, service: ControllerService, config_store: ControllerConfigStore, root: Path) -> None:
        config = config_store.load()
        resolved_root = str(root.resolve())
        config.repo_root = resolved_root
        config.file_allowed_roots = (resolved_root,)
        config_store.save(config)
        service._config = config_store.load()

    @staticmethod
    def _extract_confirmation_id(reply: str) -> str:
        marker = "ID: "
        start = reply.index(marker) + len(marker)
        return reply[start:].splitlines()[0].split()[0].strip()

    def test_end_to_end_patch_confirm_test_loop_succeeds_and_lastaction_stays_stable(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            target = root / "docs" / "notes.txt"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("alpha\nbeta\n", encoding="utf-8")
            runner = _LoopCommandRunner(
                subprocess.CompletedProcess(
                    ["python", "-m", "unittest", "tests.test_telegram_commands"],
                    0,
                    "Ran 2 tests in 0.08s\n\nOK\n",
                    "",
                )
            )
            service, config_store, _, _, fake_runner = self._make_service(tmp_dir=tmp, command_runner=runner)
            self._configure_scopes(service=service, config_store=config_store, root=root)

            file_tg = _FakeTelegramService(update_batches=[(
                TelegramInboundMessage(update_id=801, chat_id="chat-1", text="/file docs/notes.txt", sender_label="@tester"),
            )])
            file_reply = self._run_single_update(service, file_tg)
            self.assertIn("docs/notes.txt", file_reply)

            patch_tg = _FakeTelegramService(update_batches=[(
                TelegramInboundMessage(
                    update_id=802,
                    chat_id="chat-1",
                    text="/patchfile docs/notes.txt\nReason: tighten loop\n@@ FIND\nbeta\n@@ REPLACE\nbeta updated",
                    sender_label="@tester",
                ),
            )])
            patch_prompt = self._run_single_update(service, patch_tg)
            patch_confirmation_id = self._extract_confirmation_id(patch_prompt)

            patch_confirm_tg = _FakeTelegramService(update_batches=[(
                TelegramInboundMessage(update_id=803, chat_id="chat-1", text=f"/confirm {patch_confirmation_id}", sender_label="@tester"),
            )])
            patch_reply = self._run_single_update(service, patch_confirm_tg)

            test_tg = _FakeTelegramService(update_batches=[(
                TelegramInboundMessage(update_id=804, chat_id="chat-1", text="/test tests.test_telegram_commands", sender_label="@tester"),
            )])
            test_prompt = self._run_single_update(service, test_tg)
            test_confirmation_id = self._extract_confirmation_id(test_prompt)

            test_confirm_tg = _FakeTelegramService(update_batches=[(
                TelegramInboundMessage(update_id=805, chat_id="chat-1", text=f"/confirm {test_confirmation_id}", sender_label="@tester"),
            )])
            test_reply = self._run_single_update(service, test_confirm_tg)
            loop_recent = service._audit_store.recent(limit=6)
            completed_loop_recent = [
                record
                for record in loop_recent
                if record.capability_id in {"file.read", "file.patch.write", "test.command.run"}
                and record.outcome == "success"
            ]

            status_tg = _FakeTelegramService(update_batches=[(
                TelegramInboundMessage(update_id=806, chat_id="chat-1", text="/status", sender_label="@tester"),
            )])
            _ = self._run_single_update(service, status_tg)

            last_tg = _FakeTelegramService(update_batches=[(
                TelegramInboundMessage(update_id=807, chat_id="chat-1", text="/lastaction", sender_label="@tester"),
            )])
            last_reply = self._run_single_update(service, last_tg)

            recent = service._audit_store.recent(limit=4)
            self.assertEqual(target.read_text(encoding="utf-8"), "alpha\nbeta updated\n")
            self.assertIn("Operation: patch", patch_reply)
            self.assertIn("Exit code: 0", test_reply)
            self.assertIn("Summary: 2 tests passed in 0.08s", test_reply)
            self.assertEqual(len(fake_runner.calls), 1)
            self.assertIn("Action: test completed", last_reply)
            self.assertIn("Command: python -m unittest tests.test_telegram_commands", last_reply)
            self.assertIn("Exit code: 0", last_reply)
            self.assertIn("Summary: 2 tests passed in 0.08s", last_reply)
            self.assertIn("Next: Inspect with /file, patch with /patchfile, or run another bounded command explicitly.", last_reply)
            self.assertEqual(completed_loop_recent[0].capability_id, "test.command.run")
            self.assertEqual(completed_loop_recent[1].capability_id, "file.patch.write")
            self.assertEqual(completed_loop_recent[2].capability_id, "file.read")
            self.assertIn("exit 0", service._build_audit_reply(limit=3).reply)

    def test_end_to_end_patch_confirm_test_failure_is_summarized_clearly(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            target = root / "docs" / "notes.txt"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("alpha\nbeta\n", encoding="utf-8")
            runner = _LoopCommandRunner(
                subprocess.CompletedProcess(
                    ["python", "-m", "unittest", "tests.test_loop_failure"],
                    1,
                    "FAIL: test_loop_failure (tests.test_loop_failure.DevLoop.test_loop_failure)\nRan 1 test in 0.03s\n\nFAILED (failures=1)\n",
                    "",
                )
            )
            service, config_store, _, _, _ = self._make_service(tmp_dir=tmp, command_runner=runner)
            self._configure_scopes(service=service, config_store=config_store, root=root)

            patch_tg = _FakeTelegramService(update_batches=[(
                TelegramInboundMessage(update_id=808, chat_id="chat-1", text="/patchfile docs/notes.txt\n@@ FIND\nbeta\n@@ REPLACE\ngamma", sender_label="@tester"),
            )])
            patch_prompt = self._run_single_update(service, patch_tg)
            patch_confirmation_id = self._extract_confirmation_id(patch_prompt)

            patch_confirm_tg = _FakeTelegramService(update_batches=[(
                TelegramInboundMessage(update_id=809, chat_id="chat-1", text=f"/confirm {patch_confirmation_id}", sender_label="@tester"),
            )])
            self._run_single_update(service, patch_confirm_tg)

            test_tg = _FakeTelegramService(update_batches=[(
                TelegramInboundMessage(update_id=810, chat_id="chat-1", text="/test tests.test_loop_failure", sender_label="@tester"),
            )])
            test_prompt = self._run_single_update(service, test_tg)
            test_confirmation_id = self._extract_confirmation_id(test_prompt)

            test_confirm_tg = _FakeTelegramService(update_batches=[(
                TelegramInboundMessage(update_id=811, chat_id="chat-1", text=f"/confirm {test_confirmation_id}", sender_label="@tester"),
            )])
            test_reply = self._run_single_update(service, test_confirm_tg)

            last_tg = _FakeTelegramService(update_batches=[(
                TelegramInboundMessage(update_id=812, chat_id="chat-1", text="/lastaction", sender_label="@tester"),
            )])
            last_reply = self._run_single_update(service, last_tg)

            self.assertIn("Exit code: 1", test_reply)
            self.assertIn("Summary: failures=1", test_reply)
            self.assertIn("First issue: test_loop_failure", test_reply)
            self.assertIn("Action: test failed", last_reply)
            self.assertIn("Summary: failures=1", last_reply)
            self.assertIn("First issue: test_loop_failure", last_reply)

    def test_duplicate_confirm_does_not_duplicate_patch_or_execution_in_loop_context(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            target = root / "docs" / "notes.txt"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("alpha\nbeta\n", encoding="utf-8")
            runner = _LoopCommandRunner(
                subprocess.CompletedProcess(
                    ["python", "-m", "unittest", "tests.test_scope_audit_layer"],
                    0,
                    "Ran 1 test in 0.02s\n\nOK\n",
                    "",
                )
            )
            service, config_store, _, _, fake_runner = self._make_service(tmp_dir=tmp, command_runner=runner)
            self._configure_scopes(service=service, config_store=config_store, root=root)

            patch_tg = _FakeTelegramService(update_batches=[(
                TelegramInboundMessage(update_id=813, chat_id="chat-1", text="/patchfile docs/notes.txt\n@@ FIND\nbeta\n@@ REPLACE\nbeta updated", sender_label="@tester"),
            )])
            patch_prompt = self._run_single_update(service, patch_tg)
            patch_confirmation_id = self._extract_confirmation_id(patch_prompt)

            patch_confirm_tg = _FakeTelegramService(update_batches=[(
                TelegramInboundMessage(update_id=814, chat_id="chat-1", text=f"/confirm {patch_confirmation_id}", sender_label="@tester"),
            )])
            self._run_single_update(service, patch_confirm_tg)

            patch_replay_tg = _FakeTelegramService(update_batches=[(
                TelegramInboundMessage(update_id=815, chat_id="chat-1", text=f"/confirm {patch_confirmation_id}", sender_label="@tester"),
            )])
            replay_reply = self._run_single_update(service, patch_replay_tg)
            self.assertIn("already used", replay_reply)
            self.assertEqual(target.read_text(encoding="utf-8"), "alpha\nbeta updated\n")

            test_tg = _FakeTelegramService(update_batches=[(
                TelegramInboundMessage(update_id=816, chat_id="chat-1", text="/test tests.test_scope_audit_layer", sender_label="@tester"),
            )])
            test_prompt = self._run_single_update(service, test_tg)
            test_confirmation_id = self._extract_confirmation_id(test_prompt)

            test_confirm_tg = _FakeTelegramService(update_batches=[(
                TelegramInboundMessage(update_id=817, chat_id="chat-1", text=f"/confirm {test_confirmation_id}", sender_label="@tester"),
            )])
            self._run_single_update(service, test_confirm_tg)

            test_replay_tg = _FakeTelegramService(update_batches=[(
                TelegramInboundMessage(update_id=818, chat_id="chat-1", text=f"/confirm {test_confirmation_id}", sender_label="@tester"),
            )])
            replay_test_reply = self._run_single_update(service, test_replay_tg)
            self.assertIn("already used", replay_test_reply)
            self.assertEqual(len(fake_runner.calls), 1)

    def test_workflow_interaction_remains_deterministic_when_patch_and_test_run(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            target = root / "docs" / "notes.txt"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("alpha\nbeta\n", encoding="utf-8")
            runner = _LoopCommandRunner(
                subprocess.CompletedProcess(["python", "-m", "unittest"], 0, "Ran 1 test in 0.02s\n\nOK\n", "")
            )
            service, config_store, _, _, _ = self._make_service(tmp_dir=tmp, command_runner=runner)
            self._configure_scopes(service=service, config_store=config_store, root=root)

            workflow = WorkflowRecord(
                workflow_id="WF-BBBBBB",
                workflow_type="file.explain",
                name="Paused Workflow",
                description="Regression guard",
                created_at=datetime.now().astimezone().isoformat(timespec="seconds"),
                expires_at=(datetime.now().astimezone() + timedelta(minutes=10)).isoformat(timespec="seconds"),
                current_state="paused",
                total_steps=1,
                steps=(),
                user_id="chat-1",
                chat_id="chat-1",
                confirmation_state="pending",
                metadata={"pending_confirmation_id": "WFCONF2"},
            )
            service._workflow_store.create(workflow)

            patch_tg = _FakeTelegramService(update_batches=[(
                TelegramInboundMessage(update_id=819, chat_id="chat-1", text="/patchfile docs/notes.txt\n@@ FIND\nbeta\n@@ REPLACE\ngamma", sender_label="@tester"),
            )])
            patch_prompt = self._run_single_update(service, patch_tg)
            patch_confirmation_id = self._extract_confirmation_id(patch_prompt)

            patch_confirm_tg = _FakeTelegramService(update_batches=[(
                TelegramInboundMessage(update_id=820, chat_id="chat-1", text=f"/confirm {patch_confirmation_id}", sender_label="@tester"),
            )])
            self._run_single_update(service, patch_confirm_tg)

            test_tg = _FakeTelegramService(update_batches=[(
                TelegramInboundMessage(update_id=821, chat_id="chat-1", text="/test tests.test_scope_audit_layer", sender_label="@tester"),
            )])
            test_prompt = self._run_single_update(service, test_tg)
            test_confirmation_id = self._extract_confirmation_id(test_prompt)

            test_confirm_tg = _FakeTelegramService(update_batches=[(
                TelegramInboundMessage(update_id=822, chat_id="chat-1", text=f"/confirm {test_confirmation_id}", sender_label="@tester"),
            )])
            self._run_single_update(service, test_confirm_tg)

            latest_workflow = service._workflow_store.latest(chat_id="chat-1")
            self.assertIsNotNone(latest_workflow)
            self.assertEqual(latest_workflow.workflow_id, "WF-BBBBBB")
            self.assertEqual(latest_workflow.current_state, "paused")
            self.assertEqual(latest_workflow.confirmation_state, "pending")


if __name__ == "__main__":
    unittest.main()