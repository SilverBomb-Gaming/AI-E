from dataclasses import replace
from types import SimpleNamespace
import unittest
from unittest import mock


class CanonicalStartupFlowTests(unittest.TestCase):
    def _import_window_module(self):
        qtcore = mock.MagicMock()
        qtcore.QObject = object
        qtcore.Signal = lambda *args, **kwargs: mock.MagicMock()
        qtcore.QTimer = mock.MagicMock()
        qtcore.Qt = mock.MagicMock()

        qtgui = mock.MagicMock()
        qtgui.QCloseEvent = object

        qtwidgets = mock.MagicMock()
        qtwidgets.QMainWindow = object

        with mock.patch.dict(
            "sys.modules",
            {
                "PySide6": mock.MagicMock(QtCore=qtcore, QtGui=qtgui, QtWidgets=qtwidgets),
                "PySide6.QtCore": qtcore,
                "PySide6.QtGui": qtgui,
                "PySide6.QtWidgets": qtwidgets,
            },
        ):
            import importlib
            import app.controller.window as window

            return importlib.reload(window)

    def test_launch_shell_uses_ai_e_product_identity(self):
        window = self._import_window_module()

        self.assertEqual(window.APP_TITLE, "AI-E Operator Console")
        self.assertIn("governed conversational AI environment", window.APP_SUBTITLE)
        self.assertIn("Runtime plugins stay optional", window.APP_SUBTITLE)

    def test_startup_shell_defaults_to_conversation_first_truthful_state(self):
        window = self._import_window_module()

        self.assertIn("Ready", window.STARTUP_CONVERSATION_GREETING)
        self.assertIn("approval before any bounded action", window.STARTUP_CONVERSATION_GREETING)
        self.assertIn("Provider validation: Not run this session", window.PROVIDER_VISIBILITY_IDLE)
        self.assertEqual(
            window.DEFAULT_TRUTH_LINE,
            "Workflow Not Started | Mutation Not Applied | Validation Not Run | Playtest Not Confirmed | Deploy Not Deployed",
        )

    def test_provider_validation_loading_state_is_visible(self):
        window = self._import_window_module()

        label = window.FoundationWindow._provider_validation_loading_label("ollama", "qwen2.5:0.5b")

        self.assertIn("Provider validation: Validating Ollama / qwen2.5:0.5b runtime", label)
        self.assertIn("Last checked:", label)

    def test_provider_validation_success_state_is_visible(self):
        window = self._import_window_module()
        snapshot = mock.MagicMock(
            selected_provider="ollama",
            provider_model="qwen2.5:0.5b",
            provider_status="valid",
            provider_ready=True,
            provider_message="Ollama is reachable and preferred model is available.",
        )

        label = window.FoundationWindow._provider_validation_result_label(snapshot)

        self.assertIn("Provider validation: Provider Validated", label)
        self.assertIn("Runtime Ready: Ollama / qwen2.5:0.5b", label)
        self.assertIn("Last checked:", label)

    def test_provider_validation_failure_state_is_visible(self):
        window = self._import_window_module()
        snapshot = mock.MagicMock(
            selected_provider="ollama",
            provider_model="missing-model",
            provider_status="invalid",
            provider_ready=False,
            provider_message="Preferred model not found locally.",
        )

        label = window.FoundationWindow._provider_validation_result_label(snapshot)

        self.assertIn("Provider validation: Validation Failed", label)
        self.assertIn("Preferred model not found locally.", label)
        self.assertIn("Last checked:", label)

    def test_runtime_readiness_labels_are_compact_and_plugin_oriented(self):
        window = self._import_window_module()
        from app.controller.models import ControllerSnapshot

        base = ControllerSnapshot(
            runtime_state="stopped",
            status_message="Runtime stopped.",
            mode="offline",
            selected_mode="offline",
            policy="ask_before_online",
            active_provider="ollama",
            selected_provider="ollama",
            provider_status="unknown",
            provider_message="Provider has not been validated yet.",
            provider_ready=False,
            provider_model="",
            available_provider_models=(),
            openai_key_masked="",
            telegram_configured=False,
            telegram_token_present=False,
            telegram_status="unknown",
            telegram_message="Telegram has not been configured yet.",
            telegram_token_masked="",
            telegram_bot_identity="-",
            telegram_last_test_result="not_run",
            telegram_last_test_at="-",
            telegram_loop_state="stopped",
            telegram_loop_activity="idle",
            telegram_loop_message="Telegram loop is stopped.",
            telegram_last_activity_at="-",
            telegram_last_command="No Telegram command handled yet.",
            telegram_last_ask_status="No provider-backed ask has run yet.",
            telegram_last_inbound_summary="No inbound Telegram activity yet.",
            telegram_last_outbound_summary="No outbound Telegram activity yet.",
            configured_repo_root="-",
            configured_file_roots="-",
            configured_web_domains="-",
            registered_node_count=0,
            selected_node_id="",
            selected_node_summary="",
            buffered_context_count=0,
            last_context_source="No buffered context yet.",
            current_context_freshness="",
            last_context_action="No context action yet.",
            last_repo_branch="-",
            last_repo_status="No repository insight result yet.",
            last_repo_checked_at="-",
            last_file_read="No file preview result yet.",
            last_file_read_status="No file preview result yet.",
            last_file_read_at="-",
            last_web_fetch="No web fetch result yet.",
            last_web_status="No web fetch result yet.",
            last_web_content_type="-",
            last_web_fetched_at="-",
            last_capability_id="-",
            last_capability_state="unknown",
            last_capability_message="No capability evaluated yet.",
            last_capability_trust_summary="No capability trust summary yet.",
            last_execution_outcome="Unknown",
            last_execution_reason_code="No execution result yet.",
            last_execution_summary="No execution result yet.",
            last_execution_trust_summary="No execution trust summary yet.",
            last_execution_scope_summary="No execution scope summary yet.",
            last_execution_duration_ms=0,
            last_execution_finished_at="-",
            last_audit_summary="No audit record yet.",
            last_workflow_type="-",
            last_workflow_state="No workflow yet.",
            last_workflow_step="No workflow step yet.",
            last_workflow_summary="No workflow executed yet.",
            pending_confirmation_count=0,
            last_confirmation_requested="No pending confirmation requested yet.",
            last_confirmation_result="No confirmation handled yet.",
            readiness_state="not_ready",
            readiness_message="Run health and security checks after validation.",
            health_status="unknown",
            safety_status="unknown",
            last_health_check_at="-",
            last_security_check_at="-",
            health_summary="Health check has not been run yet.",
            safety_summary="Security check has not been run yet.",
            diagnostic_summary_lines=(),
            openclaw_installed=False,
            openclaw_path="",
            ollama_installed=False,
            ollama_path="",
            runtime_pid=None,
            recent_logs=(),
            runtime_active=False,
        )

        self.assertIn("No Runtime Loaded", window.FoundationWindow._runtime_plugin_readiness_label(base))
        self.assertIn(
            "OpenClaw Available",
            window.FoundationWindow._runtime_plugin_readiness_label(replace(base, openclaw_installed=True, openclaw_path="C:/openclaw.mjs")),
        )
        self.assertIn(
            "OpenClaw Connected",
            window.FoundationWindow._runtime_plugin_readiness_label(
                replace(base, runtime_state="running", status_message="OpenClaw gateway running.", openclaw_installed=True)
            ),
        )
        self.assertIn(
            "Plugin Requires Setup",
            window.FoundationWindow._runtime_plugin_readiness_label(replace(base, runtime_state="error", status_message="OpenClaw CLI was not found.")),
        )

    def test_infrastructure_sections_are_compressed_by_default(self):
        window = self._import_window_module()

        self.assertEqual(window.INFRASTRUCTURE_SECTION_TITLE, "Infrastructure")
        self.assertFalse(window.INFRASTRUCTURE_DEFAULT_EXPANDED)
        self.assertEqual(
            window.INFRASTRUCTURE_COMPRESSED_PANELS,
            (
                "Mode + Provider Settings",
                "Telegram Channel",
                "Diagnostics",
                "Runtime Actions",
                "Status Panel",
                "Runtime Logs",
            ),
        )

    def test_startup_conversation_uses_runtime_agent_routing_boundary(self):
        window = self._import_window_module()

        self.assertFalse(hasattr(window.FoundationWindow, "_conversation_response_for_prompt"))
        self.assertTrue(hasattr(window.FoundationWindow, "_invoke_conversation_route"))
        self.assertTrue(hasattr(window.FoundationWindow, "_apply_conversation_reply"))
        self.assertTrue(hasattr(window.FoundationWindow, "_apply_provider_validation_snapshot"))

    def test_approval_pending_card_helpers_are_scope_aware(self):
        window = self._import_window_module()

        truth_line = "Runtime Agent Routed | Scope: mutation_request | Risk: mutation_requested | Approval Required | Boundary: read_only_plan_until_operator_approval | Mutation Not Applied | Validation Not Run | Approval Required Before Action | Audit Visible"

        self.assertEqual(window.APPROVAL_PENDING_IDLE, "No scoped action pending.")
        self.assertTrue(window.FoundationWindow._approval_pending_required("Approval Required Before Action"))
        self.assertFalse(window.FoundationWindow._approval_pending_required("No Approval Requested"))
        self.assertEqual(
            window.FoundationWindow._pending_request_from_truth_line(truth_line),
            "Mutation-capable request awaiting operator approval.",
        )
        self.assertEqual(window.FoundationWindow._pending_risk_from_truth_line(truth_line), "Mutation requested.")
        self.assertEqual(window.FoundationWindow._pending_boundary_from_truth_line(truth_line), "No files changed yet.")

    def test_approval_pending_card_visibility_follows_reply_governance(self):
        window = self._import_window_module()

        class Field:
            def __init__(self):
                self.text = ""

            def setText(self, text):
                self.text = text

        class Card:
            def __init__(self):
                self.visible = False

            def setVisible(self, visible):
                self.visible = visible

        fake_window = SimpleNamespace(
            approval_pending_card=Card(),
            approval_request_value=Field(),
            approval_risk_value=Field(),
            approval_boundary_value=Field(),
            _pending_approval_scope_line="",
            _approval_pending_required=window.FoundationWindow._approval_pending_required,
            _pending_request_from_truth_line=window.FoundationWindow._pending_request_from_truth_line,
            _pending_risk_from_truth_line=window.FoundationWindow._pending_risk_from_truth_line,
            _pending_boundary_from_truth_line=window.FoundationWindow._pending_boundary_from_truth_line,
            _hide_approval_pending_card=lambda: window.FoundationWindow._hide_approval_pending_card(fake_window),
        )
        approval_reply = SimpleNamespace(
            approval_state="Approval Required Before Action",
            truth_line="Runtime Agent Routed | Scope: mutation_request | Risk: mutation_requested | Approval Required | Boundary: read_only_plan_until_operator_approval | Mutation Not Applied | Validation Not Run | Approval Required Before Action | Audit Visible",
        )
        read_only_reply = SimpleNamespace(approval_state="No Approval Requested", truth_line="Runtime Agent Routed")

        window.FoundationWindow._apply_approval_pending_state(fake_window, approval_reply)

        self.assertTrue(fake_window.approval_pending_card.visible)
        self.assertEqual(fake_window.approval_risk_value.text, "Mutation requested.")
        self.assertEqual(fake_window.approval_boundary_value.text, "No files changed yet.")

        window.FoundationWindow._apply_approval_pending_state(fake_window, read_only_reply)

        self.assertFalse(fake_window.approval_pending_card.visible)
        self.assertEqual(fake_window.approval_request_value.text, window.APPROVAL_PENDING_IDLE)


if __name__ == "__main__":
    unittest.main()
