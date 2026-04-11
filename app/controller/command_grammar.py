"""Centralized command grammar, usage hints, and structured parsers."""
from __future__ import annotations

from dataclasses import dataclass
import shlex


CHAIN_TYPE_USAGE = (
    "validate_then_report|feature_validate_loop|dispatch_validate_recover|"
    "validate_with_fallback|validate_compare_report|dispatch_recover_resume|feature_validate_gate"
)
DATA_TYPE_USAGE = "command|evaluation_run|chain_step|feature_bundle"
DATASET_LABEL_USAGE = "training|evaluation_only|discarded|debug|review_needed"
DATASET_SPLIT_USAGE = "train|eval|holdout"
MODEL_TASK_USAGE = "command_grammar_correction"
MODEL_BASELINE_USAGE = "rules|none|previous_model"
MODEL_METHOD_USAGE = "char_bigram_knn_v1"
DATASOURCE_USAGE_CLASS_USAGE = "requires_review|retrieval_only|evaluation_only|training_allowed|blocked|archival_only|internal_only"
DATASOURCE_REVIEW_USAGE = "draft|pending_review|approved|rejected|suspended"
DATASOURCE_STATUS_USAGE = "draft|active|blocked|suspended|archived"
DATASOURCE_TYPE_USAGE = "web_domain|website_section|api_source|internal_dataset|file_bundle|exported_dataset|manual_import|document_collection|repo_source"


@dataclass(frozen=True)
class CommandParseError:
    reason: str
    next_step: str


