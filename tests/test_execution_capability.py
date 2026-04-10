from __future__ import annotations

import subprocess
import tempfile
import unittest
from dataclasses import replace
from datetime import datetime, timedelta
from pathlib import Path

from app.controller.app_service import ControllerService
from app.controller.execution_runner import ExecutionRunner
from app.controller.telegram_service import TelegramInboundMessage
from app.controller.workflow_models import WorkflowRecord
from app.platform.secrets import InMemorySecretStore
from app.controller.profile_store import ControllerConfigStore

from tests.test_telegram_commands import (
    VALID_TOKEN,
    _FakeOllamaAdapter,
    _FakeOpenAIAdapter,
    _FakeRuntimeManager,
    _FakeTelegramService,
    _item,
    _report,
    _wait_until,
)


class _FakeCommandRunner:
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


class ExecutionCapabilityTests(unittest.TestCase):
    def _make_service(
        self,
        *,
        tmp_dir: str,
        telegram_service: _FakeTelegramService | None = None,
        command_runner: _FakeCommandRunner | None = None,
    ) -> tuple[ControllerService, ControllerConfigStore, InMemorySecretStore, _FakeTelegramService, _FakeCommandRunner]:
        config_store = ControllerConfigStore(config_path=Path(tmp_dir) / "controller_config.json")
        secret_store = InMemorySecretStore()
        tg = telegram_service or _FakeTelegramService()
        runner = command_runner or _FakeCommandRunner()
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
        service.activate_runtime_control_plane()
        return service, config_store, secret_store, tg, runner

    def _run_single_update(self, service: ControllerService, telegram_service: _FakeTelegramService) -> str:
        service._telegram_service = telegram_service
        service.start_telegram_loop()
        self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 1))
        service.stop_telegram_loop()
        return telegram_service.sent_messages[0][1]

    def _configure_repo_root(self, *, service: ControllerService, config_store: ControllerConfigStore, root: Path) -> None:
        config = config_store.load()
        config.repo_root = str(root.resolve())
        config_store.save(config)
        service._config = config_store.load()

    @staticmethod
    def _extract_confirmation_id(reply: str) -> str:
        marker = "ID: "
        start = reply.index(marker) + len(marker)
        return reply[start:].splitlines()[0].split()[0].strip()

    def test_run_requires_confirmation_and_confirm_executes_once(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            create_tg = _FakeTelegramService(
                update_batches=[(
                    TelegramInboundMessage(
                        update_id=701,
                        chat_id="chat-1",
                        text="/run python -m unittest tests.test_telegram_commands",
                        sender_label="@tester",
                    ),
                )]
            )
            runner = _FakeCommandRunner(
                subprocess.CompletedProcess(
                    ["python", "-m", "unittest"],
                    0,
                    "Ran 2 tests in 0.08s\n\nOK\n",
                    "",
                )
            )
            service, config_store, _, _, fake_runner = self._make_service(tmp_dir=tmp, telegram_service=create_tg, command_runner=runner)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            prompt_reply = self._run_single_update(service, create_tg)
            confirmation_id = self._extract_confirmation_id(prompt_reply)

            self.assertIn("Action requires confirmation.", prompt_reply)
            self.assertIn("Preview: run python -m unittest tests.test_telegram_commands", prompt_reply)
            self.assertEqual(len(fake_runner.calls), 0)

            confirm_tg = _FakeTelegramService(
                update_batches=[(
                    TelegramInboundMessage(
                        update_id=702,
                        chat_id="chat-1",
                        text=f"/confirm {confirmation_id}",
                        sender_label="@tester",
                    ),
                )]
            )
            confirm_reply = self._run_single_update(service, confirm_tg)

            self.assertEqual(len(fake_runner.calls), 1)
            self.assertIn(f"Confirmation {confirmation_id} approved.", confirm_reply)
            self.assertIn("Exit code: 0", confirm_reply)
            self.assertIn("Summary: 2 tests passed in 0.08s", confirm_reply)

            replay_tg = _FakeTelegramService(
                update_batches=[(
                    TelegramInboundMessage(
                        update_id=703,
                        chat_id="chat-1",
                        text=f"/confirm {confirmation_id}",
                        sender_label="@tester",
                    ),
                )]
            )
            replay_reply = self._run_single_update(service, replay_tg)
            self.assertIn("already used", replay_reply)
            self.assertEqual(len(fake_runner.calls), 1)

    def test_deny_run_does_not_execute(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            create_tg = _FakeTelegramService(
                update_batches=[(
                    TelegramInboundMessage(update_id=704, chat_id="chat-1", text="/run python -m unittest tests.test_scope_audit_layer", sender_label="@tester"),
                )]
            )
            service, config_store, _, _, fake_runner = self._make_service(tmp_dir=tmp, telegram_service=create_tg)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            prompt_reply = self._run_single_update(service, create_tg)
            confirmation_id = self._extract_confirmation_id(prompt_reply)

            deny_tg = _FakeTelegramService(
                update_batches=[(
                    TelegramInboundMessage(update_id=705, chat_id="chat-1", text=f"/deny {confirmation_id}", sender_label="@tester"),
                )]
            )
            deny_reply = self._run_single_update(service, deny_tg)

            self.assertEqual(deny_reply, f"Confirmation {confirmation_id} denied. Request not executed.")
            self.assertEqual(len(fake_runner.calls), 0)
            self.assertEqual(service._audit_store.latest().outcome, "denied")

    def test_run_rejects_out_of_scope_path_and_blocked_patterns(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            updates = [
                (TelegramInboundMessage(update_id=706, chat_id="chat-1", text="/run python ../outside.py", sender_label="@tester"),),
                (TelegramInboundMessage(update_id=707, chat_id="chat-1", text="/run python -m unittest tests.test_telegram_commands && whoami", sender_label="@tester"),),
            ]
            telegram_service = _FakeTelegramService(update_batches=updates)
            service, config_store, _, _, fake_runner = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 2, timeout=2.0))
            service.stop_telegram_loop()
            first_reply = telegram_service.sent_messages[0][1]
            second_reply = telegram_service.sent_messages[1][1]

            self.assertEqual(len(fake_runner.calls), 0)
            self.assertIn("Action is out of scope.", first_reply)
            self.assertIn("escapes the approved repository scope", first_reply)
            self.assertIn("Can't run /run right now.", second_reply)
            self.assertIn("blocked shell operators", second_reply)

    def test_run_timeout_is_reported_concisely(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            create_tg = _FakeTelegramService(
                update_batches=[(
                    TelegramInboundMessage(update_id=708, chat_id="chat-1", text="/run python diagnostics_smoke.py", sender_label="@tester"),
                )]
            )
            timeout_exc = subprocess.TimeoutExpired(cmd=["python", "diagnostics_smoke.py"], timeout=5.0, output="still running", stderr="waiting")
            runner = _FakeCommandRunner(timeout_exc)
            service, config_store, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=create_tg, command_runner=runner)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            prompt_reply = self._run_single_update(service, create_tg)
            confirmation_id = self._extract_confirmation_id(prompt_reply)

            confirm_tg = _FakeTelegramService(
                update_batches=[(
                    TelegramInboundMessage(update_id=709, chat_id="chat-1", text=f"/confirm {confirmation_id}", sender_label="@tester"),
                )]
            )
            confirm_reply = self._run_single_update(service, confirm_tg)

            self.assertEqual(service._last_execution_result.outcome, "timed_out")
            self.assertEqual(service._last_execution_result.outcome_reason_code, "command_timeout")
            self.assertIn("Exit: timeout", confirm_reply)
            self.assertIn("Summary: Timed out after 5s.", confirm_reply)

    def test_run_main_alias_executes_expected_argv_and_updates_lastaction(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            (root / "src").mkdir(parents=True, exist_ok=True)
            (root / "src" / "main.py").write_text("print('hello')\n", encoding="utf-8")
            create_tg = _FakeTelegramService(
                update_batches=[(
                    TelegramInboundMessage(update_id=714, chat_id="chat-1", text="/run main .", sender_label="@tester"),
                )]
            )
            runner = _FakeCommandRunner(
                subprocess.CompletedProcess(
                    ["python", "src/main.py", "."],
                    0,
                    "Scanning: .\n",
                    "",
                )
            )
            service, config_store, _, _, fake_runner = self._make_service(tmp_dir=tmp, telegram_service=create_tg, command_runner=runner)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            prompt_reply = self._run_single_update(service, create_tg)
            confirmation_id = self._extract_confirmation_id(prompt_reply)

            self.assertIn("Preview: run main .", prompt_reply)
            self.assertEqual(len(fake_runner.calls), 0)

            confirm_tg = _FakeTelegramService(
                update_batches=[(
                    TelegramInboundMessage(update_id=715, chat_id="chat-1", text=f"/confirm {confirmation_id}", sender_label="@tester"),
                )]
            )
            confirm_reply = self._run_single_update(service, confirm_tg)

            self.assertEqual(len(fake_runner.calls), 1)
            self.assertEqual(fake_runner.calls[0][0][1:], ("src/main.py", "."))
            self.assertIn("Command: main .", confirm_reply)
            self.assertIn("Summary: Scanning: .", confirm_reply)

            last_tg = _FakeTelegramService(
                update_batches=[(
                    TelegramInboundMessage(update_id=716, chat_id="chat-1", text="/lastaction", sender_label="@tester"),
                )]
            )
            last_reply = self._run_single_update(service, last_tg)
            last_run = service.latest_run_for_chat(chat_id="chat-1")
            self.assertIn("Action: run completed", last_reply)
            self.assertIn("Command: main .", last_reply)
            self.assertIn("Target: .", last_reply)
            self.assertIn("Exit code: 0", last_reply)
            self.assertIsNotNone(last_run)
            self.assertEqual(last_run.command_label, "main")
            self.assertEqual(last_run.target_root, ".")
            self.assertEqual(last_run.entrypoint_path, "src/main.py")
            self.assertEqual(last_run.exit_code, 0)
            self.assertEqual(last_run.stdout_preview, "Scanning: .")
            self.assertEqual(last_run.stderr_preview, "")
            self.assertTrue(last_run.is_patch_relevant)

    def test_run_main_alias_without_argument_executes_expected_argv(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            (root / "src").mkdir(parents=True, exist_ok=True)
            (root / "src" / "main.py").write_text("print('hello')\n", encoding="utf-8")
            create_tg = _FakeTelegramService(
                update_batches=[(
                    TelegramInboundMessage(update_id=7161, chat_id="chat-1", text="/run main", sender_label="@tester"),
                )]
            )
            runner = _FakeCommandRunner(
                subprocess.CompletedProcess(
                    ["python", "src/main.py"],
                    0,
                    "Scanning: .\n",
                    "",
                )
            )
            service, config_store, _, _, fake_runner = self._make_service(tmp_dir=tmp, telegram_service=create_tg, command_runner=runner)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            prompt_reply = self._run_single_update(service, create_tg)
            confirmation_id = self._extract_confirmation_id(prompt_reply)
            self.assertIn("Preview: run main", prompt_reply)

            confirm_tg = _FakeTelegramService(
                update_batches=[(
                    TelegramInboundMessage(update_id=7162, chat_id="chat-1", text=f"/confirm {confirmation_id}", sender_label="@tester"),
                )]
            )
            confirm_reply = self._run_single_update(service, confirm_tg)

            self.assertEqual(len(fake_runner.calls), 1)
            self.assertEqual(fake_runner.calls[0][0][1:], ("src/main.py",))
            self.assertIn("Command: main", confirm_reply)
            self.assertIn("Summary: Scanning: .", confirm_reply)

    def test_run_main_alias_accepts_generated_project_target(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            generated_root = root / "generated" / "GP-7A31C2" / "src"
            generated_root.mkdir(parents=True, exist_ok=True)
            (generated_root / "main.py").write_text("print('hello')\n", encoding="utf-8")
            create_tg = _FakeTelegramService(
                update_batches=[(
                    TelegramInboundMessage(update_id=7163, chat_id="chat-1", text="/run main generated/GP-7A31C2", sender_label="@tester"),
                )]
            )
            runner = _FakeCommandRunner(
                subprocess.CompletedProcess(
                    ["python", "generated/GP-7A31C2/src/main.py", "generated/GP-7A31C2"],
                    0,
                    "Scanning: generated/GP-7A31C2\n",
                    "",
                )
            )
            service, config_store, _, _, fake_runner = self._make_service(tmp_dir=tmp, telegram_service=create_tg, command_runner=runner)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            prompt_reply = self._run_single_update(service, create_tg)
            confirmation_id = self._extract_confirmation_id(prompt_reply)
            self.assertIn("Preview: run main generated/GP-7A31C2", prompt_reply)

            confirm_tg = _FakeTelegramService(
                update_batches=[(
                    TelegramInboundMessage(update_id=7164, chat_id="chat-1", text=f"/confirm {confirmation_id}", sender_label="@tester"),
                )]
            )
            confirm_reply = self._run_single_update(service, confirm_tg)
            last_run = service.latest_run_for_chat(chat_id="chat-1")

            self.assertEqual(len(fake_runner.calls), 1)
            self.assertEqual(fake_runner.calls[0][0][1:], ("generated/GP-7A31C2/src/main.py", "generated/GP-7A31C2"))
            self.assertIn("Command: main generated/GP-7A31C2", confirm_reply)
            self.assertIn("Target: generated/GP-7A31C2", confirm_reply)
            self.assertIn("Summary: Scanning: generated/GP-7A31C2", confirm_reply)
            self.assertIsNotNone(last_run)
            self.assertEqual(last_run.command_label, "main")
            self.assertEqual(last_run.target_root, "generated/GP-7A31C2")
            self.assertEqual(last_run.entrypoint_path, "generated/GP-7A31C2/src/main.py")
            self.assertEqual(last_run.exit_code, 0)
            self.assertEqual(last_run.stdout_preview, "Scanning: generated/GP-7A31C2")
            self.assertEqual(last_run.stderr_preview, "")
            self.assertTrue(last_run.is_patch_relevant)

    def test_plain_text_run_request_reuses_latest_main_target_with_confirmation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            generated_root = root / "generated" / "GP-7A31C2" / "src"
            generated_root.mkdir(parents=True, exist_ok=True)
            (generated_root / "main.py").write_text("print('hello')\n", encoding="utf-8")
            runner = _FakeCommandRunner(
                subprocess.CompletedProcess(
                    ["python", "generated/GP-7A31C2/src/main.py", "generated/GP-7A31C2"],
                    0,
                    "Scanning: generated/GP-7A31C2\n",
                    "",
                ),
                subprocess.CompletedProcess(
                    ["python", "generated/GP-7A31C2/src/main.py", "generated/GP-7A31C2"],
                    0,
                    "Scanning: generated/GP-7A31C2\n",
                    "",
                ),
            )
            service, config_store, _, _, fake_runner = self._make_service(tmp_dir=tmp, command_runner=runner)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            first_prompt = self._run_single_update(
                service,
                _FakeTelegramService(update_batches=[(
                    TelegramInboundMessage(update_id=7165, chat_id="chat-1", text="/run main generated/GP-7A31C2", sender_label="@tester"),
                )]),
            )
            first_confirmation_id = self._extract_confirmation_id(first_prompt)
            self._run_single_update(
                service,
                _FakeTelegramService(update_batches=[(
                    TelegramInboundMessage(update_id=7166, chat_id="chat-1", text=f"/confirm {first_confirmation_id}", sender_label="@tester"),
                )]),
            )
            self.assertEqual(len(fake_runner.calls), 1)

            natural_reply = self._run_single_update(
                service,
                _FakeTelegramService(update_batches=[(
                    TelegramInboundMessage(update_id=7167, chat_id="chat-1", text="Run it again.", sender_label="@tester"),
                )]),
            )
            self.assertIn("Action requires confirmation.", natural_reply)
            self.assertIn("Preview: run main generated/GP-7A31C2", natural_reply)
            self.assertEqual(len(fake_runner.calls), 1)
            self.assertEqual(service._last_execution_result.capability_id, "telegram.plain_text")
            self.assertEqual(service._last_execution_result.telemetry["natural_chat_classification"]["intent_label"], "execution_request")
            self.assertEqual(service._last_execution_result.telemetry["natural_chat_route"]["route_command"], "/run")

            second_confirmation_id = self._extract_confirmation_id(natural_reply)
            confirm_reply = self._run_single_update(
                service,
                _FakeTelegramService(update_batches=[(
                    TelegramInboundMessage(update_id=7168, chat_id="chat-1", text=f"/confirm {second_confirmation_id}", sender_label="@tester"),
                )]),
            )
            self.assertEqual(len(fake_runner.calls), 2)
            self.assertIn("Command: main generated/GP-7A31C2", confirm_reply)

    def test_run_main_alias_rejects_missing_entrypoint_and_multiple_args(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            updates = [
                (TelegramInboundMessage(update_id=717, chat_id="chat-1", text="/run main", sender_label="@tester"),),
                (TelegramInboundMessage(update_id=718, chat_id="chat-1", text="/run main one two", sender_label="@tester"),),
                (TelegramInboundMessage(update_id=719, chat_id="chat-1", text="/run python src/main.py", sender_label="@tester"),),
                (TelegramInboundMessage(update_id=720, chat_id="chat-1", text="/run unknownalias", sender_label="@tester"),),
            ]
            telegram_service = _FakeTelegramService(update_batches=updates)
            service, config_store, _, _, fake_runner = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 4, timeout=2.0))
            service.stop_telegram_loop()

            self.assertEqual(len(fake_runner.calls), 0)
            self.assertIn("src/main.py is missing", telegram_service.sent_messages[0][1])
            self.assertIn("zero or one repo-local target argument only", telegram_service.sent_messages[1][1])
            self.assertIn("approved repo-local validation or smoke script", telegram_service.sent_messages[2][1])
            self.assertIn("Can't run /run right now.", telegram_service.sent_messages[3][1])
            self.assertIn("allowed Python-based /run command", telegram_service.sent_messages[3][1])

    def test_run_main_alias_is_blocked_when_readiness_is_not_ready(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            (root / "src").mkdir(parents=True, exist_ok=True)
            (root / "src" / "main.py").write_text("print('hello')\n", encoding="utf-8")
            telegram_service = _FakeTelegramService(
                update_batches=[(
                    TelegramInboundMessage(update_id=720, chat_id="chat-1", text="/run main", sender_label="@tester"),
                )]
            )
            service, config_store, _, _, fake_runner = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            self._configure_repo_root(service=service, config_store=config_store, root=root)
            service._latest_health_report = _report(
                "health",
                "blocked",
                "error",
                "Blocked",
                items=(_item("health", "error", "health.blocked", "Readiness is not ready."),),
            )

            reply = self._run_single_update(service, telegram_service)

            self.assertEqual(len(fake_runner.calls), 0)
            self.assertIn("Can't run /run right now.", reply)
            self.assertIn("Readiness is not ready.", reply)

    def test_test_command_requires_confirmation_and_audits_execution(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            create_tg = _FakeTelegramService(
                update_batches=[(
                    TelegramInboundMessage(update_id=710, chat_id="chat-1", text="/test tests.test_file_mutation_capability", sender_label="@tester"),
                )]
            )
            runner = _FakeCommandRunner(
                subprocess.CompletedProcess(
                    ["python", "-m", "unittest", "tests.test_file_mutation_capability"],
                    1,
                    "Ran 3 tests in 0.12s\n\nFAILED (failures=2, errors=1)\n",
                    "",
                )
            )
            service, config_store, _, _, fake_runner = self._make_service(tmp_dir=tmp, telegram_service=create_tg, command_runner=runner)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            prompt_reply = self._run_single_update(service, create_tg)
            confirmation_id = self._extract_confirmation_id(prompt_reply)
            self.assertIn("Preview: run python -m unittest tests.test_file_mutation_capability", prompt_reply)

            confirm_tg = _FakeTelegramService(
                update_batches=[(
                    TelegramInboundMessage(update_id=711, chat_id="chat-1", text=f"/confirm {confirmation_id}", sender_label="@tester"),
                )]
            )
            confirm_reply = self._run_single_update(service, confirm_tg)
            latest = service._audit_store.latest()

            self.assertEqual(len(fake_runner.calls), 1)
            self.assertEqual(service._last_execution_result.capability_id, "test.command.run")
            self.assertEqual(service._last_execution_result.outcome, "failed")
            self.assertIn("Exit code: 1", confirm_reply)
            self.assertIn("Summary: failures=2, errors=1", confirm_reply)
            self.assertIsNotNone(latest)
            self.assertEqual(latest.capability_id, "test.command.run")
            self.assertEqual(latest.exit_code, 1)
            self.assertIn("python -m unittest tests.test_file_mutation_capability", latest.action_summary)
            self.assertIn("failures=2, errors=1", latest.output_summary)
            self.assertIn("repository/execute", latest.scope_summary)

    def test_run_confirmation_does_not_disturb_existing_workflow_state(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            create_tg = _FakeTelegramService(
                update_batches=[(
                    TelegramInboundMessage(update_id=712, chat_id="chat-1", text="/run python -m unittest tests.test_scope_audit_layer", sender_label="@tester"),
                )]
            )
            runner = _FakeCommandRunner(
                subprocess.CompletedProcess(["python", "-m", "unittest"], 0, "Ran 1 test in 0.02s\n\nOK\n", "")
            )
            service, config_store, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=create_tg, command_runner=runner)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            workflow = WorkflowRecord(
                workflow_id="WF-AAAAAA",
                workflow_type="file.explain",
                name="Existing Workflow",
                description="Regression guard",
                created_at=datetime.now().astimezone().isoformat(timespec="seconds"),
                expires_at=(datetime.now().astimezone() + timedelta(minutes=10)).isoformat(timespec="seconds"),
                current_state="paused",
                total_steps=1,
                steps=(),
                user_id="chat-1",
                chat_id="chat-1",
                confirmation_state="pending",
                metadata={"pending_confirmation_id": "WFCONF1"},
            )
            service._workflow_store.create(workflow)

            prompt_reply = self._run_single_update(service, create_tg)
            confirmation_id = self._extract_confirmation_id(prompt_reply)

            confirm_tg = _FakeTelegramService(
                update_batches=[(
                    TelegramInboundMessage(update_id=713, chat_id="chat-1", text=f"/confirm {confirmation_id}", sender_label="@tester"),
                )]
            )
            self._run_single_update(service, confirm_tg)

            latest_workflow = service._workflow_store.latest(chat_id="chat-1")
            self.assertIsNotNone(latest_workflow)
            self.assertEqual(latest_workflow.workflow_id, "WF-AAAAAA")
            self.assertEqual(latest_workflow.current_state, "paused")
            self.assertEqual(latest_workflow.confirmation_state, "pending")


if __name__ == "__main__":
    unittest.main()