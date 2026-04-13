from __future__ import annotations

from datetime import datetime
import tempfile
from pathlib import Path

from app.controller.app_service import ControllerService
from app.controller.diagnostic_models import DiagnosticReport
from app.controller.profile_store import ControllerConfigStore
from app.controller.telegram_service import TelegramApiClient, TelegramChannelService, mask_telegram_token
from app.platform.secrets import InMemorySecretStore
from app.providers.base import ProviderStatus
from app.runtime.models import OllamaInstallation, OpenClawInstallation, RuntimeInspection, RuntimeStatus


class FakeRuntimeManager:
    def __init__(self) -> None:
        self._status = RuntimeStatus(
            runtime_state="stopped",
            status_message="Runtime stopped.",
            openclaw=OpenClawInstallation(installed=True, entrypoint_path="C:\\openclaw.mjs"),
            ollama=OllamaInstallation(installed=True, path="C:\\ollama.exe"),
            pid=None,
        )
        self._inspection = RuntimeInspection(
            configured_bind="loopback",
            configured_host="127.0.0.1",
            configured_port=18789,
            cli_reachable=True,
            process_exists=False,
            process_responsive=False,
            listener_addresses=(),
        )
        self._logs = (
            "[10:00:00] stdout: booting",
            "[10:00:01] stderr: safe warning",
        )
        self.restart_count = 0

    def configure(self, *, gateway_port: int | None = None, gateway_bind: str | None = None) -> None:
        if gateway_port is not None:
            self._inspection = RuntimeInspection(**{**self._inspection.__dict__, "configured_port": gateway_port})
        if gateway_bind is not None:
            host = "127.0.0.1" if gateway_bind == "loopback" else gateway_bind
            self._inspection = RuntimeInspection(**{**self._inspection.__dict__, "configured_bind": gateway_bind, "configured_host": host})

    def refresh_status(self) -> RuntimeStatus:
        return self._status

    def get_status(self) -> RuntimeStatus:
        return self._status

    def inspect_runtime(self) -> RuntimeInspection:
        return self._inspection

    def get_recent_logs(self, *, limit: int = 200) -> tuple[str, ...]:
        return self._logs[-limit:]

    def start_runtime(self) -> RuntimeStatus:
        self._status = RuntimeStatus(
            runtime_state="running",
            status_message="OpenClaw gateway running on port 18789.",
            openclaw=self._status.openclaw,
            ollama=self._status.ollama,
            pid=4321,
        )
        self._inspection = RuntimeInspection(
            configured_bind=self._inspection.configured_bind,
            configured_host=self._inspection.configured_host,
            configured_port=self._inspection.configured_port,
            cli_reachable=True,
            process_exists=True,
            process_responsive=True,
            listener_addresses=("127.0.0.1",),
        )
        return self._status

    def stop_runtime(self) -> RuntimeStatus:
        self._status = RuntimeStatus(
            runtime_state="stopped",
            status_message="OpenClaw runtime stopped.",
            openclaw=self._status.openclaw,
            ollama=self._status.ollama,
            pid=None,
        )
        self._inspection = RuntimeInspection(
            configured_bind=self._inspection.configured_bind,
            configured_host=self._inspection.configured_host,
            configured_port=self._inspection.configured_port,
            cli_reachable=True,
            process_exists=False,
            process_responsive=False,
            listener_addresses=(),
        )
        return self._status

    def restart_runtime(self) -> RuntimeStatus:
        self.restart_count += 1
        return self.start_runtime()

    def clear_logs(self) -> RuntimeStatus:
        self._logs = ()
        return self._status


class FakeOllamaProviderAdapter:
    def validate(self, **kwargs: object) -> ProviderStatus:
        preferred_model = str(kwargs.get("preferred_model") or "llama3.1")
        return ProviderStatus(
            provider="ollama",
            display_name="Ollama",
            configured=True,
            available=True,
            validation_state="valid",
            ready=True,
            message="Ollama is ready.",
            is_local=True,
            model=preferred_model,
            available_models=(preferred_model,),
        )