COMMAND_USAGE: dict[str, str] = {
    "/start": "Use /start.",
    "/help": "Use /help.",
    "/startruntime": "Use /startruntime.",
    "/nodes": "Use /nodes.",
    "/nodeview": "Use /nodeview <id>.",
    "/nodeselect": "Use /nodeselect <id>.",
    "/nodeclear": "Use /nodeclear.",
    "/status": "Use /status.",
    "/lastaction": "Use /lastaction.",
    "/chat": "Use /chat <message>.",
    "/translate": "Use /translate <idea or request>.",
    "/refine": "Use /refine <clarification>.",
    "/translateview": "Use /translateview.",
    "/translateclear": "Use /translateclear.",
    "/planbuild": "Use /planbuild after /translate or /refine.",
    "/bootstrapproject": "Use /bootstrapproject.",
    "/bootstrapview": "Use /bootstrapview.",
    "/bootstrapapprove": "Use /bootstrapapprove.",
    "/bootstrapreset": "Use /bootstrapreset.",
    "/planstep": "Use /planstep.",
    "/planapprove": "Use /planapprove.",
    "/planstatus": "Use /planstatus.",
    "/planresetstep": "Use /planresetstep.",
    "/planstepbundle": "Use /planstepbundle.",
    "/bundleapprove": "Use /bundleapprove.",
    "/bundlestatus": "Use /bundlestatus.",
    "/bundlecancel": "Use /bundlecancel.",
    "/bundlereset": "Use /bundlereset.",
    "/planview": "Use /planview.",
    "/planclear": "Use /planclear.",
    "/projectview": "Use /projectview.",
    "/prodproject": "Use /prodproject --title \"name\" [--engine unity|godot|unreal|custom] [--milestone \"text\"].",
    "/prodstatus": "Use /prodstatus [overview|blocked|changes|nodes|attention].",
    "/prodmobile": "Use /prodmobile.",
    "/prodpriority": "Use /prodpriority --title \"focus\" [--category gameplay|ai_behavior|ui_ux|systems_tools|animation|audio|content_pipeline|performance|build_release|qa_validation|research_modeling] [--node <id>].",
    "/prodpause": "Use /prodpause [validation|followup|category].",
    "/prodresume": "Use /prodresume [validation|followup|category].",
    "/prodassign": "Use /prodassign --target <node|validator|another> [--category gameplay|ai_behavior|ui_ux|systems_tools|animation|audio|content_pipeline|performance|build_release|qa_validation|research_modeling] [--title \"work\"].",
    "/mode": "Use /mode.",
    "/models": "Use /models.",
    "/repo": "Use /repo or /repo status.",
    "/file": "Use /file <relative_path>.",
    "/createfile": "Use /createfile <relative_path> with @@ CONTENT.",
    "/patchlast": "Use /patchlast <relative_path>.",
    "/patchfile": "Use /patchfile <relative_path> with @@ FIND / @@ REPLACE blocks.",
    "/writefile": "Use /writefile <relative_path> with @@ CONTENT.",
    "/featurestatus": "Use /featurestatus.",
    "/featureapply": "Use /featureapply.",
    "/run": "Use /run <bounded command>.",
    "/test": "Use /test or /test <module_or_path>.",
    "/dispatch": "Use /dispatch --target <node_or_role> --command \"/test ...\". Compatibility: /dispatch <node_or_role> <bounded command>.",
    "/dispatchstatus": "Use /dispatchstatus <job_id>.",
    "/evalcreate": "Use /evalcreate --title \"name\" --command \"/test target\" --runs 3 --interval 60 [--failures 1] [--target local|node:<id>|role:<role>] [--purpose \"text\"] [--dispatch-errors 1].",
    "/evals": "Use /evals.",
    "/evalstatus": "Use /evalstatus <session_id>.",
    "/evalruns": "Use /evalruns <session_id> [limit].",
    "/evalstart": "Use /evalstart <session_id>.",
    "/evalstop": "Use /evalstop <session_id>.",
    "/chaincreate": f"Use /chaincreate --title \"name\" --type {CHAIN_TYPE_USAGE} --command \"/run pytest ...\" --steps 3 [--objective \"goal\"] [--retries 1] [--failures 2] [--no-progress 1] [--target local|node:<id>|role:<role>] [--fallback stop|local|node:<id>|role:<role>].",
    "/chains": "Use /chains.",
    "/chainstatus": "Use /chainstatus <chain_id>.",
    "/chainsteps": "Use /chainsteps <chain_id> [limit].",
    "/chainstart": "Use /chainstart <chain_id>.",
    "/chainresume": "Use /chainresume <chain_id>.",
    "/chainstop": "Use /chainstop <chain_id>.",
    "/chaindecision": "Use /chaindecision <chain_id>.",
    "/web": "Use /web <https://allowed-domain/path>.",
    "/contexts": "Use /contexts.",
    "/clearcontext": "Use /clearcontext.",
    "/data": "Use /data, /data <record_id>, or /data <1-20>.",
    "/datasearch": f"Use /datasearch --type {DATA_TYPE_USAGE} [--label training-eligible|evaluation-only|discarded] [--session-id EV-...] [--chain-id CH-...] [--bundle-id FB-...] [--limit 8]. Compatibility: key=value filters still work.",
    "/datalabel": f"Use /datalabel <record_id> <{DATASET_LABEL_USAGE}>.",
    "/dataunlabel": "Use /dataunlabel <record_id> [label].",
    "/datatag": "Use /datatag <record_id> <tag>.",
    "/datasetcreate": f"Use /datasetcreate --title \"name\" [--description \"text\"] [--source local-cli] [--type {DATA_TYPE_USAGE}] [--label {DATASET_LABEL_USAGE}] [--tag chain_decision] [--status success] [--session-id EV-...] [--chain-id CH-...] [--bundle-id FB-...] [--allow-empty true].",
    "/datasets": "Use /datasets.",
    "/dataset": "Use /dataset <dataset_id>.",
    "/datasetrecords": "Use /datasetrecords <dataset_id>.",
    "/datasetadd": "Use /datasetadd <dataset_id> <record_id>.",
    "/datasetremove": "Use /datasetremove <dataset_id> <record_id>.",
    "/datasetsummary": "Use /datasetsummary <dataset_id>.",
    "/datasetlabel": f"Use /datasetlabel <dataset_id> <{DATASET_LABEL_USAGE}>.",
    "/datasetaddfilter": f"Use /datasetaddfilter <dataset_id> [--source local-cli] [--type {DATA_TYPE_USAGE}] [--label {DATASET_LABEL_USAGE}] [--tag chain_decision] [--status success] [--session-id EV-...] [--chain-id CH-...] [--bundle-id FB-...].",
    "/datasetsplit": f"Use /datasetsplit <dataset_id> [--mode deterministic] --train 80 --eval 20 [--holdout 0]. Splits: {DATASET_SPLIT_USAGE}.",
    "/datasetexport": "Use /datasetexport <dataset_id> [--split train|eval|holdout] [--format jsonl|json].",
    "/datasources": "Use /datasources.",
    "/datasource": "Use /datasource <source_id>.",
    "/datasourcepolicy": "Use /datasourcepolicy <source_id>.",
    "/datasourcesummary": "Use /datasourcesummary.",
    "/datasourcequery": "Use /datasourcequery [--usage requires_review|retrieval_only|evaluation_only|training_allowed|blocked|archival_only|internal_only] [--review draft|pending_review|approved|rejected|suspended] [--status draft|active|blocked|suspended|archived] [--type web_domain|website_section|api_source|internal_dataset|file_bundle|exported_dataset|manual_import|document_collection|repo_source] [--tag governance] [--operation metadata_only|retrieval|evaluation|training|export_reference|blocked].",
    "/datasourcecreate": f"Use /datasourcecreate --name \"source\" --type {DATASOURCE_TYPE_USAGE} --locator \"https://example.com/path\" [--usage {DATASOURCE_USAGE_CLASS_USAGE}] [--status {DATASOURCE_STATUS_USAGE}] [--review {DATASOURCE_REVIEW_USAGE}] [--owner \"name\"] [--scope \"text\"] [--collection manual_declaration] [--tags compliance,training] [--operations metadata_only,retrieval] [--provenance \"req 1|req 2\"] [--note \"text\"] [--license-note \"text\"] [--robots-note \"text\"] [--terms-note \"text\"] [--retention \"text\"] [--training-reason \"text\"] [--review-required true|false].",
    "/datasourceupdate": "Use /datasourceupdate <source_id> [--name \"source\"] [--type web_domain|website_section|api_source|internal_dataset|file_bundle|exported_dataset|manual_import|document_collection|repo_source] [--locator \"https://example.com/path\"] [--usage requires_review|retrieval_only|evaluation_only|training_allowed|blocked|archival_only|internal_only] [--status draft|active|blocked|suspended|archived] [--owner \"name\"] [--scope \"text\"] [--collection manual_declaration] [--tags compliance,training] [--operations metadata_only,retrieval] [--provenance \"req 1|req 2\"] [--note \"text\"] [--license-note \"text\"] [--robots-note \"text\"] [--terms-note \"text\"] [--retention \"text\"] [--training-reason \"text\"] [--blocked-reason \"text\"] [--review-required true|false].",
    "/datasourcereview": f"Use /datasourcereview <source_id> <{DATASOURCE_REVIEW_USAGE}> [--reviewer \"name\"] [--note \"text\"].",
    "/datasourceblock": "Use /datasourceblock <source_id> --reason \"text\" [--reviewer \"name\"] [--note \"text\"].",
    "/datasourceallow": f"Use /datasourceallow <source_id> <{DATASOURCE_USAGE_CLASS_USAGE}> [--reviewer \"name\"] [--note \"text\"] [--training-reason \"text\"].",
    "/modelexperiments": "Use /modelexperiments.",
    "/modelexperiment": "Use /modelexperiment <experiment_id>.",
    "/modelexperimentresults": "Use /modelexperimentresults <experiment_id>.",
    "/modelexperimentstart": "Use /modelexperimentstart <experiment_id>.",
    "/modelexperimentstop": "Use /modelexperimentstop <experiment_id>.",
    "/modelexperimentapprove": "Use /modelexperimentapprove <experiment_id>.",
    "/modelexperimentreject": "Use /modelexperimentreject <experiment_id>.",
    "/modelexperimentcreate": f"Use /modelexperimentcreate --title \"name\" --task {MODEL_TASK_USAGE} --dataset DS-... [--baseline {MODEL_BASELINE_USAGE}] [--method {MODEL_METHOD_USAGE}] [--base-model rules] [--train-split train] [--eval-split eval] [--mode advisory] [--notes \"text\"].",
    "/capabilities": "Use /capabilities.",
    "/audit": "Use /audit or /audit <1-8>.",
    "/confirm": "Use /confirm <id>.",
    "/deny": "Use /deny <id>.",
    "/ask": "Use /ask <prompt> or /askd <prompt>.",
    "/askd": "Use /ask <prompt> or /askd <prompt>.",
    "/asklast": "Use /asklast <prompt>.",
    "/askctx": "Use /askctx <context_id> <prompt>.",
    "/explainrepo": "Use /explainrepo or /explainrepo <relative_path>.",
    "/explainfile": "Use /explainfile <relative_path>.",
    "/summarizeweb": "Use /summarizeweb <https://allowed-domain/path>.",
    "/workflows": "Use /workflows.",
    "/workflowstatus": "Use /workflowstatus or /workflowstatus <workflow_id>.",
    "/cancelworkflow": "Use /cancelworkflow or /cancelworkflow <workflow_id>.",
}

