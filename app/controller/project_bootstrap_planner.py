"""Deterministic phase-1 starter scaffold planning derived from intent and build plans."""
from __future__ import annotations

from pathlib import Path
import re

from .build_plan_models import BuildPlan
from .intent_models import IntentTranslationSession
from .project_bootstrap_models import ProjectBootstrapFileSpec, ProjectBootstrapProposal, ProjectBootstrapType


class ProjectBootstrapPlannerError(RuntimeError):
    """Structured, user-safe bootstrap planning error."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class ProjectBootstrapPlanner:
    """Build explicit, reviewable phase-1 scaffold proposals for supported Python projects."""

    def build_proposal(
        self,
        session: IntentTranslationSession,
        plan: BuildPlan,
        *,
        bootstrap_id: str,
        created_at: str,
        repo_root: str = "",
    ) -> ProjectBootstrapProposal:
        project_type = self._classify_project_type(session=session, plan=plan)
        title = (plan.title or session.current_spec.title or "Starter Project").strip()
        package_name = self._package_name(repo_root=repo_root, title=title)
        files = self._build_files(project_type=project_type, title=title, package_name=package_name)
        follow_up_commands = self._follow_up_commands(project_type)
        return ProjectBootstrapProposal(
            bootstrap_id=bootstrap_id,
            translation_session_id=session.translation_session_id,
            plan_id=plan.plan_id,
            intent_id=session.intent_id,
            project_type=project_type,
            title=title,
            summary=f"Minimal {project_type} starter scaffold for {title}.",
            files=files,
            follow_up_commands=follow_up_commands,
            warnings=(),
            next_step="Approve with /bootstrapapprove or discard with /bootstrapreset.",
            created_at=created_at,
            updated_at=created_at,
        )

    def _classify_project_type(self, *, session: IntentTranslationSession, plan: BuildPlan) -> ProjectBootstrapType:
        request_type = plan.request_type or session.current_spec.request_type
        combined = self._combined_text(session=session, plan=plan)
        has_python = any(marker in combined for marker in ("python", "pyside6", "py side6"))
        if request_type == "desktop_app":
            if "pyside6" in combined or "py side6" in combined:
                return "desktop_app"
            raise ProjectBootstrapPlannerError(
                "unsupported_desktop_stack",
                "Phase 1 desktop app bootstrap currently supports PySide6 only.",
            )
        if any(marker in combined for marker in ("library", "package", "sdk", "module")) and has_python:
            return "simple_library"
        if any(marker in combined for marker in ("command line", "command-line", " cli", "terminal tool", "console app")) and has_python:
            return "python_cli"
        if request_type == "automation_tool" and has_python:
            return "python_script"
        if "script" in combined and has_python:
            return "python_script"
        raise ProjectBootstrapPlannerError(
            "unsupported_bootstrap_type",
            "Phase 1 bootstrap supports python_script, python_cli, desktop_app (PySide6), and simple_library only.",
        )

    def _combined_text(self, *, session: IntentTranslationSession, plan: BuildPlan) -> str:
        values = [
            session.source_request,
            session.current_spec.title,
            session.current_spec.summary,
            session.current_spec.product_goal.what,
            session.current_spec.product_goal.who,
            session.current_spec.product_goal.why,
            session.current_spec.delivery_target,
            session.profile.platform,
            session.profile.stack,
            plan.title,
            plan.summary,
            " ".join(session.current_spec.constraints),
            " ".join(session.current_spec.functional_requirements),
            " ".join(session.current_spec.confirmed_values),
        ]
        return " ".join(value for value in values if value).lower()

    def _build_files(
        self,
        *,
        project_type: ProjectBootstrapType,
        title: str,
        package_name: str,
    ) -> tuple[ProjectBootstrapFileSpec, ...]:
        if project_type == "python_script":
            return (
                ProjectBootstrapFileSpec("./README.md", "document the starter scaffold", self._script_readme(title)),
                ProjectBootstrapFileSpec("./main.py", "add the bounded starter script entrypoint", self._script_main(title)),
            )
        if project_type == "python_cli":
            return (
                ProjectBootstrapFileSpec("./README.md", "document the starter scaffold", self._cli_readme(title)),
                ProjectBootstrapFileSpec("./main.py", "add the bounded CLI entrypoint", self._cli_main(title)),
            )
        if project_type == "desktop_app":
            return (
                ProjectBootstrapFileSpec("./README.md", "document the starter scaffold", self._desktop_readme(title)),
                ProjectBootstrapFileSpec("./requirements.txt", "declare the explicit desktop dependency", "PySide6>=6.7,<7.0\n"),
                ProjectBootstrapFileSpec("./main.py", "add the bounded PySide6 desktop entrypoint", self._desktop_main(title)),
            )
        return (
            ProjectBootstrapFileSpec("./README.md", "document the starter scaffold", self._library_readme(title, package_name)),
            ProjectBootstrapFileSpec("./pyproject.toml", "declare the bounded library package metadata", self._library_pyproject(title, package_name)),
            ProjectBootstrapFileSpec(f"./{package_name}/__init__.py", "add the starter package module", self._library_init(title)),
            ProjectBootstrapFileSpec("./tests/test_smoke.py", "add the starter library smoke test", self._library_test(package_name)),
        )

    @staticmethod
    def _follow_up_commands(project_type: ProjectBootstrapType) -> tuple[str, ...]:
        if project_type == "python_script":
            return ("/file ./main.py", "/run python main.py")
        if project_type == "python_cli":
            return ("/file ./main.py", "/run python main.py --help")
        if project_type == "desktop_app":
            return ("/file ./main.py", "/run python main.py")
        return ("/file ./tests/test_smoke.py", "/test tests/test_smoke.py")

    @staticmethod
    def _package_name(*, repo_root: str, title: str) -> str:
        candidate = Path(repo_root).name.strip() if repo_root.strip() else title
        normalized = re.sub(r"[^a-zA-Z0-9]+", "_", candidate).strip("_").lower()
        if not normalized:
            normalized = "starter_lib"
        if normalized[0].isdigit():
            normalized = f"project_{normalized}"
        return normalized

    @staticmethod
    def _py_string(value: str) -> str:
        return value.replace("\\", "\\\\").replace('"', '\\"')

    def _script_readme(self, title: str) -> str:
        return "\n".join(
            (
                f"# {title}",
                "",
                "Bounded phase-1 bootstrap for a Python script.",
                "",
                "## Run",
                "python main.py",
            )
        )

    def _script_main(self, title: str) -> str:
        return "\n".join(
            (
                "def main() -> None:",
                f"    print(\"Hello from {self._py_string(title)}.\")",
                "",
                "",
                "if __name__ == \"__main__\":",
                "    main()",
            )
        )

    def _cli_readme(self, title: str) -> str:
        return "\n".join(
            (
                f"# {title}",
                "",
                "Bounded phase-1 bootstrap for a Python CLI.",
                "",
                "## Run",
                "python main.py --help",
            )
        )

    def _cli_main(self, title: str) -> str:
        escaped = self._py_string(title)
        return "\n".join(
            (
                "import argparse",
                "",
                "",
                "def build_parser() -> argparse.ArgumentParser:",
                f"    parser = argparse.ArgumentParser(description=\"{escaped}\")",
                '    parser.add_argument("--name", default="operator", help="Name to greet.")',
                "    return parser",
                "",
                "",
                "def main() -> None:",
                "    args = build_parser().parse_args()",
                f"    print(f\"Hello, {{args.name}}. {escaped} is ready.\")",
                "",
                "",
                "if __name__ == \"__main__\":",
                "    main()",
            )
        )

    def _desktop_readme(self, title: str) -> str:
        return "\n".join(
            (
                f"# {title}",
                "",
                "Bounded phase-1 bootstrap for a PySide6 desktop app.",
                "",
                "## Install",
                "pip install -r requirements.txt",
                "",
                "## Run",
                "python main.py",
            )
        )

    def _desktop_main(self, title: str) -> str:
        escaped = self._py_string(title)
        return "\n".join(
            (
                "from PySide6.QtWidgets import QApplication, QLabel, QMainWindow",
                "",
                "",
                "def main() -> int:",
                "    app = QApplication([])",
                "    window = QMainWindow()",
                f"    window.setWindowTitle(\"{escaped}\")",
                f"    window.setCentralWidget(QLabel(\"{escaped} bootstrap ready\"))",
                "    window.resize(480, 240)",
                "    window.show()",
                "    return app.exec()",
                "",
                "",
                "if __name__ == \"__main__\":",
                "    raise SystemExit(main())",
            )
        )

    def _library_readme(self, title: str, package_name: str) -> str:
        return "\n".join(
            (
                f"# {title}",
                "",
                f"Bounded phase-1 bootstrap for the `{package_name}` Python library.",
                "",
                "## Test",
                "pytest tests/test_smoke.py",
            )
        )

    def _library_pyproject(self, title: str, package_name: str) -> str:
        escaped_title = title.replace('"', "'")
        return "\n".join(
            (
                "[build-system]",
                'requires = ["setuptools>=68"]',
                'build-backend = "setuptools.build_meta"',
                "",
                "[project]",
                f'name = "{package_name.replace("_", "-")}"',
                'version = "0.1.0"',
                f'description = "Starter library bootstrap for {escaped_title}."',
                'requires-python = ">=3.11"',
            )
        )

    def _library_init(self, title: str) -> str:
        escaped = self._py_string(title)
        return "\n".join(
            (
                f'"""Starter package for {escaped}."""',
                "",
                "",
                "def hello(name: str = \"world\") -> str:",
                "    return f\"hello, {name}\"",
            )
        )

    @staticmethod
    def _library_test(package_name: str) -> str:
        return "\n".join(
            (
                f"from {package_name} import hello",
                "",
                "",
                "def test_hello() -> None:",
                '    assert hello("operator") == "hello, operator"',
            )
        )