"""Bounded git push execution for confirmed feature-bundle commits."""
from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
import subprocess
from typing import Callable


@dataclass(frozen=True)
class FeatureBundlePushExecutionResult:
    branch: str
    remote_name: str
    pushed_commit: str
    command_text: str
    push_output: str


class FeatureBundlePushError(RuntimeError):
    """Structured bounded push failure."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


_CommandRunner = Callable[[list[str], str | None, float], subprocess.CompletedProcess[str]]


class FeatureBundlePushExecutor:
    """Revalidate and push one approved branch to one approved remote."""

    def __init__(self, command_runner: _CommandRunner | None = None, *, timeout_seconds: float = 15.0) -> None:
        self._command_runner = command_runner or self._default_command_runner
        self._timeout_seconds = max(4.0, float(timeout_seconds))

    def repo_status_fingerprint(self, repo_root: str) -> str:
        root = self._validate_repo_root(repo_root)
        branch = self._current_branch(str(root), allow_detached=True)
        head_commit = self._run_git(["rev-parse", "--short", "HEAD"], repo_root=str(root)).stdout.strip()
        status_output = self._run_git(["status", "--short", "--untracked-files=all"], repo_root=str(root)).stdout
        payload = "\n".join((branch, head_commit, status_output))
        return sha256(payload.encode("utf-8")).hexdigest()

    @staticmethod
    def build_push_command(*, remote_name: str, branch: str) -> str:
        return f"git push -u {remote_name.strip()} {branch.strip()}"

    def push_branch(
        self,
        repo_root: str,
        *,
        expected_branch: str,
        expected_commit: str,
        expected_status_fingerprint: str,
        remote_name: str,
    ) -> FeatureBundlePushExecutionResult:
        root = self._validate_repo_root(repo_root)
        branch, head_commit = self._validate_push_target(
            str(root),
            expected_branch=expected_branch,
            expected_commit=expected_commit,
            expected_status_fingerprint=expected_status_fingerprint,
            remote_name=remote_name,
        )
        command_text = self.build_push_command(remote_name=remote_name, branch=branch)
        push_result = self._run_git(["push", "-u", remote_name.strip(), branch], repo_root=str(root))
        push_output = (push_result.stdout or push_result.stderr or "Push completed.").strip()
        return FeatureBundlePushExecutionResult(
            branch=branch,
            remote_name=remote_name.strip(),
            pushed_commit=head_commit,
            command_text=command_text,
            push_output=push_output,
        )

    def validate_push_readiness(
        self,
        repo_root: str,
        *,
        expected_branch: str,
        expected_commit: str,
        expected_status_fingerprint: str,
        remote_name: str,
    ) -> tuple[str, str, str]:
        root = self._validate_repo_root(repo_root)
        branch, head_commit = self._validate_push_target(
            str(root),
            expected_branch=expected_branch,
            expected_commit=expected_commit,
            expected_status_fingerprint=expected_status_fingerprint,
            remote_name=remote_name,
        )
        command_text = self.build_push_command(remote_name=remote_name, branch=branch)
        return branch, head_commit, command_text

    def _validate_push_target(
        self,
        repo_root: str,
        *,
        expected_branch: str,
        expected_commit: str,
        expected_status_fingerprint: str,
        remote_name: str,
    ) -> tuple[str, str]:
        self._run_git(["--version"])
        branch = self._current_branch(repo_root)
        normalized_expected_branch = expected_branch.strip()
        if normalized_expected_branch and branch != normalized_expected_branch:
            raise FeatureBundlePushError(
                "feature_push_branch_changed",
                f"Branch changed from {normalized_expected_branch} to {branch}; refresh the push preview before pushing.",
            )
        self._run_git(["check-ref-format", "--branch", branch], repo_root=repo_root)
        expected_commit_text = expected_commit.strip()
        if not expected_commit_text:
            raise FeatureBundlePushError("feature_push_commit_missing", "No committed milestone receipt is available to push.")
        self._run_git(["cat-file", "-e", f"{expected_commit_text}^{{commit}}"], repo_root=repo_root)
        head_commit = self._run_git(["rev-parse", "--short", "HEAD"], repo_root=repo_root).stdout.strip()
        if head_commit != expected_commit_text:
            raise FeatureBundlePushError(
                "feature_push_head_mismatch",
                f"HEAD changed from {expected_commit_text} to {head_commit}; refresh the push preview before pushing.",
            )
        git_dir = self._git_dir(repo_root)
        if (git_dir / "MERGE_HEAD").exists():
            raise FeatureBundlePushError("feature_push_merge_in_progress", "A merge is in progress; resolve it before pushing.")
        if (git_dir / "rebase-merge").exists() or (git_dir / "rebase-apply").exists():
            raise FeatureBundlePushError("feature_push_rebase_in_progress", "A rebase is in progress; finish it before pushing.")
        status_output = self._run_git(["status", "--short", "--untracked-files=all"], repo_root=repo_root).stdout
        status_lines = [line for line in status_output.splitlines() if line.strip()]
        if any(self._is_conflict_status(line) for line in status_lines):
            raise FeatureBundlePushError("feature_push_conflicted_state", "The repository has unresolved conflicts; resolve them before pushing.")
        remotes = tuple(line.strip() for line in self._run_git(["remote"], repo_root=repo_root).stdout.splitlines() if line.strip())
        normalized_remote = remote_name.strip()
        if normalized_remote not in remotes:
            raise FeatureBundlePushError(
                "feature_push_remote_missing",
                f"Remote {normalized_remote or '[missing]'} is not configured for this repository.",
            )
        current_fingerprint = self.repo_status_fingerprint(repo_root)
        if expected_status_fingerprint.strip() and current_fingerprint != expected_status_fingerprint.strip():
            raise FeatureBundlePushError(
                "feature_push_drifted",
                "Repository state changed after commit execution; refresh the push preview before pushing.",
            )
        return branch, head_commit

    def _current_branch(self, repo_root: str, *, allow_detached: bool = False) -> str:
        inside = self._run_git(["rev-parse", "--is-inside-work-tree"], repo_root=repo_root).stdout.strip().lower()
        if inside != "true":
            raise FeatureBundlePushError("feature_push_not_git_repo", "Configured repository root is not a valid git working tree.")
        branch = self._run_git(["branch", "--show-current"], repo_root=repo_root).stdout.strip()
        if branch:
            return branch
        if allow_detached:
            detached = self._run_git(["rev-parse", "--short", "HEAD"], repo_root=repo_root).stdout.strip()
            return f"detached@{detached}" if detached else "detached"
        raise FeatureBundlePushError("feature_push_detached_head", "Detached HEAD cannot be pushed through the bounded operator.")

    def _git_dir(self, repo_root: str) -> Path:
        raw_git_dir = self._run_git(["rev-parse", "--git-dir"], repo_root=repo_root).stdout.strip()
        if not raw_git_dir:
            raise FeatureBundlePushError("feature_push_git_dir_missing", "Git metadata directory could not be resolved.")
        candidate = Path(raw_git_dir)
        if not candidate.is_absolute():
            candidate = (Path(repo_root) / candidate).resolve()
        return candidate.resolve()

    def _run_git(self, args: list[str], *, repo_root: str | None = None) -> subprocess.CompletedProcess[str]:
        try:
            result = self._command_runner(list(args), repo_root, self._timeout_seconds)
        except FileNotFoundError as exc:
            raise FeatureBundlePushError("feature_push_git_missing", "Git is not installed or not available on PATH.") from exc
        except subprocess.TimeoutExpired as exc:
            raise FeatureBundlePushError("feature_push_timeout", "Bounded push execution timed out.") from exc
        except OSError as exc:
            raise FeatureBundlePushError("feature_push_failed", self._sanitize_text(str(exc), limit=160)) from exc
        if result.returncode == 0:
            return result
        message = self._sanitize_text(result.stderr or result.stdout or "Git command failed.", limit=160)
        raise FeatureBundlePushError("feature_push_failed", message)

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
            raise FeatureBundlePushError("feature_push_repo_root_missing", "Repository root is not configured.")
        candidate = Path(value)
        if not candidate.is_absolute():
            raise FeatureBundlePushError("feature_push_repo_root_not_absolute", "Repository root must be an absolute path.")
        if not candidate.exists():
            raise FeatureBundlePushError("feature_push_repo_not_found", "Repository not found at configured path.")
        if not candidate.is_dir():
            raise FeatureBundlePushError("feature_push_repo_root_not_directory", "Repository root is not a directory.")
        return candidate.resolve()

    @staticmethod
    def _is_conflict_status(status_line: str) -> bool:
        if len(status_line) < 2:
            return False
        xy = status_line[:2]
        return "U" in xy or xy in {"AA", "DD"}

    @staticmethod
    def _sanitize_text(value: str, *, limit: int) -> str:
        normalized = " ".join(value.split())
        if len(normalized) <= limit:
            return normalized
        return f"{normalized[: limit - 3].rstrip()}..."