SUPPORTED_COMMANDS = frozenset(COMMAND_USAGE)

HELP_LINES = (
    "Operator commands",
    "Core: /chat /translate|/refine",
    "Plan: /planbuild /planstep|approve|status|reset",
    "Bundle: /planstepbundle /bundleapprove|status|cancel",
    "Boot: /bootstrapproject|/bootstrapapprove|reset /prod*",
    "Files: /repo|file /createfile|patch*|/writefile",
    "Exec: /run|/test /dispatch --target ... --command ... /nodes|node*",
    "Loops: /eval* /chain*",
    "Trust: /data /capabilities /contexts /model*",
    "Ask: /ask|askd|asklast|askctx",
    "Info: /contexts /explainrepo /summarizeweb",
    "Flow: /workflows|status|cancelworkflow",
)


def build_help_text() -> str:
    return "\n".join(HELP_LINES)


def usage_hint_for_command(command: str) -> str:
    return COMMAND_USAGE.get(command, "Use /help to see supported commands.")


def usage_hint_for_prefix(command: str) -> str:
    matched = ""
    for candidate in SUPPORTED_COMMANDS:
        if command.startswith(candidate) and len(candidate) > len(matched):
            matched = candidate
    if matched:
        return usage_hint_for_command(matched)
    return "Use /help to see supported commands."


