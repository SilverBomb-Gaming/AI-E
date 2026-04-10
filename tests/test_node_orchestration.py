from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

from app.controller.app_service import ControllerService
from app.controller.execution_runner import ExecutionRunner
from app.controller.node_config import NodeConfigStore
from app.controller.node_registry import NodeRegistry
from app.controller.profile_store import ControllerConfigStore
from app.node import bootstrap as node_bootstrap
from app.node.worker import NodeWorker
from app.platform.secrets import InMemorySecretStore

from tests.test_telegram_commands import (
    VALID_TOKEN,
    _FakeOllamaAdapter,
    _FakeOpenAIAdapter,
    _FakeRuntimeManager,
    _FakeTelegramService,
)


class _FakeCommandRunner:
    def __init__(self, response: subprocess.CompletedProcess[str] | None = None) -> None:
        self.response = response or subprocess.CompletedProcess(["python", "-m", "unittest"], 0, "Ran 1 test in 0.01s\n\nOK\n", "")
        self.calls: list[tuple[tuple[str, ...], str, float]] = []

    def __call__(self, argv: tuple[str, ...], working_directory: str, timeout_seconds: float) -> subprocess.CompletedProcess[str]:
        self.calls.append((tuple(argv), working_directory, timeout_seconds))
        return self.response


