from __future__ import annotations

import codecs
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from accessibility.interpreter import interpret_input
from accessibility.refiner import refine_request
from accessibility.schemas import IngestionRequest
from accessibility.validator import validate_request
from ingestion.ingest import ingest_from_conversation, main


class ConversationalIngestionTests(unittest.TestCase):
    def _make_root(self) -> Path:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        root = Path(temp_dir.name)
        (root / "policy").mkdir(parents=True, exist_ok=True)
        (root / "data" / "raw").mkdir(parents=True, exist_ok=True)
        (root / "data" / "processed").mkdir(parents=True, exist_ok=True)
        (root / "policy" / "allowlist.json").write_text(
            json.dumps({"domains": ["docs.unity3d.com", "example.com"]}, indent=2),
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
                        "must retain timestamp",
                    ],
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        (root / "data" / "registry.json").write_text("[]", encoding="utf-8-sig")
        return root

    def test_interpreter_maps_unity_docs_request(self) -> None:
        request = interpret_input("grab docs from unity scripting API")

        self.assertEqual(request.source, "https://docs.unity3d.com/ScriptReference/")
        self.assertEqual(request.intent, "documentation")

    def test_refiner_rejects_unknown_prompt(self) -> None:
        with self.assertRaisesRegex(ValueError, "Ask user for clarification"):
            refine_request(IngestionRequest(source="UNKNOWN", intent="unknown"))

    def test_validator_requires_local_file_path(self) -> None:
        with self.assertRaisesRegex(ValueError, "User must provide a file path"):
            validate_request(IngestionRequest(source="LOCAL_FILE_REQUIRED", intent="user_provided", allow_local=True))

    @patch("ingestion.fetcher.requests.get")
    def test_conversational_unity_docs_request_ingests(self, mock_get: Mock) -> None:
        root = self._make_root()
        response = Mock()
        response.content = codecs.BOM_UTF8 + b"<html><body><p>alpha beta gamma delta epsilon zeta eta theta</p></body></html>"
        response.encoding = "ISO-8859-1"
        response.apparent_encoding = "utf-8"
        response.raise_for_status.return_value = None
        mock_get.return_value = response

        result = ingest_from_conversation("get unity docs", root_path=root)

        payload = json.loads((root / "data" / "processed" / "output.json").read_text(encoding="utf-8"))
        self.assertEqual(result["entry_count"], len(payload))
        self.assertEqual(payload[0]["metadata"]["source"], "https://docs.unity3d.com/ScriptReference/")
        self.assertFalse(payload[0]["content"].startswith("\ufeff"))

    def test_conversational_unknown_prompt_requests_clarification(self) -> None:
        root = self._make_root()

        with self.assertRaisesRegex(ValueError, "Ask user for clarification"):
            ingest_from_conversation("get something random", root_path=root)

    def test_conversational_blocked_domain_still_hits_policy(self) -> None:
        root = self._make_root()

        with self.assertRaisesRegex(ValueError, "Source not allowed by policy"):
            ingest_from_conversation("get data from blockedsite.com", root_path=root)

    @patch("ingestion.fetcher.requests.get")
    def test_main_routes_natural_language_request(self, mock_get: Mock) -> None:
        root = self._make_root()
        response = Mock()
        response.content = b"<html><body><p>alpha beta gamma delta epsilon</p></body></html>"
        response.encoding = "utf-8"
        response.apparent_encoding = "utf-8"
        response.raise_for_status.return_value = None
        mock_get.return_value = response

        with patch("ingestion.ingest.DEFAULT_ROOT", root):
            exit_code = main(["get unity docs"])

        self.assertEqual(exit_code, 0)