def _tokenize(argument: str, *, next_step: str) -> tuple[list[str] | None, CommandParseError | None]:
    try:
        return shlex.split(argument), None
    except ValueError as exc:
        return None, CommandParseError(reason=str(exc), next_step=next_step)


def _normalize_flag_name(name: str) -> str:
    return name.strip().lower().replace("_", "-")


def _parse_named_options(
    tokens: list[str],
    *,
    allowed_flags: set[str],
    required_flags: tuple[str, ...] = (),
    aliases: dict[str, str] | None = None,
    next_step: str,
) -> tuple[dict[str, str] | None, CommandParseError | None]:
    alias_map = {key: _normalize_flag_name(value) for key, value in (aliases or {}).items()}
    parsed: dict[str, str] = {}
    index = 0
    while index < len(tokens):
        token = tokens[index]
        if not token.startswith("--"):
            return None, CommandParseError(reason=f"Unexpected token: {token}", next_step=next_step)
        body = token[2:]
        inline_value = ""
        if "=" in body:
            body, inline_value = body.split("=", 1)
        key = _normalize_flag_name(body)
        if not key:
            return None, CommandParseError(reason="Empty option name is not allowed.", next_step=next_step)
        key = alias_map.get(key, key)
        if key not in allowed_flags:
            return None, CommandParseError(reason=f"Unsupported option --{key}.", next_step=next_step)
        if key in parsed:
            return None, CommandParseError(reason=f"Duplicate option --{key}.", next_step=next_step)
        if inline_value:
            value = inline_value.strip()
        else:
            if index + 1 >= len(tokens):
                return None, CommandParseError(reason=f"Missing value for --{key}.", next_step=next_step)
            value = tokens[index + 1].strip()
            index += 1
        if not value:
            return None, CommandParseError(reason=f"Missing value for --{key}.", next_step=next_step)
        parsed[key] = value
        index += 1
    for required in required_flags:
        if not parsed.get(required):
            return None, CommandParseError(reason=f"Missing required option --{required}.", next_step=next_step)
    return parsed, None


def parse_dispatch_arguments(argument: str) -> tuple[dict[str, str] | None, CommandParseError | None]:
    next_step = usage_hint_for_command("/dispatch")
    tokens, error = _tokenize(argument, next_step=next_step)
    if error is not None:
        return None, error
    if tokens is None or not tokens:
        return None, CommandParseError(reason="Missing required target and bounded command.", next_step=next_step)
    if any(token.startswith("--") for token in tokens):
        parsed, error = _parse_named_options(
            tokens,
            allowed_flags={"target", "command"},
            required_flags=("target", "command"),
            next_step=next_step,
        )
        if error is not None or parsed is None:
            return None, error
        return {"selector": parsed["target"].strip().lower(), "command": parsed["command"].strip()}, None
    if len(tokens) < 2:
        return None, CommandParseError(reason="Missing required bounded command.", next_step=next_step)
    return {"selector": tokens[0].strip().lower(), "command": " ".join(tokens[1:]).strip()}, None


def parse_eval_create_arguments(argument: str) -> tuple[dict[str, str] | None, CommandParseError | None]:
    next_step = usage_hint_for_command("/evalcreate")
    tokens, error = _tokenize(argument, next_step=next_step)
    if error is not None:
        return None, error
    if tokens is None or not tokens:
        return None, CommandParseError(reason="Missing required options --title, --command, --runs, and --interval.", next_step=next_step)
    return _parse_named_options(
        tokens,
        allowed_flags={"title", "command", "runs", "interval", "failures", "target", "purpose", "dispatch-errors"},
        required_flags=("title", "command", "runs", "interval"),
        aliases={"dispatch_errors": "dispatch-errors"},
        next_step=next_step,
    )


def parse_chain_create_arguments(argument: str) -> tuple[dict[str, str] | None, CommandParseError | None]:
    next_step = usage_hint_for_command("/chaincreate")
    tokens, error = _tokenize(argument, next_step=next_step)
    if error is not None:
        return None, error
    if tokens is None or not tokens:
        return None, CommandParseError(reason="Missing required options --title, --type, --command, and --steps.", next_step=next_step)
    return _parse_named_options(
        tokens,
        allowed_flags={"title", "type", "command", "steps", "objective", "retries", "failures", "no-progress", "target", "fallback"},
        required_flags=("title", "type", "command", "steps"),
        aliases={"no_progress": "no-progress"},
        next_step=next_step,
    )


