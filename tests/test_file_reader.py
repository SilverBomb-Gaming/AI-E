from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.controller.file_reader import FileReader, FileReaderError


class FileReaderTests(unittest.TestCase):
    def test_reads_small_text_preview(self) -> None:
        reader = FileReader(max_file_size_bytes=1024, max_preview_chars=200, max_preview_lines=10)
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "sample.py"
            target.write_text("print('hello')\nprint('world')\n", encoding="utf-8")
            preview = reader.read_text_preview(str(target), display_path="sample.py")

            self.assertEqual(preview.display_path, "sample.py")
            self.assertEqual(preview.file_name, "sample.py")
            self.assertIn("print('hello')", preview.preview_text)
            self.assertFalse(preview.truncated)
            self.assertFalse(preview.oversized)
            self.assertEqual(preview.size_category, "small")

    def test_rejects_binary_or_unsupported_files(self) -> None:
        reader = FileReader(max_file_size_bytes=1024)
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "image.bin"
            target.write_bytes(b"\x00\x01\x02\x03")
            with self.assertRaises(FileReaderError) as context:
                reader.read_text_preview(str(target), display_path="image.bin")

            self.assertEqual(context.exception.code, "file_type_not_supported")
            self.assertEqual(context.exception.message, "File type not supported for safe display.")

    def test_large_text_file_returns_truncated_safe_preview(self) -> None:
        reader = FileReader(max_file_size_bytes=4096, max_preview_chars=400, max_preview_lines=8)
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "large.log"
            payload = ("line of text for preview\n" * 800)
            target.write_text(payload, encoding="utf-8")
            preview = reader.read_text_preview(str(target), display_path="logs/large.log")

            self.assertEqual(preview.display_path, "logs/large.log")
            self.assertTrue(preview.truncated)
            self.assertTrue(preview.oversized)
            self.assertEqual(preview.size_category, "large")
            self.assertLessEqual(len(preview.preview_text), 400)
            self.assertIn("large-preview", preview.audit_summary)


if __name__ == "__main__":
    unittest.main()
