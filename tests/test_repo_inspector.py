from __future__ import annotations

import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from app.controller.repo_inspector import RepoInspector, RepoInspectorError


@unittest.skipIf(shutil.which("git") is None, "Git is required for repo inspector tests.")
class RepoInspectorTests(unittest.TestCase):
    def _run_git(self, repo_root: Path, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["git", *args],
            cwd=repo_root,
            capture_output=True,
            text=True,
            check=True,
        )

    def _create_repo(self) -> Path:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        repo_root = Path(temp_dir.name)
        self._run_git(repo_root, "init")
        self._run_git(repo_root, "config", "user.name", "Test User")
        self._run_git(repo_root, "config", "user.email", "test@example.com")
        (repo_root / "README.md").write_text("hello repo\n", encoding="utf-8")
        self._run_git(repo_root, "add", "README.md")
        self._run_git(repo_root, "commit", "-m", "Initial commit")
        return repo_root

    def test_inspect_valid_repo_returns_branch_status_and_commits(self) -> None:
        repo_root = self._create_repo()
        (repo_root / "README.md").write_text("hello repo\nchange\n", encoding="utf-8")

        inspector = RepoInspector(timeout_seconds=4.0)
        snapshot = inspector.inspect(str(repo_root))

        self.assertEqual(snapshot.repo_root, str(repo_root.resolve()))
        self.assertEqual(snapshot.repo_name, repo_root.name)
        self.assertTrue(snapshot.branch)
        self.assertTrue(snapshot.is_dirty)
        self.assertGreaterEqual(snapshot.changed_count, 1)
        self.assertIn("README.md", snapshot.changed_paths)
        self.assertTrue(snapshot.recent_commits)
        self.assertIn("Initial commit", snapshot.recent_commits[0])
        self.assertIn(snapshot.repo_name, snapshot.audit_summary)

    def test_invalid_repo_path_fails_cleanly(self) -> None:
        inspector = RepoInspector()
        missing_path = str((Path(tempfile.gettempdir()) / "repo-inspector-missing-path").resolve())
        with self.assertRaises(RepoInspectorError) as context:
            inspector.inspect(missing_path)
        self.assertEqual(context.exception.code, "repo_not_found")
        self.assertEqual(context.exception.message, "Repository not found at configured path.")

    def test_non_git_directory_fails_cleanly(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            inspector = RepoInspector()
            with self.assertRaises(RepoInspectorError) as context:
                inspector.inspect(str(Path(tmp).resolve()))
            self.assertEqual(context.exception.code, "not_git_repository")
            self.assertEqual(context.exception.message, "Not a valid git repository.")


if __name__ == "__main__":
    unittest.main()