def parse_prod_project_arguments(argument: str) -> tuple[dict[str, str] | None, CommandParseError | None]:
    next_step = usage_hint_for_command("/prodproject")
    tokens, error = _tokenize(argument, next_step=next_step)
    if error is not None:
        return None, error
    if not tokens:
        return None, CommandParseError(reason="Missing required option --title.", next_step=next_step)
    return _parse_named_options(
        tokens,
        allowed_flags={"title", "engine", "milestone"},
        required_flags=("title",),
        next_step=next_step,
    )


def parse_prod_status_arguments(argument: str) -> tuple[dict[str, str] | None, CommandParseError | None]:
    next_step = usage_hint_for_command("/prodstatus")
    tokens, error = _tokenize(argument, next_step=next_step)
    if error is not None:
        return None, error
    if not tokens:
        return {"focus": "overview"}, None
    if len(tokens) != 1:
        return None, CommandParseError(reason="Expected at most one focus value.", next_step=next_step)
    focus = tokens[0].strip().lower()
    if focus not in {"overview", "blocked", "changes", "nodes", "attention"}:
        return None, CommandParseError(reason=f"Unsupported production focus {tokens[0]}.", next_step=next_step)
    return {"focus": focus}, None


def parse_prod_priority_arguments(argument: str) -> tuple[dict[str, str] | None, CommandParseError | None]:
    next_step = usage_hint_for_command("/prodpriority")
    tokens, error = _tokenize(argument, next_step=next_step)
    if error is not None:
        return None, error
    if not tokens:
        return None, CommandParseError(reason="Missing required option --title.", next_step=next_step)
    return _parse_named_options(
        tokens,
        allowed_flags={"title", "category", "node"},
        required_flags=("title",),
        next_step=next_step,
    )


def parse_prod_pause_resume_arguments(argument: str, *, command: str) -> tuple[dict[str, str] | None, CommandParseError | None]:
    next_step = usage_hint_for_command(command)
    tokens, error = _tokenize(argument, next_step=next_step)
    if error is not None:
        return None, error
    if not tokens:
        return {"target": "validation"}, None
    if len(tokens) != 1:
        return None, CommandParseError(reason="Expected one target value.", next_step=next_step)
    return {"target": tokens[0].strip().lower()}, None


def parse_prod_assign_arguments(argument: str) -> tuple[dict[str, str] | None, CommandParseError | None]:
    next_step = usage_hint_for_command("/prodassign")
    tokens, error = _tokenize(argument, next_step=next_step)
    if error is not None:
        return None, error
    if not tokens:
        return None, CommandParseError(reason="Missing required option --target.", next_step=next_step)
    return _parse_named_options(
        tokens,
        allowed_flags={"target", "category", "title"},
        required_flags=("target",),
        next_step=next_step,
    )


def parse_data_limit(value: str) -> int | None:
    normalized = value.strip()
    if not normalized or not normalized.isdigit():
        return None
    limit = int(normalized)
    if limit < 1 or limit > 20:
        return None
    return limit


def parse_data_search_arguments(argument: str) -> tuple[dict[str, str] | None, int, CommandParseError | None]:
    next_step = usage_hint_for_command("/datasearch")
    tokens, error = _tokenize(argument, next_step=next_step)
    if error is not None:
        return None, 8, error
    if tokens is None or not tokens:
        return None, 8, CommandParseError(reason="At least one filter is required.", next_step=next_step)
    allowed_filters = {
        "id",
        "record-id",
        "type",
        "label",
        "outcome",
        "source",
        "request-id",
        "session-id",
        "chain-id",
        "step-id",
        "run-id",
        "bundle-id",
        "chat-id",
        "capability-id",
        "command-label",
        "limit",
    }
    aliases = {
        "record_id": "record-id",
        "request_id": "request-id",
        "session_id": "session-id",
        "chain_id": "chain-id",
        "step_id": "step-id",
        "run_id": "run-id",
        "bundle_id": "bundle-id",
        "chat_id": "chat-id",
        "capability_id": "capability-id",
        "command_label": "command-label",
    }
    type_aliases = {
        "eval": "evaluation_run",
        "evaluation": "evaluation_run",
        "chain": "chain_step",
        "bundle": "feature_bundle",
    }
    if any(token.startswith("--") for token in tokens):
        parsed, error = _parse_named_options(tokens, allowed_flags=allowed_filters, aliases=aliases, next_step=next_step)
        if error is not None or parsed is None:
            return None, 8, error
    else:
        parsed = {}
        for token in tokens:
            if "=" not in token:
                return None, 8, CommandParseError(reason=f"Unexpected token: {token}", next_step=next_step)
            key, value = token.split("=", 1)
            normalized_key = aliases.get(_normalize_flag_name(key), _normalize_flag_name(key))
            normalized_value = value.strip()
            if normalized_key not in allowed_filters:
                return None, 8, CommandParseError(reason=f"Unsupported filter {key.strip()}.", next_step=next_step)
            if not normalized_value:
                return None, 8, CommandParseError(reason=f"Missing value for {key.strip()}.", next_step=next_step)
            if normalized_key in parsed:
                return None, 8, CommandParseError(reason=f"Duplicate filter {key.strip()}.", next_step=next_step)
            parsed[normalized_key] = normalized_value
    limit = 8
    if "limit" in parsed:
        parsed_limit = parse_data_limit(parsed["limit"])
        if parsed_limit is None:
            return None, 8, CommandParseError(reason="Limit must be an integer from 1 to 20.", next_step=next_step)
        limit = parsed_limit
        del parsed["limit"]
    if not parsed:
        return None, 8, CommandParseError(reason="At least one filter besides --limit is required.", next_step=next_step)
    filters: dict[str, str] = {}
    for key, value in parsed.items():
        normalized_value = value
        if key == "type":
            normalized_value = type_aliases.get(value.lower(), value)
        filters[key.replace("-", "_")] = normalized_value
    return filters, limit, None


