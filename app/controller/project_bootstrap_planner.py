"""Deterministic phase-1 starter scaffold planning derived from intent and build plans."""
from __future__ import annotations

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
        title = (plan.title or session.current_spec.title or "Project").strip() or "Project"
        files = self._build_files(project_type=project_type)
        follow_up_commands = self._follow_up_commands(project_type)
        source_intent_summary = (session.current_spec.summary or session.source_request or title).strip()
        return ProjectBootstrapProposal(
            bootstrap_id=bootstrap_id,
            translation_session_id=session.translation_session_id,
            plan_id=plan.plan_id,
            intent_id=session.intent_id,
            project_type=project_type,
            title=title,
            summary=f"Minimal {project_type} starter scaffold.",
            source_intent_summary=source_intent_summary,
            files=files,
            follow_up_commands=follow_up_commands,
            warnings=(),
            next_step="Use /bootstrapapprove to execute.",
            created_at=created_at,
            updated_at=created_at,
        )

    def _classify_project_type(self, *, session: IntentTranslationSession, plan: BuildPlan) -> ProjectBootstrapType:
        combined = self._combined_text(session=session, plan=plan)
        if any(marker in combined for marker in ("cli", "command line", "command-line", "args")):
            return "python_cli"
        if any(marker in combined for marker in ("desktop", "gui", "window", "pyside")):
            return "desktop_app"
        if any(marker in combined for marker in ("library", "module", "package")):
            return "simple_library"
        return "python_script"

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

    def _build_files(self, *, project_type: ProjectBootstrapType) -> tuple[ProjectBootstrapFileSpec, ...]:
        if project_type == "python_script":
            return (
                ProjectBootstrapFileSpec("main.py", "starter entrypoint", self._script_main()),
            )
        if project_type == "python_cli":
            return (
                ProjectBootstrapFileSpec("README.md", "project overview", self._cli_readme()),
                ProjectBootstrapFileSpec("src/main.py", "CLI entrypoint", self._cli_main()),
            )
        if project_type == "desktop_app":
            return (
                ProjectBootstrapFileSpec("README.md", "project overview", self._desktop_readme()),
                ProjectBootstrapFileSpec("main.py", "desktop entrypoint", self._desktop_main()),
            )
        return (
            ProjectBootstrapFileSpec("README.md", "project overview", self._library_readme()),
            ProjectBootstrapFileSpec("src/__init__.py", "library exports", self._library_init()),
            ProjectBootstrapFileSpec("src/core.py", "core library function", self._library_core()),
        )

    @staticmethod
    def _follow_up_commands(project_type: ProjectBootstrapType) -> tuple[str, ...]:
        if project_type == "python_script":
            return ("/file main.py", "/run python main.py")
        if project_type == "python_cli":
            return ("/file src/main.py", "/run python src/main.py")
        if project_type == "desktop_app":
            return ("/file main.py", "/run python main.py")
        return ("/file src/core.py", "/file src/__init__.py")

    @staticmethod
    def _script_main() -> str:
        return "\n".join(
            (
                "def main() -> None:",
                '    print("Hello from AI-E")',
                "",
                "",
                "if __name__ == \"__main__\":",
                "    main()",
            )
        )

    @staticmethod
    def _cli_readme() -> str:
        return "\n".join(
            (
                "# Project",
                "",
                "Minimal Python CLI scaffold generated by AI-E.",
                "",
                "## Run",
                "",
                "python src/main.py",
            )
        )

    @staticmethod
    def _cli_main() -> str:
        return "\n".join(
            (
                "from pathlib import Path",
                "import sys",
                "",
                "",
                "def main() -> int:",
                "    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(\".\")",
                '    print(f"Scanning: {target}")',
                "    return 0",
                "",
                "",
                "if __name__ == \"__main__\":",
                "    raise SystemExit(main())",
            )
        )

    @staticmethod
    def _desktop_readme() -> str:
        return "\n".join(
            (
                "# Project",
                "",
                "Minimal PySide6 desktop scaffold generated by AI-E.",
                "Install PySide6 manually.",
                "",
                "Run:",
                "python main.py",
            )
        )

    @staticmethod
    def _desktop_main() -> str:
        return "\n".join(
            (
                "import sys",
                "from PySide6.QtWidgets import QApplication, QLabel, QWidget, QVBoxLayout",
                "",
                "",
                "def main() -> int:",
                "    app = QApplication(sys.argv)",
                "",
                "    window = QWidget()",
                '    window.setWindowTitle("AI-E Desktop App")',
                "",
                "    layout = QVBoxLayout()",
                '    layout.addWidget(QLabel("Hello from AI-E"))',
                "    window.setLayout(layout)",
                "",
                "    window.show()",
                "    return app.exec()",
                "",
                "",
                "if __name__ == \"__main__\":",
                "    raise SystemExit(main())",
            )
        )

    @staticmethod
    def _library_readme() -> str:
        return "\n".join(
            (
                "# Project",
                "",
                "Minimal Python library scaffold generated by AI-E.",
            )
        )

    @staticmethod
    def _library_init() -> str:
        return "\n".join(
            (
                "from .core import greet",
                "",
                '',
                '__all__ = ["greet"]',
            )
        )

    @staticmethod
    def _library_core() -> str:
        return "\n".join(
            (
                "def greet(name: str) -> str:",
                '    return f"Hello, {name}"',
            )
        )