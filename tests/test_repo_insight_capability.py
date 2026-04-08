from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.controller.app_service import ControllerService
from app.controller.capability_registry import get_capability_manifest
from app.controller.repo_inspector import RepoInspectionSnapshot, RepoInspectorError
from app.controller.scope_models import ExecutionScope
from app.controller.telegram_service import TelegramInboundMessage
from app.platform.secrets import InMemorySecretStore
from app.controller.profile_store import ControllerConfigStore

from tests.test_telegram_commands import (
    VALID_TOKEN,
    _FakeOllamaAdapter,
    _FakeOpenAIAdapter,
    _FakeRuntimeManager,
    _FakeTelegramService,
    _report,
    _wait_until,
)


class _FakeRepoInspector:
    def __init__(
        self,
        *,
        inspection: RepoInspectionSnapshot | None = None,
        error: RepoInspectorError | None = None,
    ) -> None:
        self.inspection = inspection or RepoInspectionSnapshot(
            repo_root=str(Path(__file__).resolve().parents[1]),
            repo_name="AI-E",
            branch="codex/home-screen-v1",
            is_dirty=True,
            changed_count=3,
            recent_commits=(
                "a1b2c3d Add capability layer",
                "d4e5f6g Improve diagnostics",
                "h7i8j9k Initial setup",
            ),
            inspected_at="2026-04-07T12:00:00-04:00",
        )
        self.error = error
        self.inspect_calls = 0
        self.last_repo_root = ""

    def inspect(self, repo_root: str, *, commit_limit: int = 5) -> RepoInspectionSnapshot:
        self.inspect_calls += 1
        self.last_repo_root = repo_root
        if self.error is not None:
            raise self.error
        return self.inspection