def _parse_simple_record_target(argument: str, *, next_step: str, require_value: bool = True) -> tuple[list[str] | None, CommandParseError | None]:
    tokens, error = _tokenize(argument, next_step=next_step)
    if error is not None:
        return None, error
    if tokens is None or (require_value and not tokens):
        return None, CommandParseError(reason="Missing required record id.", next_step=next_step)
    return tokens, None


def parse_data_label_arguments(argument: str) -> tuple[dict[str, str] | None, CommandParseError | None]:
    next_step = usage_hint_for_command("/datalabel")
    tokens, error = _parse_simple_record_target(argument, next_step=next_step)
    if error is not None:
        return None, error
    if tokens is None or len(tokens) != 2:
        return None, CommandParseError(reason="Expected a record id and one label.", next_step=next_step)
    return {"record_id": tokens[0].strip().upper(), "label": tokens[1].strip().lower()}, None


def parse_data_unlabel_arguments(argument: str) -> tuple[dict[str, str] | None, CommandParseError | None]:
    next_step = usage_hint_for_command("/dataunlabel")
    tokens, error = _parse_simple_record_target(argument, next_step=next_step)
    if error is not None:
        return None, error
    if tokens is None or len(tokens) not in {1, 2}:
        return None, CommandParseError(reason="Expected a record id and an optional label.", next_step=next_step)
    parsed = {"record_id": tokens[0].strip().upper()}
    if len(tokens) == 2:
        parsed["label"] = tokens[1].strip().lower()
    return parsed, None


def parse_data_tag_arguments(argument: str) -> tuple[dict[str, str] | None, CommandParseError | None]:
    next_step = usage_hint_for_command("/datatag")
    tokens, error = _parse_simple_record_target(argument, next_step=next_step)
    if error is not None:
        return None, error
    if tokens is None or len(tokens) != 2:
        return None, CommandParseError(reason="Expected a record id and one tag.", next_step=next_step)
    return {"record_id": tokens[0].strip().upper(), "tag": tokens[1].strip()}, None


def parse_dataset_create_arguments(argument: str) -> tuple[dict[str, str] | None, CommandParseError | None]:
    next_step = usage_hint_for_command("/datasetcreate")
    tokens, error = _tokenize(argument, next_step=next_step)
    if error is not None:
        return None, error
    if tokens is None or not tokens:
        return None, CommandParseError(reason="Missing required option --title.", next_step=next_step)
    return _parse_named_options(
        tokens,
        allowed_flags={"title", "description", "source", "type", "label", "tag", "status", "session-id", "chain-id", "bundle-id", "allow-empty"},
        required_flags=("title",),
        aliases={"session_id": "session-id", "chain_id": "chain-id", "bundle_id": "bundle-id", "allow_empty": "allow-empty"},
        next_step=next_step,
    )


def parse_dataset_id_argument(argument: str, *, command: str) -> tuple[str | None, CommandParseError | None]:
    next_step = usage_hint_for_command(command)
    tokens, error = _tokenize(argument, next_step=next_step)
    if error is not None:
        return None, error
    if tokens is None or len(tokens) != 1:
        return None, CommandParseError(reason="Expected one dataset id.", next_step=next_step)
    return tokens[0].strip().upper(), None


def parse_dataset_record_pair(argument: str, *, command: str) -> tuple[dict[str, str] | None, CommandParseError | None]:
    next_step = usage_hint_for_command(command)
    tokens, error = _tokenize(argument, next_step=next_step)
    if error is not None:
        return None, error
    if tokens is None or len(tokens) != 2:
        return None, CommandParseError(reason="Expected a dataset id and one record id.", next_step=next_step)
    return {"dataset_id": tokens[0].strip().upper(), "record_id": tokens[1].strip().upper()}, None


