from __future__ import annotations

import json
import tempfile
import unittest
import codecs
from pathlib import Path
from unittest.mock import Mock, patch

from ingestion.ingest import ingest_source
from ingestion.policy_check import is_source_allowed, policy_decision_for_source


class PolicyAwareIngestionTests(unittest.TestCase):
    def _make_root(self) -> Path:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        root = Path(temp_dir.name)
        (root / "policy").mkdir(parents=True, exist_ok=True)
        (root / "data" / "raw").mkdir(parents=True, exist_ok=True)
        (root / "data" / "processed").mkdir(parents=True, exist_ok=True)
        (root / "policy" / "allowlist.json").write_text(
            json.dumps({"domains": ["example.com"]}, indent=2),
            encoding="utf-8",
        )
        (root / "policy" / "rules.json").write_text(
            json.dumps(
                {
                    "default_usage_class": "retrieval_only",
                    "default_review_status": "approved",
                    "default_review_required": False,
                    "allow_local_files": True,
                    "local_file_usage_class": "evaluation_only",
                    "local_file_review_status": "approved",
                    "local_file_review_required": False,
                    "chunk_size": 5,
                    "timeout_seconds": 1,
                    "rate_limit_seconds": 0.0,
                    "provenance_requirements": [
                        "must retain source",
                        "must retain timestamp"
                    ]
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        (root / "data" / "registry.json").write_text("[]", encoding="utf-8")
        return root

    def test_policy_allows_allowlisted_domain(self) -> None:
        root = self._make_root()
        decision = policy_decision_for_source("https://example.com/docs", root_path=root)
        self.assertTrue(decision.allowed)
        self.assertEqual(decision.source_kind, "url")
        self.assertIn("retrieval", decision.allowed_operations)
        self.assertTrue(is_source_allowed("https://example.com/docs", root_path=root))

    def test_policy_blocks_non_allowlisted_domain(self) -> None:
        root = self._make_root()
        decision = policy_decision_for_source("https://blocked.example.org", root_path=root)
        self.assertFalse(decision.allowed)
        self.assertEqual(decision.allowed_operations, ("blocked",))

    def test_policy_allows_allowlisted_domain_with_port(self) -> None:
        root = self._make_root()
        (root / "policy" / "allowlist.json").write_text(
            json.dumps({"domains": ["127.0.0.1"]}, indent=2),
            encoding="utf-8",
        )

        decision = policy_decision_for_source("http://127.0.0.1:8765/sample.html", root_path=root)

        self.assertTrue(decision.allowed)
        self.assertEqual(decision.matched_rule, "127.0.0.1")

    @patch("ingestion.fetcher.requests.get")
    def test_allowed_url_ingests_and_updates_registry(self, mock_get: Mock) -> None:
        root = self._make_root()
        response = Mock()
        response.text = "<html><body><h1>Allowed page</h1><p>alpha beta gamma delta epsilon zeta eta theta</p></body></html>"
        response.content = response.text.encode("utf-8")
        response.encoding = "utf-8"
        response.apparent_encoding = "utf-8"
        response.raise_for_status.return_value = None
        mock_get.return_value = response

        result = ingest_source("https://example.com/docs", root_path=root)

        latest_output = root / "data" / "processed" / "output.json"
        self.assertTrue(latest_output.exists())
        payload = json.loads(latest_output.read_text(encoding="utf-8"))
        self.assertTrue(payload)
        self.assertIn("metadata", payload[0])
        self.assertEqual(payload[0]["metadata"]["source"], "https://example.com/docs")
        self.assertTrue(payload[0]["metadata"]["usage"]["retrieval"])
        registry = json.loads((root / "data" / "registry.json").read_text(encoding="utf-8"))
        self.assertEqual(len(registry), 1)
        self.assertEqual(registry[0]["dataset_id"], result["dataset_id"])
        self.assertEqual(registry[0]["entries"], len(payload))

    @patch("ingestion.fetcher.requests.get")
    def test_allowed_url_ingest_strips_utf8_bom(self, mock_get: Mock) -> None:
        root = self._make_root()
        response = Mock()
        response.content = codecs.BOM_UTF8 + b"<html><body><p>alpha beta gamma delta epsilon</p></body></html>"
        response.encoding = "ISO-8859-1"
        response.apparent_encoding = "utf-8"
        response.raise_for_status.return_value = None
        mock_get.return_value = response

        ingest_source("https://example.com/docs", root_path=root)

        payload = json.loads((root / "data" / "processed" / "output.json").read_text(encoding="utf-8"))
        self.assertFalse(payload[0]["content"].startswith("\ufeff"))
        self.assertFalse(payload[0]["content"].startswith("ï»¿"))

    def test_local_file_ingests_with_metadata(self) -> None:
        root = self._make_root()
        source_path = root / "sample.txt"
        source_path.write_text("one two three four five six seven eight nine ten", encoding="utf-8")

        result = ingest_source(str(source_path), root_path=root)

        payload = json.loads((root / "data" / "processed" / "output.json").read_text(encoding="utf-8"))
        self.assertEqual(result["entry_count"], len(payload))
        self.assertEqual(payload[0]["metadata"]["source_kind"], "file")
        self.assertTrue(payload[0]["metadata"]["usage"]["evaluation"])

    def test_bom_authored_local_file_and_registry_are_supported(self) -> None:
        root = self._make_root()
        source_path = root / "sample_bom.txt"
        source_path.write_text("alpha beta gamma delta epsilon zeta", encoding="utf-8-sig")
        (root / "data" / "registry.json").write_text("[]", encoding="utf-8-sig")

        result = ingest_source(str(source_path), root_path=root)

        payload = json.loads((root / "data" / "processed" / "output.json").read_text(encoding="utf-8"))
        self.assertEqual(result["entry_count"], len(payload))
        self.assertFalse(payload[0]["content"].startswith("\ufeff"))
        registry = json.loads((root / "data" / "registry.json").read_text(encoding="utf-8"))
        self.assertEqual(len(registry), 1)

    def test_blocked_domain_raises(self) -> None:
        root = self._make_root()
        with self.assertRaisesRegex(ValueError, "Source not allowed by policy"):
            ingest_source("https://blocked.example.org", root_path=root)