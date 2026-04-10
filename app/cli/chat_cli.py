"""Interactive local CLI chat surface backed by the shared AI-E routing stack."""
from __future__ import annotations

import argparse
import traceback
from collections.abc import Callable
from typing import TextIO

from ..controller.app_service import ControllerService
from ..controller.confirmation_models import PendingConfirmation
from ..controller.execution_models import CapabilityExecutionResult


def _readline_module():
    try:
        import readline  # type: ignore[import-not-found]
    except ImportError:
        return None
    return readline


class AiEChatCli:
    def __init__(
        self,
        *,
        service: ControllerService | None = None,
        input_func: Callable[[str], str] = input,
        output_func: Callable[[str], None] | None = None,
        debug: bool = False,
        chat_id: str = "local-cli",
        sender_label: str = "local-cli",
    ) -> None:
        self._service = service or ControllerService()
        self._owns_service = service is None
        self._input = input_func
        self._output = output_func or print
        self._debug = debug
        self._chat_id = chat_id
        self._sender_label = sender_label
        self._history: list[str] = []
        self._readline = _readline_module()

    def run(self) -> int:
        self._configure_history()
        self._write("AI-E CLI Chat initialized.")
        self._write("Type 'exit' to quit.")
        try:
            while True:
                try:
                    line = self._input("> ")
                except EOFError:
                    self._write("Exiting AI-E CLI chat.")
                    return 0
                except KeyboardInterrupt:
                    self._write("")
                    self._write("Exiting AI-E CLI chat.")
                    return 0
                if not self.handle_line(line):
                    return 0
        finally:
            if self._owns_service:
                self._service.shutdown()

    def handle_line(self, line: str) -> bool:
        stripped = line.strip()
        if not stripped:
            return True
        if stripped.lower() in {"exit", "quit"}:
            self._write("Exiting AI-E CLI chat.")
            return False
        self._remember_history(stripped)
        try:
            result = self._service.execute_local_chat_input(
                text=stripped,
                chat_id=self._chat_id,
                sender_label=self._sender_label,
            )
            self._display_result(result)
            if result.outcome == "confirmation_required":
                confirmation = self._service.latest_pending_confirmation_for_chat(chat_id=self._chat_id)
                if confirmation is not None:
                    follow_up = self._handle_confirmation_prompt(confirmation)
                    if follow_up is not None:
                        self._display_result(follow_up)
            return True
        except KeyboardInterrupt:
            self._write("")
            self._write("Exiting AI-E CLI chat.")
            return False
        except Exception as exc:  # noqa: BLE001
            self._write("AI-E:")
            self._write("The local chat session hit an unexpected error.")
            if self._debug:
                for line_item in traceback.format_exception(exc):
                    self._write(line_item.rstrip())
            else:
                self._write("Next: retry the request or rerun with --debug for details.")
            self._write("")
            return True

    def _handle_confirmation_prompt(self, confirmation: PendingConfirmation) -> CapabilityExecutionResult | None:
        prompt_label = "Confirm execution" if confirmation.capability_id in {"shell.command.run", "test.command.run"} else "Confirm action"
        while True:
            answer = self._input(f"{prompt_label}? (y/n): ").strip().lower()
            if answer in {"y", "yes"}:
                return self._service.execute_local_chat_input(
                    text=f"/confirm {confirmation.confirmation_id}",
                    chat_id=self._chat_id,
                    sender_label=self._sender_label,
                )
            if answer in {"n", "no"}:
                return self._service.execute_local_chat_input(
                    text=f"/deny {confirmation.confirmation_id}",
                    chat_id=self._chat_id,
                    sender_label=self._sender_label,
                )
            self._write("Please answer y or n.")

    def _display_result(self, result: CapabilityExecutionResult) -> None:
        self._write("AI-E:")
        intent = self._intent_label(result)
        action_tag = self._action_tag(result, intent)
        if intent:
            self._write(f"[INTENT: {intent.upper()}]")
        if action_tag:
            self._write(f"[{action_tag}]")
        if result.outcome == "confirmation_required":
            self._write("[CONFIRMATION REQUIRED]")
        for line in (result.user_message.splitlines() or ["(no reply)"]):
            self._write(line)
        if self._debug:
            confidence = self._intent_confidence(result)
            route = self._route_label(result)
            if confidence:
                self._write(f"[CONFIDENCE: {confidence}]")
            if route:
                self._write(f"[ROUTE: {route}]")
            self._write(f"[OUTCOME: {result.outcome} / {result.outcome_reason_code}]")
        self._write("")

    def _configure_history(self) -> None:
        if self._readline is None:
            return
        try:
            self._readline.parse_and_bind("tab: complete")
        except Exception:  # noqa: BLE001
            return

    def _remember_history(self, entry: str) -> None:
        self._history.append(entry)
        if self._readline is None:
            return
        try:
            self._readline.add_history(entry)
        except Exception:  # noqa: BLE001
            return

    @staticmethod
    def _intent_label(result: CapabilityExecutionResult) -> str:
        payload = result.telemetry.get("natural_chat_classification")
        if not isinstance(payload, dict):
            return ""
        return str(payload.get("intent_label") or "").strip()

    @staticmethod
    def _intent_confidence(result: CapabilityExecutionResult) -> str:
        payload = result.telemetry.get("natural_chat_classification")
        if not isinstance(payload, dict):
            return ""
        confidence = payload.get("confidence")
        if not isinstance(confidence, (int, float)):
            return ""
        return f"{confidence:.2f}"

    @staticmethod
    def _route_label(result: CapabilityExecutionResult) -> str:
        payload = result.telemetry.get("natural_chat_route")
        if not isinstance(payload, dict):
            return ""
        route = str(payload.get("selected_route") or payload.get("route_command") or "").strip()
        if route.startswith("legacy:"):
            return route.split(":", 1)[1]
        return route

    @staticmethod
    def _action_tag(result: CapabilityExecutionResult, intent: str) -> str:
        if result.outcome == "confirmation_required":
            routed_capability = str(result.telemetry.get("routed_capability_id") or result.capability_id)
            if routed_capability in {"shell.command.run", "test.command.run"}:
                return "RUN REQUEST"
        intent_map = {
            "planning": "PLAN",
            "patch_request": "PATCH PROPOSED",
            "execution_request": "RUN REQUEST",
        }
        return intent_map.get(intent, "")

    def _write(self, text: str) -> None:
        self._output(text)


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the local AI-E CLI chat interface.")
    parser.add_argument("--debug", action="store_true", help="Show intent confidence, route decisions, and exception traces.")
    parser.add_argument("--chat-id", default="local-cli", help="Session chat id used for local context and confirmation tracking.")
    parser.add_argument("--sender-label", default="local-cli", help="Display label recorded for local requests.")
    return parser


def main(argv: list[str] | None = None, *, stdout: TextIO | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    output = (stdout.write if stdout is not None else None)

    def emit(line: str) -> None:
        if output is None:
            print(line)
            return
        stdout.write(f"{line}\n")

    cli = AiEChatCli(debug=args.debug, chat_id=args.chat_id, sender_label=args.sender_label, output_func=emit)
    return cli.run()