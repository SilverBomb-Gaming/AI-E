from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.controller.app_service import ControllerService
from app.controller.profile_store import ControllerConfigStore
from app.platform.secrets import InMemorySecretStore
from app.providers.base import ProviderStatus
from app.runtime.manager import OpenClawRuntimeManager


class _FakeOllamaAdapter:
    def validate(self, **kwargs: object) -> ProviderStatus:
        return ProviderStatus(
            provider="ollama",
            display_name="Ollama",
            configured=True,
            available=False,
            validation_state="invalid",
            ready=False,
            message="Ollama service is unavailable.",
            is_local=True,
        )


class _FakeOpenAIAdapter:
    def validate(self, **kwargs: object) -> ProviderStatus:
        return ProviderStatus(
            provider="openai",
            display_name="OpenAI",
            configured=False,
            available=False,
            validation_state="invalid",
            ready=False,
            message="Missing OpenAI API key.",
            is_local=False,
        )


class ModeSwitchingTests(unittest.TestCase):
    def test_online_switch_requires_secret(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = ControllerConfigStore(config_path=Path(tmp) / "controller_config.json")
            service = ControllerService(
                runtime_manager=OpenClawRuntimeManager(),
                config_store=store,
                secret_store=InMemorySecretStore(),
                provider_adapters={"ollama": _FakeOllamaAdapter(), "openai": _FakeOpenAIAdapter()},
            )
            snapshot = service.save_settings(
                selected_mode="online",
                selected_provider="openai",
                policy="ask_before_online",
                confirm_online=True,
            )
            self.assertEqual(snapshot.mode, "offline")
            self.assertEqual(snapshot.selected_mode, "online")
            self.assertIn("not activated", snapshot.status_message)

    def test_offline_switch_requires_ollama(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = ControllerConfigStore(config_path=Path(tmp) / "controller_config.json")
            config = store.load()
            config.current_mode = "online"
            config.selected_mode = "online"
            config.selected_provider = "openai"
            store.save(config)
            service = ControllerService(
                runtime_manager=OpenClawRuntimeManager(),
                config_store=store,
                secret_store=InMemorySecretStore(),
                provider_adapters={"ollama": _FakeOllamaAdapter(), "openai": _FakeOpenAIAdapter()},
            )
            snapshot = service.save_settings(
                selected_mode="offline",
                selected_provider="ollama",
                policy="ask_before_online",
            )
            self.assertEqual(snapshot.mode, "online")
            self.assertEqual(snapshot.selected_mode, "offline")
            self.assertIn("Current mode remains Online", snapshot.status_message)


if __name__ == "__main__":
    unittest.main()
