from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.controller.profile_store import ControllerConfigStore


class WebScopeConfigTests(unittest.TestCase):
    def test_web_allowed_domains_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            config_path = Path(tmp) / "controller_config.json"
            store = ControllerConfigStore(config_path=config_path)
            config = store.load()
            config.web_allowed_domains = ("docs.openclaw.ai", "platform.openai.com", "*.ollama.com")
            store.save(config)

            reloaded = store.load()
            self.assertEqual(
                reloaded.web_allowed_domains,
                ("docs.openclaw.ai", "platform.openai.com", "*.ollama.com"),
            )


if __name__ == "__main__":
    unittest.main()
