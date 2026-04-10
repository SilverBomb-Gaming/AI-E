from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

from app.cli.chat_cli import AiEChatCli
from app.controller.app_service import ControllerService
from app.controller.execution_runner import ExecutionRunner
from app.controller.last_run_models import LastRunRecord
from app.controller.profile_store import ControllerConfigStore
from app.platform.secrets import InMemorySecretStore

from tests.test_execution_capability import _FakeCommandRunner
from tests.test_telegram_commands import VALID_TOKEN, _FakeOllamaAdapter, _FakeOpenAIAdapter, _FakeRuntimeManager, _FakeTelegramService, _report


class _PromptDriver:
    def __init__(self, *answers: str) -> None:
        self._answers = list(answers)
        self.prompts: list[str] = []

    def __call__(self, prompt: str) -> str:
        self.prompts.append(prompt)
        if self._answers:
            return self._answers.pop(0)
        raise AssertionError(f"Unexpected prompt: {prompt}")


class LocalCliChatTests(unittest.TestCase):
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

    def test_cli_debug_shows_shared_status_routing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service, _, _ = self._make_service(tmp_dir=tmp)
            prompts = _PromptDriver()
            output: list[str] = []
            cli = AiEChatCli(service=service, input_func=prompts, output_func=output.append, debug=True)

            keep_running = cli.handle_line("what is the current status?")

            self.assertTrue(keep_running)
            joined = "\n".join(output)
            self.assertIn("[INTENT: STATUS_OR_CONTEXT]", joined)
            self.assertIn("[ROUTE: /status]", joined)
            self.assertIn("Readiness:", joined)

    def test_cli_execution_requests_confirmation_before_running(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir(parents=True, exist_ok=True)
            (root / "src").mkdir(parents=True, exist_ok=True)
            (root / "src" / "main.py").write_text("print('hello')\n", encoding="utf-8")
            runner = _FakeCommandRunner(
                subprocess.CompletedProcess(["python", "src/main.py", "."], 0, "Scanning: .\n", "")
            )
            service, config_store, fake_runner = self._make_service(tmp_dir=tmp, command_runner=runner)
            self._configure_repo_root(service=service, config_store=config_store, root=root)
            service.set_latest_run_for_chat(
                chat_id="local-cli",
                record=LastRunRecord(
                    command_label="main",
                    target_root=".",
                    entrypoint_path="src/main.py",
                    argv=["python", "src/main.py", "."],
                    exit_code=0,
                    stdout_preview="Scanning: .",
                    stderr_preview="",
                    summary="Completed successfully.",
                    created_at_utc="2026-04-10T10:00:00Z",
                    is_patch_relevant=True,
                ),
            )
            prompts = _PromptDriver("n")
            output: list[str] = []
            cli = AiEChatCli(service=service, input_func=prompts, output_func=output.append)

            cli.handle_line("run it again")

            joined = "\n".join(output)
            self.assertIn("[RUN REQUEST]", joined)
            self.assertIn("[CONFIRMATION REQUIRED]", joined)
            self.assertIn("Action requires confirmation.", joined)
            self.assertIn("Confirmation", joined)
            self.assertEqual(len(fake_runner.calls), 0)
            self.assertEqual(prompts.prompts, ["Confirm execution? (y/n): "])

    def test_cli_fallback_does_not_crash_on_ambiguous_input(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service, _, _ = self._make_service(tmp_dir=tmp)
            prompts = _PromptDriver()
            output: list[str] = []
            cli = AiEChatCli(service=service, input_func=prompts, output_func=output.append)

            keep_running = cli.handle_line("maybe")

            self.assertTrue(keep_running)
            joined = "\n".join(output)
            self.assertIn("AI-E:", joined)
            self.assertIn("Do you want to start a new idea", joined)

    def test_cli_session_context_supports_run_it_again(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            generated_root = root / "generated" / "GP-7A31C2" / "src"
            generated_root.mkdir(parents=True, exist_ok=True)
            (generated_root / "main.py").write_text("print('generated')\n", encoding="utf-8")
            service, config_store, _ = self._make_service(tmp_dir=tmp)
            self._configure_repo_root(service=service, config_store=config_store, root=root)
            service.set_latest_run_for_chat(
                chat_id="dev-shell",
                record=LastRunRecord(
                    command_label="main",
                    target_root="generated/GP-7A31C2",
                    entrypoint_path="src/main.py",
                    argv=["python", "src/main.py", "generated/GP-7A31C2"],
                    exit_code=0,
                    stdout_preview="Completed last run.",
                    stderr_preview="",
                    summary="Completed last run.",
                    created_at_utc="2026-04-10T10:00:00Z",
                    is_patch_relevant=True,
                ),
            )
            prompts = _PromptDriver("n")
            output: list[str] = []
            cli = AiEChatCli(service=service, input_func=prompts, output_func=output.append, chat_id="dev-shell")

            cli.handle_line("run it again")

            joined = "\n".join(output)
            self.assertIn("Preview: run main generated/GP-7A31C2", joined)
            self.assertIn("Confirmation", joined)