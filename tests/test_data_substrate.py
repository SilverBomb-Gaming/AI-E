from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

from app.cli.chat_cli import AiEChatCli
from app.controller.app_service import ControllerService
from app.controller.chat_command_parser import parse_chat_command
from app.controller.evaluation_session_models import EvaluationJobDefinition, EvaluationSessionRecord
from app.controller.execution_runner import ExecutionRunner
from app.controller.feature_bundle_models import FeatureBundleFile, FeatureBundleRecord, FeatureValidationPlan
from app.controller.profile_store import ControllerConfigStore
from app.platform.secrets import InMemorySecretStore

from tests.test_execution_capability import _FakeCommandRunner
from tests.test_telegram_commands import VALID_TOKEN, _FakeOllamaAdapter, _FakeOpenAIAdapter, _FakeRuntimeManager, _FakeTelegramService, _report


class _PromptDriver:
    def __init__(self, *answers: str) -> None:
        self._answers = list(answers)

    def __call__(self, prompt: str) -> str:
        if self._answers:
            return self._answers.pop(0)
        raise AssertionError(f"Unexpected prompt: {prompt}")


class DataSubstrateTests(unittest.TestCase):
    def _make_service(
        self,
        *,
        tmp_dir: str,
        command_runner: _FakeCommandRunner | None = None,
    ) -> tuple[ControllerService, ControllerConfigStore, _FakeCommandRunner]:
        config_store = ControllerConfigStore(config_path=Path(tmp_dir) / "controller_config.json")
        secret_store = InMemorySecretStore()
        runner = command_runner or _FakeCommandRunner()
        service = ControllerService(
            runtime_manager=_FakeRuntimeManager(runtime_state="running"),
            config_store=config_store,
            secret_store=secret_store,
            provider_adapters={"ollama": _FakeOllamaAdapter(), "openai": _FakeOpenAIAdapter()},
            telegram_service=_FakeTelegramService(),
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
        return service, config_store, runner

    @staticmethod
    def _configure_repo_root(*, service: ControllerService, config_store: ControllerConfigStore, root: Path) -> None:
        config = config_store.load()
        resolved = str(root.resolve())
        config.repo_root = resolved
        config.file_allowed_roots = (resolved,)
        config_store.save(config)
        service._config = config_store.load()

    def test_parser_recognizes_data_command_family(self) -> None:
        data_list = parse_chat_command(text="/data", has_text=True)
        data_detail = parse_chat_command(text="/data DAT-ABC1234567", has_text=True)
        data_search = parse_chat_command(text="/datasearch type=chain_step chain_id=CH-12345678 limit=2", has_text=True)
        named_data_search = parse_chat_command(text="/datasearch --type chain_step --chain-id CH-12345678 --limit 2", has_text=True)

        self.assertEqual(data_list.command_label, "/data")
        self.assertEqual(data_detail.command_label, "/data")
        self.assertEqual(data_search.command_label, "/datasearch")
        self.assertIn("type=chain_step", data_search.argument)
        self.assertEqual(named_data_search.command_label, "/datasearch")
        self.assertIn("--type chain_step", named_data_search.argument)

    def test_datasearch_invalid_limit_returns_specific_message(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service, config_store, _ = self._make_service(tmp_dir=tmp)
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            self._configure_repo_root(service=service, config_store=config_store, root=root)
            result = service.execute_local_chat_input(text="/datasearch --type chain_step --limit 99")

            self.assertEqual(result.outcome, "invalid_request")
            self.assertIn("Couldn't parse that data search.", result.user_message)
            self.assertIn("Limit must be an integer from 1 to 20.", result.user_message)
            self.assertIn("Next: Use /datasearch --type", result.user_message)

    def test_command_records_persist_and_can_be_inspected_from_cli(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service, config_store, _ = self._make_service(tmp_dir=tmp)
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            self._configure_repo_root(service=service, config_store=config_store, root=root)
            output: list[str] = []
            cli = AiEChatCli(service=service, input_func=_PromptDriver(), output_func=output.append)

            self.assertTrue(cli.handle_line("/status"))

            records = service.list_data_records(limit=5)
            self.assertTrue(records)
            status_record = next(record for record in records if record.command_label == "/status")
            self.assertEqual(status_record.record_type, "command")
            self.assertEqual(status_record.input_text, "/status")

            jsonl_files = sorted((Path(tmp) / "data_records").glob("*.jsonl"))
            self.assertTrue(jsonl_files)

            self.assertTrue(cli.handle_line("/data"))
            self.assertTrue(cli.handle_line(f"/data {status_record.record_id}"))

            joined = "\n".join(output)
            self.assertIn("Data records", joined)
            self.assertIn(f"Data record {status_record.record_id}", joined)
            self.assertIn("Type: command", joined)

    def test_evaluation_runs_are_grouped_and_labeled(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            runner = _FakeCommandRunner(
                subprocess.CompletedProcess(
                    ["python", "-m", "pytest", "tests/test_cli_chat.py::LocalCliChatTests::test_cli_debug_shows_shared_status_routing"],
                    0,
                    "1 passed\n",
                    "",
                )
            )
            service, config_store, _ = self._make_service(tmp_dir=tmp, command_runner=runner)
            self._configure_repo_root(service=service, config_store=config_store, root=root)
            session = EvaluationSessionRecord(
                session_id=service.next_evaluation_session_id(),
                title="data substrate eval",
                purpose="verify evaluation capture",
                created_at="2026-04-10T10:00:00Z",
                approved_at="",
                status="created",
                owner_label="local-cli",
                source="local-cli",
                chat_id="local-cli",
                allowed_jobs=(
                    EvaluationJobDefinition(
                        job_id="job-1",
                        command_label="/test",
                        command_text="/test tests/test_cli_chat.py::LocalCliChatTests::test_cli_debug_shows_shared_status_routing",
                        command_argument="tests/test_cli_chat.py::LocalCliChatTests::test_cli_debug_shows_shared_status_routing",
                        command_summary="pytest LocalCliChatTests::test_cli_debug_shows_shared_status_routing",
                        job_kind="local_command",
                        target_kind="local",
                    ),
                ),
                interval_seconds=0,
                max_runs=1,
                max_failures=1,
                dispatch_error_threshold=1,
                stop_conditions=(),
            )

            service.create_evaluation_session(session)
            service.start_evaluation_session(session.session_id)
            completed = service.await_evaluation_session(session.session_id, timeout_seconds=2.0)

            self.assertIsNotNone(completed)
            self.assertEqual(completed.status, "completed")

            records = service.search_data_records(filters={"type": "evaluation_run", "session_id": session.session_id}, limit=5)
            self.assertTrue(records)
            self.assertEqual(records[0].label, "evaluation-only")
            self.assertEqual(records[0].session_id, session.session_id)
            self.assertEqual(records[0].command_label, "/test")

    def test_chain_step_records_are_searchable_by_chain_id(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            runner = _FakeCommandRunner(
                subprocess.CompletedProcess(
                    ["python", "-m", "pytest", "tests/test_cli_chat.py::LocalCliChatTests::test_cli_debug_shows_shared_status_routing"],
                    0,
                    "1 passed\n",
                    "",
                )
            )
            service, config_store, _ = self._make_service(tmp_dir=tmp, command_runner=runner)
            self._configure_repo_root(service=service, config_store=config_store, root=root)
            output: list[str] = []
            cli = AiEChatCli(service=service, input_func=_PromptDriver(), output_func=output.append)

            self.assertTrue(
                cli.handle_line(
                    '/chaincreate --title cli_validator_chain --type validate_then_report --command "/test tests/test_cli_chat.py::LocalCliChatTests::test_cli_debug_shows_shared_status_routing" --steps 2 --retries 1 --failures 1'
                )
            )
            chain = service.list_task_chains()[0]
            self.assertTrue(cli.handle_line(f"/chainstart {chain.chain_id}"))
            confirmation = service.latest_pending_confirmation_for_chat(chat_id="local-cli")
            self.assertIsNotNone(confirmation)
            self.assertTrue(cli.handle_line(f"/confirm {confirmation.confirmation_id}"))

            completed = service.await_task_chain(chain.chain_id, timeout_seconds=2.0)
            self.assertIsNotNone(completed)
            self.assertEqual(completed.status, "completed")

            records = service.search_data_records(filters={"type": "chain_step", "chain_id": chain.chain_id}, limit=10)
            self.assertTrue(records)
            self.assertTrue(any(record.chain_id == chain.chain_id for record in records))
            self.assertIn("progress_state", records[0].normalized_input)
            self.assertIn("matched_rule_id", records[0].normalized_input)
            self.assertIn("chain_policy_version", records[0].context_payload)

            self.assertTrue(cli.handle_line(f"/datasearch type=chain_step chain_id={chain.chain_id}"))
            self.assertTrue(cli.handle_line(f"/datasearch --type chain_step --chain-id {chain.chain_id} --limit 2"))
            joined = "\n".join(output)
            self.assertIn("Data search", joined)
            self.assertIn(chain.chain_id, joined)

    def test_supervised_chain_records_include_decision_trace(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            runner = _FakeCommandRunner(
                subprocess.CompletedProcess(["python", "-m", "pytest"], 1, "FAILED\n", "assertion failed"),
            )
            service, config_store, _ = self._make_service(tmp_dir=tmp, command_runner=runner)
            self._configure_repo_root(service=service, config_store=config_store, root=root)

            def _fake_resolve_dispatch_target(*, selector: str, required_command_label: str, requested_command: str):
                return None, "dispatch_role_unavailable", "No enabled validator node can accept /test."

            service.resolve_dispatch_target = _fake_resolve_dispatch_target  # type: ignore[method-assign]

            created = service.execute_local_chat_input(
                text='/chaincreate --title "substrate decision" --type dispatch_recover_resume --command "/test tests.test_cli_chat.LocalCliChatTests.test_cli_debug_shows_shared_status_routing" --steps 4 --failures 4 --no-progress 3 --target role:validator --fallback local'
            )
            self.assertEqual(created.outcome, "success")
            chain = service.list_task_chains()[0]
            service.execute_local_chat_input(text=f"/chainstart {chain.chain_id}")
            confirmation = service.latest_pending_confirmation_for_chat(chat_id="local-cli")
            self.assertIsNotNone(confirmation)
            service.execute_local_chat_input(text=f"/confirm {confirmation.confirmation_id}")

            paused = service.await_task_chain(chain.chain_id, timeout_seconds=2.0)
            self.assertIsNotNone(paused)
            self.assertEqual(paused.status, "paused")

            records = service.search_data_records(filters={"type": "chain_step", "chain_id": chain.chain_id}, limit=10)
            self.assertTrue(records)
            decision_record = records[0]
            self.assertEqual(decision_record.context_payload.get("chain_policy_version").lower(), "v2")
            self.assertIn("decision_summary", decision_record.result_payload)
            self.assertIn("transition_reason", decision_record.result_payload)
            self.assertIn("next_stage", decision_record.result_payload)

    def test_feature_bundle_validation_capture_includes_bundle_provenance(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service, _, _ = self._make_service(tmp_dir=tmp)
            bundle = FeatureBundleRecord(
                bundle_id="FB-TEST-001",
                feature_request="Add better data capture",
                feature_title="Data capture",
                intended_outcome="Store reusable traces",
                bundle_summary="Add storage and inspection commands",
                files=(
                    FeatureBundleFile(
                        relative_path="app/controller/app_service.py",
                        inclusion_reason="service wiring",
                        change_summary="wire durable data capture",
                        editable=True,
                        scope_confidence=0.95,
                    ),
                ),
                assumptions=("tests remain local",),
                risk_notes=("schema drift",),
                validation_plan=FeatureValidationPlan(command_text="/test tests/test_data_substrate.py", rationale="verify capture"),
                state="applied",
                validation_state="not_run",
                created_at="2026-04-10T10:00:00Z",
                updated_at="2026-04-10T10:00:00Z",
                approval_required=True,
            )
            service.set_active_feature_bundle(chat_id="local-cli", bundle=bundle)

            service.record_feature_bundle_validation_result(
                chat_id="local-cli",
                command_text="/test tests/test_data_substrate.py",
                outcome="success",
                output_summary="1 passed",
            )

            records = service.search_data_records(filters={"type": "feature_bundle", "bundle_id": "FB-TEST-001"}, limit=5)
            self.assertTrue(records)
            self.assertEqual(records[0].bundle_id, "FB-TEST-001")
            self.assertEqual(records[0].label, "training-eligible")
            self.assertEqual(records[0].normalized_input.get("event_kind"), "validation")