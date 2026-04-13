"""Bounded local command execution for Telegram-driven operator actions."""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
import shlex
import subprocess
import sys
import time
import re
from typing import Callable

from .execution_models import LocalCommandExecutionRequest, LocalCommandExecutionResult


class ExecutionRunnerError(RuntimeError):
    """Structured execution runner error."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


_CommandRunner = Callable[[tuple[str, ...], str, float], subprocess.CompletedProcess[str]]

_BLOCKED_OPERATOR_TOKENS = ("&&", "||", ";", "&", ">>", ">", "<", "|")
_ALLOWED_PYTHON_SCRIPTS = frozenset({"validate_runtime.py", "diagnostics_smoke.py", "daily_use_smoke.py"})
_ALLOWED_PYTHON_EXECUTABLES = frozenset(
    {
        "python",
        "python.exe",
        "py",
        "py.exe",
        Path(sys.executable).name.lower(),
    }
)
_APPROVED_RUN_ALIAS_ENTRYPOINTS: dict[str, tuple[str, ...]] = {
    "main": ("src/main.py",),
}


class ExecutionRunner:
    """Parse, validate, execute, and summarize narrow local commands."""

    def __init__(
        self,
        command_runner: _CommandRunner | None = None,
        *,
        default_timeout_seconds: float = 20.0,
        max_command_length: int = 160,
    ) -> None:
        self._command_runner = command_runner or self._default_command_runner
        self._default_timeout_seconds = max(5.0, float(default_timeout_seconds))
        self._max_command_length = max(40, int(max_command_length))

    def build_run_request(
        self,
        *,
        capability_id: str,
        repo_root: str,
        command_text: str,
        operator_reason: str = "",
        timeout_seconds: float | None = None,
        expected_scope: str = "",
    ) -> LocalCommandExecutionRequest:
        repo_root_text = self._validate_repo_root(repo_root)
        normalized = self._normalize_command_text(command_text)
        argv = self._split_command(normalized)
        alias_request = self._build_run_alias_request(
            capability_id=capability_id,
            repo_root=repo_root_text,
            argv=argv,
            command_text=normalized,
            operator_reason=operator_reason,
            timeout_seconds=timeout_seconds,
            expected_scope=expected_scope,
        )
        if alias_request is not None:
            return alias_request
        executable = self._normalize_executable(argv[0])

        if executable in _ALLOWED_PYTHON_EXECUTABLES:
            return self._build_python_run_request(
                capability_id=capability_id,
                repo_root=repo_root_text,
                argv=argv,
                command_text=normalized,
                operator_reason=operator_reason,
                timeout_seconds=timeout_seconds,
                expected_scope=expected_scope,
            )
        if executable == "pytest":
            return self._build_pytest_request(
                capability_id=capability_id,
                repo_root=repo_root_text,
                argv=argv,
                command_text=normalized,
                operator_reason=operator_reason,
                timeout_seconds=timeout_seconds,
                expected_scope=expected_scope,
            )
        raise ExecutionRunnerError(
            "command_prefix_not_allowed",
            "Only bounded Python test and approved smoke commands are allowed in /run right now.",
        )

    def _build_run_alias_request(
        self,
        *,
        capability_id: str,
        repo_root: str,
        argv: tuple[str, ...],
        command_text: str,
        operator_reason: str,
        timeout_seconds: float | None,
        expected_scope: str,
    ) -> LocalCommandExecutionRequest | None:
        alias = argv[0].strip().lower()
        entrypoint = _APPROVED_RUN_ALIAS_ENTRYPOINTS.get(alias)
        if entrypoint is None:
            return None
        if len(argv) > 2:
            raise ExecutionRunnerError(
                "run_alias_argument_count_not_allowed",
                "The main run alias accepts zero or one repo-local target argument only.",
            )
        repo_root_path = Path(repo_root)
        entrypoint_text = Path(*entrypoint).as_posix()
        tail = argv[1:]
        if tail:
            self._validate_repo_relative_path(tail[0], repo_root_path)
            target_path = (repo_root_path / Path(tail[0])).resolve()
            if not target_path.is_dir():
                raise ExecutionRunnerError(
                    "run_alias_entrypoint_missing",
                    f"Approved run alias 'main' is unavailable because {tail[0]}/src/main.py is missing in the configured repository root.",
                )
            if target_path == repo_root_path:
                entrypoint_text = Path(*entrypoint).as_posix()
            else:
                relative_target = target_path.relative_to(repo_root_path).as_posix()
                entrypoint_text = Path(relative_target, *entrypoint).as_posix()
        entrypoint_path = repo_root_path / Path(entrypoint_text)
        if not entrypoint_path.exists() or not entrypoint_path.is_file():
            raise ExecutionRunnerError(
                "run_alias_entrypoint_missing",
                f"Approved run alias 'main' is unavailable because {entrypoint_text} is missing in the configured repository root.",
            )
        command_summary = alias
        if tail:
            command_summary = f"{command_summary} {tail[0]}"
        return LocalCommandExecutionRequest(
            capability_id=capability_id,
            command_kind="run",
            command_family="python_script",
            command_text=command_text,
            command_summary=command_summary,
            working_directory=repo_root,
            timeout_seconds=self._resolve_timeout(timeout_seconds),
            operator_reason=operator_reason.strip(),
            expected_scope=expected_scope,
            argv=(sys.executable, entrypoint_text, *tail),
        )

    def build_test_request(
        self,
        *,
        capability_id: str,
        repo_root: str,
        target: str,
        operator_reason: str = "",
        timeout_seconds: float | None = None,
        expected_scope: str = "",
    ) -> LocalCommandExecutionRequest:
        repo_root_text = self._validate_repo_root(repo_root)
        normalized_target = self._normalize_target_text(target)
        tokens = self._split_command(normalized_target) if normalized_target else ()
        self._validate_target_tokens(tokens, Path(repo_root_text), allow_option_tokens=False)
        summary = "python -m unittest"
        if tokens:
            summary = f"{summary} {' '.join(tokens)}"
        return LocalCommandExecutionRequest(
            capability_id=capability_id,
            command_kind="test",
            command_family="unittest",
            command_text=summary,
            command_summary=summary,
            working_directory=repo_root_text,
            timeout_seconds=self._resolve_timeout(timeout_seconds),
            operator_reason=operator_reason.strip(),
            expected_scope=expected_scope,
            argv=(sys.executable, "-m", "unittest", *tokens),
        )

    def execute(self, request: LocalCommandExecutionRequest) -> LocalCommandExecutionResult:
        started = time.perf_counter()
        completed_at = datetime.now().astimezone().isoformat(timespec="seconds")
        try:
            completed = self._command_runner(request.argv, request.working_directory, request.timeout_seconds)
            stdout = self._normalize_output(completed.stdout)
            stderr = self._normalize_output(completed.stderr)
            exit_code = int(completed.returncode)
            timed_out = False
        except subprocess.TimeoutExpired as exc:
            stdout = self._normalize_output(exc.stdout)
            stderr = self._normalize_output(exc.stderr)
            exit_code = -1
            timed_out = True
        except FileNotFoundError as exc:
            raise ExecutionRunnerError("command_not_found", self._truncate_message(str(exc), limit=140)) from exc
        except OSError as exc:
            raise ExecutionRunnerError("command_execution_failed", self._truncate_message(str(exc), limit=140)) from exc

        duration_ms = max(0, int((time.perf_counter() - started) * 1000))
        output_summary, first_issue = self._summarize_result(
            request=request,
            stdout=stdout,
            stderr=stderr,
            exit_code=exit_code,
            timed_out=timed_out,
        )
        return LocalCommandExecutionResult(
            request=request,
            exit_code=exit_code,
            stdout=stdout,
            stderr=stderr,
            timed_out=timed_out,
            duration_ms=duration_ms,
            output_summary=output_summary,
            first_issue=first_issue,
            completed_at=completed_at,
        )

    def _build_python_run_request(
        self,
        *,
        capability_id: str,
        repo_root: str,
        argv: tuple[str, ...],
        command_text: str,
        operator_reason: str,
        timeout_seconds: float | None,
        expected_scope: str,
    ) -> LocalCommandExecutionRequest:
        repo_root_path = Path(repo_root)
        if len(argv) >= 3 and argv[1] == "-m" and argv[2] in {"unittest", "pytest"}:
            family = "unittest" if argv[2] == "unittest" else "pytest"
            tail = argv[3:]
            self._validate_target_tokens(tail, repo_root_path, allow_option_tokens=False)
            summary = f"python -m {argv[2]}"
            if tail:
                summary = f"{summary} {' '.join(tail)}"
            return LocalCommandExecutionRequest(
                capability_id=capability_id,
                command_kind="run",
                command_family=family,
                command_text=command_text,
                command_summary=summary,
                working_directory=repo_root,
                timeout_seconds=self._resolve_timeout(timeout_seconds),
                operator_reason=operator_reason.strip(),
                expected_scope=expected_scope,
                argv=(sys.executable, "-m", argv[2], *tail),
            )
        if len(argv) == 2:
            script_name = argv[1].replace("\\", "/")
            self._validate_repo_relative_path(script_name, repo_root_path)
            script_leaf = Path(script_name).name
            if script_leaf not in _ALLOWED_PYTHON_SCRIPTS:
                raise ExecutionRunnerError(
                    "python_script_not_allowed",
                    "Only approved repo-local validation and smoke scripts are allowed in /run right now.",
                )
            return LocalCommandExecutionRequest(
                capability_id=capability_id,
                command_kind="run",
                command_family="python_script",
                command_text=command_text,
                command_summary=f"python {script_name}",
                working_directory=repo_root,
                timeout_seconds=self._resolve_timeout(timeout_seconds),
                operator_reason=operator_reason.strip(),
                expected_scope=expected_scope,
                argv=(sys.executable, script_name),
            )
        raise ExecutionRunnerError(
            "unsupported_python_command",
            "Only python -m unittest, python -m pytest, or approved repo-local smoke scripts are allowed in /run right now.",
        )

    def _build_pytest_request(
        self,
        *,
        capability_id: str,
        repo_root: str,
        argv: tuple[str, ...],
        command_text: str,
        operator_reason: str,
        timeout_seconds: float | None,
        expected_scope: str,
    ) -> LocalCommandExecutionRequest:
        repo_root_path = Path(repo_root)
        tail = argv[1:]
        self._validate_target_tokens(tail, repo_root_path, allow_option_tokens=False)
        summary = "pytest"
        if tail:
            summary = f"{summary} {' '.join(tail)}"
        return LocalCommandExecutionRequest(
            capability_id=capability_id,
            command_kind="run",
            command_family="pytest",
            command_text=command_text,
            command_summary=summary,
            working_directory=repo_root,
            timeout_seconds=self._resolve_timeout(timeout_seconds),
            operator_reason=operator_reason.strip(),
            expected_scope=expected_scope,
            argv=(sys.executable, "-m", "pytest", *tail),
        )

    def _normalize_command_text(self, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ExecutionRunnerError("missing_command", "Provide a command after /run.")
        if len(normalized) > self._max_command_length:
            raise ExecutionRunnerError("command_too_long", "Command is too long for bounded Telegram execution.")
        if any(token in normalized for token in _BLOCKED_OPERATOR_TOKENS):
            raise ExecutionRunnerError("blocked_command_pattern", "Command contains blocked shell operators.")
        if "\n" in value or "\r" in value:
            raise ExecutionRunnerError("multiline_command_not_allowed", "Only single-line commands are allowed in /run.")
        return normalized

    def _normalize_target_text(self, value: str) -> str:
        if "\n" in value or "\r" in value:
            raise ExecutionRunnerError("multiline_target_not_allowed", "Only single-line test targets are allowed in /test.")
        normalized = " ".join(value.split())
        if len(normalized) > self._max_command_length:
            raise ExecutionRunnerError("target_too_long", "Test target is too long for bounded Telegram execution.")
        if any(token in normalized for token in _BLOCKED_OPERATOR_TOKENS):
            raise ExecutionRunnerError("blocked_command_pattern", "Test target contains blocked shell operators.")
        return normalized

    @staticmethod
    def _split_command(value: str) -> tuple[str, ...]:
        try:
            parts = tuple(shlex.split(value, posix=False))
        except ValueError as exc:
            raise ExecutionRunnerError("command_parse_failed", "Command could not be parsed safely.") from exc
        if not parts:
            raise ExecutionRunnerError("missing_command", "Provide a command to run.")
        return parts

    def _validate_target_tokens(self, tokens: tuple[str, ...], repo_root: Path, *, allow_option_tokens: bool) -> None:
        for token in tokens:
            normalized = token.strip()
            if not normalized:
                continue
            if not allow_option_tokens and normalized.startswith("-"):
                raise ExecutionRunnerError("command_option_not_allowed", "Options are blocked in this first-pass execution model.")
            if any(operator in normalized for operator in _BLOCKED_OPERATOR_TOKENS):
                raise ExecutionRunnerError("blocked_command_pattern", "Command contains blocked shell operators.")
            if "/" in normalized or "\\" in normalized or normalized.endswith(".py"):
                self._validate_repo_relative_path(normalized, repo_root)
            elif not re.fullmatch(r"[A-Za-z0-9_:.\-/]+", normalized):
                raise ExecutionRunnerError("command_token_not_allowed", f"Unsupported command token: {normalized}")

    @staticmethod
    def _validate_repo_relative_path(value: str, repo_root: Path) -> None:
        candidate = Path(value)
        if candidate.is_absolute():
            raise ExecutionRunnerError("absolute_path_not_allowed", "Absolute paths are not allowed for bounded execution.")
        resolved = (repo_root / candidate).resolve()
        try:
            resolved.relative_to(repo_root)
        except ValueError as exc:
            raise ExecutionRunnerError("target_path_not_allowed", "Command path escapes the approved repository scope.") from exc

    @staticmethod
    def _normalize_executable(value: str) -> str:
        return Path(value.strip().strip('"')).name.lower()

    def _resolve_timeout(self, timeout_seconds: float | None) -> float:
        if timeout_seconds is None:
            return self._default_timeout_seconds
        return max(5.0, float(timeout_seconds))

    @staticmethod
    def _validate_repo_root(repo_root: str) -> str:
        candidate = Path(repo_root.strip())
        if not candidate.is_absolute():
            raise ExecutionRunnerError("repo_root_not_absolute", "Repository root must be absolute for execution.")
        if not candidate.exists() or not candidate.is_dir():
            raise ExecutionRunnerError("repo_root_invalid", "Repository root is not available for execution.")
        return str(candidate.resolve())

    def _summarize_result(
        self,
        *,
        request: LocalCommandExecutionRequest,
        stdout: str,
        stderr: str,
        exit_code: int,
        timed_out: bool,
    ) -> tuple[str, str]:
        if timed_out:
            return f"Timed out after {request.timeout_seconds:.0f}s.", self._first_issue(stdout, stderr)
        if request.command_family == "unittest":
            return self._summarize_unittest(stdout=stdout, stderr=stderr, exit_code=exit_code)
        if request.command_family == "pytest":
            return self._summarize_pytest(stdout=stdout, stderr=stderr, exit_code=exit_code)
        if exit_code == 0:
            return self._truncate_message(self._first_content_line(stdout, stderr) or "Command completed successfully.", limit=120), ""
        first_issue = self._first_issue(stdout, stderr)
        return self._truncate_message(first_issue or "Command failed.", limit=120), first_issue

    def _summarize_unittest(self, *, stdout: str, stderr: str, exit_code: int) -> tuple[str, str]:
        ran_match = re.search(r"Ran (\d+) tests? in ([0-9.]+)s", stdout)
        failed_match = re.search(r"FAILED \(([^)]+)\)", stdout)
        issue_match = re.search(r"^(?:FAIL|ERROR):\s+(.+)$", stdout, re.MULTILINE)
        first_issue = self._truncate_message(issue_match.group(1), limit=120) if issue_match else ""
        if exit_code == 0 and ran_match:
            count, duration = ran_match.groups()
            noun = "test" if count == "1" else "tests"
            return f"{count} {noun} passed in {duration}s", ""
        if failed_match:
            return self._truncate_message(failed_match.group(1), limit=120), first_issue
        generic = self._first_content_line(stderr, stdout) or "Command failed."
        return self._truncate_message(generic, limit=120), first_issue or self._truncate_message(generic, limit=120)

    def _summarize_pytest(self, *, stdout: str, stderr: str, exit_code: int) -> tuple[str, str]:
        summary_match = None
        for line in reversed(stdout.splitlines()):
            compact = " ".join(line.split())
            if compact.startswith("=") and " in " in compact and any(word in compact for word in ("passed", "failed", "error", "skipped")):
                summary_match = compact.strip("= ")
                break
        issue_match = re.search(r"^FAILED\s+(.+)$", stdout, re.MULTILINE)
        first_issue = self._truncate_message(issue_match.group(1), limit=120) if issue_match else ""
        if summary_match:
            return self._truncate_message(summary_match, limit=120), first_issue
        generic = self._first_content_line(stderr, stdout) or ("pytest completed successfully." if exit_code == 0 else "pytest failed.")
        return self._truncate_message(generic, limit=120), first_issue or self._truncate_message(generic, limit=120)

    @staticmethod
    def _normalize_output(value: object) -> str:
        if value is None:
            return ""
        if isinstance(value, bytes):
            value = value.decode("utf-8", errors="replace")
        return str(value).replace("\r\n", "\n").replace("\r", "\n")

    @classmethod
    def _first_content_line(cls, first: str, second: str) -> str:
        for source in (first, second):
            for raw_line in source.splitlines():
                line = " ".join(raw_line.split())
                if line:
                    return cls._truncate_message(line, limit=120)
        return ""

    @classmethod
    def _first_issue(cls, stdout: str, stderr: str) -> str:
        return cls._first_content_line(stderr, stdout)

    @staticmethod
    def _truncate_message(value: str, *, limit: int) -> str:
        normalized = " ".join(value.split())
        if len(normalized) <= limit:
            return normalized
        truncated = normalized[: limit - 3].rstrip()
        if " " in truncated:
            truncated = truncated.rsplit(" ", 1)[0]
        return f"{truncated}..."

    @staticmethod
    def _default_command_runner(argv: tuple[str, ...], working_directory: str, timeout_seconds: float) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            list(argv),
            cwd=working_directory,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
        )