def parse_dataset_label_arguments(argument: str) -> tuple[dict[str, str] | None, CommandParseError | None]:
    next_step = usage_hint_for_command("/datasetlabel")
    tokens, error = _tokenize(argument, next_step=next_step)
    if error is not None:
        return None, error
    if tokens is None or len(tokens) != 2:
        return None, CommandParseError(reason="Expected a dataset id and one label.", next_step=next_step)
    return {"dataset_id": tokens[0].strip().upper(), "label": tokens[1].strip().lower()}, None


def parse_dataset_add_filter_arguments(argument: str) -> tuple[dict[str, str] | None, CommandParseError | None]:
    next_step = usage_hint_for_command("/datasetaddfilter")
    tokens, error = _tokenize(argument, next_step=next_step)
    if error is not None:
        return None, error
    if tokens is None or not tokens:
        return None, CommandParseError(reason="Expected a dataset id followed by one or more filters.", next_step=next_step)
    dataset_id = tokens[0].strip().upper()
    parsed, error = _parse_named_options(
        tokens[1:],
        allowed_flags={"source", "type", "label", "tag", "status", "session-id", "chain-id", "bundle-id"},
        aliases={"session_id": "session-id", "chain_id": "chain-id", "bundle_id": "bundle-id"},
        next_step=next_step,
    )
    if error is not None or parsed is None:
        return None, error
    parsed["dataset_id"] = dataset_id
    return parsed, None


def parse_dataset_split_arguments(argument: str) -> tuple[dict[str, str] | None, CommandParseError | None]:
    next_step = usage_hint_for_command("/datasetsplit")
    tokens, error = _tokenize(argument, next_step=next_step)
    if error is not None:
        return None, error
    if tokens is None or len(tokens) < 3:
        return None, CommandParseError(reason="Expected a dataset id and split percentages.", next_step=next_step)
    dataset_id = tokens[0].strip().upper()
    parsed, error = _parse_named_options(
        tokens[1:],
        allowed_flags={"mode", "train", "eval", "holdout"},
        required_flags=("train", "eval"),
        next_step=next_step,
    )
    if error is not None or parsed is None:
        return None, error
    parsed["dataset_id"] = dataset_id
    return parsed, None


def parse_dataset_export_arguments(argument: str) -> tuple[dict[str, str] | None, CommandParseError | None]:
    next_step = usage_hint_for_command("/datasetexport")
    tokens, error = _tokenize(argument, next_step=next_step)
    if error is not None:
        return None, error
    if tokens is None or not tokens:
        return None, CommandParseError(reason="Expected a dataset id.", next_step=next_step)
    dataset_id = tokens[0].strip().upper()
    if len(tokens) == 1:
        return {"dataset_id": dataset_id}, None
    parsed, error = _parse_named_options(
        tokens[1:],
        allowed_flags={"split", "format"},
        next_step=next_step,
    )
    if error is not None or parsed is None:
        return None, error
    parsed["dataset_id"] = dataset_id
    return parsed, None


def parse_datasource_id_argument(argument: str, *, command: str) -> tuple[str | None, CommandParseError | None]:
    next_step = usage_hint_for_command(command)
    tokens, error = _tokenize(argument, next_step=next_step)
    if error is not None:
        return None, error
    if tokens is None or len(tokens) != 1:
        return None, CommandParseError(reason="Expected one datasource id.", next_step=next_step)
    return tokens[0].strip().upper(), None


def parse_datasource_query_arguments(argument: str) -> tuple[dict[str, str] | None, CommandParseError | None]:
    next_step = usage_hint_for_command("/datasourcequery")
    tokens, error = _tokenize(argument, next_step=next_step)
    if error is not None:
        return None, error
    if not tokens:
        return {}, None
    return _parse_named_options(
        tokens,
        allowed_flags={"usage", "review", "status", "type", "tag", "operation"},
        next_step=next_step,
    )


def parse_datasource_create_arguments(argument: str) -> tuple[dict[str, str] | None, CommandParseError | None]:
    next_step = usage_hint_for_command("/datasourcecreate")
    tokens, error = _tokenize(argument, next_step=next_step)
    if error is not None:
        return None, error
    if tokens is None or not tokens:
        return None, CommandParseError(reason="Missing required options --name, --type, and --locator.", next_step=next_step)
    return _parse_named_options(
        tokens,
        allowed_flags={"name", "type", "locator", "usage", "status", "review", "owner", "scope", "collection", "tags", "operations", "provenance", "note", "license-note", "robots-note", "terms-note", "retention", "training-reason", "review-required", "blocked-reason"},
        required_flags=("name", "type", "locator"),
        aliases={"license_note": "license-note", "robots_note": "robots-note", "terms_note": "terms-note", "training_reason": "training-reason", "review_required": "review-required", "blocked_reason": "blocked-reason"},
        next_step=next_step,
    )