class FakeOpenAIProviderAdapter:
    def validate(self, **kwargs: object) -> ProviderStatus:
        secret_store = kwargs["secret_store"]
        secret_id = str(kwargs["secret_id"])
        if secret_store.has_secret(secret_id):
            return ProviderStatus(
                provider="openai",
                display_name="OpenAI",
                configured=True,
                available=True,
                validation_state="valid",
                ready=True,
                message="OpenAI is ready.",
                is_local=False,
            )
        return ProviderStatus(
            provider="openai",
            display_name="OpenAI",
            configured=False,
            available=False,
            validation_state="invalid",
            ready=False,
            message="OpenAI secret missing.",
            is_local=False,
        )


def ok_report(check_type: str) -> DiagnosticReport:
    return DiagnosticReport(
        check_type=check_type,  # type: ignore[arg-type]
        overall_status="ok",
        overall_severity="info",
        ran_at=datetime.now().astimezone().isoformat(timespec="seconds"),
        summary="OK",
        items=(),
    )


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def make_service(
    *,
    request_json,
    temp_dir: str,
) -> tuple[ControllerService, InMemorySecretStore, ControllerConfigStore, FakeRuntimeManager]:
    runtime_manager = FakeRuntimeManager()
    secret_store = InMemorySecretStore()
    config_store = ControllerConfigStore(config_path=Path(temp_dir) / "controller_config.json")
    telegram_service = TelegramChannelService(api_client=TelegramApiClient(request_json=request_json))
    service = ControllerService(
        runtime_manager=runtime_manager,
        config_store=config_store,
        secret_store=secret_store,
        provider_adapters={
            "ollama": FakeOllamaProviderAdapter(),
            "openai": FakeOpenAIProviderAdapter(),
        },
        telegram_service=telegram_service,
    )
    return service, secret_store, config_store, runtime_manager


def run() -> None:
    valid_token = "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456"
    masked_token = mask_telegram_token(valid_token)

    with tempfile.TemporaryDirectory() as tmp:
        service, secret_store, config_store, runtime_manager = make_service(
            request_json=lambda url: {
                "ok": True,
                "result": {
                    "id": 123456789,
                    "username": "aie_openclaw_bot",
                    "first_name": "AI-E OpenClaw",
                },
            },
            temp_dir=tmp,
        )

        saved = service.save_telegram_settings(telegram_token=valid_token)
        assert_true(secret_store.get_secret("telegram/default") == valid_token, "telegram token was not stored in secret storage")
        config_text = config_store.path.read_text(encoding="utf-8")
        assert_true(valid_token not in config_text, "telegram token leaked into config")
        assert_true(saved.telegram_token_masked == masked_token, "telegram token mask was not applied")

        validated = service.validate_telegram()
        assert_true(validated.telegram_status == "valid", "telegram validation did not pass with a valid fake response")
        tested = service.test_telegram_connection()
        assert_true(tested.telegram_last_test_result == "passed", "telegram test did not record a passing result")

        service.start_runtime()
        service.validate_provider(provider="ollama")
        degraded_snapshot = service.snapshot()
        assert_true(degraded_snapshot.readiness_state == "degraded", "readiness should be degraded before diagnostics run")

        service._latest_health_report = ok_report("health")
        service._latest_security_report = ok_report("security")
        ready_snapshot = service.snapshot()
        assert_true(ready_snapshot.readiness_state == "ready", "readiness rollup did not reach ready")

        restarted = service.restart_runtime()
        assert_true(runtime_manager.restart_count == 1, "restart runtime did not call the runtime manager")
        assert_true(restarted.runtime_state == "running", "restart runtime did not leave the runtime running")

        cleared = service.clear_logs()
        assert_true(cleared.recent_logs == (), "clear logs did not empty the log buffer")

        failing_service, _, _, _ = make_service(
            request_json=lambda url: {"ok": False, "description": "Unauthorized"},
            temp_dir=tmp,
        )
        failing_service.save_telegram_settings(telegram_token=valid_token)
        failed_validation = failing_service.validate_telegram()
        assert_true(failed_validation.telegram_status == "invalid", "telegram validation failure was not reported as invalid")
        assert_true("Unauthorized" in failed_validation.telegram_message, "telegram validation failure message was not preserved")

    print("daily-use smoke passed")


if __name__ == "__main__":
    run()