class NodeOrchestrationTests(unittest.TestCase):
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

    def _make_service(self, *, config_dir: Path) -> ControllerService:
        config_store = ControllerConfigStore(config_path=config_dir / "controller_config.json")
        secret_store = InMemorySecretStore()
        service = ControllerService(
            runtime_manager=_FakeRuntimeManager(runtime_state="running"),
            config_store=config_store,
            secret_store=secret_store,
            provider_adapters={"ollama": _FakeOllamaAdapter(), "openai": _FakeOpenAIAdapter()},
            telegram_service=_FakeTelegramService(),
        )
        self.addCleanup(service.shutdown)
        service.validate_provider(provider="ollama")
        service.save_telegram_settings(telegram_token=VALID_TOKEN)
        service.validate_telegram()
        service.test_telegram_connection()
        service.activate_runtime_control_plane()
        return service

    def test_node_bootstrap_creates_valid_config(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            config_dir = root / "validator-node"
            registry_root = root / "registry"
            repo_root = root / "repo"
            repo_root.mkdir(parents=True, exist_ok=True)

            self._bootstrap_node(
                config_dir=config_dir,
                registry_root=registry_root,
                role="validator",
                display_name="Validator Node 01",
                repo_root=repo_root,
                capabilities=("/run", "/test"),
            )

            controller_config = ControllerConfigStore(config_path=config_dir / "controller_config.json").load()
            node_config = NodeConfigStore(config_path=config_dir / "node_config.json").load()
            self.assertEqual(controller_config.repo_root, str(repo_root.resolve()))
            self.assertEqual(controller_config.file_allowed_roots, (str(repo_root.resolve()),))
            self.assertEqual(node_config.role, "validator")
            self.assertEqual(node_config.display_name, "Validator Node 01")
            self.assertTrue(node_config.node_id.startswith("validator-"))
            self.assertEqual(node_config.registry_root, str(registry_root.resolve()))
            self.assertEqual(node_config.declared_capabilities, ("/run", "/test"))

    def test_node_registration_records_metadata_correctly(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            registry_root = root / "registry"
            controller_dir = root / "controller"
            validator_dir = root / "validator"
            repo_root = Path("e:/AI projects 2025/AI-E")

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
                capabilities=("/test",),
            )

            worker = NodeWorker(
                controller_config_store=ControllerConfigStore(config_path=validator_dir / "controller_config.json"),
                node_config_store=NodeConfigStore(config_path=validator_dir / "node_config.json"),
                execution_runner=ExecutionRunner(command_runner=_FakeCommandRunner()),
            )
            worker.run_once()

            service = self._make_service(config_dir=controller_dir)
            nodes = service.list_registered_nodes()
            self.assertEqual(len(nodes), 2)
            validator = service.get_registered_node("validator-node-01")
            self.assertIsNotNone(validator)
            assert validator is not None
            self.assertEqual(validator.role, "validator")
            self.assertEqual(validator.transport, "shared_directory")
            self.assertEqual(validator.capability_labels, ("/test",))
            self.assertEqual(validator.status, "online")

    def test_stale_and_disabled_nodes_are_surfaced(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            registry_root = root / "registry"
            controller_dir = root / "controller"
            repo_root = Path("e:/AI projects 2025/AI-E")
            self._bootstrap_node(
                config_dir=controller_dir,
                registry_root=registry_root,
                role="controller",
                display_name="Primary Controller",
                repo_root=repo_root,
                capabilities=("/run", "/test"),
            )
            service = self._make_service(config_dir=controller_dir)
            stale_node = NodeRegistry.build_configured_local_node(
                controller_config=ControllerConfigStore(config_path=controller_dir / "controller_config.json").load(),
                node_config=NodeConfigStore(config_path=controller_dir / "node_config.json").load(),
                now_iso="2000-01-01T00:00:00+00:00",
                fallback_node_id="validator-stale",
                transport_mode="shared_directory",
            ).with_status(
                "online",
                node_id="validator-stale",
                display_name="Stale Validator",
                role="validator",
                enabled=True,
                is_default=False,
            )
            disabled_node = stale_node.with_status("disabled", node_id="validator-disabled", display_name="Disabled Validator", enabled=False)
            service._node_registry.register_node(stale_node)
            service._node_registry.register_node(disabled_node)

            stale = service.get_registered_node("validator-stale")
            disabled = service.get_registered_node("validator-disabled")
            self.assertIsNotNone(stale)
            self.assertIsNotNone(disabled)
            assert stale is not None and disabled is not None
            self.assertEqual(stale.status, "stale")
            self.assertEqual(disabled.status, "disabled")

    def test_bounded_dispatch_selects_validator_and_records_status(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            registry_root = root / "registry"
            controller_dir = root / "controller"
            validator_dir = root / "validator"
            repo_root = Path("e:/AI projects 2025/AI-E")

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
                capabilities=("/run", "/test"),
            )

            worker_runner = _FakeCommandRunner(
                subprocess.CompletedProcess(["python", "-m", "unittest"], 0, "Ran 1 test in 0.01s\n\nOK\n", "")
            )
            worker = NodeWorker(
                controller_config_store=ControllerConfigStore(config_path=validator_dir / "controller_config.json"),
                node_config_store=NodeConfigStore(config_path=validator_dir / "node_config.json"),
                execution_runner=ExecutionRunner(command_runner=worker_runner),
            )
            worker.run_once()

            service = self._make_service(config_dir=controller_dir)
            dispatch = service.execute_local_chat_input(
                text='/dispatch validator "/test tests.test_cli_chat.LocalCliChatTests.test_cli_debug_shows_shared_status_routing"'
            )
            self.assertEqual(dispatch.outcome, "confirmation_required")
            self.assertIn("Target node: validator-node-01", dispatch.user_message)

            confirmation = service.latest_pending_confirmation_for_chat(chat_id="local-cli")
            self.assertIsNotNone(confirmation)
            assert confirmation is not None
            confirm = service.execute_local_chat_input(text=f"/confirm {confirmation.confirmation_id}")
            self.assertEqual(confirm.outcome, "success")
            self.assertIn("Dispatch job:", confirm.user_message)
            job_id = str(confirm.telemetry.get("dispatch_job_id") or "").strip()
            self.assertTrue(job_id)

            completed = worker.run_once()
            self.assertIsNotNone(completed)
            assert completed is not None
            self.assertEqual(completed.status, "completed")
            self.assertEqual(len(worker_runner.calls), 1)

            status = service.execute_local_chat_input(text=f"/dispatchstatus {job_id}")
            self.assertEqual(status.outcome, "success")
            self.assertIn("Status: completed", status.user_message)
            self.assertIn("Role: validator", status.user_message)

            audit = service.execute_local_chat_input(text="/audit")
            self.assertIn(job_id, audit.user_message)

    def test_dispatch_refuses_when_role_has_no_supported_capability(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            registry_root = root / "registry"
            controller_dir = root / "controller"
            validator_dir = root / "validator"
            repo_root = Path("e:/AI projects 2025/AI-E")

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
            worker = NodeWorker(
                controller_config_store=ControllerConfigStore(config_path=validator_dir / "controller_config.json"),
                node_config_store=NodeConfigStore(config_path=validator_dir / "node_config.json"),
                execution_runner=ExecutionRunner(command_runner=_FakeCommandRunner()),
            )
            worker.run_once()

            service = self._make_service(config_dir=controller_dir)
            result = service.execute_local_chat_input(
                text='/dispatch validator "/test tests.test_cli_chat.LocalCliChatTests.test_cli_debug_shows_shared_status_routing"'
            )
            self.assertEqual(result.outcome, "blocked")
            self.assertIn("No enabled validator node can accept /test", result.user_message)

    def test_local_run_workflow_still_works_without_configured_nodes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            config_dir = Path(tmp)
            service = self._make_service(config_dir=config_dir)
            nodes = service.execute_local_chat_input(text="/nodes")
            self.assertIn("[NODES]", nodes.user_message)
            self.assertIn("Role: controller", nodes.user_message)
            run_request = service.execute_local_chat_input(text="/run python diagnostics_smoke.py")
            self.assertEqual(run_request.outcome, "confirmation_required")
            self.assertIn("Node:", run_request.user_message)


if __name__ == "__main__":
    unittest.main()