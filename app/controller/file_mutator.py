"""Controlled, bounded text file mutation helpers for operator-approved edits."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from hashlib import sha256
from pathlib import Path
from typing import Literal
import difflib


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
_PROTECTED_PATH_SEGMENTS = frozenset({".git", ".venv", "__pycache__", "Library", "Temp", "UserSettings"})
_PATCH_FIND_MARKER = "@@ FIND"
_PATCH_REPLACE_MARKER = "@@ REPLACE"
_WRITE_CONTENT_MARKER = "@@ CONTENT"


@dataclass(frozen=True)
class FilePatchOperation:
    find_text: str
    replace_text: str


@dataclass(frozen=True)
class ParsedFilePatchCommand:
    relative_path: str
    operator_reason: str
    expected_base_hash: str
    operations: tuple[FilePatchOperation, ...]
    raw_argument: str


@dataclass(frozen=True)
class ParsedFileWriteCommand:
    relative_path: str
    operator_reason: str
    expected_base_hash: str
    new_content: str
    raw_argument: str


@dataclass(frozen=True)
class FilePatchMutationRequest:
    target_path: str
    display_path: str
    operator_reason: str
    expected_base_hash: str
    operations: tuple[FilePatchOperation, ...]


@dataclass(frozen=True)
class FileWriteReplaceRequest:
    target_path: str
    display_path: str
    operator_reason: str
    expected_base_hash: str
    new_content: str


@dataclass(frozen=True)
class FileMutationSnapshot:
    target_path: str
    display_path: str
    file_name: str
    operation_kind: Literal["patch", "replace"]
    change_count: int
    changed_lines: int
    size_bytes_before: int
    size_bytes_after: int
    base_hash_before: str
    base_hash_after: str
    applied_at: str
    operator_reason: str = ""

    @property
    def size_label_after(self) -> str:
        return _format_size_label(self.size_bytes_after)

    @property
    def audit_summary(self) -> str:
        change_label = "replacement" if self.change_count == 1 else "replacements"
        return (
            f"{self.display_path} | {self.operation_kind} | "
            f"{self.change_count} {change_label} | {self.changed_lines} lines changed"
        )

    @property
    def status_label(self) -> str:
        change_label = "replacement" if self.change_count == 1 else "replacements"
        return f"{self.operation_kind.title()} applied: {self.change_count} {change_label}, {self.changed_lines} lines changed."


class FileMutatorError(RuntimeError):
    """Structured, user-safe file mutation error."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class FileMutator:
    """Apply bounded patch and replace operations to scoped text files only."""

    def __init__(
        self,
        *,
        max_file_size_bytes: int = 262_144,
        max_patch_operations: int = 8,
        max_replacement_chars: int = 20_000,
    ) -> None:
        self._max_file_size_bytes = max_file_size_bytes
        self._max_patch_operations = max_patch_operations
        self._max_replacement_chars = max_replacement_chars

    def apply_patch(self, request: FilePatchMutationRequest) -> FileMutationSnapshot:
        if not request.operations:
            raise FileMutatorError("missing_patch_sections", "Patch request did not include any @@ FIND / @@ REPLACE blocks.")
        if len(request.operations) > self._max_patch_operations:
            raise FileMutatorError("patch_operation_limit_exceeded", "Patch request exceeds the allowed number of replacements.")
        current_text, path, size_bytes_before, newline_style = self._load_text_file(
            request.target_path,
            display_path=request.display_path,
        )
        base_hash_before = self._content_hash(current_text)
        self._validate_expected_base(request.expected_base_hash, base_hash_before)

        updated_text = current_text
        for operation in request.operations:
            if len(operation.find_text) > self._max_replacement_chars or len(operation.replace_text) > self._max_replacement_chars:
                raise FileMutatorError("replacement_too_large", "Patch block is too large for a bounded mutation request.")
            match_count = updated_text.count(operation.find_text)
            if match_count == 0:
                raise FileMutatorError("patch_context_missing", "Patch text was not found in the current file content.")
            if match_count > 1:
                raise FileMutatorError("patch_context_ambiguous", "Patch text matched multiple locations. Narrow the patch and try again.")
            updated_text = updated_text.replace(operation.find_text, operation.replace_text, 1)

        if updated_text == current_text:
            raise FileMutatorError("no_changes_requested", "Patch request would not change the file content.")
        return self._write_text_result(
            path=path,
            display_path=request.display_path,
            operation_kind="patch",
            change_count=len(request.operations),
            operator_reason=request.operator_reason,
            before_text=current_text,
            after_text=updated_text,
            newline_style=newline_style,
            size_bytes_before=size_bytes_before,
            base_hash_before=base_hash_before,
        )

    def replace_file(self, request: FileWriteReplaceRequest) -> FileMutationSnapshot:
        current_text, path, size_bytes_before, newline_style = self._load_text_file(
            request.target_path,
            display_path=request.display_path,
        )
        base_hash_before = self._content_hash(current_text)
        self._validate_expected_base(request.expected_base_hash, base_hash_before)
        if len(request.new_content) > self._max_file_size_bytes:
            raise FileMutatorError("replacement_too_large", "Replacement content is too large for a bounded mutation request.")
        if request.new_content == current_text:
            raise FileMutatorError("no_changes_requested", "Replacement content matches the current file content.")
        return self._write_text_result(
            path=path,
            display_path=request.display_path,
            operation_kind="replace",
            change_count=1,
            operator_reason=request.operator_reason,
            before_text=current_text,
            after_text=request.new_content,
            newline_style=newline_style,
            size_bytes_before=size_bytes_before,
            base_hash_before=base_hash_before,
        )

    def _load_text_file(self, target_path: str, *, display_path: str) -> tuple[str, Path, int, str]:
        path = Path(target_path)
        if not path.exists() or not path.is_file():
            raise FileMutatorError("file_not_found", "File not found in allowed scope.")
        self._ensure_path_not_protected(Path(display_path))
        if not self._is_supported_text_file(path):
            raise FileMutatorError("file_type_not_supported", "File type not supported for controlled mutation.")
        size_bytes = path.stat().st_size
        if size_bytes > self._max_file_size_bytes:
            raise FileMutatorError("file_too_large", "File is too large for controlled mutation.")
        raw_bytes = path.read_bytes()
        if self._looks_binary(raw_bytes):
            raise FileMutatorError("file_type_not_supported", "File type not supported for controlled mutation.")
        try:
            text = raw_bytes.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise FileMutatorError("file_encoding_not_supported", "Only UTF-8 text files are supported for controlled mutation.") from exc
        newline_style = self._detect_newline_style(text)
        normalized_text = self._normalize_newlines(text)
        return normalized_text, path.resolve(), size_bytes, newline_style

    def _write_text_result(
        self,
        *,
        path: Path,
        display_path: str,
        operation_kind: Literal["patch", "replace"],
        change_count: int,
        operator_reason: str,
        before_text: str,
        after_text: str,
        newline_style: str,
        size_bytes_before: int,
        base_hash_before: str,
    ) -> FileMutationSnapshot:
        encoded_output = self._restore_newlines(after_text, newline_style).encode("utf-8")
        if len(encoded_output) > self._max_file_size_bytes:
            raise FileMutatorError("replacement_too_large", "Mutation result exceeds the allowed file size bound.")
        path.write_bytes(encoded_output)
        return FileMutationSnapshot(
            target_path=str(path),
            display_path=display_path,
            file_name=path.name,
            operation_kind=operation_kind,
            change_count=change_count,
            changed_lines=self._count_changed_lines(before_text, after_text),
            size_bytes_before=size_bytes_before,
            size_bytes_after=len(encoded_output),
            base_hash_before=base_hash_before,
            base_hash_after=self._content_hash(after_text),
            applied_at=datetime.now().astimezone().isoformat(timespec="seconds"),
            operator_reason=operator_reason.strip(),
        )

    @staticmethod
    def _validate_expected_base(expected_base_hash: str, actual_base_hash: str) -> None:
        expected = expected_base_hash.strip().lower()
        if not expected:
            return
        if len(expected) < 8 or any(char not in "0123456789abcdef" for char in expected):
            raise FileMutatorError("invalid_base_hash", "Base hash must be at least 8 hexadecimal characters.")
        if not actual_base_hash.startswith(expected):
            raise FileMutatorError(
                "base_hash_mismatch",
                f"File changed since the request was prepared. Expected base {expected}, current base {actual_base_hash[:12]}.",
            )

    @staticmethod
    def _normalize_newlines(text: str) -> str:
        return text.replace("\r\n", "\n").replace("\r", "\n")

    @staticmethod
    def _restore_newlines(text: str, newline_style: str) -> str:
        if newline_style == "\n":
            return text
        return text.replace("\n", newline_style)

    @staticmethod
    def _detect_newline_style(text: str) -> str:
        if "\r\n" in text:
            return "\r\n"
        return "\n"

    @staticmethod
    def _content_hash(text: str) -> str:
        return sha256(text.encode("utf-8")).hexdigest()

    @staticmethod
    def _looks_binary(raw_bytes: bytes) -> bool:
        return bool(raw_bytes[:4096] and b"\x00" in raw_bytes[:4096])

    @staticmethod
    def _is_supported_text_file(path: Path) -> bool:
        if path.suffix.lower() in _TEXT_SUFFIX_ALLOWLIST:
            return True
        return path.name in _TEXT_NAME_ALLOWLIST

    @staticmethod
    def _ensure_path_not_protected(path: Path) -> None:
        if any(part in _PROTECTED_PATH_SEGMENTS for part in path.parts):
            raise FileMutatorError("protected_path_not_allowed", "This path is protected from Telegram-driven mutation.")

    @staticmethod
    def _count_changed_lines(before_text: str, after_text: str) -> int:
        before_lines = before_text.split("\n")
        after_lines = after_text.split("\n")
        changed = 0
        for opcode, start_before, end_before, start_after, end_after in difflib.SequenceMatcher(a=before_lines, b=after_lines).get_opcodes():
            if opcode == "equal":
                continue
            changed += max(end_before - start_before, end_after - start_after)
        return max(1, changed)


