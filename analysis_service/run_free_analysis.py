from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from orchestrator_lane.orchestrator.conversational_gateway import process_conversational_request


def _normalize_text(value: str | None) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _compose_issue_text(payload: dict[str, str]) -> str:
    sections: list[str] = []
    description = _normalize_text(payload.get("problemDescription"))
    if description:
        sections.append(description)
    error_message = _normalize_text(payload.get("errorMessage"))
    if error_message:
        sections.append(f"Error: {error_message}")
    context = _normalize_text(payload.get("context"))
    if context:
        sections.append(f"Context: {context}")
    code_snippet = _normalize_text(payload.get("codeSnippet"))
    if code_snippet:
        sections.append(f"Snippet: {code_snippet[:500]}")
    return " ".join(sections)


def _classify_issue(issue_text: str) -> str:
    lowered = issue_text.lower()
    if any(token in lowered for token in ("nullreference", "missingreference", "serializefield", "prefab", "reference")):
        return "reference_path"
    if any(token in lowered for token in ("cs", "compiler", "namespace", "assembly definition", "type or namespace", "cannot convert")):
        return "compile_or_api"
    if any(token in lowered for token in ("build failed", "gradle", "il2cpp", "addressables build", "player build")):
        return "build_pipeline"
    if any(token in lowered for token in ("fps", "stutter", "lag", "memory", "gc", "spike", "performance")):
        return "performance"
    if any(token in lowered for token in ("shader", "material", "pink", "render", "urp", "hdrp", "lighting")):
        return "rendering"
    if any(token in lowered for token in ("navmesh", "agent", "pathfinding", "unreachable", "jump", "platform", "playability", "level")):
        return "playability"
    if any(token in lowered for token in ("physics", "rigidbody", "collider", "trigger", "raycast")):
        return "physics"
    return "general_unity"


def _gateway_prompt(issue_text: str, issue_kind: str) -> str | None:
    lowered = issue_text.lower()
    if issue_kind == "playability" or any(token in lowered for token in ("level", "arena", "platform", "playable")):
        return f"analyze level {issue_text}"
    if any(token in lowered for token in ("repair", "fix playability", "make playable")):
        return f"improve playability {issue_text}"
    if any(token in lowered for token in ("results", "report", "report output")):
        return f"inspect results {issue_text}"
    return None


def _what_happened(issue_kind: str, description: str, gateway_result: dict | None) -> str:
    if issue_kind == "reference_path":
        return "AI-E sees a likely runtime reference-path failure: an expected scene, prefab, or serialized dependency is probably missing or arriving too late in the load sequence."
    if issue_kind == "compile_or_api":
        return "AI-E sees a likely compile or API-shape issue: a type, namespace, assembly boundary, or method contract no longer matches what the project expects."
    if issue_kind == "build_pipeline":
        return "AI-E sees a likely build-pipeline issue: the project compiles or runs locally, but a packaging, platform, or player-build step is breaking the release path."
    if issue_kind == "performance":
        return "AI-E sees a likely performance bottleneck: a spike, heavy loop, or memory-heavy path is affecting frame stability rather than a single isolated exception."
    if issue_kind == "rendering":
        return "AI-E sees a likely rendering or pipeline mismatch: the visible failure points to shaders, materials, lighting, or render-pipeline configuration rather than core gameplay logic."
    if issue_kind == "playability":
        if gateway_result and gateway_result.get("structured_tasks"):
            return "AI-E matched this issue to a structural Unity playability analysis path and converted it into bounded inspection tasks instead of a generic answer."
        return "AI-E sees a likely structural gameplay or traversal issue: the blocker looks tied to scene layout, navigation, movement reachability, or play-mode progression."
    return f"AI-E sees a likely Unity debugging issue centered on the signals in your report. The first-pass read is based on the issue description, error text, and any attached context."


def _what_matters(issue_kind: str, payload: dict[str, str], gateway_result: dict | None) -> list[str]:
    matters: list[str] = []
    error_message = _normalize_text(payload.get("errorMessage"))
    context = _normalize_text(payload.get("context"))
    code_snippet = _normalize_text(payload.get("codeSnippet"))

    if error_message:
        matters.append("The issue includes a concrete error signal, which narrows the first validation pass and reduces blind searching.")
    if context:
        matters.append("The extra project context gives AI-E a bounded reproduction surface instead of forcing a broad guess across the whole project.")
    if code_snippet:
        matters.append("A focused code snippet is available, which means the next pass can validate one narrow execution path before widening the search.")

    if gateway_result and gateway_result.get("structured_tasks"):
        first_task = gateway_result["structured_tasks"][0]
        matters.append(f"The current AI-E gateway mapped the issue to '{first_task.get('title', 'a bounded task')}', which is a stronger signal than a generic text-only read.")

    type_specific = {
        "reference_path": "Reference-path bugs are usually local to one scene object, prefab chain, or initialization boundary, so the fix should stay narrow at first.",
        "compile_or_api": "Compile and API-shape failures usually come from one contract drift, not from unrelated gameplay systems, so broad refactors are risky noise.",
        "build_pipeline": "Build failures often come from platform config, package state, or asset processing differences between editor runs and player builds.",
        "performance": "Performance issues need one reproducible spike or hotspot first; otherwise the project can spend hours optimizing the wrong subsystem.",
        "rendering": "Rendering issues often look global on screen even when the real cause is one material, shader keyword, or pipeline asset mismatch.",
        "playability": "Traversal and playability issues usually need one bounded reproduction route before layout changes or system-level design work.",
        "general_unity": "The free pass is strongest when it isolates one failure surface first instead of suggesting broad project-wide change.",
    }
    matters.append(type_specific[issue_kind])

    while len(matters) < 3:
        matters.append("The next steps should stay bounded and testable so one fix can be confirmed before adjacent systems are touched.")

    return matters[:5]


