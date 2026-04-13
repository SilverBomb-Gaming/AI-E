from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.controller.app_service import ControllerService
from app.controller.chat_command_parser import parse_chat_command
from app.controller.execution_runner import ExecutionRunner
from app.controller.profile_store import ControllerConfigStore
from app.platform.secrets import InMemorySecretStore

from tests.test_execution_capability import _FakeCommandRunner
from tests.test_telegram_commands import VALID_TOKEN, _FakeOllamaAdapter, _FakeOpenAIAdapter, _FakeRuntimeManager, _FakeTelegramService, _report


class DatasourcePolicyTests(unittest.TestCase):
    def _make_service(self, *, tmp_dir: str) -> ControllerService:
        config_store = ControllerConfigStore(config_path=Path(tmp_dir) / "controller_config.json")
        service = ControllerService(
            runtime_manager=_FakeRuntimeManager(runtime_state="running"),
            config_store=config_store,
            secret_store=InMemorySecretStore(),
            provider_adapters={"ollama": _FakeOllamaAdapter(), "openai": _FakeOpenAIAdapter()},
            telegram_service=_FakeTelegramService(),
            execution_runner=ExecutionRunner(command_runner=_FakeCommandRunner(), default_timeout_seconds=5.0),
        )
        self.addCleanup(service.shutdown)
        service.validate_provider(provider="ollama")
        service.save_telegram_settings(telegram_token=VALID_TOKEN)
        service.validate_telegram()
        service.test_telegram_connection()
        service._latest_health_report = _report("health", "ok", "info", "Healthy")
        service._latest_security_report = _report("security", "ok", "info", "Safe")
        service.activate_runtime_control_plane()
        root = Path(tmp_dir) / "workspace"
        root.mkdir(parents=True, exist_ok=True)
        config = config_store.load()
        resolved = str(root.resolve())
        config.repo_root = resolved
        config.file_allowed_roots = (resolved,)
        config_store.save(config)
        service._config = config_store.load()
        return service

    @staticmethod
    def _extract_source_id(reply: str) -> str:
        for line in reply.splitlines():
            if line.startswith("Datasource DSRC-"):
                return line.split()[1].strip()
        raise AssertionError(f"Datasource id not found in reply: {reply}")

    @staticmethod
    def _extract_dataset_id(reply: str) -> str:
        for line in reply.splitlines():
            if line.startswith("Dataset DS-"):
                return line.split()[1].strip()
        raise AssertionError(f"Dataset id not found in reply: {reply}")

    @staticmethod
    def _extract_experiment_id(reply: str) -> str:
        for line in reply.splitlines():
            if line.startswith("Model experiment MX-"):
                return line.split()[2].strip()
        raise AssertionError(f"Experiment id not found in reply: {reply}")

    def _create_dataset(self, service: ControllerService) -> str:
        for command in ("/status", "/help"):
            result = service.execute_local_chat_input(text=command)
            self.assertEqual(result.outcome, "success")
            record = next(item for item in service.list_data_records(limit=10) if item.input_text == command)
            labeled = service.execute_local_chat_input(text=f"/datalabel {record.record_id} training")
            self.assertEqual(labeled.outcome, "success")
        created = service.execute_local_chat_input(text='/datasetcreate --title "linked dataset" --type command --label training')
        self.assertEqual(created.outcome, "success")
        return self._extract_dataset_id(created.user_message)

    def test_parser_recognizes_datasource_command_family(self) -> None:
        create = parse_chat_command(
            text='/datasourcecreate --name "docs portal" --type web_domain --locator "https://example.com"',
            has_text=True,
        )
        review = parse_chat_command(text='/datasourcereview DSRC-12345678 approved', has_text=True)
        summary = parse_chat_command(text='/datasourcesummary', has_text=True)

        self.assertEqual(create.command_label, '/datasourcecreate')
        self.assertEqual(review.command_label, '/datasourcereview')
        self.assertEqual(summary.command_label, '/datasourcesummary')

    def test_datasource_create_review_and_allow_flow(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service = self._make_service(tmp_dir=tmp)

            created = service.execute_local_chat_input(
                text='/datasourcecreate --name "docs portal" --type web_domain --locator "https://example.com/docs" --tags docs,public --note "manual review required"'
            )
            self.assertEqual(created.outcome, 'success')
            source_id = self._extract_source_id(created.user_message)
            self.assertIn('Usage: requires_review', created.user_message)
            self.assertIn('Operations: metadata_only', created.user_message)

            reviewed = service.execute_local_chat_input(text=f'/datasourcereview {source_id} approved --reviewer "operator" --note "approved for controlled use"')
            self.assertEqual(reviewed.outcome, 'success')
            self.assertIn('Review: approved', reviewed.user_message)

            allowed = service.execute_local_chat_input(text=f'/datasourceallow {source_id} retrieval_only --reviewer "operator"')
            self.assertEqual(allowed.outcome, 'success')
            self.assertIn('Usage: retrieval_only', allowed.user_message)
            self.assertIn('Operations: metadata_only, retrieval', allowed.user_message)

            listed = service.execute_local_chat_input(text='/datasources')
            queried = service.execute_local_chat_input(text='/datasourcequery --usage retrieval_only')
            self.assertEqual(listed.outcome, 'success')
            self.assertEqual(queried.outcome, 'success')
            self.assertIn(source_id, listed.user_message)
            self.assertIn(source_id, queried.user_message)

    def test_datasource_block_and_summary_flow(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service = self._make_service(tmp_dir=tmp)

            created = service.execute_local_chat_input(
                text='/datasourcecreate --name "blocked api" --type api_source --locator "https://api.example.com" --review draft'
            )
            source_id = self._extract_source_id(created.user_message)

            blocked = service.execute_local_chat_input(text=f'/datasourceblock {source_id} --reason "license forbids training reuse" --reviewer "operator"')
            summary = service.execute_local_chat_input(text='/datasourcesummary')
            queried = service.execute_local_chat_input(text='/datasourcequery --status blocked')

            self.assertEqual(blocked.outcome, 'success')
            self.assertIn('Status: blocked', blocked.user_message)
            self.assertIn('Blocked reason: license forbids training reuse', blocked.user_message)
            self.assertEqual(summary.outcome, 'success')
            self.assertIn('Statuses: blocked=1', summary.user_message)
            self.assertEqual(queried.outcome, 'success')
            self.assertIn(source_id, queried.user_message)

    def test_dataset_and_model_experiment_inherit_datasource_lineage(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service = self._make_service(tmp_dir=tmp)
            created = service.execute_local_chat_input(
                text='/datasourcecreate --name "training corpus" --type manual_import --locator "file://training-corpus" --review approved --usage evaluation_only'
            )
            source_id = self._extract_source_id(created.user_message)
            dataset_id = self._create_dataset(service)

            dataset = service.link_source_policies_to_dataset(dataset_id=dataset_id, source_policy_ids=(source_id,))
            experiment_created = service.execute_local_chat_input(
                text=f'/modelexperimentcreate --title "lineage test" --task command_grammar_correction --dataset {dataset_id}'
            )
            experiment_id = self._extract_experiment_id(experiment_created.user_message)
            experiment = service.get_model_experiment(experiment_id)
            policy = service.get_source_policy(source_id)

            self.assertEqual(dataset.source_policy_ids, (source_id,))
            self.assertIsNotNone(experiment)
            self.assertEqual(experiment.source_policy_ids, (source_id,))
            self.assertIsNotNone(policy)
            self.assertIn(dataset_id, policy.linked_dataset_ids)
            self.assertIn(experiment_id, policy.linked_experiment_ids)
            self.assertIn(f'Source policies: {source_id}', experiment_created.user_message)