def parse_patch_command(argument: str) -> ParsedFilePatchCommand:
    relative_path, operator_reason, expected_base_hash, body_lines, raw_argument = _parse_command_preamble(argument)
    operations: list[FilePatchOperation] = []
    index = 0
    while index < len(body_lines):
        marker = body_lines[index].strip()
        if marker != _PATCH_FIND_MARKER:
            raise FileMutatorError("missing_patch_sections", "Use @@ FIND and @@ REPLACE blocks in /patchfile requests.")
        index += 1
        find_lines: list[str] = []
        while index < len(body_lines) and body_lines[index].strip() != _PATCH_REPLACE_MARKER:
            find_lines.append(body_lines[index])
            index += 1
        if index >= len(body_lines) or body_lines[index].strip() != _PATCH_REPLACE_MARKER:
            raise FileMutatorError("missing_patch_sections", "Each @@ FIND block must be followed by @@ REPLACE.")
        index += 1
        replace_lines: list[str] = []
        while index < len(body_lines) and body_lines[index].strip() != _PATCH_FIND_MARKER:
            replace_lines.append(body_lines[index])
            index += 1
        find_text = "\n".join(find_lines)
        replace_text = "\n".join(replace_lines)
        if not find_text:
            raise FileMutatorError("missing_patch_sections", "Each @@ FIND block must contain text to match.")
        operations.append(FilePatchOperation(find_text=find_text, replace_text=replace_text))
    if not operations:
        raise FileMutatorError("missing_patch_sections", "Patch request did not include any @@ FIND / @@ REPLACE blocks.")
    return ParsedFilePatchCommand(
        relative_path=relative_path,
        operator_reason=operator_reason,
        expected_base_hash=expected_base_hash,
        operations=tuple(operations),
        raw_argument=raw_argument,
    )


