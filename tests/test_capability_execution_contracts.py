from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.controller.app_service import ControllerService
from app.controller.execution_models import CapabilityExecutionRequest, CapabilityExecutionResult
from app.controller.node_config import NodeConfigStore
from app.controller.node_models import NodeDescriptor
from app.controller.profile_store import ControllerConfigStore
from app.controller.telegram_service import TelegramInboundMessage
from app.platform.secrets import InMemorySecretStore
from app.providers.base import ProviderStatus

from tests.test_telegram_commands import (
    VALID_TOKEN,
    _FakeOllamaAdapter,
    _FakeOpenAIAdapter,
    _FakeRuntimeManager,
    _FakeTelegramService,
    _report,
    _wait_until,
)


class CapabilityExecutionContractTests(unittest.TestCase):
    def _make_service(
        self,
        *,
        tmp_dir: str,
        runtime_state: str = "running",
        activate_runtime: bool = True,
        ollama_adapter: _FakeOllamaAdapter | None = None,
        openai_adapter: _FakeOpenAIAdapter | None = None,
        telegram_service: _FakeTelegramService | None = None,
    ) -> tuple[ControllerService, ControllerConfigStore, InMemorySecretStore, _FakeTelegramService, _FakeOllamaAdapter, _FakeOpenAIAdapter]:
        config_store = ControllerConfigStore(config_path=Path(tmp_dir) / "controller_config.json")
        secret_store = InMemorySecretStore()
        local_ollama = ollama_adapter or _FakeOllamaAdapter()
        remote_openai = openai_adapter or _FakeOpenAIAdapter()
        tg = telegram_service or _FakeTelegramService()
        service = ControllerService(
            runtime_manager=_FakeRuntimeManager(runtime_state=runtime_state),
            config_store=config_store,
            secret_store=secret_store,
            provider_adapters={"ollama": local_ollama, "openai": remote_openai},
            telegram_service=tg,
        )
        self.addCleanup(service.shutdown)
        service.validate_provider(provider="ollama")
        service.save_telegram_settings(telegram_token=VALID_TOKEN)
        service.validate_telegram()
        service.test_telegram_connection()
        service._latest_health_report = _report("health", "ok", "info", "Healthy")
        service._latest_security_report = _report("security", "ok", "info", "Safe")
        if activate_runtime:
            service.activate_runtime_control_plane()
        return service, config_store, secret_store, tg, local_ollama, remote_openai

    def _run_single_update(self, service: ControllerService, telegram_service: _FakeTelegramService) -> tuple[object, str]:
        service.start_telegram_loop()
        self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 1))
        snapshot = service.stop_telegram_loop()
        return snapshot, telegram_service.sent_messages[0][1]

    def _configure_online_confirmation_mode(self, service: ControllerService, config_store: ControllerConfigStore) -> None:
        config = config_store.load()
        config.selected_mode = "online"
        config.current_mode = "offline"
        config.selected_provider = "openai"
        config.policy = "ask_before_online"
        config_store.save(config)
        service._config = config_store.load()
        service._secret_store.put_secret(service._config.openai_secret_id, "sk-test-confirmation")
        service._config.openai_has_secret = True
        service._config.openai_key_masked = "sk-...rmation"
        config_store.save(service._config)
        service.validate_provider(provider="openai")

    def _last_result(self, service: ControllerService) -> CapabilityExecutionResult:
        result = service._last_execution_result
        self.assertIsNotNone(result)
        self.assertIsInstance(result, CapabilityExecutionResult)
        self.assertIsInstance(result.request, CapabilityExecutionRequest)
        return result

    def test_status_read_returns_structured_success_result(self) -> None:
        update = TelegramInboundMessage(update_id=101, chat_id="chat-1", text="/status", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            snapshot, reply = self._run_single_update(service, telegram_service)
            result = self._last_result(service)
            self.assertEqual(result.request_id, result.request.request_id)
            self.assertTrue(result.request_id.startswith("REQ-"))
            self.assertEqual(result.capability_id, "status.read")
            self.assertEqual(result.outcome, "success")
            self.assertEqual(result.outcome_reason_code, "ok")
            self.assertEqual(result.user_message, reply)
            self.assertEqual(result.request.source, "telegram")
            self.assertEqual(result.request.chat_id, "chat-1")
            self.assertEqual(result.request.user_id, "chat-1")
            self.assertEqual(result.request.original_command, "/status")
            self.assertEqual(result.request.parsed_arguments, {})
            self.assertEqual(result.request.mode_snapshot, "offline")
            self.assertEqual(result.request.policy_snapshot, "ask_before_online")
            self.assertGreaterEqual(result.duration_ms, 0)
            self.assertFalse(result.confirmation_used)
            self.assertFalse(result.degraded)
            self.assertFalse(result.retryable)
            self.assertEqual(result.access_kind, "read_only")
            self.assertEqual(result.locality, "local_only")
            self.assertEqual(result.offline_safety, "safe_offline")
            self.assertEqual(result.telegram_exposure, "allowed")
            self.assertIn("read-only | local | offline-safe", result.trust_summary)
            self.assertEqual(result.scope_summary, "internal/read")
            self.assertEqual(snapshot.last_execution_outcome, "success")
            self.assertEqual(snapshot.last_execution_reason_code, "ok")
            self.assertEqual(snapshot.last_execution_summary, result.internal_summary)
            self.assertIn("read-only | local | offline-safe", snapshot.last_execution_trust_summary)

    def test_translate_read_returns_structured_success_result(self) -> None:
        update = TelegramInboundMessage(
            update_id=1011,
            chat_id="chat-1",
            text="/translate Build me a landing page for BABYLON with wishlist CTA and email signup.",
            sender_label="@tester",
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            snapshot, reply = self._run_single_update(service, telegram_service)
            result = self._last_result(service)
            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(openai.ask_calls, 0)
            self.assertEqual(result.capability_id, "intent.translate.read")
            self.assertEqual(result.outcome, "success")
            self.assertEqual(result.outcome_reason_code, "ok")
            self.assertEqual(result.user_message, reply)
            self.assertEqual(result.access_kind, "read_only")
            self.assertEqual(result.locality, "local_only")
            self.assertEqual(result.offline_safety, "safe_offline")
            self.assertEqual(result.scope_summary, "internal/read")
            self.assertIn("translation_session", result.telemetry)
            self.assertIn("intent_spec", result.telemetry)
            self.assertIn("execution_handoff", result.telemetry)
            spec_payload = result.telemetry["intent_spec"]
            self.assertEqual(spec_payload["request_type"], "website")
            self.assertIn("Wishlist CTA", spec_payload["functional_requirements"])
            self.assertEqual(snapshot.last_execution_outcome, "success")

    def test_refine_read_returns_structured_success_result(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=1012, chat_id="chat-1", text="/translate Build me a landing page for BABYLON with wishlist CTA and email signup.", sender_label="@tester"),
            TelegramInboundMessage(update_id=1013, chat_id="chat-1", text="/refine one-page site, dark style, deploy to Vercel, use React", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, _, _, _, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 2, timeout=2.0))
            service.stop_telegram_loop()
            result = self._last_result(service)
            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(openai.ask_calls, 0)
            self.assertEqual(result.capability_id, "intent.refine.read")
            self.assertEqual(result.outcome, "success")
            self.assertIn("translation_session", result.telemetry)
            self.assertIn("intent_spec", result.telemetry)
            self.assertIn("stack: react", result.telemetry["intent_spec"]["confirmed_values"])
            self.assertLess(result.telemetry["open_question_count"], 4)

    def test_planbuild_returns_structured_build_plan_result(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=1014, chat_id="chat-1", text="/translate Build me a landing page for BABYLON with wishlist CTA and email signup.", sender_label="@tester"),
            TelegramInboundMessage(update_id=1015, chat_id="chat-1", text="/refine one-page site, dark style, deploy to Vercel, use React", sender_label="@tester"),
            TelegramInboundMessage(update_id=1016, chat_id="chat-1", text="/planbuild", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, _, _, _, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 3, timeout=2.0))
            service.stop_telegram_loop()
            result = self._last_result(service)
            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(openai.ask_calls, 0)
            self.assertEqual(result.capability_id, "build.plan.read")
            self.assertEqual(result.outcome, "success")
            self.assertIn("build_plan", result.telemetry)
            self.assertIn("translation_session", result.telemetry)
            self.assertEqual(result.telemetry["build_plan"]["request_type"], "website")
            self.assertEqual(result.telemetry["build_plan"]["phases"][0]["phase_id"], "PH-001")
            self.assertEqual(result.telemetry["build_plan"]["phases"][0]["task_groups"][0]["task_group_id"], "TG-001-001")
            self.assertEqual(result.telemetry["build_plan"]["phases"][0]["name"], "Scope contract")
            self.assertIn("Deployment target: vercel", result.telemetry["build_plan"]["cross_phase_dependencies"])

    def test_planapprove_returns_structured_bridge_result(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=1017, chat_id="chat-1", text="/translate Build me a landing page for BABYLON with wishlist CTA and email signup.", sender_label="@tester"),
            TelegramInboundMessage(update_id=1018, chat_id="chat-1", text="/refine one-page site, dark style, deploy to Vercel, use React, use Mailchimp", sender_label="@tester"),
            TelegramInboundMessage(update_id=1019, chat_id="chat-1", text="/planbuild", sender_label="@tester"),
            TelegramInboundMessage(update_id=1020, chat_id="chat-1", text="/planstep", sender_label="@tester"),
            TelegramInboundMessage(update_id=1021, chat_id="chat-1", text="/planapprove", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, _, _, _, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 5, timeout=2.0))
            service.stop_telegram_loop()
            result = self._last_result(service)
            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(openai.ask_calls, 0)
            self.assertEqual(result.capability_id, "build.step.approve.query")
            self.assertEqual(result.outcome, "success")
            self.assertTrue(result.confirmation_used)
            self.assertEqual(result.telemetry["executed_capability_id"], "repo.status.read")
            self.assertEqual(result.telemetry["execution_proposal"]["command_label"], "/repo")
            self.assertEqual(result.telemetry["plan_bridge_state"]["task_group_progress"][0]["status"], "completed")

    def test_bundleapprove_returns_structured_bundle_result(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=1022, chat_id="chat-1", text="/translate Build me a landing page for BABYLON with wishlist CTA and email signup.", sender_label="@tester"),
            TelegramInboundMessage(update_id=1023, chat_id="chat-1", text="/refine one-page site, dark style, deploy to Vercel, use React, use Mailchimp", sender_label="@tester"),
            TelegramInboundMessage(update_id=1024, chat_id="chat-1", text="/planbuild", sender_label="@tester"),
            TelegramInboundMessage(update_id=1025, chat_id="chat-1", text="/planstepbundle", sender_label="@tester"),
            TelegramInboundMessage(update_id=1026, chat_id="chat-1", text="/bundleapprove", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, _, _, _, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 5, timeout=2.0))
            service.stop_telegram_loop()
            result = self._last_result(service)
            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(openai.ask_calls, 0)
            self.assertEqual(result.capability_id, "build.bundle.approve.query")
            self.assertEqual(result.outcome, "success")
            self.assertTrue(result.confirmation_used)
            self.assertIn("bundle_state", result.telemetry)
            self.assertIn("bundle_proposal", result.telemetry)
            self.assertIn("executed_capability_ids", result.telemetry)
            self.assertEqual(len(result.telemetry["bundle_state"]["completed_steps"]), 3)
            self.assertEqual(result.telemetry["bundle_state"]["state"], "completed")
            self.assertEqual(result.telemetry["bundle_state"]["stop_reason"], "approved_step_budget_reached")
            self.assertEqual(len(result.telemetry["executed_capability_ids"]), 3)
            self.assertEqual(result.telemetry["plan_bridge_state"]["task_group_progress"][0]["status"], "completed")

    def test_chat_new_idea_returns_structured_routed_result(self) -> None:
        update = TelegramInboundMessage(
            update_id=1027,
            chat_id="chat-1",
            text="/chat Build me a landing page for BABYLON with wishlist CTA and email signup.",
            sender_label="@tester",
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            _, reply = self._run_single_update(service, telegram_service)
            result = self._last_result(service)
            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(openai.ask_calls, 0)
            self.assertEqual(result.capability_id, "chat.orchestrate.read")
            self.assertEqual(result.outcome, "success")
            self.assertEqual(result.user_message, reply)
            self.assertIn("orchestration_result", result.telemetry)
            self.assertIn("orchestration_context", result.telemetry)
            self.assertEqual(result.telemetry["orchestration_result"]["detected_mode"], "new_intent")
            self.assertEqual(result.telemetry["orchestration_result"]["routed_capability"], "intent.translate.read")
            self.assertEqual(result.telemetry["routed_capability_id"], "intent.translate.read")

    def test_chat_approval_request_returns_structured_boundary_result(self) -> None:
        updates = (
            TelegramInboundMessage(update_id=1028, chat_id="chat-1", text="/translate Build me a landing page for BABYLON with wishlist CTA and email signup.", sender_label="@tester"),
            TelegramInboundMessage(update_id=1029, chat_id="chat-1", text="/refine one-page site, dark style, deploy to Vercel, use React, use Mailchimp", sender_label="@tester"),
            TelegramInboundMessage(update_id=1030, chat_id="chat-1", text="/planbuild", sender_label="@tester"),
            TelegramInboundMessage(update_id=1031, chat_id="chat-1", text="/planstep", sender_label="@tester"),
            TelegramInboundMessage(update_id=1032, chat_id="chat-1", text="/chat approve it", sender_label="@tester"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[updates])
            service, _, _, _, ollama, openai = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service.start_telegram_loop()
            self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 5, timeout=2.0))
            service.stop_telegram_loop()
            result = self._last_result(service)
            self.assertEqual(ollama.ask_calls, 0)
            self.assertEqual(openai.ask_calls, 0)
            self.assertEqual(result.capability_id, "chat.orchestrate.read")
            self.assertEqual(result.outcome, "success")
            self.assertEqual(result.outcome_reason_code, "explicit_approval_required")
            self.assertFalse(result.confirmation_used)
            self.assertEqual(result.telemetry["orchestration_result"]["detected_mode"], "approve_step_request")
            self.assertEqual(result.telemetry["orchestration_result"]["routed_action"], "/planapprove")
            self.assertIn("Approval stays explicit", result.user_message)

    def test_models_read_returns_structured_degraded_result_when_ollama_unavailable(self) -> None:
        update = TelegramInboundMessage(update_id=102, chat_id="chat-1", text="/models", sender_label="@tester")
        ollama = _FakeOllamaAdapter(
            validation_status=ProviderStatus(
                provider="ollama",
                display_name="Ollama",
                configured=True,
                available=False,
                validation_state="invalid",
                ready=False,
                message="Ollama service is unavailable.",
                is_local=True,
            )
        )
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service, ollama_adapter=ollama)
            _, reply = self._run_single_update(service, telegram_service)
            result = self._last_result(service)
            self.assertEqual(result.capability_id, "models.read")
            self.assertEqual(result.outcome, "degraded")
            self.assertEqual(result.outcome_reason_code, "ollama_unavailable")
            self.assertTrue(result.degraded)
            self.assertTrue(result.retryable)
            self.assertEqual(result.provider_used, "ollama")
            self.assertEqual(result.mode_used, "offline")
            self.assertEqual(result.access_kind, "read_only")
            self.assertEqual(result.locality, "local_only")
            self.assertIn("offline-safe", result.trust_summary)
            self.assertEqual(result.user_message, reply)
            self.assertIn("Unavailable right now.", result.user_message)

    def test_confirmed_run_carries_target_node_telemetry_and_audit_summary(self) -> None:
        first_update = TelegramInboundMessage(update_id=103, chat_id="chat-1", text="/run python validate_runtime.py", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            node_config_store = NodeConfigStore(config_path=Path(tmp) / "node_config.json")
            node_config = node_config_store.load()
            node_config.registry_root = str((Path(tmp) / "registry").resolve())
            node_config_store.save(node_config)
            create_service = _FakeTelegramService(update_batches=[(first_update,)])
            service, config_store, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=create_service)
            config = config_store.load()
            config.repo_root = tmp
            config.file_allowed_roots = (tmp,)
            config_store.save(config)
            service._config = config_store.load()
            service._normalize_repo_root_config()
            service._normalize_file_roots_config()
            service._node_registry.register_node(
                NodeDescriptor(
                    node_id="mock-gpu",
                    display_name="Bedroom GPU Rig",
                    role="executor",
                    node_type="mock",
                    status="online",
                    transport="mock",
                    summary="Simulated remote execution node for controller tests.",
                    capability_labels=("/run", "/test"),
                    metadata={"mock_output_summary": "Mock node executed validate_runtime.py", "mock_exit_code": 0},
                )
            )
            service.select_execution_node("mock-gpu")
            _, prompt_reply = self._run_single_update(service, create_service)
            confirmation_id = prompt_reply.split("ID: ", 1)[1].splitlines()[0].strip()

            confirm_service = _FakeTelegramService(
                update_batches=[(TelegramInboundMessage(update_id=104, chat_id="chat-1", text=f"/confirm {confirmation_id}", sender_label="@tester"),)]
            )
            service._telegram_service = confirm_service
            snapshot, _ = self._run_single_update(service, confirm_service)
            result = self._last_result(service)
            self.assertEqual(result.capability_id, "shell.command.run")
            self.assertEqual(result.outcome, "success")
            self.assertEqual(result.telemetry["target_node_id"], "mock-gpu")
            self.assertEqual(result.telemetry["target_node_name"], "Bedroom GPU Rig")
            self.assertEqual(result.telemetry["target_node_type"], "mock")
            self.assertEqual(result.telemetry["target_node_transport"], "mock")
            self.assertEqual(result.telemetry["execution_exit_code"], 0)
            self.assertEqual(result.telemetry["execution_output_summary"], "Mock node executed validate_runtime.py")
            self.assertIn("node mock-gpu", snapshot.last_audit_summary)

    def test_ask_provider_query_success_result_is_structured(self) -> None:
        update = TelegramInboundMessage(update_id=103, chat_id="chat-1", text="/ask hello", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _, ollama, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            _, reply = self._run_single_update(service, telegram_service)
            result = self._last_result(service)
            self.assertEqual(ollama.ask_calls, 1)
            self.assertEqual(result.capability_id, "ask.provider_query")
            self.assertEqual(result.outcome, "success")
            self.assertEqual(result.provider_used, "ollama")
            self.assertEqual(result.mode_used, "offline")
            self.assertFalse(result.confirmation_used)
            self.assertTrue(result.hide_content_in_summary)
            self.assertEqual(result.access_kind, "external_side_effect")
            self.assertEqual(result.locality, "hybrid")
            self.assertEqual(result.offline_safety, "optional_online")
            self.assertEqual(result.confirmation_sensitivity, "policy_based")
            self.assertIn("external-side-effect | hybrid | online-sensitive", result.trust_summary)
            self.assertEqual(result.scope_summary, "network/execute target=127.0.0.1")
            self.assertEqual(result.user_message, reply)
            self.assertIn("provider_model", result.telemetry)
            self.assertIn("Answer (Offline | Ollama", result.user_message)

    def test_ask_provider_query_timeout_result_is_structured(self) -> None:
        update = TelegramInboundMessage(update_id=104, chat_id="chat-1", text="/ask hello", sender_label="@tester")
        ollama = _FakeOllamaAdapter(ask_delay_seconds=0.2)
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service, ollama_adapter=ollama)
            service._provider_timeouts["ollama"] = 0.05
            service._provider_ask_cooldown_seconds = 0.0
            _, reply = self._run_single_update(service, telegram_service)
            result = self._last_result(service)
            self.assertEqual(result.outcome, "timed_out")
            self.assertEqual(result.outcome_reason_code, "provider_timeout")
            self.assertTrue(result.retryable)
            self.assertEqual(result.user_message, reply)
            self.assertIn("timed out", result.ask_status)

    def test_ask_provider_query_passes_extended_ollama_timeout(self) -> None:
        update = TelegramInboundMessage(update_id=1041, chat_id="chat-1", text="/ask hello", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _, ollama, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)

            _, _ = self._run_single_update(service, telegram_service)

            self.assertEqual(ollama.last_ask_kwargs.get("timeout_seconds"), 60.0)

    def test_confirmation_required_and_confirmed_results_are_structured(self) -> None:
        request_update = TelegramInboundMessage(update_id=105, chat_id="chat-1", text="/ask hello", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            create_service = _FakeTelegramService(update_batches=[(request_update,)])
            service, config_store, _, _, _, openai = self._make_service(tmp_dir=tmp, telegram_service=create_service)
            self._configure_online_confirmation_mode(service, config_store)
            _, prompt_reply = self._run_single_update(service, create_service)
            prompt_result = self._last_result(service)
            self.assertEqual(prompt_result.outcome, "confirmation_required")
            self.assertEqual(prompt_result.outcome_reason_code, "online_confirmation_required")
            self.assertEqual(prompt_result.provider_used, "openai")
            self.assertEqual(prompt_result.mode_used, "online")
            self.assertIn("confirmation_id", prompt_result.telemetry)
            confirmation_id = str(prompt_result.telemetry["confirmation_id"])
            self.assertIn(confirmation_id, prompt_reply)

            confirm_service = _FakeTelegramService(update_batches=[(TelegramInboundMessage(update_id=106, chat_id="chat-1", text=f"/confirm {confirmation_id}", sender_label="@tester"),)])
            service._telegram_service = confirm_service
            _, confirm_reply = self._run_single_update(service, confirm_service)
            confirm_result = self._last_result(service)
            self.assertEqual(openai.ask_calls, 1)
            self.assertEqual(confirm_result.outcome, "success")
            self.assertTrue(confirm_result.confirmation_used)
            self.assertEqual(confirm_result.provider_used, "openai")
            self.assertEqual(confirm_result.mode_used, "online")
            self.assertEqual(confirm_result.user_message, confirm_reply)
            self.assertIn(f"Confirmation {confirmation_id} approved.", confirm_reply)

    def test_denied_and_expired_confirmation_results_are_structured(self) -> None:
        request_update = TelegramInboundMessage(update_id=107, chat_id="chat-1", text="/ask hello", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            create_service = _FakeTelegramService(update_batches=[(request_update,)])
            service, config_store, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=create_service)
            self._configure_online_confirmation_mode(service, config_store)
            _, _ = self._run_single_update(service, create_service)
            confirmation_id = str(self._last_result(service).telemetry["confirmation_id"])

            deny_service = _FakeTelegramService(update_batches=[(TelegramInboundMessage(update_id=108, chat_id="chat-1", text=f"/deny {confirmation_id}", sender_label="@tester"),)])
            service._telegram_service = deny_service
            _, deny_reply = self._run_single_update(service, deny_service)
            deny_result = self._last_result(service)
            self.assertEqual(deny_result.outcome, "denied")
            self.assertEqual(deny_result.outcome_reason_code, "confirmation_denied")
            self.assertEqual(deny_result.user_message, deny_reply)

        request_update = TelegramInboundMessage(update_id=109, chat_id="chat-1", text="/ask hello", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            create_service = _FakeTelegramService(update_batches=[(request_update,)])
            service, config_store, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=create_service)
            self._configure_online_confirmation_mode(service, config_store)
            _, _ = self._run_single_update(service, create_service)
            confirmation_id = str(self._last_result(service).telemetry["confirmation_id"])
            confirmation = service._confirmation_store.get(confirmation_id)
            service._confirmation_store._items[confirmation_id] = confirmation.__class__(**{**confirmation.__dict__, 'expires_at': '2000-01-01T00:00:00+00:00'})

            confirm_service = _FakeTelegramService(update_batches=[(TelegramInboundMessage(update_id=110, chat_id="chat-1", text=f"/confirm {confirmation_id}", sender_label="@tester"),)])
            service._telegram_service = confirm_service
            _, expired_reply = self._run_single_update(service, confirm_service)
            expired_result = self._last_result(service)
            self.assertEqual(expired_result.outcome, "expired")
            self.assertEqual(expired_result.outcome_reason_code, "confirmation_expired")
            self.assertEqual(expired_result.user_message, expired_reply)

    def test_invalid_request_result_for_missing_prompt_is_structured(self) -> None:
        update = TelegramInboundMessage(update_id=111, chat_id="chat-1", text="/ask", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            snapshot, reply = self._run_single_update(service, telegram_service)
            result = self._last_result(service)
            self.assertEqual(result.outcome, "invalid_request")
            self.assertEqual(result.outcome_reason_code, "missing_prompt")
            self.assertEqual(result.user_message, reply)
            self.assertEqual(snapshot.last_execution_outcome, "invalid_request")
            self.assertEqual(snapshot.last_execution_reason_code, "missing_prompt")


if __name__ == "__main__":
    unittest.main()