class RepoInsightCapabilityTests(unittest.TestCase):
    def _make_service(
        self,
        *,
        tmp_dir: str,
        runtime_state: str = "running",
        telegram_service: _FakeTelegramService | None = None,
    ) -> tuple[ControllerService, ControllerConfigStore, InMemorySecretStore, _FakeTelegramService]:
        config_store = ControllerConfigStore(config_path=Path(tmp_dir) / "controller_config.json")
        secret_store = InMemorySecretStore()
        tg = telegram_service or _FakeTelegramService()
        service = ControllerService(
            runtime_manager=_FakeRuntimeManager(runtime_state=runtime_state),
            config_store=config_store,
            secret_store=secret_store,
            provider_adapters={"ollama": _FakeOllamaAdapter(), "openai": _FakeOpenAIAdapter()},
            telegram_service=tg,
        )
        self.addCleanup(service.shutdown)
        service.validate_provider(provider="ollama")
        service.save_telegram_settings(telegram_token=VALID_TOKEN)
        service.validate_telegram()
        service.test_telegram_connection()
        service._latest_health_report = _report("health", "ok", "info", "Healthy")
        service._latest_security_report = _report("security", "ok", "info", "Safe")
        return service, config_store, secret_store, tg

    def _run_single_update(self, service: ControllerService, telegram_service: _FakeTelegramService) -> tuple[object, str]:
        service.start_telegram_loop()
        self.assertTrue(_wait_until(lambda: len(telegram_service.sent_messages) == 1))
        snapshot = service.stop_telegram_loop()
        return snapshot, telegram_service.sent_messages[0][1]

    def test_repo_manifest_is_read_only_local_and_repository_scoped(self) -> None:
        manifest = get_capability_manifest("repo.status.read")
        self.assertEqual(manifest.access_kind, "read_only")
        self.assertEqual(manifest.locality, "local_only")
        self.assertEqual(manifest.data_scope, "repository")
        self.assertEqual(manifest.scope_type, "repository")
        self.assertTrue(manifest.scope_uses_configured_root)

    def test_repo_command_returns_compact_scoped_summary_and_audit(self) -> None:
        update = TelegramInboundMessage(update_id=401, chat_id="chat-1", text="/repo", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, config_store, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service._repo_inspector = _FakeRepoInspector()
            config = config_store.load()
            config.repo_root = str(Path(__file__).resolve().parents[1])
            config_store.save(config)
            service._config = config_store.load()
            snapshot, reply = self._run_single_update(service, telegram_service)
            latest = service._audit_store.latest()

            self.assertIn("Repo: AI-E", reply)
            self.assertIn("Branch: codex/home-screen-v1", reply)
            self.assertIn("Status: Dirty (3 changes)", reply)
            self.assertIn("Recent commits:", reply)
            self.assertIn("- a1b2c3d Add capability layer", reply)
            self.assertLessEqual(len(reply), 320)
            self.assertEqual(service._last_execution_result.capability_id, "repo.status.read")
            self.assertEqual(service._last_execution_result.outcome, "success")
            self.assertEqual(service._last_execution_result.scope_summary, "repository/read repo=AI-E")
            self.assertEqual(snapshot.last_repo_branch, "codex/home-screen-v1")
            self.assertEqual(snapshot.last_repo_status, "AI-E: Dirty (3 changes)")
            self.assertEqual(snapshot.last_repo_checked_at, service._last_execution_result.finished_at)
            self.assertIsNotNone(latest)
            self.assertEqual(latest.capability_id, "repo.status.read")
            self.assertEqual(latest.outcome, "success")
            self.assertEqual(latest.scope_summary, "repository/read repo=AI-E")
            self.assertEqual(latest.action_summary, "AI-E | codex/home-screen-v1 | Dirty (3 changes) | created C1")
            self.assertNotIn("trainer.py", latest.action_summary)

    def test_repo_command_rejects_invalid_subcommand_cleanly(self) -> None:
        update = TelegramInboundMessage(update_id=402, chat_id="chat-1", text="/repo branches", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, _, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            service._repo_inspector = _FakeRepoInspector()
            _, reply = self._run_single_update(service, telegram_service)
            self.assertEqual(reply, "Couldn't parse that repo command.\nNext: Use /repo or /repo status.")
            self.assertEqual(service._last_execution_result.outcome, "invalid_request")
            self.assertEqual(service._last_execution_result.outcome_reason_code, "invalid_repo_command")

    def test_repo_command_reports_missing_repo_root_cleanly(self) -> None:
        update = TelegramInboundMessage(update_id=403, chat_id="chat-1", text="/repo", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, config_store, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            config = config_store.load()
            config.repo_root = ""
            config_store.save(config)
            service._config = config_store.load()
            _, reply = self._run_single_update(service, telegram_service)
            self.assertEqual(service._last_execution_result.outcome, "unavailable")
            self.assertEqual(service._last_execution_result.outcome_reason_code, "repo_root_invalid")
            self.assertEqual(
                reply,
                "Can't run /repo right now.\nReason: Repository root is not configured.\nNext: Check the configured repository path and current readiness in the operator console.",
            )

    def test_repo_scope_violation_blocks_before_inspector_runs(self) -> None:
        update = TelegramInboundMessage(update_id=404, chat_id="chat-1", text="/repo", sender_label="@tester")
        with tempfile.TemporaryDirectory() as tmp:
            telegram_service = _FakeTelegramService(update_batches=[(update,)])
            service, config_store, _, _ = self._make_service(tmp_dir=tmp, telegram_service=telegram_service)
            fake_repo = _FakeRepoInspector()
            service._repo_inspector = fake_repo
            config = config_store.load()
            config.repo_root = str(Path(__file__).resolve().parents[1])
            config_store.save(config)
            service._config = config_store.load()
            original_builder = service._build_execution_scope

            def _out_of_scope_builder(capability_id: str, *, snapshot):
                if capability_id == "repo.status.read":
                    repo_root = str(Path(__file__).resolve().parents[1])
                    return ExecutionScope(
                        scope_type="repository",
                        access_mode="read",
                        repo_root=repo_root,
                        target_path=str(Path(repo_root).parent),
                    )
                return original_builder(capability_id, snapshot=snapshot)

            service._build_execution_scope = _out_of_scope_builder  # type: ignore[method-assign]
            _, reply = self._run_single_update(service, telegram_service)
            self.assertEqual(fake_repo.inspect_calls, 0)
            self.assertEqual(service._last_execution_result.outcome, "out_of_scope")
            self.assertEqual(service._last_execution_result.outcome_reason_code, "target_path_not_allowed")
            self.assertEqual(
                reply,
                "Can't run /repo right now.\nReason: This capability is not allowed to access that repository target.\nNext: Use an allowed scope for this capability or adjust the operator-console configuration.",
            )


if __name__ == "__main__":
    unittest.main()

