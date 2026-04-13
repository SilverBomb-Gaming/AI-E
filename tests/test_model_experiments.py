from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from app.controller.app_service import ControllerService
from app.controller.chat_command_parser import parse_chat_command
from app.controller.execution_runner import ExecutionRunner
from app.controller.model_dataset_builders import CommandGrammarCorrectionBuilder
from app.controller.profile_store import ControllerConfigStore
from app.platform.secrets import InMemorySecretStore

from tests.test_execution_capability import _FakeCommandRunner
from tests.test_telegram_commands import VALID_TOKEN, _FakeOllamaAdapter, _FakeOpenAIAdapter, _FakeRuntimeManager, _FakeTelegramService, _report


class ModelExperimentTests(unittest.TestCase):
    def _make_service(self, *, tmp_dir: str) -> tuple[ControllerService, ControllerConfigStore]:
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
        return service, config_store

    def _create_dataset(self, service: ControllerService, *, commands: tuple[str, ...] = ("/status", "/help", "/models", "/capabilities")) -> str:
        for command in commands:
            result = service.execute_local_chat_input(text=command)
            self.assertEqual(result.outcome, "success")
            records = service.list_data_records(limit=20)
            record_id = next((record.record_id for record in records if record.input_text == command), records[0].record_id)
            labeled = service.execute_local_chat_input(text=f"/datalabel {record_id} training")
            self.assertEqual(labeled.outcome, "success")
        created = service.execute_local_chat_input(text='/datasetcreate --title "grammar traces" --type command --label training')
        self.assertEqual(created.outcome, "success")
        for line in created.user_message.splitlines():
            if line.startswith("Dataset DS-"):
                return line.split()[1].strip()
        raise AssertionError(f"Dataset id not found in reply: {created.user_message}")

    @staticmethod
    def _extract_experiment_id(reply: str) -> str:
        for line in reply.splitlines():
            if line.startswith("Model experiment MX-"):
                return line.split()[2].strip()
            if line.startswith("Experiment ID: MX-"):
                return line.split(":", 1)[1].strip()
        raise AssertionError(f"Experiment id not found in reply: {reply}")

    def test_parser_recognizes_model_experiment_command_family(self) -> None:
        create = parse_chat_command(
            text='/modelexperimentcreate --title "grammar-corrector-v1" --task command_grammar_correction --dataset DS-12345678',
            has_text=True,
        )
        results = parse_chat_command(text="/modelexperimentresults MX-12345678", has_text=True)
        start = parse_chat_command(text="/modelexperimentstart MX-12345678", has_text=True)

        self.assertEqual(create.command_label, "/modelexperimentcreate")
        self.assertEqual(results.command_label, "/modelexperimentresults")
        self.assertEqual(start.command_label, "/modelexperimentstart")

    def test_model_experiment_creation_persists(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service, _ = self._make_service(tmp_dir=tmp)
            dataset_id = self._create_dataset(service)

            created = service.execute_local_chat_input(
                text=f'/modelexperimentcreate --title "grammar-corrector-v1" --task command_grammar_correction --dataset {dataset_id} --baseline rules --mode advisory'
            )

            self.assertEqual(created.outcome, "success")
            experiment_id = self._extract_experiment_id(created.user_message)
            experiment = service.get_model_experiment(experiment_id)
            self.assertIsNotNone(experiment)
            self.assertEqual(experiment.dataset_id, dataset_id)
            self.assertEqual(experiment.task_type, "command_grammar_correction")
            self.assertEqual(experiment.status, "draft")
            self.assertEqual(experiment.mode, "advisory")

    def test_dataset_builder_transforms_export_into_training_examples(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service, _ = self._make_service(tmp_dir=tmp)
            dataset_id = self._create_dataset(service)
            exported = service.export_dataset(dataset_id=dataset_id, export_format="jsonl")
            rows = tuple(
                json.loads(line)
                for line in Path(exported.file_path).read_text(encoding="utf-8").splitlines()
                if line.strip()
            )

            builder = CommandGrammarCorrectionBuilder()
            examples = builder.build_examples(export_rows=rows)

            self.assertTrue(examples)
            self.assertTrue(all(item.malformed_text.startswith("/") for item in examples))
            self.assertTrue(all(item.target_text.startswith("/") for item in examples))
            self.assertTrue(all(parse_chat_command(text=item.malformed_text, has_text=True).command_label == "parse_failure" for item in examples))

    def test_experiment_run_produces_metrics_and_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service, _ = self._make_service(tmp_dir=tmp)
            dataset_id = self._create_dataset(service)
            created = service.execute_local_chat_input(
                text=f'/modelexperimentcreate --title "grammar-corrector-v1" --task command_grammar_correction --dataset {dataset_id}'
            )
            experiment_id = self._extract_experiment_id(created.user_message)

            started = service.execute_local_chat_input(text=f"/modelexperimentstart {experiment_id}")

            self.assertEqual(started.outcome, "success")
            experiment = service.get_model_experiment(experiment_id)
            self.assertEqual(experiment.status, "evaluated")
            self.assertIn("baseline_exact_match", experiment.metrics)
            self.assertIn("adapted_exact_match", experiment.metrics)
            self.assertIn("exact_match_delta", experiment.metrics)
            self.assertTrue(Path(experiment.artifact_paths["model_artifact"]).exists())
            self.assertTrue(Path(experiment.artifact_paths["metrics_summary"]).exists())
            self.assertTrue(Path(experiment.artifact_paths["evaluation_outputs"]).exists())

    def test_failed_training_is_recorded_safely(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service, _ = self._make_service(tmp_dir=tmp)
            service.execute_local_chat_input(text="/status")
            created = service.execute_local_chat_input(
                text='/datasetcreate --title "empty grammar" --type command --label training --allow-empty true'
            )
            self.assertEqual(created.outcome, "success")
            dataset_id = next(line.split()[1].strip() for line in created.user_message.splitlines() if line.startswith("Dataset DS-"))
            experiment_created = service.execute_local_chat_input(
                text=f'/modelexperimentcreate --title "grammar-fail" --task command_grammar_correction --dataset {dataset_id}'
            )
            experiment_id = self._extract_experiment_id(experiment_created.user_message)

            started = service.execute_local_chat_input(text=f"/modelexperimentstart {experiment_id}")

            self.assertEqual(started.outcome, "success")
            experiment = service.get_model_experiment(experiment_id)
            self.assertEqual(experiment.status, "failed")
            self.assertTrue(experiment.last_error)
            self.assertNotEqual(experiment.integration_status, "approved_for_advisory_use")

    def test_advisory_suggestion_is_optional_and_fallback_safe(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service, _ = self._make_service(tmp_dir=tmp)
            baseline = service.execute_local_chat_input(text="/statsu")

            self.assertEqual(baseline.outcome, "invalid_request")
            self.assertEqual(baseline.user_message, "Couldn't parse that command.\nNext: Use /help to see supported commands.")

            dataset_id = self._create_dataset(service, commands=("/status", "/help", "/models", "/capabilities"))
            created = service.execute_local_chat_input(
                text=f'/modelexperimentcreate --title "grammar-corrector-v1" --task command_grammar_correction --dataset {dataset_id}'
            )
            experiment_id = self._extract_experiment_id(created.user_message)
            started = service.execute_local_chat_input(text=f"/modelexperimentstart {experiment_id}")
            self.assertEqual(started.outcome, "success")
            approved = service.execute_local_chat_input(text=f"/modelexperimentapprove {experiment_id}")
            self.assertEqual(approved.outcome, "success")

            advised = service.execute_local_chat_input(text="/statsu")
            status = service.execute_local_chat_input(text="/status")

            self.assertEqual(advised.outcome, "invalid_request")
            self.assertIn("Couldn't parse that command.", advised.user_message)
            self.assertIn("Advisory suggestion: /status", advised.user_message)
            self.assertEqual(status.outcome, "success")

    def test_model_experiment_status_commands_work(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service, _ = self._make_service(tmp_dir=tmp)
            dataset_id = self._create_dataset(service)
            created = service.execute_local_chat_input(
                text=f'/modelexperimentcreate --title "grammar-corrector-v1" --task command_grammar_correction --dataset {dataset_id}'
            )
            experiment_id = self._extract_experiment_id(created.user_message)
            service.execute_local_chat_input(text=f"/modelexperimentstart {experiment_id}")

            listed = service.execute_local_chat_input(text="/modelexperiments")
            detailed = service.execute_local_chat_input(text=f"/modelexperiment {experiment_id}")
            results = service.execute_local_chat_input(text=f"/modelexperimentresults {experiment_id}")

            self.assertEqual(listed.outcome, "success")
            self.assertIn(experiment_id, listed.user_message)
            self.assertEqual(detailed.outcome, "success")
            self.assertIn(f"Model experiment {experiment_id}", detailed.user_message)
            self.assertEqual(results.outcome, "success")
            self.assertIn("[MODEL EXPERIMENT]", results.user_message)
            self.assertIn("adapted_exact_match", results.user_message)