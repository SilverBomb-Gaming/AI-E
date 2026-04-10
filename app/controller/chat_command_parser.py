"""Shared slash-command and plain-text parser for chat surfaces."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ParsedChatCommand:
    command_label: str
    argument: str = ""
    normalized_text: str = ""
    usage_hint: str = ""


def parse_chat_command(*, text: str, has_text: bool = True) -> ParsedChatCommand:
    if not has_text:
        return ParsedChatCommand(command_label="non_text")
    stripped = text.strip()
    if not stripped:
        return ParsedChatCommand(command_label="plain_text")
    if not stripped.startswith("/"):
        return ParsedChatCommand(command_label="plain_text", normalized_text=" ".join(stripped.split()))
    parts = stripped.split(None, 1)
    command_token = parts[0]
    argument = parts[1].strip() if len(parts) > 1 else ""
    command = command_token.split("@", 1)[0].lower()
    normalized_text = " ".join(stripped.split())
    if command in {
        "/start",
        "/help",
        "/startruntime",
        "/nodes",
        "/nodeview",
        "/nodeselect",
        "/nodeclear",
        "/status",
        "/lastaction",
        "/chat",
        "/translate",
        "/refine",
        "/translateview",
        "/translateclear",
        "/planbuild",
        "/bootstrapproject",
        "/bootstrapview",
        "/bootstrapapprove",
        "/bootstrapreset",
        "/planstep",
        "/planapprove",
        "/planstatus",
        "/planresetstep",
        "/planstepbundle",
        "/bundleapprove",
        "/bundlestatus",
        "/bundlecancel",
        "/bundlereset",
        "/planview",
        "/planclear",
        "/projectview",
        "/mode",
        "/models",
        "/repo",
        "/file",
        "/createfile",
        "/patchlast",
        "/patchfile",
        "/writefile",
        "/featurestatus",
        "/featureapply",
        "/run",
        "/test",
        "/dispatch",
        "/dispatchstatus",
        "/evalcreate",
        "/evals",
        "/evalstatus",
        "/evalruns",
        "/evalstart",
        "/evalstop",
        "/web",
        "/contexts",
        "/clearcontext",
        "/capabilities",
        "/audit",
        "/confirm",
        "/deny",
        "/ask",
        "/askd",
        "/asklast",
        "/askctx",
        "/explainrepo",
        "/explainfile",
        "/summarizeweb",
        "/workflows",
        "/workflowstatus",
        "/cancelworkflow",
    }:
        return ParsedChatCommand(command_label=command, argument=argument, normalized_text=normalized_text)
    if command.startswith("/file"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /file <relative_path>.")
    if command.startswith("/createfile"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /createfile <relative_path> with @@ CONTENT.")
    if command.startswith("/patchlast"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /patchlast <relative_path>.")
    if command.startswith("/patchfile"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /patchfile <relative_path> with @@ FIND / @@ REPLACE blocks.")
    if command.startswith("/writefile"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /writefile <relative_path> with @@ CONTENT.")
    if command.startswith("/featurestatus") or command.startswith("/featureapply"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /featurestatus or /featureapply.")
    if command.startswith("/run"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /run <bounded command>.")
    if command.startswith("/test"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /test or /test <module_or_path>.")
    if command.startswith("/dispatchstatus"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /dispatchstatus <job_id>.")
    if command.startswith("/dispatch"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /dispatch <node_or_role> <bounded command>.")
    if command.startswith("/evalcreate"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /evalcreate --title \"name\" --command \"/test target\" --runs 3 --interval 60 [--failures 1] [--target local|node:<id>|role:<role>] [--purpose \"text\"].")
    if command.startswith("/evalstatus"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /evalstatus <session_id>.")
    if command.startswith("/evalruns"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /evalruns <session_id> [limit].")
    if command.startswith("/evalstart"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /evalstart <session_id>.")
    if command.startswith("/evalstop"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /evalstop <session_id>.")
    if command.startswith("/evals"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /evals.")
    if command.startswith("/web"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /web <https://allowed-domain/path>.")
    if command.startswith("/lastaction"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /lastaction.")
    if command.startswith("/nodes") or command.startswith("/nodeclear"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /nodes, /nodeview <id>, /nodeselect <id>, or /nodeclear.")
    if command.startswith("/nodeview") or command.startswith("/nodeselect"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /nodeview <id> or /nodeselect <id>.")
    if command.startswith("/translate"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /translate <idea or request>.")
    if command.startswith("/chat"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /chat <message>.")
    if command.startswith("/refine"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /refine <clarification>.")
    if command.startswith("/planbuild"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /planbuild after /translate or /refine.")
    if command.startswith("/planstep") or command.startswith("/planapprove") or command.startswith("/planstatus") or command.startswith("/planresetstep"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /planstep, /planapprove, /planstatus, or /planresetstep.")
    if command.startswith("/bootstrapproject") or command.startswith("/bootstrapview") or command.startswith("/bootstrapapprove") or command.startswith("/bootstrapreset"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /bootstrapproject, /bootstrapview, /bootstrapapprove, or /bootstrapreset.")
    if command.startswith("/projectview"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /projectview.")
    if command.startswith("/planstepbundle") or command.startswith("/bundleapprove") or command.startswith("/bundlestatus") or command.startswith("/bundlecancel") or command.startswith("/bundlereset"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /planstepbundle, /bundleapprove, /bundlestatus, /bundlecancel, or /bundlereset.")
    if command.startswith("/planview") or command.startswith("/planclear"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /planview or /planclear.")
    if command.startswith("/translateview") or command.startswith("/translateclear"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /translateview or /translateclear.")
    if command.startswith("/repo"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /repo or /repo status.")
    if command.startswith("/contexts") or command.startswith("/clearcontext"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /contexts or /clearcontext.")
    if command.startswith("/asklast"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /asklast <prompt>.")
    if command.startswith("/askctx"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /askctx <context_id> <prompt>.")
    if command.startswith("/ask"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /ask <prompt> or /askd <prompt>.")
    if command.startswith("/explainrepo"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /explainrepo or /explainrepo <relative_path>.")
    if command.startswith("/explainfile"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /explainfile <relative_path>.")
    if command.startswith("/summarizeweb"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /summarizeweb <https://allowed-domain/path>.")
    if command.startswith("/workflows"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /workflows.")
    if command.startswith("/workflowstatus"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /workflowstatus or /workflowstatus <workflow_id>.")
    if command.startswith("/cancelworkflow"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /cancelworkflow or /cancelworkflow <workflow_id>.")
    if command.startswith("/confirm") or command.startswith("/deny"):
        return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /confirm <id> or /deny <id>.")
    return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint="Use /help to see supported commands.")