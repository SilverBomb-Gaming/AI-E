"""Read-only repository inspection for the operator console."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import subprocess
from typing import Callable


@dataclass(frozen=True)
class RepoInspectionSnapshot:
    repo_root: str
    repo_name: str
    branch: str
    is_dirty: bool
    changed_count: int
    recent_commits: tuple[str, ...]
    inspected_at: str
    changed_paths: tuple[str, ...] = ()

    @property
    def status_label(self) -> str:
        if not self.is_dirty:
            return "Clean"
        noun = "change" if self.changed_count == 1 else "changes"
        return f"Dirty ({self.changed_count} {noun})"

    @property
    def audit_summary(self) -> str:
        return f"{self.repo_name} | {self.branch} | {self.status_label}"


class RepoInspectorError(RuntimeError):
    """Structured repository inspection error."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


_CommandRunner = Callable[[list[str], str | None, float], subprocess.CompletedProcess[str]]


class RepoInspector:
    """Inspect a single repository through fixed, read-only git commands."""

    def __init__(self, command_runner: _CommandRunner | None = None, *, timeout_seconds: float = 6.0) -> None:
        self._command_runner = command_runner or self._default_command_runner
        self._timeout_seconds = timeout_seconds

    def inspect(self, repo_root: str, *, commit_limit: int = 5) -> RepoInspectionSnapshot:
        root_path = self._validate_repo_root(repo_root)
        repo_root_text = str(root_path)
        repo_name = self._sanitize_text(root_path.name or repo_root_text, limit=48)

        self._run_git(["--version"])
        try:
            work_tree = self._run_git(["rev-parse", "--is-inside-work-tree"], repo_root=repo_root_text)
        except RepoInspectorError as exc:
            if exc.code == "git_command_failed" and "not a git repository" in exc.message.lower():
                raise RepoInspectorError("not_git_repository", "Not a valid git repository.") from exc
            raise
        if work_tree.stdout.strip().lower() != "true":
            raise RepoInspectorError("not_git_repository", "Not a valid git repository.")

        branch_result = self._run_git(["branch", "--show-current"], repo_root=repo_root_text)
        branch = self._sanitize_text(branch_result.stdout.strip(), limit=64)
        if not branch:
            detached = self._run_git(["rev-parse", "--short", "HEAD"], repo_root=repo_root_text)
            detached_ref = self._sanitize_text(detached.stdout.strip(), limit=16)
            branch = f"detached@{detached_ref}" if detached_ref else "detached"

        status_result = self._run_git(["status", "--short", "--untracked-files=all"], repo_root=repo_root_text)
        status_lines = [line for line in status_result.stdout.splitlines() if line.strip()]
        changed_count = len(status_lines)
        changed_paths = tuple(
            parsed_path
            for parsed_path in (self._parse_changed_path(line) for line in status_lines)
            if parsed_path
        )

        commits = self._read_recent_commits(repo_root_text, limit=max(1, min(commit_limit, 5)))
        return RepoInspectionSnapshot(
            repo_root=repo_root_text,
            repo_name=repo_name,
            branch=branch,
            is_dirty=changed_count > 0,
            changed_count=changed_count,
            recent_commits=commits,
            inspected_at=datetime.now().astimezone().isoformat(timespec="seconds"),
            changed_paths=changed_paths,
        )

    def _read_recent_commits(self, repo_root: str, *, limit: int) -> tuple[str, ...]:
        try:
            result = self._run_git(["log", "--oneline", "--no-decorate", "-n", str(limit)], repo_root=repo_root)
        except RepoInspectorError as exc:
            if exc.code == "git_command_failed" and "does not have any commits yet" in exc.message.lower():
                return ()
            raise
        commits: list[str] = []
        for raw_line in result.stdout.splitlines():
            line = self._sanitize_text(raw_line, limit=88)
            if line:
                commits.append(line)
        return tuple(commits)

    def _run_git(self, args: list[str], *, repo_root: str | None = None) -> subprocess.CompletedProcess[str]:
        try:
            result = self._command_runner(list(args), repo_root, self._timeout_seconds)
        except FileNotFoundError as exc:
            raise RepoInspectorError("git_not_installed", "Git is not installed or not available on PATH.") from exc
        except subprocess.TimeoutExpired as exc:
            raise RepoInspectorError("repo_inspection_timeout", "Repository inspection timed out.") from exc
        except OSError as exc:
            raise RepoInspectorError("git_command_failed", self._sanitize_text(str(exc), limit=120)) from exc

        if result.returncode == 0:
            return result

        message = self._sanitize_text(result.stderr or result.stdout or "Git command failed.", limit=120)
        raise RepoInspectorError("git_command_failed", message)

    @staticmethod
    def _default_command_runner(args: list[str], repo_root: str | None, timeout_seconds: float) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["git", *args],
            cwd=repo_root or None,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
        )

    @staticmethod
    def _validate_repo_root(repo_root: str) -> Path:
        value = repo_root.strip()
        if not value:
            raise RepoInspectorError("repo_root_missing", "Repository root is not configured.")
        candidate = Path(value)
        if not candidate.is_absolute():
            raise RepoInspectorError("repo_root_not_absolute", "Repository root must be an absolute path.")
        if not candidate.exists():
            raise RepoInspectorError("repo_not_found", "Repository not found at configured path.")
        if not candidate.is_dir():
            raise RepoInspectorError("repo_root_not_directory", "Repository root is not a directory.")
        return candidate.resolve()

    @staticmethod
    def _sanitize_text(value: str, *, limit: int) -> str:
        normalized = " ".join(value.split())
        if len(normalized) <= limit:
            return normalized
        truncated = normalized[: limit - 3].rstrip()
        if " " in truncated:
            truncated = truncated.rsplit(" ", 1)[0]
        return f"{truncated}..."

    @staticmethod
    def _parse_changed_path(status_line: str) -> str:
        if len(status_line) < 4:
            return ""
        candidate = status_line[3:].strip()
        if " -> " in candidate:
            candidate = candidate.split(" -> ", 1)[1].strip()
        return candidate.replace("\\", "/")
