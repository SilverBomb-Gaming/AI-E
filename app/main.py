"""Entry point for the OpenClaw controller foundation app."""
from __future__ import annotations

from .controller.window import launch_controller_app


def main() -> None:
    launch_controller_app()


if __name__ == "__main__":
    main()