def parse_write_command(argument: str) -> ParsedFileWriteCommand:
    relative_path, operator_reason, expected_base_hash, body_lines, raw_argument = _parse_command_preamble(argument)
    if not body_lines or body_lines[0].strip() != _WRITE_CONTENT_MARKER:
        raise FileMutatorError("missing_write_content", "Use @@ CONTENT followed by the replacement file content.")
    new_content = "\n".join(body_lines[1:])
    return ParsedFileWriteCommand(
        relative_path=relative_path,
        operator_reason=operator_reason,
        expected_base_hash=expected_base_hash,
        new_content=new_content,
        raw_argument=raw_argument,
    )


def summarize_patch_request(parsed: ParsedFilePatchCommand) -> str:
    count = len(parsed.operations)
    change_label = "replacement" if count == 1 else "replacements"
    summary = f"{count} {change_label}"
    if parsed.expected_base_hash:
        summary = f"{summary}, base {parsed.expected_base_hash[:12].lower()}"
    return summary


def summarize_write_request(parsed: ParsedFileWriteCommand) -> str:
    line_count = parsed.new_content.count("\n") + (1 if parsed.new_content or parsed.new_content == "" else 0)
    summary = f"replace file with {line_count} lines"
    if parsed.expected_base_hash:
        summary = f"{summary}, base {parsed.expected_base_hash[:12].lower()}"
    return summary


def _parse_command_preamble(argument: str) -> tuple[str, str, str, list[str], str]:
    raw_argument = _normalize_newlines(argument).strip("\n")
    if not raw_argument.strip():
        raise FileMutatorError("missing_file_path", "Provide a relative file path as the first line of the command.")
    lines = raw_argument.split("\n")
    relative_path = lines[0].strip()
    if not relative_path:
        raise FileMutatorError("missing_file_path", "Provide a relative file path as the first line of the command.")
    operator_reason = ""
    expected_base_hash = ""
    body_start = 1
    while body_start < len(lines):
        candidate = lines[body_start].strip()
        if not candidate:
            body_start += 1
            continue
        lowered = candidate.lower()
        if lowered.startswith("reason:"):
            operator_reason = candidate.split(":", 1)[1].strip()
            body_start += 1
            continue
        if lowered.startswith("base:"):
            expected_base_hash = candidate.split(":", 1)[1].strip().lower()
            body_start += 1
            continue
        break
    body_lines = lines[body_start:]
    if not body_lines:
        raise FileMutatorError("missing_mutation_body", "Provide mutation content after the file path.")
    return relative_path, operator_reason, expected_base_hash, body_lines, raw_argument


def _normalize_newlines(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _format_size_label(size_bytes: int) -> str:
    if size_bytes < 1024:
        return f"{size_bytes} B"
    if size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    return f"{size_bytes / (1024 * 1024):.1f} MB"