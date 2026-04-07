from __future__ import annotations

import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app.platform.secrets import InMemorySecretStore, WindowsDpapiSecretStore
from app.providers.ollama_adapter import OllamaProviderAdapter
from app.providers.openai_adapter import OpenAIProviderAdapter
from app.runtime.models import OllamaInstallation, RuntimeStatus


class _FakeResponse(io.BytesIO):
    def __enter__(self) -> "_FakeResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()


class ProviderValidationTests(unittest.TestCase):
    def test_ollama_validation_detects_models(self) -> None:
        adapter = OllamaProviderAdapter()
        payload = {"models": [{"name": "qwen2.5-coder:7b"}, {"name": "llama3.1:8b"}]}
        runtime_status = RuntimeStatus(ollama=OllamaInstallation(installed=True, path="C:\\Ollama\\ollama.exe"))
        with mock.patch("urllib.request.urlopen", return_value=_FakeResponse(json.dumps(payload).encode("utf-8"))):
            status = adapter.validate(
                runtime_status=runtime_status,
                base_url="http://127.0.0.1:11434",
                preferred_model="qwen2.5-coder:7b",
            )
        self.assertTrue(status.ready)
        self.assertEqual(status.validation_state, "valid")
        self.assertIn("qwen2.5-coder:7b", status.available_models)

    def test_openai_validation_uses_secret_store(self) -> None:
        adapter = OpenAIProviderAdapter()
        secrets = InMemorySecretStore()
        secrets.put_secret("openai/default", "sk-abcdefghijklmnopqrstuvwxyz123456")
        status = adapter.validate(secret_store=secrets, secret_id="openai/default")
        self.assertTrue(status.ready)
        self.assertEqual(status.validation_state, "valid")

    @unittest.skipUnless(os.name == "nt", "Windows-only DPAPI store")
    def test_windows_secret_store_round_trip_when_available(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = WindowsDpapiSecretStore(Path(tmp) / "secrets.json")
            store.put_secret("openai/default", "sk-abcdefghijklmnopqrstuvwxyz123456")
            self.assertTrue(store.has_secret("openai/default"))
            self.assertEqual(store.get_secret("openai/default"), "sk-abcdefghijklmnopqrstuvwxyz123456")


if __name__ == "__main__":
    unittest.main()
