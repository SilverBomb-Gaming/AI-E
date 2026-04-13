"""Bounded git commit execution for validated feature bundles."""
from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
import subprocess
from typing import Callable


@dataclass(frozen=True)
class FeatureBundleCommitExecutionResult:
    branch: str
    commit_sha: str
    commit_message: str
    committed_paths: tuple[str, ...]
    commit_output: str


class FeatureBundleCommitError(RuntimeError):
    """Structured bounded commit failure."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


_CommandRunner = Callable[[list[str], str | None, float], subprocess.CompletedProcess[str]]


class FeatureBundleCommitExecutor:
    """Revalidate and commit an approved set of repo-local paths."""

    def __init__(self, command_runner: _CommandRunner | None = None, *, timeout_seconds: float = 12.0) -> None:
        self._command_runner = command_runner or self._default_command_runner
        self._timeout_seconds = max(4.0, float(timeout_seconds))

    def scope_fingerprint(self, repo_root: str, *, paths: tuple[str, ...]) -> str:
        root = self._validate_repo_root(repo_root)
        normalized_paths = self._normalize_paths(paths)
        if not normalized_paths:
            return ""
        branch = self._current_branch(str(root))
        status_output = self._run_git(["status", "--short", "--untracked-files=all", "--", *normalized_paths], repo_root=str(root)).stdout
        diff_output = self._run_git(["diff", "--no-ext-diff", "--no-color", "--", *normalized_paths], repo_root=str(root)).stdout
        cached_output = self._run_git(["diff", "--cached", "--no-ext-diff", "--no-color", "--", *normalized_paths], repo_root=str(root)).stdout
        payload = "\n".join(
            (
                branch,
                "|".join(normalized_paths),
                status_output,
                diff_output,
                cached_output,
            )
        )
        return sha256(payload.encode("utf-8")).hexdigest()

    def commit_paths(
        self,
        repo_root: str,
        *,
        paths: tuple[str, ...],
        commit_message: str,
        expected_branch: str,
    ) -> FeatureBundleCommitExecutionResult:
        root = self._validate_repo_root(repo_root)
        normalized_paths = self._normalize_paths(paths)
        if not normalized_paths:
            raise FeatureBundleCommitError("feature_commit_paths_missing", "No approved milestone paths were supplied for commit execution.")
        branch = self._current_branch(str(root))
        if expected_branch.strip() and branch != expected_branch.strip():
            raise FeatureBundleCommitError(
                "feature_commit_branch_changed",
                f"Branch changed from {expected_branch.strip()} to {branch}; refresh the preview before committing.",
            )
        scoped_status = self._run_git(["status", "--short", "--untracked-files=all", "--", *normalized_paths], repo_root=str(root)).stdout
        if not scoped_status.strip():
            raise FeatureBundleCommitError(
                "feature_commit_scope_clean",
                "Approved milestone paths no longer have changes; refresh the preview before committing.",
            )
        self._run_git(["add", "--", *normalized_paths], repo_root=str(root))
        staged_output = self._run_git(["diff", "--cached", "--name-only", "--", *normalized_paths], repo_root=str(root)).stdout
        staged_paths = self._normalize_paths(tuple(line.strip() for line in staged_output.splitlines() if line.strip()))
        if staged_paths != normalized_paths:
            raise FeatureBundleCommitError(
                "feature_commit_stage_mismatch",
                "Approved milestone paths changed while staging; refresh the preview before committing.",
            )
        before_head = self._run_git(["rev-parse", "--short", "HEAD"], repo_root=str(root)).stdout.strip()
        commit_result = self._run_git(
            ["commit", "--only", "-m", commit_message, "--", *normalized_paths],
            repo_root=str(root),
        )
        after_head = self._run_git(["rev-parse", "--short", "HEAD"], repo_root=str(root)).stdout.strip()
        if not after_head or after_head == before_head:
            raise FeatureBundleCommitError(
                "feature_commit_no_new_head",
                "Git did not advance HEAD for the bounded milestone commit.",
            )
        commit_output = (commit_result.stdout or commit_result.stderr or "Commit completed.").strip()
        return FeatureBundleCommitExecutionResult(
            branch=branch,
            commit_sha=after_head,
            commit_message=commit_message.strip(),
            committed_paths=normalized_paths,
            commit_output=commit_output,
        )

    def _current_branch(self, repo_root: str) -> str:
        self._run_git(["--version"])
        inside = self._run_git(["rev-parse", "--is-inside-work-tree"], repo_root=repo_root).stdout.strip().lower()
        if inside != "true":
            raise FeatureBundleCommitError("feature_commit_not_git_repo", "Configured repository root is not a valid git working tree.")
        branch_result = self._run_git(["branch", "--show-current"], repo_root=repo_root).stdout.strip()
        if branch_result:
            return branch_result
        detached = self._run_git(["rev-parse", "--short", "HEAD"], repo_root=repo_root).stdout.strip()
        return f"detached@{detached}" if detached else "detached"

    def _run_git(self, args: list[str], *, repo_root: str | None = None) -> subprocess.CompletedProcess[str]:
        try:
            result = self._command_runner(list(args), repo_root, self._timeout_seconds)
        except FileNotFoundError as exc:
            raise FeatureBundleCommitError("feature_commit_git_missing", "Git is not installed or not available on PATH.") from exc
        except subprocess.TimeoutExpired as exc:
            raise FeatureBundleCommitError("feature_commit_timeout", "Bounded commit execution timed out.") from exc
        except OSError as exc:
            raise FeatureBundleCommitError("feature_commit_failed", self._sanitize_text(str(exc), limit=160)) from exc
        if result.returncode == 0:
            return result
        message = self._sanitize_text(result.stderr or result.stdout or "Git command failed.", limit=160)
        if "nothing to commit" in message.lower() or "no changes added to commit" in message.lower():
            raise FeatureBundleCommitError("feature_commit_scope_clean", "Approved milestone paths no longer produce a bounded commit.")
        raise FeatureBundleCommitError("feature_commit_failed", message)

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
            raise FeatureBundleCommitError("feature_commit_repo_root_missing", "Repository root is not configured.")
        candidate = Path(value)
        if not candidate.is_absolute():
            raise FeatureBundleCommitError("feature_commit_repo_root_not_absolute", "Repository root must be an absolute path.")
        if not candidate.exists():
            raise FeatureBundleCommitError("feature_commit_repo_not_found", "Repository not found at configured path.")
        if not candidate.is_dir():
            raise FeatureBundleCommitError("feature_commit_repo_root_not_directory", "Repository root is not a directory.")
        return candidate.resolve()

    @staticmethod
    def _normalize_paths(paths: tuple[str, ...]) -> tuple[str, ...]:
        normalized: list[str] = []
        seen: set[str] = set()
        for raw_path in paths:
            cleaned = raw_path.replace("\\", "/").strip()
            if not cleaned or cleaned in seen:
                continue
            normalized.append(cleaned)
            seen.add(cleaned)
        return tuple(normalized)

    @staticmethod
    def _sanitize_text(value: str, *, limit: int) -> str:
        normalized = " ".join(value.split())
        if len(normalized) <= limit:
            return normalized
        return f"{normalized[: limit - 3].rstrip()}..."