def parse_datasource_update_arguments(argument: str) -> tuple[dict[str, str] | None, CommandParseError | None]:
    next_step = usage_hint_for_command("/datasourceupdate")
    tokens, error = _tokenize(argument, next_step=next_step)
    if error is not None:
        return None, error
    if tokens is None or len(tokens) < 2:
        return None, CommandParseError(reason="Expected a datasource id followed by one or more options.", next_step=next_step)
    source_id = tokens[0].strip().upper()
    parsed, error = _parse_named_options(
        tokens[1:],
        allowed_flags={"name", "type", "locator", "usage", "status", "owner", "scope", "collection", "tags", "operations", "provenance", "note", "license-note", "robots-note", "terms-note", "retention", "training-reason", "review-required", "blocked-reason"},
        aliases={"license_note": "license-note", "robots_note": "robots-note", "terms_note": "terms-note", "training_reason": "training-reason", "review_required": "review-required", "blocked_reason": "blocked-reason"},
        next_step=next_step,
    )
    if error is not None or parsed is None:
        return None, error
    parsed["source_id"] = source_id
    return parsed, None


def parse_datasource_review_arguments(argument: str) -> tuple[dict[str, str] | None, CommandParseError | None]:
    next_step = usage_hint_for_command("/datasourcereview")
    tokens, error = _tokenize(argument, next_step=next_step)
    if error is not None:
        return None, error
    if tokens is None or len(tokens) < 2:
        return None, CommandParseError(reason="Expected a datasource id and review state.", next_step=next_step)
    parsed = {"source_id": tokens[0].strip().upper(), "review": tokens[1].strip().lower()}
    if len(tokens) == 2:
        return parsed, None
    options, error = _parse_named_options(
        tokens[2:],
        allowed_flags={"reviewer", "note"},
        next_step=next_step,
    )
    if error is not None or options is None:
        return None, error
    parsed.update(options)
    return parsed, None


def parse_datasource_block_arguments(argument: str) -> tuple[dict[str, str] | None, CommandParseError | None]:
    next_step = usage_hint_for_command("/datasourceblock")
    tokens, error = _tokenize(argument, next_step=next_step)
    if error is not None:
        return None, error
    if tokens is None or len(tokens) < 3:
        return None, CommandParseError(reason="Expected a datasource id and --reason.", next_step=next_step)
    source_id = tokens[0].strip().upper()
    parsed, error = _parse_named_options(
        tokens[1:],
        allowed_flags={"reason", "reviewer", "note"},
        required_flags=("reason",),
        next_step=next_step,
    )
    if error is not None or parsed is None:
        return None, error
    parsed["source_id"] = source_id
    return parsed, None


def parse_datasource_allow_arguments(argument: str) -> tuple[dict[str, str] | None, CommandParseError | None]:
    next_step = usage_hint_for_command("/datasourceallow")
    tokens, error = _tokenize(argument, next_step=next_step)
    if error is not None:
        return None, error
    if tokens is None or len(tokens) < 2:
        return None, CommandParseError(reason="Expected a datasource id and usage class.", next_step=next_step)
    parsed = {"source_id": tokens[0].strip().upper(), "usage": tokens[1].strip().lower()}
    if len(tokens) == 2:
        return parsed, None
    options, error = _parse_named_options(
        tokens[2:],
        allowed_flags={"reviewer", "note", "training-reason"},
        aliases={"training_reason": "training-reason"},
        next_step=next_step,
    )
    if error is not None or options is None:
        return None, error
    parsed.update(options)
    return parsed, None


def parse_model_experiment_create_arguments(argument: str) -> tuple[dict[str, str] | None, CommandParseError | None]:
    next_step = usage_hint_for_command("/modelexperimentcreate")
    tokens, error = _tokenize(argument, next_step=next_step)
    if error is not None:
        return None, error
    if tokens is None or not tokens:
        return None, CommandParseError(reason="Missing required options --title, --task, and --dataset.", next_step=next_step)
    return _parse_named_options(
        tokens,
        allowed_flags={"title", "task", "dataset", "baseline", "method", "base-model", "train-split", "eval-split", "mode", "notes"},
        required_flags=("title", "task", "dataset"),
        aliases={"base_model": "base-model", "train_split": "train-split", "eval_split": "eval-split"},
        next_step=next_step,
    )


def parse_model_experiment_id_argument(argument: str, *, command: str) -> tuple[str | None, CommandParseError | None]:
    next_step = usage_hint_for_command(command)
    tokens, error = _tokenize(argument, next_step=next_step)
    if error is not None:
        return None, error
    if tokens is None or len(tokens) != 1:
        return None, CommandParseError(reason="Expected one experiment id.", next_step=next_step)
    return tokens[0].strip().upper(), None