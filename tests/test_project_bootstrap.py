from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.controller.app_service import ControllerService
from app.controller.build_planner import BuildPlanner
from app.controller.profile_store import ControllerConfigStore
from app.controller.project_bootstrap_planner import ProjectBootstrapPlanner
from app.controller.telegram_service import TelegramInboundMessage
from app.controller.intent_translator import IntentTranslator
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


class ProjectBootstrapTests(unittest.TestCase):
    def _make_service(
        self,
        *,
        tmp_dir: str,
        telegram_service: _FakeTelegramService | None = None,
    ) -> tuple[ControllerService, ControllerConfigStore, InMemorySecretStore, _FakeTelegramService, _FakeOllamaAdapter, _FakeOpenAIAdapter]:
        config_store = ControllerConfigStore(config_path=Path(tmp_dir) / "controller_config.json")
        secret_store = InMemorySecretStore()
        ollama = _FakeOllamaAdapter()
        openai = _FakeOpenAIAdapter()
        tg = telegram_service or _FakeTelegramService()
        service = ControllerService(
            runtime_manager=_FakeRuntimeManager(runtime_state="running"),
            config_store=config_store,
            secret_store=secret_store,
            provider_adapters={"ollama": ollama, "openai": openai},
            telegram_service=tg,
        )
        self.addCleanup(service.shutdown)
        service.validate_provider(provider="ollama")
        service.save_telegram_settings(telegram_token=VALID_TOKEN)
        service.validate_telegram()
        service.test_telegram_connection()
        service._latest_health_report = _report("health", "ok", "info", "Healthy")
        service._latest_security_report = _report("security", "ok", "info", "Safe")
        return service, config_store, secret_store, tg, ollama, openai

    def _run_until(self, service: ControllerService, telegram_service: _FakeTelegramService, expected_messages: int) -> object:
        service.start_telegram_loop()
        self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == expected_messages, timeout=2.0))
        return service.stop_telegram_loop()

    def _configure_scopes(
        self,
        *,
        service: ControllerService,
        config_store: ControllerConfigStore,
        repo_root: Path,
        file_root: Path | None = None,
    ) -> None:
        config = config_store.load()
        config.repo_root = str(repo_root.resolve())
        config.file_allowed_roots = (str((file_root or repo_root).resolve()),)
        config_store.save(config)
        service._config = config_store.load()

    def test_bootstrapproject_proposes_python_script_without_hidden_execution(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=700, chat_id="chat-1", text="/translate Build a simple python script that prints hello from bootstrap.", sender_label="@tester"),
            TelegramInboundMessage(update_id=701, chat_id="chat-1", text="/planbuild", sender_label="@tester"),
            TelegramInboundMessage(update_id=702, chat_id="chat-1", text="/bootstrapproject", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, config_store, _, _, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            self._configure_scopes(service=service, config_store=config_store, repo_root=root)

            self._run_until(service, telegram_service, expected_messages=3)
            reply = telegram_service.sent_messages[-1][1]

            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(openai.ask_calls, 0)
            self.assertIn("Bootstrap proposal", reply)
            self.assertIn("Type: python_script", reply)
            self.assertIn("./README.md", reply)
            self.assertIn("./main.py", reply)
            self.assertIn("Approve: /bootstrapapprove", reply)
            self.assertFalse((root / "README.md").exists())
            self.assertEqual(service._last_loop_result.capability_id, "build.bootstrap.propose.read")

    def test_bootstrapview_and_reset_manage_bootstrap_state(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=703, chat_id="chat-1", text="/translate Build a simple python script that prints hello.", sender_label="@tester"),
            TelegramInboundMessage(update_id=704, chat_id="chat-1", text="/planbuild", sender_label="@tester"),
            TelegramInboundMessage(update_id=705, chat_id="chat-1", text="/bootstrapproject", sender_label="@tester"),
            TelegramInboundMessage(update_id=706, chat_id="chat-1", text="/bootstrapview", sender_label="@tester"),
            TelegramInboundMessage(update_id=707, chat_id="chat-1", text="/bootstrapreset", sender_label="@tester"),
            TelegramInboundMessage(update_id=708, chat_id="chat-1", text="/bootstrapview", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, config_store, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            self._configure_scopes(service=service, config_store=config_store, repo_root=root)

            self._run_until(service, telegram_service, expected_messages=6)

            self.assertIn("Bootstrap view", telegram_service.sent_messages[3][1])
            self.assertIn("Bootstrap proposal cleared.", telegram_service.sent_messages[4][1])
            self.assertEqual(
                telegram_service.sent_messages[5][1],
                "No active bootstrap proposal.\nNext: Use /bootstrapproject after /planbuild.",
            )

    def test_bootstrapapprove_creates_files_via_create_path_and_updates_lastaction(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=709, chat_id="chat-1", text="/translate Build a simple python cli for local greetings.", sender_label="@tester"),
            TelegramInboundMessage(update_id=710, chat_id="chat-1", text="/planbuild", sender_label="@tester"),
            TelegramInboundMessage(update_id=711, chat_id="chat-1", text="/bootstrapproject", sender_label="@tester"),
            TelegramInboundMessage(update_id=712, chat_id="chat-1", text="/bootstrapapprove", sender_label="@tester"),
            TelegramInboundMessage(update_id=713, chat_id="chat-1", text="/lastaction", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, config_store, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            self._configure_scopes(service=service, config_store=config_store, repo_root=root)

            with patch.object(service._file_mutator, "create_file", wraps=service._file_mutator.create_file) as create_file:
                self._run_until(service, telegram_service, expected_messages=5)

            approve_reply = telegram_service.sent_messages[3][1]
            lastaction_reply = telegram_service.sent_messages[4][1]
            self.assertEqual(create_file.call_count, 2)
            self.assertTrue((root / "README.md").exists())
            self.assertTrue((root / "main.py").exists())
            self.assertIn("Bootstrap result", approve_reply)
            self.assertIn("Created: 2/2", approve_reply)
            self.assertEqual(service._last_loop_result.capability_id, "build.bootstrap.approve.query")
            self.assertEqual(service._last_loop_result.telemetry.get("executed_capability_ids"), ["file.create.write", "file.create.write"])
            self.assertEqual(service._confirmation_store.pending_count(chat_id="chat-1"), 0)
            self.assertIn("Action: bootstrap completed", lastaction_reply)
            self.assertIn("Created: 2/2", lastaction_reply)

    def test_bootstrapapprove_blocks_existing_file_before_writing_anything(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=714, chat_id="chat-1", text="/translate Build a simple python script that prints hello.", sender_label="@tester"),
            TelegramInboundMessage(update_id=715, chat_id="chat-1", text="/planbuild", sender_label="@tester"),
            TelegramInboundMessage(update_id=716, chat_id="chat-1", text="/bootstrapproject", sender_label="@tester"),
            TelegramInboundMessage(update_id=717, chat_id="chat-1", text="/bootstrapapprove", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            (root / "README.md").write_text("existing\n", encoding="utf-8")
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, config_store, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            self._configure_scopes(service=service, config_store=config_store, repo_root=root)

            with patch.object(service._file_mutator, "create_file", wraps=service._file_mutator.create_file) as create_file:
                self._run_until(service, telegram_service, expected_messages=4)

            reply = telegram_service.sent_messages[-1][1]
            self.assertEqual(create_file.call_count, 0)
            self.assertIn("Couldn't approve that bootstrap.", reply)
            self.assertIn("File already exists", reply)
            self.assertFalse((root / "main.py").exists())
            self.assertEqual((root / "README.md").read_text(encoding="utf-8"), "existing\n")

    def test_bootstrapapprove_blocks_targets_outside_repo_root(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=718, chat_id="chat-1", text="/translate Build a simple python script that prints hello.", sender_label="@tester"),
            TelegramInboundMessage(update_id=719, chat_id="chat-1", text="/planbuild", sender_label="@tester"),
            TelegramInboundMessage(update_id=720, chat_id="chat-1", text="/bootstrapproject", sender_label="@tester"),
            TelegramInboundMessage(update_id=721, chat_id="chat-1", text="/bootstrapapprove", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            repo_root = Path(tmp) / "repo"
            outside_root = Path(tmp) / "outside"
            repo_root.mkdir(parents=True, exist_ok=True)
            outside_root.mkdir(parents=True, exist_ok=True)
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, config_store, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            self._configure_scopes(service=service, config_store=config_store, repo_root=repo_root, file_root=outside_root)

            self._run_until(service, telegram_service, expected_messages=4)

            reply = telegram_service.sent_messages[-1][1]
            self.assertIn("resolves outside the configured repository root", reply)
            self.assertFalse((outside_root / "README.md").exists())
            self.assertFalse((outside_root / "main.py").exists())

    def test_bootstrapproject_rejects_unsupported_website_scaffold(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=722, chat_id="chat-1", text="/translate Build me a landing page for BABYLON.", sender_label="@tester"),
            TelegramInboundMessage(update_id=723, chat_id="chat-1", text="/planbuild", sender_label="@tester"),
            TelegramInboundMessage(update_id=724, chat_id="chat-1", text="/bootstrapproject", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, config_store, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            self._configure_scopes(service=service, config_store=config_store, repo_root=root)

            self._run_until(service, telegram_service, expected_messages=3)

            reply = telegram_service.sent_messages[-1][1]
            self.assertIn("supports python_script, python_cli, desktop_app (PySide6), and simple_library only", reply)


class ProjectBootstrapPlannerTests(unittest.TestCase):
    def test_planner_classifies_simple_library_from_python_library_request(self) -> None:
        planner = ProjectBootstrapPlanner()
        translator = IntentTranslator()
        build_planner = BuildPlanner()
        session = translator.start_session(
            "Build a simple python library for greeting helpers.",
            translation_session_id="TR-TEST01",
            timestamp="2026-04-09T10:00:00+00:00",
        )
        plan = build_planner.build_plan(session, plan_id="BP-TEST01")
        proposal = planner.build_proposal(
            session,
            plan,
            bootstrap_id="BT-TEST01",
            created_at="2026-04-09T10:01:00+00:00",
            repo_root=str(Path("greeter_lib")),
        )

        self.assertEqual(proposal.project_type, "simple_library")
        self.assertEqual(proposal.files[1].relative_path, "./pyproject.toml")
        self.assertTrue(proposal.files[2].relative_path.endswith("/__init__.py"))