from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.controller.app_service import ControllerService
from app.controller.build_planner import BuildPlanner
from app.controller.intent_formatter import IntentFormatter
from app.controller.intent_translator import IntentTranslator
from app.controller.profile_store import ControllerConfigStore
from app.controller.telegram_service import TelegramInboundMessage
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


class IntentTranslatorDeterminismTests(unittest.TestCase):
    def setUp(self) -> None:
        self.translator = IntentTranslator()
        self.formatter = IntentFormatter()
        self.planner = BuildPlanner()

    def test_python_cli_request_is_classified_without_product_discovery_questions(self) -> None:
        spec = self.translator.translate(
            "Build a simple Python CLI that scans a folder and writes a CSV summary of file sizes"
        )
        self.assertEqual(spec.request_type, "python_cli")
        self.assertEqual(spec.delivery_target, "python_cli")
        self.assertEqual(spec.summary, "Simple Python CLI that scans a folder and writes a CSV summary of file sizes.")
        self.assertIn("stack: python", spec.confirmed_values)
        self.assertIn("interface: CLI", spec.confirmed_values)
        self.assertFalse(spec.open_questions)
        self.assertNotIn("unknown", spec.intent_id)

    def test_python_script_request_is_classified_without_broad_delivery_questions(self) -> None:
        spec = self.translator.translate("Build a simple Python script that renames files in a folder")
        self.assertEqual(spec.request_type, "python_script")
        self.assertEqual(spec.delivery_target, "python_script")
        self.assertIn("stack: python", spec.confirmed_values)
        self.assertIn("interface: script", spec.confirmed_values)
        self.assertFalse(spec.open_questions)

    def test_pyside_desktop_request_is_classified_as_desktop_app(self) -> None:
        spec = self.translator.translate("Build a small PySide6 desktop app for tracking notes")
        self.assertEqual(spec.request_type, "desktop_app")
        self.assertEqual(spec.delivery_target, "desktop_app")
        self.assertIn("stack: pyside6", spec.confirmed_values)

    def test_python_library_request_is_classified_as_simple_library(self) -> None:
        spec = self.translator.translate("Build a simple Python library for parsing CSV rows")
        self.assertEqual(spec.request_type, "simple_library")
        self.assertEqual(spec.delivery_target, "simple_library")
        self.assertIn("stack: python", spec.confirmed_values)
        self.assertIn("interface: library", spec.confirmed_values)
        self.assertFalse(spec.open_questions)

    def test_broad_product_discovery_request_stays_unknown(self) -> None:
        spec = self.translator.translate("Help me figure out what kind of product I should build for a market opportunity")
        self.assertEqual(spec.request_type, "unknown")
        self.assertTrue(spec.open_questions)
        self.assertTrue(any("first deliverable" in item.lower() for item in spec.open_questions))

    def test_translation_session_formatter_points_ready_bounded_tool_to_planbuild(self) -> None:
        session = self.translator.start_session(
            "Build a simple Python CLI that scans a folder and writes a CSV summary of file sizes",
            translation_session_id="TR-CLITST",
            timestamp="2026-04-09T12:00:00+00:00",
        )
        reply = self.formatter.format_translation_session(session, heading="Translation draft")
        self.assertIn("Type: python_cli", reply)
        self.assertIn("stack: python", reply)
        self.assertIn("interface: CLI", reply)
        self.assertNotIn("Open questions:", reply)
        self.assertIn("Next: Use /planbuild or /translateview.", reply)

    def test_planbuild_inherits_python_cli_without_intent_drift(self) -> None:
        session = self.translator.start_session(
            "Build a simple Python CLI that scans a folder and writes a CSV summary of file sizes",
            translation_session_id="TR-PLANCLI",
            timestamp="2026-04-09T12:00:00+00:00",
        )
        plan = self.planner.build_plan(session, plan_id="BP-CLITST")
        self.assertEqual(plan.request_type, "python_cli")
        self.assertEqual(plan.state, "ready")
        self.assertEqual(plan.blockers, ())


class TranslateCommandDeterminismTests(unittest.TestCase):
    def _make_service(
        self,
        *,
        tmp_dir: str,
        telegram_service: _FakeTelegramService | None = None,
    ) -> tuple[ControllerService, _FakeTelegramService, _FakeOllamaAdapter, _FakeOpenAIAdapter]:
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
        return service, tg, ollama, openai

    def _run_until(self, service: ControllerService, telegram_service: _FakeTelegramService, expected_messages: int) -> None:
        service.start_telegram_loop()
        self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == expected_messages, timeout=2.0))
        service.stop_telegram_loop()

    def test_translate_command_returns_bounded_cli_draft(self) -> None:
        update = TelegramInboundMessage(
            update_id=401,
            chat_id="chat-1",
            text="/translate Build a simple Python CLI that scans a folder and writes a CSV summary of file sizes",
            sender_label="@tester",
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, tg, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            self._run_until(service, tg, expected_messages=1)
            reply = tg.sent_messages[0][1]
            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(openai.ask_calls, 0)
            self.assertIn("Translation draft", reply)
            self.assertIn("Type: python_cli", reply)
            self.assertIn("Summary: Simple Python CLI that scans a folder and writes a CSV summary of file sizes.", reply)
            self.assertIn("stack: python", reply)
            self.assertIn("interface: CLI", reply)
            self.assertIn("Next: Use /planbuild or /translateview.", reply)
            self.assertNotIn("Open questions:", reply)
            self.assertNotIn("What is the first deliverable", reply)
            self.assertEqual(service._intent_store.get_active(chat_id="chat-1").current_spec.request_type, "python_cli")

    def test_planbuild_from_cli_translation_keeps_python_cli_request_type(self) -> None:
        updates = (
            TelegramInboundMessage(
                update_id=402,
                chat_id="chat-1",
                text="/translate Build a simple Python CLI that scans a folder and writes a CSV summary of file sizes",
                sender_label="@tester",
            ),
            TelegramInboundMessage(update_id=403, chat_id="chat-1", text="/planbuild", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, tg, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            self._run_until(service, tg, expected_messages=2)
            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(openai.ask_calls, 0)
            plan = service._build_plan_store.get_active(chat_id="chat-1")
            self.assertIsNotNone(plan)
            assert plan is not None
            self.assertEqual(plan.request_type, "python_cli")
            self.assertEqual(plan.state, "ready")
            self.assertEqual(plan.blockers, ())


if __name__ == "__main__":
    unittest.main()
