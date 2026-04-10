from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

from app.controller.app_service import ControllerService
from app.controller.execution_runner import ExecutionRunner
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


class _RecordingOllamaAdapter(_FakeOllamaAdapter):
    def __init__(self) -> None:
        super().__init__()
        self.ask_prompts: list[str] = []

    def ask(self, **kwargs: object):
        self.ask_prompts.append(str(kwargs.get("prompt", "")))
        return super().ask(**kwargs)


class _LoopCommandRunner:
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
        return subprocess.CompletedProcess(list(argv), 0, "Scanning: .\n", "")


class BoundedCliEditLoopTests(unittest.TestCase):
    def _make_service(
        self,
        *,
        tmp_dir: str,
        telegram_service: _FakeTelegramService | None = None,
        command_runner: _LoopCommandRunner | None = None,
        ollama_adapter: _RecordingOllamaAdapter | None = None,
    ) -> tuple[
        ControllerService,
        ControllerConfigStore,
        InMemorySecretStore,
        _FakeTelegramService,
        _LoopCommandRunner,
        _RecordingOllamaAdapter,
    ]:
        config_store = ControllerConfigStore(config_path=Path(tmp_dir) / "controller_config.json")
        secret_store = InMemorySecretStore()
        tg = telegram_service or _FakeTelegramService()
        runner = command_runner or _LoopCommandRunner()
        offline = ollama_adapter or _RecordingOllamaAdapter()
        service = ControllerService(
            runtime_manager=_FakeRuntimeManager(runtime_state="running"),
            config_store=config_store,
            secret_store=secret_store,
            provider_adapters={"ollama": offline, "openai": _FakeOpenAIAdapter()},
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
        return service, config_store, secret_store, tg, runner, offline

    def _run_single_update(self, service: ControllerService, telegram_service: _FakeTelegramService) -> str:
        service._telegram_service = telegram_service
        service.start_telegram_loop()
        self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 1))
        service.stop_telegram_loop()
        return telegram_service.sent_messages[0][1]

    def _configure_scopes(self, *, service: ControllerService, config_store: ControllerConfigStore, root: Path) -> None:
        config = config_store.load()
        resolved_root = str(root.resolve())
        config.repo_root = resolved_root
        config.file_allowed_roots = (resolved_root,)
        config_store.save(config)
        service._config = config_store.load()

    @staticmethod
    def _extract_confirmation_id(reply: str) -> str:
        marker = "ID: "
        start = reply.index(marker) + len(marker)
        return reply[start:].splitlines()[0].split()[0].strip()

    def test_file_context_edit_loop_patches_and_runs_generated_cli(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            src = root / "src"
            src.mkdir(parents=True, exist_ok=True)
            target = src / "main.py"
            target.write_text(
                "from pathlib import Path\n"
                "import sys\n\n\n"
                "def main() -> int:\n"
                "    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(\".\")\n"
                "    print(f\"Scanning: {target}\")\n"
                "    return 0\n\n\n"
                "if __name__ == \"__main__\":\n"
                "    raise SystemExit(main())\n",
                encoding="utf-8",
            )
            runner = _LoopCommandRunner(
                subprocess.CompletedProcess(
                    ["python", "src/main.py", "."],
                    0,
                    "Scanned 1 files in .\nWrote CSV: summary.csv\n",
                    "",
                )
            )
            service, config_store, _, _, fake_runner, offline = self._make_service(tmp_dir=tmp, command_runner=runner)
            self._configure_scopes(service=service, config_store=config_store, root=root)

            file_reply = self._run_single_update(
                service,
                _FakeTelegramService(update_batches=[(
                    TelegramInboundMessage(update_id=901, chat_id="chat-1", text="/file src/main.py", sender_label="@tester"),
                )]),
            )
            self.assertIn("Context: C1 ready for /asklast or /askctx C1 <prompt>.", file_reply)

            ask_reply = self._run_single_update(
                service,
                _FakeTelegramService(update_batches=[(
                    TelegramInboundMessage(
                        update_id=902,
                        chat_id="chat-1",
                        text="/askctx C1 add CSV writing support so the CLI writes file sizes to summary.csv",
                        sender_label="@tester",
                    ),
                )]),
            )
            self.assertIn("Planned update for src/main.py", ask_reply)
            self.assertIn("- write rows to summary.csv", ask_reply)
            self.assertIn("- use /patchlast src/main.py to apply the update", ask_reply)
            self.assertEqual(offline.ask_calls, 0)
            self.assertNotIn("summary.csv", target.read_text(encoding="utf-8"))
            self.assertEqual(len(fake_runner.calls), 0)

            patch_prompt = self._run_single_update(
                service,
                _FakeTelegramService(update_batches=[(
                    TelegramInboundMessage(update_id=903, chat_id="chat-1", text="/patchlast src/main.py", sender_label="@tester"),
                )]),
            )
            patch_confirmation_id = self._extract_confirmation_id(patch_prompt)
            self.assertIn("Action requires confirmation.", patch_prompt)
            self.assertIn("Preview: 1 replacement", patch_prompt)

            patch_reply = self._run_single_update(
                service,
                _FakeTelegramService(update_batches=[(
                    TelegramInboundMessage(update_id=904, chat_id="chat-1", text=f"/confirm {patch_confirmation_id}", sender_label="@tester"),
                )]),
            )
            self.assertIn("Operation: patch", patch_reply)
            self.assertIn("Wrote CSV", target.read_text(encoding="utf-8"))

            patch_lastaction = self._run_single_update(
                service,
                _FakeTelegramService(update_batches=[(
                    TelegramInboundMessage(update_id=905, chat_id="chat-1", text="/lastaction", sender_label="@tester"),
                )]),
            )
            self.assertIn("Action: patch completed", patch_lastaction)
            self.assertIn("File: src/main.py", patch_lastaction)

            run_prompt = self._run_single_update(
                service,
                _FakeTelegramService(update_batches=[(
                    TelegramInboundMessage(update_id=906, chat_id="chat-1", text="/run main .", sender_label="@tester"),
                )]),
            )
            run_confirmation_id = self._extract_confirmation_id(run_prompt)
            self.assertIn("Action requires confirmation.", run_prompt)
            self.assertEqual(len(fake_runner.calls), 0)

            run_reply = self._run_single_update(
                service,
                _FakeTelegramService(update_batches=[(
                    TelegramInboundMessage(update_id=907, chat_id="chat-1", text=f"/confirm {run_confirmation_id}", sender_label="@tester"),
                )]),
            )
            self.assertIn("Command: main .", run_reply)
            self.assertIn("Context: C2 ready for /asklast or /askctx C2 <prompt>.", run_reply)
            self.assertEqual(len(fake_runner.calls), 1)
            self.assertEqual(fake_runner.calls[0][0][1:], ("src/main.py", "."))

            run_lastaction = self._run_single_update(
                service,
                _FakeTelegramService(update_batches=[(
                    TelegramInboundMessage(update_id=908, chat_id="chat-1", text="/lastaction", sender_label="@tester"),
                )]),
            )
            self.assertIn("Action: run completed", run_lastaction)
            self.assertIn("Command: main .", run_lastaction)
            self.assertIn("Exit code: 0", run_lastaction)

    def test_asklast_after_run_prepares_csv_patch_without_autorun(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            src = root / "src"
            src.mkdir(parents=True, exist_ok=True)
            target = src / "main.py"
            target.write_text(
                "from pathlib import Path\n"
                "import sys\n\n\n"
                "def main() -> int:\n"
                "    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(\".\")\n"
                "    print(f\"Scanning: {target}\")\n"
                "    return 0\n\n\n"
                "if __name__ == \"__main__\":\n"
                "    raise SystemExit(main())\n",
                encoding="utf-8",
            )
            runner = _LoopCommandRunner(
                subprocess.CompletedProcess(
                    ["python", "src/main.py", "."],
                    0,
                    "Scanning: .\n",
                    "",
                )
            )
            service, config_store, _, _, fake_runner, offline = self._make_service(tmp_dir=tmp, command_runner=runner)
            self._configure_scopes(service=service, config_store=config_store, root=root)

            run_prompt = self._run_single_update(
                service,
                _FakeTelegramService(update_batches=[(
                    TelegramInboundMessage(update_id=909, chat_id="chat-1", text="/run main .", sender_label="@tester"),
                )]),
            )
            run_confirmation_id = self._extract_confirmation_id(run_prompt)
            self._run_single_update(
                service,
                _FakeTelegramService(update_batches=[(
                    TelegramInboundMessage(update_id=910, chat_id="chat-1", text=f"/confirm {run_confirmation_id}", sender_label="@tester"),
                )]),
            )
            self.assertEqual(len(fake_runner.calls), 1)

            asklast_reply = self._run_single_update(
                service,
                _FakeTelegramService(update_batches=[(
                    TelegramInboundMessage(
                        update_id=911,
                        chat_id="chat-1",
                        text="/asklast improve this so it writes CSV output",
                        sender_label="@tester",
                    ),
                )]),
            )
            self.assertIn("Planned update for src/main.py", asklast_reply)
            self.assertIn("- use /patchlast src/main.py to apply the update", asklast_reply)
            self.assertEqual(offline.ask_calls, 0)
            self.assertEqual(len(fake_runner.calls), 1)
            self.assertNotIn("summary.csv", target.read_text(encoding="utf-8"))

    def test_patchlast_without_prepared_draft_fails_clearly(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            src = root / "src"
            src.mkdir(parents=True, exist_ok=True)
            (src / "main.py").write_text("print('hello')\n", encoding="utf-8")
            service, config_store, _, _, _, _ = self._make_service(tmp_dir=tmp)
            self._configure_scopes(service=service, config_store=config_store, root=root)

            reply = self._run_single_update(
                service,
                _FakeTelegramService(update_batches=[(
                    TelegramInboundMessage(update_id=912, chat_id="chat-1", text="/patchlast src/main.py", sender_label="@tester"),
                )]),
            )
            self.assertIn("No recent patch-eligible edit suggestion is available.", reply)
            self.assertIn("Use /askctx <context_id> <change request> or /asklast <change request> first.", reply)

    def test_patchlast_rejects_stale_prepared_draft_after_generic_answer(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            src = root / "src"
            src.mkdir(parents=True, exist_ok=True)
            target = src / "main.py"
            target.write_text(
                "from pathlib import Path\n"
                "import sys\n\n\n"
                "def main() -> int:\n"
                "    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(\".\")\n"
                "    print(f\"Scanning: {target}\")\n"
                "    return 0\n\n\n"
                "if __name__ == \"__main__\":\n"
                "    raise SystemExit(main())\n",
                encoding="utf-8",
            )
            service, config_store, _, _, _, offline = self._make_service(tmp_dir=tmp)
            self._configure_scopes(service=service, config_store=config_store, root=root)

            self._run_single_update(
                service,
                _FakeTelegramService(update_batches=[(
                    TelegramInboundMessage(update_id=913, chat_id="chat-1", text="/file src/main.py", sender_label="@tester"),
                )]),
            )
            ask_reply = self._run_single_update(
                service,
                _FakeTelegramService(update_batches=[(
                    TelegramInboundMessage(
                        update_id=914,
                        chat_id="chat-1",
                        text="/askctx C1 add CSV writing support so the CLI writes file sizes to summary.csv",
                        sender_label="@tester",
                    ),
                )]),
            )
            self.assertIn("Planned update for src/main.py", ask_reply)
            self.assertEqual(offline.ask_calls, 0)

            generic_reply = self._run_single_update(
                service,
                _FakeTelegramService(update_batches=[(
                    TelegramInboundMessage(
                        update_id=915,
                        chat_id="chat-1",
                        text="/askctx C1 explain the current behavior without changing the file",
                        sender_label="@tester",
                    ),
                )]),
            )
            self.assertIn("Answer (Offline | Ollama", generic_reply)
            self.assertEqual(offline.ask_calls, 1)

            patch_reply = self._run_single_update(
                service,
                _FakeTelegramService(update_batches=[(
                    TelegramInboundMessage(update_id=916, chat_id="chat-1", text="/patchlast src/main.py", sender_label="@tester"),
                )]),
            )
            self.assertIn("No recent patch-eligible edit suggestion is available.", patch_reply)
            self.assertNotIn("summary.csv", target.read_text(encoding="utf-8"))

    def test_patchfile_without_prepared_draft_fails_clearly(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            src = root / "src"
            src.mkdir(parents=True, exist_ok=True)
            (src / "main.py").write_text("print('hello')\n", encoding="utf-8")
            service, config_store, _, _, _, _ = self._make_service(tmp_dir=tmp)
            self._configure_scopes(service=service, config_store=config_store, root=root)

            reply = self._run_single_update(
                service,
                _FakeTelegramService(update_batches=[(
                    TelegramInboundMessage(update_id=912, chat_id="chat-1", text="/patchfile src/main.py", sender_label="@tester"),
                )]),
            )
            self.assertIn("No prepared patch is available for src/main.py.", reply)
            self.assertIn("Use /askctx or /asklast first", reply)

    def test_patchfile_still_accepts_prepared_bounded_patch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            src = root / "src"
            src.mkdir(parents=True, exist_ok=True)
            target = src / "main.py"
            target.write_text(
                "from pathlib import Path\n"
                "import sys\n\n\n"
                "def main() -> int:\n"
                "    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(\".\")\n"
                "    print(f\"Scanning: {target}\")\n"
                "    return 0\n\n\n"
                "if __name__ == \"__main__\":\n"
                "    raise SystemExit(main())\n",
                encoding="utf-8",
            )
            service, config_store, _, _, _, _ = self._make_service(tmp_dir=tmp)
            self._configure_scopes(service=service, config_store=config_store, root=root)

            self._run_single_update(
                service,
                _FakeTelegramService(update_batches=[(
                    TelegramInboundMessage(update_id=917, chat_id="chat-1", text="/file src/main.py", sender_label="@tester"),
                )]),
            )
            self._run_single_update(
                service,
                _FakeTelegramService(update_batches=[(
                    TelegramInboundMessage(
                        update_id=918,
                        chat_id="chat-1",
                        text="/askctx C1 add CSV writing support so the CLI writes file sizes to summary.csv",
                        sender_label="@tester",
                    ),
                )]),
            )

            patch_prompt = self._run_single_update(
                service,
                _FakeTelegramService(update_batches=[(
                    TelegramInboundMessage(update_id=919, chat_id="chat-1", text="/patchfile src/main.py", sender_label="@tester"),
                )]),
            )
            self.assertIn("Action requires confirmation.", patch_prompt)
            self.assertIn("Preview: 1 replacement", patch_prompt)


if __name__ == "__main__":
    unittest.main()
