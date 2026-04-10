"""Interactive local CLI chat surface backed by the shared AI-E routing stack."""
from __future__ import annotations

import argparse
from dataclasses import dataclass
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


@dataclass
class _CliWorkingContext:
    working_file_path: str = ""
    working_file_context_id: str = ""
    current_run_target: str = ""
    last_patch_target: str = ""
    last_patch_summary: str = ""
    last_executable_target: str = ""
    last_confirmed_target: str = ""


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
        self._working = _CliWorkingContext()
        self._service.activate_runtime_control_plane()

    def run(self) -> int:
        self._configure_history()
        if self._debug:
            self._write("Debug routing enabled.")
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
            handled = self._handle_confirmation_shortcut(stripped)
            if handled is not None:
                return handled
            local_handled = self._handle_local_bootstrap_command(stripped)
            if local_handled is not None:
                return local_handled
            rewritten = self._rewrite_input_from_working_context(stripped)
            if rewritten is None:
                return True
            result = self._service.execute_local_chat_input(text=rewritten, chat_id=self._chat_id, sender_label=self._sender_label)
            self._update_working_context(original_input=stripped, effective_input=rewritten, result=result)
            self._display_result(result)
            if result.outcome == "confirmation_required" and self._should_inline_confirm(result, original_input=stripped):
                confirmation = self._service.latest_pending_confirmation_for_chat(chat_id=self._chat_id)
                if confirmation is not None:
                    follow_up = self._handle_confirmation_prompt(confirmation)
                    if follow_up is not None:
                        self._update_working_context(original_input="/confirm", effective_input=f"/confirm {confirmation.confirmation_id}", result=follow_up)
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

    def _handle_confirmation_shortcut(self, stripped: str) -> bool | None:
        lowered = stripped.lower()
        if lowered not in {"y", "yes", "n", "no"}:
            return None
        confirmation = self._service.latest_pending_confirmation_for_chat(chat_id=self._chat_id)
        if confirmation is None:
            self._display_local_message(
                heading="AI-E:",
                lines=("No confirmation is pending.", "Next: create a bounded patch, ask, or run request first."),
            )
            return True
        command = "/confirm" if lowered in {"y", "yes"} else "/deny"
        result = self._service.execute_local_chat_input(
            text=f"{command} {confirmation.confirmation_id}",
            chat_id=self._chat_id,
            sender_label=self._sender_label,
        )
        self._update_working_context(original_input=stripped, effective_input=f"{command} {confirmation.confirmation_id}", result=result)
        self._display_result(result)
        return True

    def _handle_local_bootstrap_command(self, stripped: str) -> bool | None:
        lowered = stripped.lower()
        if lowered == "/context":
            self._display_local_context()
            return True
        if lowered.startswith("/main "):
            target = stripped.split(None, 1)[1].strip()
            self._set_run_target(target)
            return True
        if lowered.startswith("/project "):
            target = stripped.split(None, 1)[1].strip()
            self._set_run_target(target)
            return True
        if lowered.startswith("/target "):
            target = stripped.split(None, 1)[1].strip()
            result = self._service.execute_local_chat_input(text=f"/file {target}", chat_id=self._chat_id, sender_label=self._sender_label)
            self._update_working_context(original_input=stripped, effective_input=f"/file {target}", result=result)
            self._display_result(result)
            return True
        return None

    def _rewrite_input_from_working_context(self, stripped: str) -> str | None:
        lowered = stripped.lower()
        pending = self._service.latest_pending_confirmation_for_chat(chat_id=self._chat_id)
        if self._is_apply_request(lowered):
            if not self._working.last_patch_target:
                bundle = self._service.active_feature_bundle_for_chat(chat_id=self._chat_id)
                if bundle is not None and bundle.state == "proposed":
                    result = self._service.execute_local_chat_input(
                        text="/featureapply",
                        chat_id=self._chat_id,
                        sender_label=self._sender_label,
                    )
                    self._update_working_context(original_input=stripped, effective_input="/featureapply", result=result)
                    self._display_result(result)
                    return None
                self._display_local_message(
                    heading="AI-E:",
                    lines=(
                        "No prepared patch target is set.",
                        "Next: use /file <relative_path> and request a bounded change first, or prepare a bounded multi-file feature bundle.",
                    ),
                )
                return None
            result = self._service.execute_local_chat_input(
                text=f"/patchlast {self._working.last_patch_target}",
                chat_id=self._chat_id,
                sender_label=self._sender_label,
            )
            self._update_working_context(original_input=stripped, effective_input=f"/patchlast {self._working.last_patch_target}", result=result)
            if result.outcome == "confirmation_required":
                confirmation = self._service.latest_pending_confirmation_for_chat(chat_id=self._chat_id)
                if confirmation is not None:
                    result = self._service.execute_local_chat_input(
                        text=f"/confirm {confirmation.confirmation_id}",
                        chat_id=self._chat_id,
                        sender_label=self._sender_label,
                    )
                    self._update_working_context(original_input="/confirm", effective_input=f"/confirm {confirmation.confirmation_id}", result=result)
            self._display_result(result)
            return None
        if self._is_run_followup(lowered):
            if pending is not None and pending.capability_id in {"shell.command.run", "test.command.run"}:
                self._display_local_message(
                    heading="AI-E:",
                    tags=("RUN REQUEST", "CONFIRMATION REQUIRED"),
                    lines=(
                        f"Execution is already pending for {self._working.current_run_target or self._working.last_executable_target or 'the current run target'}.",
                        f"ID: {pending.confirmation_id}",
                        "Next: type y to approve or n to cancel.",
                    ),
                )
                return None
            run_target = self._working.current_run_target or self._working.last_executable_target or self._working.last_confirmed_target
            if not run_target:
                latest_run = self._service.latest_run_for_chat(chat_id=self._chat_id)
                if latest_run is not None and latest_run.command_label == "main":
                    run_target = (latest_run.target_root or ".").strip().replace("\\", "/") or "."
            if not run_target:
                self._display_local_message(
                    heading="AI-E:",
                    lines=("No run target is set.", "Next: use /main <target> or /run main <target> first."),
                )
                return None
            return f"/run main {run_target}" if run_target != "." else "/run main ."
        if self._should_bind_to_working_file(lowered):
            if self._working.working_file_context_id:
                return f"/askctx {self._working.working_file_context_id} {stripped}"
            latest_run = self._service.latest_run_for_chat(chat_id=self._chat_id)
            if latest_run is not None and latest_run.is_patch_relevant:
                return f"/asklast {stripped}"
            self._display_local_message(
                heading="AI-E:",
                lines=("No working file is set.", "Next: use /file <relative_path> first."),
            )
            return None
        return stripped

    def _set_run_target(self, target: str) -> None:
        resolved_target, valid, message = self._service.validate_main_run_target(target=target)
        if valid:
            self._working.current_run_target = resolved_target
            self._working.last_executable_target = resolved_target
            self._display_local_message(
                heading="AI-E:",
                tags=("RUN TARGET",),
                lines=(message, f"Next: use /run main {resolved_target} or say 'run it'."),
            )
            return
        self._display_local_message(
            heading="AI-E:",
            lines=("Run target could not be set.", f"Reason: {message}"),
        )

    def _display_local_context(self) -> None:
        pending = self._service.latest_pending_confirmation_for_chat(chat_id=self._chat_id)
        patch = self._service.latest_pending_patch_draft_for_chat(chat_id=self._chat_id)
        bundle = self._service.active_feature_bundle_for_chat(chat_id=self._chat_id)
        lines = ["CLI context"]
        lines.append(f"Working file: {self._working.working_file_path or '-'}")
        lines.append(f"Working file context: {self._working.working_file_context_id or '-'}")
        lines.append(f"Current run target: {self._working.current_run_target or '-'}")
        patch_target = self._working.last_patch_target or (patch.relative_path if patch is not None else "")
        lines.append(f"Last patch target: {patch_target or '-'}")
        if bundle is None:
            lines.append("Feature bundle: -")
        else:
            lines.append(f"Feature bundle: {bundle.bundle_id} {bundle.state}")
        lines.append(f"Last executable target: {self._working.last_executable_target or '-'}")
        lines.append(f"Last confirmed target: {self._working.last_confirmed_target or '-'}")
        if pending is None:
            lines.append("Pending confirmation: -")
        else:
            lines.append(f"Pending confirmation: {pending.confirmation_id} {pending.capability_id}")
        self._display_local_message(heading="AI-E:", lines=tuple(lines))

    def _update_working_context(self, *, original_input: str, effective_input: str, result: CapabilityExecutionResult) -> None:
        telemetry = result.telemetry
        display_path = str(telemetry.get("display_path") or "").strip()
        context_created_id = str(telemetry.get("context_created_id") or "").strip().upper()
        patch_target_path = str(telemetry.get("patch_target_path") or "").strip().replace("\\", "/")
        patch_plan_summary = str(telemetry.get("patch_plan_summary") or "").strip()
        if result.command_label == "/file" and result.outcome == "success" and display_path:
            self._working.working_file_path = display_path
            self._working.working_file_context_id = context_created_id or self._working.working_file_context_id
        if result.command_label in {"/askctx", "/asklast", "/ask"} and result.outcome == "success" and patch_target_path:
            self._working.last_patch_target = patch_target_path
            self._working.last_patch_summary = patch_plan_summary
            if not self._working.working_file_path:
                self._working.working_file_path = patch_target_path
        explicit_run_target = self._run_target_from_input(effective_input)
        if explicit_run_target and result.outcome in {"confirmation_required", "success", "failed", "timed_out"}:
            self._working.current_run_target = explicit_run_target
            self._working.last_executable_target = explicit_run_target
        if result.confirmation_used:
            last_run_payload = telemetry.get("last_run_record")
            if isinstance(last_run_payload, dict):
                confirmed_target = str(last_run_payload.get("target_root") or ".").strip().replace("\\", "/") or "."
                self._working.last_confirmed_target = confirmed_target
                self._working.last_executable_target = confirmed_target
                self._working.current_run_target = confirmed_target
        patch_info = self._service.latest_pending_patch_draft_for_chat(chat_id=self._chat_id)
        if patch_info is not None:
            self._working.last_patch_target = patch_info.relative_path
            self._working.last_patch_summary = patch_info.summary

    def _should_inline_confirm(self, result: CapabilityExecutionResult, *, original_input: str) -> bool:
        if original_input.startswith("/"):
            return False
        confirmation = self._service.latest_pending_confirmation_for_chat(chat_id=self._chat_id)
        if confirmation is None:
            return False
        return confirmation.capability_id in {"file.patch.write", "file.create.write", "file.write.replace"}

    @staticmethod
    def _run_target_from_input(value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized.lower().startswith("/run main"):
            return ""
        parts = normalized.split(maxsplit=2)
        if len(parts) < 3:
            return "."
        return parts[2].strip().replace("\\", "/") or "."

    @staticmethod
    def _is_apply_request(lowered: str) -> bool:
        return lowered in {"apply it", "apply that", "apply the patch", "apply patch"}

    @staticmethod
    def _is_run_followup(lowered: str) -> bool:
        return lowered in {"run it", "run it again", "execute it", "execute it again"}

    @staticmethod
    def _should_bind_to_working_file(lowered: str) -> bool:
        if any(token in lowered for token in ("this file", "that file")):
            return True
        return lowered.startswith(("fix it", "fix that", "change it", "change that", "update it", "update that", "improve it", "improve that"))

    def _display_local_message(self, *, heading: str, lines: tuple[str, ...], tags: tuple[str, ...] = ()) -> None:
        self._write(heading)
        for tag in tags:
            self._write(f"[{tag}]")
        for line in lines:
            self._write(line)
        self._write("")

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
            self._write(f"[COMMAND: {result.command_label}]")
            routed_capability = self._routed_capability_label(result)
            if routed_capability:
                self._write(f"[ROUTED CAPABILITY: {routed_capability}]")
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
    def _routed_capability_label(result: CapabilityExecutionResult) -> str:
        routed = str(result.telemetry.get("routed_capability_id") or "").strip()
        if not routed or routed == result.capability_id:
            return ""
        return routed

    @staticmethod
    def _action_tag(result: CapabilityExecutionResult, intent: str) -> str:
        if result.telemetry.get("feature_bundle"):
            return "FEATURE BUNDLE"
        routed_capability = str(result.telemetry.get("routed_capability_id") or result.capability_id)
        if result.outcome == "confirmation_required":
            if routed_capability in {"shell.command.run", "test.command.run"}:
                return "RUN REQUEST"
            if routed_capability in {"file.patch.write", "file.create.write", "file.write.replace"}:
                return "PATCH PROPOSED"
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
    parser.add_argument("--debug-routing", action="store_true", help="Alias for --debug focused on routed CLI diagnostics.")
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

    cli = AiEChatCli(debug=args.debug or args.debug_routing, chat_id=args.chat_id, sender_label=args.sender_label, output_func=emit)
    return cli.run()