def _what_to_do_next(issue_kind: str, gateway_result: dict | None) -> list[str]:
    steps_by_type = {
        "reference_path": [
            "Open the scene or prefab root named in the issue path and inspect serialized references first.",
            "Reproduce the failure in the smallest possible scene so you can confirm whether load order or a missing assignment is the trigger.",
            "Validate the first fixed reference path before changing neighboring prefabs, managers, or scene wiring.",
        ],
        "compile_or_api": [
            "Inspect the first reported compiler error and verify the exact namespace, assembly definition, or method signature it expects.",
            "Check the most recent API boundary change before editing broad call sites or unrelated scripts.",
            "Rebuild after the smallest contract fix to confirm the next error is real and not a cascade artifact.",
        ],
        "build_pipeline": [
            "Inspect the first build-stage failure and identify whether it belongs to packages, player settings, assets, or platform tooling.",
            "Compare the failing build target against the editor configuration that still works locally.",
            "Validate one bounded build fix before rotating packages, plugins, or platform-wide settings.",
        ],
        "performance": [
            "Capture one reproducible spike or hotspot in the Profiler before changing gameplay systems broadly.",
            "Inspect the highest-cost update, allocation, or rendering step tied to the slowdown.",
            "Validate one optimization in isolation and compare the frame impact before stacking more changes.",
        ],
        "rendering": [
            "Inspect the first material, shader, or render-pipeline asset directly tied to the visible failure.",
            "Check whether the problem is scene-local or pipeline-wide before editing unrelated render settings.",
            "Validate one bounded shader or material fix and rerun the affected scene before widening the search.",
        ],
        "playability": [
            "Reproduce the blocker along one traversal or gameplay path and confirm the exact point where progression breaks.",
            "Inspect the layout, movement, or navigation dependency connected to that failure route.",
            "Validate one narrow scene or movement fix before changing broader encounter or level structure.",
        ],
        "general_unity": [
            "Reproduce the issue with the smallest scene, prefab, or script path that still fails.",
            "Inspect the first high-signal dependency, import, or runtime boundary named in the report.",
            "Validate one bounded fix before widening the change into adjacent systems.",
        ],
    }

    steps = list(steps_by_type[issue_kind])
    if gateway_result and gateway_result.get("structured_tasks"):
        task = gateway_result["structured_tasks"][0]
        steps.insert(0, f"Use the current AI-E gateway task as the first validation frame: {task.get('title', 'bounded task')}.")
    return steps[:5]


def _upgrade_hint(issue_kind: str) -> str:
    if issue_kind == "playability":
        return "Upgrade for a deeper workflow breakdown, richer issue follow-up, and saved inspection history across level and playability passes."
    return "Upgrade for guided debugging workflows, richer follow-up, saved results, and a more detailed issue breakdown."


def analyze(payload: dict[str, str]) -> dict[str, object]:
    issue_text = _compose_issue_text(payload)
    description = _normalize_text(payload.get("problemDescription"))
    if len(description) < 24:
        raise ValueError("Please describe the Unity issue in a little more detail.")

    issue_kind = _classify_issue(issue_text)
    gateway_result = None
    prompt = _gateway_prompt(issue_text, issue_kind)
    if prompt is not None:
        candidate = process_conversational_request(prompt)
        if candidate.get("status") != "unsupported_request":
            gateway_result = candidate

    return {
        "what_happened": _what_happened(issue_kind, description, gateway_result),
        "what_matters": _what_matters(issue_kind, payload, gateway_result),
        "what_to_do_next": _what_to_do_next(issue_kind, gateway_result),
        "upgrade_hint": _upgrade_hint(issue_kind),
    }


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        if not isinstance(payload, dict):
            raise ValueError("Invalid analysis payload.")
        result = analyze({key: str(value or "") for key, value in payload.items()})
        sys.stdout.write(json.dumps(result))
        return 0
    except Exception as exc:  # noqa: BLE001
        sys.stderr.write(str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())