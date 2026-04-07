"""Safe, bounded text file reading for operator-console file inspection."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


_TEXT_SUFFIX_ALLOWLIST = frozenset(
    {
        ".py",
        ".md",
        ".txt",
        ".json",
        ".toml",
        ".yaml",
        ".yml",
        ".ini",
        ".cfg",
        ".ps1",
        ".psm1",
        ".bat",
        ".cmd",
        ".sh",
        ".js",
        ".jsx",
        ".ts",
        ".tsx",
        ".css",
        ".html",
        ".xml",
        ".csv",
        ".log",
        ".gitignore",
        ".gitattributes",
    }
)
_TEXT_NAME_ALLOWLIST = frozenset({"README", "Dockerfile", "Makefile", "LICENSE"})


@dataclass(frozen=True)
class FileReadSnapshot:
    target_path: str
    display_path: str
    file_name: str
    preview_text: str
    size_bytes: int
    line_count: int
    truncated: bool
    oversized: bool
    encoding: str
    read_at: str

    @property
    def size_label(self) -> str:
        if self.size_bytes < 1024:
            return f"{self.size_bytes} B"
        if self.size_bytes < 1024 * 1024:
            return f"{self.size_bytes / 1024:.1f} KB"
        return f"{self.size_bytes / (1024 * 1024):.1f} MB"

    @property
    def size_category(self) -> str:
        if self.oversized:
            return "large"
        return "truncated" if self.truncated else "small"

    @property
    def audit_summary(self) -> str:
        if self.oversized:
            suffix = " | large-preview"
        elif self.truncated:
            suffix = " | truncated"
        else:
            suffix = ""
        return f"{self.display_path} | {self.size_label}{suffix}"


class FileReaderError(RuntimeError):
    """Structured, user-safe file-reading error."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class FileReader:
    """Read bounded text previews without exposing mutation or shell paths."""

    def __init__(
        self,
        *,
        max_file_size_bytes: int = 262_144,
        max_preview_chars: int = 2_400,
        max_preview_lines: int = 24,
    ) -> None:
        self._max_file_size_bytes = max_file_size_bytes
        self._max_preview_chars = max_preview_chars
        self._max_preview_lines = max_preview_lines

    def read_text_preview(self, target_path: str, *, display_path: str) -> FileReadSnapshot:
        path = Path(target_path)
        if not path.exists() or not path.is_file():
            raise FileReaderError("file_not_found", "File not found in allowed scope.")

        if not self._is_supported_text_file(path):
            raise FileReaderError("file_type_not_supported", "File type not supported for safe display.")

        size_bytes = path.stat().st_size
        oversized = size_bytes > self._max_file_size_bytes
        raw_bytes = self._read_head_bytes(path, limit=min(size_bytes, self._max_file_size_bytes))
        if self._looks_binary(raw_bytes):
            raise FileReaderError("file_type_not_supported", "File type not supported for safe display.")

        text, encoding = self._decode_text_preview(raw_bytes)

        normalized = text.replace("\r\n", "\n").replace("\r", "\n")
        preview_text, truncated = self._build_preview(normalized)
        truncated = truncated or oversized
        line_count = normalized.count("\n") + (1 if normalized and not normalized.endswith("\n") else 0)
        return FileReadSnapshot(
            target_path=str(path.resolve()),
            display_path=display_path,
            file_name=path.name,
            preview_text=preview_text,
            size_bytes=size_bytes,
            line_count=line_count,
            truncated=truncated,
            oversized=oversized,
            encoding=encoding,
            read_at=datetime.now().astimezone().isoformat(timespec="seconds"),
        )

    def _build_preview(self, text: str) -> tuple[str, bool]:
        lines = text.split("\n")
        preview_lines = lines[: self._max_preview_lines]
        preview = "\n".join(preview_lines).strip("\n")
        truncated = len(lines) > self._max_preview_lines
        if len(preview) > self._max_preview_chars:
            preview = preview[: self._max_preview_chars].rstrip()
            truncated = True
        if not preview:
            preview = "[empty file]"
        return preview, truncated

    @staticmethod
    def _looks_binary(raw_bytes: bytes) -> bool:
        if not raw_bytes:
            return False
        sample = raw_bytes[:4096]
        return b"\x00" in sample

    @staticmethod
    def _read_head_bytes(path: Path, *, limit: int) -> bytes:
        with path.open("rb") as handle:
            return handle.read(max(0, limit))

    @staticmethod
    def _decode_text_preview(raw_bytes: bytes) -> tuple[str, str]:
        for trim in range(0, 4):
            candidate = raw_bytes[:-trim] if trim else raw_bytes
            try:
                return candidate.decode("utf-8-sig"), "utf-8"
            except UnicodeDecodeError as exc:
                if exc.start < max(0, len(candidate) - 4):
                    break
        raise FileReaderError("file_encoding_not_supported", "File type not supported for safe display.")

    @staticmethod
    def _is_supported_text_file(path: Path) -> bool:
        suffix = path.suffix.lower()
        if suffix in _TEXT_SUFFIX_ALLOWLIST:
            return True
        return path.name in _TEXT_NAME_ALLOWLIST
