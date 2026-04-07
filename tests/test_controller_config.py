from __future__ import annotations

import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

from app.controller.profile_store import ControllerConfigStore


class ControllerConfigStoreTests(unittest.TestCase):
    def test_load_save_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            config_path = Path(tmp) / "controller_config.json"
            store = ControllerConfigStore(config_path=config_path)
            config = store.load()
            self.assertEqual(config.current_mode, "offline")
            self.assertTrue(Path(config.repo_root).is_absolute())

            updated = replace(
                config,
                current_mode="online",
                selected_mode="online",
                selected_provider="openai",
                policy="always_online",
                preferred_ollama_model="qwen2.5-coder:7b",
                repo_root=str((Path(tmp) / "repo-root").resolve()),
                openai_key_masked="sk-abc...1234",
                openai_has_secret=True,
            )
            store.save(updated)
            reloaded = store.load()
            self.assertEqual(reloaded.current_mode, "online")
            self.assertEqual(reloaded.selected_provider, "openai")
            self.assertEqual(reloaded.policy, "always_online")
            self.assertEqual(reloaded.repo_root, str((Path(tmp) / "repo-root").resolve()))
            self.assertEqual(reloaded.openai_key_masked, "sk-abc...1234")


if __name__ == "__main__":
    unittest.main()
