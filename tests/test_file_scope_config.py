from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.controller.profile_store import ControllerConfigStore


class FileScopeConfigTests(unittest.TestCase):
    def test_file_allowed_roots_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            config_path = Path(tmp) / "controller_config.json"
            store = ControllerConfigStore(config_path=config_path)
            config = store.load()
            config.file_allowed_roots = (
                str((Path(tmp) / "workspace").resolve()),
                str((Path(tmp) / "docs").resolve()),
            )
            store.save(config)

            reloaded = store.load()
            self.assertEqual(
                reloaded.file_allowed_roots,
                (
                    str((Path(tmp) / "workspace").resolve()),
                    str((Path(tmp) / "docs").resolve()),
                ),
            )


if __name__ == "__main__":
    unittest.main()
