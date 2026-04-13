from __future__ import annotations

import math
from typing import Any, Dict, Iterable, List


SUPPORTED_PLATFORMER_LAYOUT_VALIDATION_TYPES = {
    "platform",
    "ladder",
    "elevator",
    "obstacle_cluster",
    "enemy_spawn_anchor",
    "collectible_anchor",
}

_DEFAULT_DIMENSIONS = {
    "platform": {"width": 2.0, "depth": 1.0, "height": 0.5},
    "ladder": {"width": 0.6, "depth": 0.6, "height": 3.0},
    "elevator": {"width": 1.5, "depth": 1.5, "height": 0.6, "travel_height": 2.5},
    "obstacle_cluster": {"width": 1.0, "depth": 1.0, "height": 1.0},
    "enemy_spawn_anchor": {"width": 0.5, "depth": 0.5, "height": 0.5},
    "collectible_anchor": {"width": 0.5, "depth": 0.5, "height": 0.5},
}
_CONNECTION_VERTICAL_TOLERANCE = 0.75
_CROWDING_RADIUS = 0.85
_CROWDING_CLUSTER_RADIUS = 1.5
_CROWDING_CLUSTER_LIMIT = 3
_VALIDATION_STATUS_LABELS = {
    "passed": "clean",
    "issues_found": "issues detected",
}
_VALIDATION_CATEGORY_ORDER = (
    "reachability",
    "traversal",
    "structural",
    "density_overlap",
)
_VALIDATION_CATEGORY_LABELS = {
    "reachability": "reachability",
    "traversal": "traversal",
    "structural": "structural",
    "density_overlap": "density/overlap",
}
_VALIDATION_ISSUE_CATEGORIES = {
    "unreachable_platform": "reachability",
    "gap_exceeds_jump_capability": "traversal",
    "invalid_ladder": "traversal",
    "unreachable_elevator": "traversal",
    "invalid_elevator_destination": "structural",
    "overlapping_objects": "density_overlap",
    "cramped_layout": "density_overlap",
}
_VALIDATION_ISSUE_LABELS = {
    "unreachable_platform": ("unreachable platform", "unreachable platforms"),
    "gap_exceeds_jump_capability": ("jump gap issue", "jump gap issues"),
    "invalid_ladder": ("invalid ladder", "invalid ladders"),
    "unreachable_elevator": ("unreachable elevator", "unreachable elevators"),
    "invalid_elevator_destination": ("invalid elevator destination", "invalid elevator destinations"),
    "overlapping_objects": ("excessive overlap", "excessive overlaps"),
    "cramped_layout": ("obstacle crowding issue", "obstacle crowding issues"),
}


def enrich_platformer_layout_validation_result(
    *,
    state: Dict[str, Any] | None,
    task: Dict[str, Any],
    result: Dict[str, Any],
) -> Dict[str, Any]:
    if not isinstance(result, dict):
        return result

    details = result.get("details") if isinstance(result.get("details"), dict) else {}
    metadata = extract_platformer_layout_validation_metadata(
        details,
        player_capabilities=_player_capabilities_from_state(state, details=details),
    )
    if not metadata:
        return result

    updated_details = dict(details)
    updated_details.update(metadata)
    updated_result = dict(result)
    updated_result["details"] = updated_details
    return updated_result


def extract_platformer_layout_validation_metadata(
    details: Dict[str, Any] | None,
    *,
    player_capabilities: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    if not isinstance(details, dict):
        return {}
    target_context = str(details.get("target_context") or details.get("target_entity") or "").strip().lower()
    if target_context != "platformer":
        return {}

    existing_issues = details.get("layout_validation_issues")
    existing_summary = str(details.get("layout_validation_summary") or "").strip()
    if isinstance(existing_issues, list) or existing_summary:
        return _normalize_existing_validation_metadata(details)

    normalized_layout = _extract_layout_snapshot(details)
    if not normalized_layout:
        return {}

    normalized_capabilities = _normalize_player_capabilities(player_capabilities or _player_capabilities_from_details(details))
    validation = validate_platformer_layout_snapshot(normalized_layout, normalized_capabilities)
    return {
        "layout_validation_available": True,
        "layout_validation_status": validation["status"],
        "layout_validation_status_label": validation["status_label"],
        "layout_validation_summary": validation["summary"],
        "layout_validation_issue_count": validation["issue_count"],
        "layout_validation_blocking_issue_count": validation["blocking_issue_count"],
        "layout_validation_issue_codes": list(validation["issue_codes"]),
        "layout_validation_issue_messages": list(validation["issue_messages"]),
        "layout_validation_severity_counts": dict(validation["severity_counts"]),
        "layout_validation_severity_summary": validation["severity_summary"],
        "layout_validation_category_counts": dict(validation["category_counts"]),
        "layout_validation_category_summary": validation["category_summary"],
        "layout_validation_issue_type_counts": dict(validation["issue_type_counts"]),
        "layout_validation_issue_type_summary": validation["issue_type_summary"],
        "layout_validation_highlights": list(validation["highlights"]),
        "layout_validation_issues": [dict(item) for item in validation["issues"]],
        "layout_validation_reachable_surfaces": list(validation["reachable_surfaces"]),
        "layout_validation_jump_capacity": validation["jump_capacity"],
        "layout_validation_gap_capacity": validation["gap_capacity"],
    }


def build_platformer_layout_validation_delta(
    previous: Dict[str, Any] | None,
    current: Dict[str, Any] | None,
) -> Dict[str, Any]:
    previous_issue_count = _int_or_zero((previous or {}).get("layout_validation_issue_count"))
    current_issue_count = _int_or_zero((current or {}).get("layout_validation_issue_count"))
    previous_blocking_issue_count = _int_or_zero((previous or {}).get("layout_validation_blocking_issue_count"))
    current_blocking_issue_count = _int_or_zero((current or {}).get("layout_validation_blocking_issue_count"))
    previous_status = str((previous or {}).get("layout_validation_status") or "passed").strip() or "passed"
    current_status = str((current or {}).get("layout_validation_status") or "passed").strip() or "passed"
    previous_available = bool((previous or {}).get("layout_validation_available")) or previous_issue_count > 0
    current_available = bool((current or {}).get("layout_validation_available")) or current_issue_count > 0
    previous_category_counts = _normalized_count_map((previous or {}).get("layout_validation_category_counts"), order=_VALIDATION_CATEGORY_ORDER)
    current_category_counts = _normalized_count_map((current or {}).get("layout_validation_category_counts"), order=_VALIDATION_CATEGORY_ORDER)
    previous_severity_counts = _normalized_count_map((previous or {}).get("layout_validation_severity_counts"))
    current_severity_counts = _normalized_count_map((current or {}).get("layout_validation_severity_counts"))
    previous_issue_type_counts = _normalized_count_map((previous or {}).get("layout_validation_issue_type_counts"))
    current_issue_type_counts = _normalized_count_map((current or {}).get("layout_validation_issue_type_counts"))

    changed_categories = _changed_count_entries(previous_category_counts, current_category_counts, label_map=_VALIDATION_CATEGORY_LABELS)
    changed_severities = _changed_count_entries(previous_severity_counts, current_severity_counts)
    changed_issue_types = _changed_count_entries(previous_issue_type_counts, current_issue_type_counts, label_map=_VALIDATION_ISSUE_LABELS)

    summary_parts = [f"Spatial validation issue count: {previous_issue_count} -> {current_issue_count}"]
    issue_type_delta_text = _issue_type_delta_summary(changed_issue_types)
    if issue_type_delta_text:
        summary_parts.append(issue_type_delta_text)
    elif changed_categories:
        summary_parts.append(_category_delta_summary(changed_categories))
    if previous_status != current_status:
        summary_parts.append(f"status {validation_status_label(previous_status)} -> {validation_status_label(current_status)}")

    return {
        "available": previous_available or current_available,
        "previous_status": previous_status,
        "current_status": current_status,
        "previous_status_label": validation_status_label(previous_status),
        "current_status_label": validation_status_label(current_status),
        "previous_issue_count": previous_issue_count,
        "current_issue_count": current_issue_count,
        "issue_count_delta": current_issue_count - previous_issue_count,
        "previous_blocking_issue_count": previous_blocking_issue_count,
        "current_blocking_issue_count": current_blocking_issue_count,
        "blocking_issue_count_delta": current_blocking_issue_count - previous_blocking_issue_count,
        "previous_severity_counts": previous_severity_counts,
        "current_severity_counts": current_severity_counts,
        "changed_severities": changed_severities,
        "previous_category_counts": previous_category_counts,
        "current_category_counts": current_category_counts,
        "changed_categories": changed_categories,
        "previous_issue_type_counts": previous_issue_type_counts,
        "current_issue_type_counts": current_issue_type_counts,
        "changed_issue_types": changed_issue_types,
        "summary": "; ".join(part for part in summary_parts if part).strip(),
    }


def validation_status_label(status: str) -> str:
    normalized = str(status or "").strip().lower()
    return _VALIDATION_STATUS_LABELS.get(normalized, "issues detected" if normalized else "unknown")


def validate_platformer_layout_snapshot(layout: Dict[str, Any], player_capabilities: Dict[str, Any]) -> Dict[str, Any]:
    layout_name = str(layout.get("layout_name") or layout.get("layout_id") or "platformer layout").strip() or "platformer layout"
    surfaces = list(layout.get("surfaces") or [])
    ladders = list(layout.get("ladders") or [])
    elevators = list(layout.get("elevators") or [])
    obstacles = list(layout.get("obstacles") or [])
    objects = list(layout.get("objects") or [])

    jump_capacity = _jump_capacity(player_capabilities)
    gap_capacity = _gap_capacity(player_capabilities)
    step_capacity = float(player_capabilities.get("max_step_height", 0.3) or 0.3)

    reachable_surface_ids = _reachable_surface_ids(
        surfaces=surfaces,
        ladders=ladders,
        elevators=elevators,
        jump_capacity=jump_capacity,
        gap_capacity=gap_capacity,
        step_capacity=step_capacity,
    )
    surface_map = {str(surface.get("surface_id") or "").strip(): dict(surface) for surface in surfaces}
    issues: List[Dict[str, Any]] = []

    for surface in surfaces:
        surface_id = str(surface.get("surface_id") or "").strip()
        if not surface_id or surface.get("surface_kind") == "ground" or surface_id in reachable_surface_ids:
            continue
        nearest_surface = _nearest_reachable_surface(surface, reachable_surface_ids=reachable_surface_ids, surface_map=surface_map)
        issues.append(
            _unreachable_surface_issue(
                surface,
                nearest_surface=nearest_surface,
                jump_capacity=jump_capacity,
                gap_capacity=gap_capacity,
            )
        )

    for ladder in ladders:
        issues.extend(
            _ladder_issues(
                ladder,
                surfaces=surfaces,
                reachable_surface_ids=reachable_surface_ids,
            )
        )

    for elevator in elevators:
        issues.extend(
            _elevator_issues(
                elevator,
                surfaces=surfaces,
                reachable_surface_ids=reachable_surface_ids,
            )
        )

    issues.extend(_overlap_and_crowding_issues(objects, obstacles=obstacles))
    issues = _sorted_issues(issues)
    blocking_issue_count = sum(1 for item in issues if str(item.get("severity") or "warning") == "error")
    issue_messages = [str(item.get("message") or "").strip() for item in issues if str(item.get("message") or "").strip()]
    issue_codes = sorted({str(item.get("code") or "").strip() for item in issues if str(item.get("code") or "").strip()})
    status = "passed" if not issues else "issues_found"
    status_label = validation_status_label(status)
    severity_counts = _severity_counts(issues)
    category_counts = _category_counts(issues)
    issue_type_counts = _issue_type_counts(issues)
    severity_summary = _count_summary_text(severity_counts)
    category_summary = _count_summary_text(category_counts, label_map=_VALIDATION_CATEGORY_LABELS, order=_VALIDATION_CATEGORY_ORDER)
    issue_type_summary = _count_summary_text(issue_type_counts, label_map=_VALIDATION_ISSUE_LABELS)
    highlights = _top_highlights(issue_type_counts)

    if issues:
        summary = f"{len(issues)} spatial issue(s) detected for {layout_name}: {issue_type_summary}."
    else:
        summary = f"Spatial validation clean for {layout_name}: 0 issues detected."

    return {
        "status": status,
        "status_label": status_label,
        "summary": summary,
        "issue_count": len(issues),
        "blocking_issue_count": blocking_issue_count,
        "issue_codes": issue_codes,
        "issue_messages": issue_messages,
        "severity_counts": severity_counts,
        "severity_summary": severity_summary,
        "category_counts": category_counts,
        "category_summary": category_summary,
        "issue_type_counts": issue_type_counts,
        "issue_type_summary": issue_type_summary,
        "highlights": highlights,
        "issues": issues,
        "reachable_surfaces": sorted(reachable_surface_ids),
        "jump_capacity": round(jump_capacity, 3),
        "gap_capacity": round(gap_capacity, 3),
    }


def _normalize_existing_validation_metadata(details: Dict[str, Any]) -> Dict[str, Any]:
    issues = [dict(item) for item in details.get("layout_validation_issues", []) if isinstance(item, dict)]
    issue_messages = [
        str(item.get("message") or "").strip()
        for item in issues
        if str(item.get("message") or "").strip()
    ]
    issue_codes = sorted(
        {
            str(item.get("code") or "").strip()
            for item in issues
            if str(item.get("code") or "").strip()
        }
    )
    issue_count = int(details.get("layout_validation_issue_count") or len(issues))
    blocking_issue_count = int(
        details.get("layout_validation_blocking_issue_count")
        or sum(1 for item in issues if str(item.get("severity") or "warning") == "error")
    )
    status = str(details.get("layout_validation_status") or ("passed" if issue_count <= 0 else "issues_found")).strip() or "passed"
    status_label = str(details.get("layout_validation_status_label") or validation_status_label(status)).strip() or validation_status_label(status)
    summary = str(details.get("layout_validation_summary") or "").strip()
    reachable_surfaces = [
        str(item).strip()
        for item in (details.get("layout_validation_reachable_surfaces") or [])
        if str(item).strip()
    ]
    severity_counts = _normalized_count_map(details.get("layout_validation_severity_counts"))
    category_counts = _normalized_count_map(details.get("layout_validation_category_counts"), order=_VALIDATION_CATEGORY_ORDER)
    issue_type_counts = _normalized_count_map(details.get("layout_validation_issue_type_counts"))
    if issues:
        severity_counts = _severity_counts(issues)
        category_counts = _category_counts(issues)
        issue_type_counts = _issue_type_counts(issues)
    severity_summary = str(details.get("layout_validation_severity_summary") or _count_summary_text(severity_counts)).strip()
    category_summary = str(
        details.get("layout_validation_category_summary")
        or _count_summary_text(category_counts, label_map=_VALIDATION_CATEGORY_LABELS, order=_VALIDATION_CATEGORY_ORDER)
    ).strip()
    issue_type_summary = str(
        details.get("layout_validation_issue_type_summary")
        or _count_summary_text(issue_type_counts, label_map=_VALIDATION_ISSUE_LABELS)
    ).strip()
    highlights = [str(item).strip() for item in (details.get("layout_validation_highlights") or _top_highlights(issue_type_counts)) if str(item).strip()]
    return {
        "layout_validation_available": bool(summary or issues or reachable_surfaces or issue_count),
        "layout_validation_status": status,
        "layout_validation_status_label": status_label,
        "layout_validation_summary": summary,
        "layout_validation_issue_count": issue_count,
        "layout_validation_blocking_issue_count": blocking_issue_count,
        "layout_validation_issue_codes": issue_codes,
        "layout_validation_issue_messages": issue_messages,
        "layout_validation_severity_counts": severity_counts,
        "layout_validation_severity_summary": severity_summary,
        "layout_validation_category_counts": category_counts,
        "layout_validation_category_summary": category_summary,
        "layout_validation_issue_type_counts": issue_type_counts,
        "layout_validation_issue_type_summary": issue_type_summary,
        "layout_validation_highlights": highlights,
        "layout_validation_issues": issues,
        "layout_validation_reachable_surfaces": reachable_surfaces,
        "layout_validation_jump_capacity": _float_or_none(details.get("layout_validation_jump_capacity")),
        "layout_validation_gap_capacity": _float_or_none(details.get("layout_validation_gap_capacity")),
    }


def _severity_counts(issues: List[Dict[str, Any]]) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for item in issues:
        severity = str(item.get("severity") or "warning").strip().lower() or "warning"
        counts[severity] = counts.get(severity, 0) + 1
    return _normalized_count_map(counts)


def _category_counts(issues: List[Dict[str, Any]]) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for item in issues:
        category = _VALIDATION_ISSUE_CATEGORIES.get(str(item.get("code") or "").strip(), "structural")
        counts[category] = counts.get(category, 0) + 1
    return _normalized_count_map(counts, order=_VALIDATION_CATEGORY_ORDER)


def _issue_type_counts(issues: List[Dict[str, Any]]) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for item in issues:
        code = str(item.get("code") or "").strip()
        if not code:
            continue
        counts[code] = counts.get(code, 0) + 1
    return _normalized_count_map(counts)


def _count_summary_text(
    counts: Dict[str, int],
    *,
    label_map: Dict[str, Any] | None = None,
    order: Iterable[str] | None = None,
) -> str:
    if not counts:
        return "none"
    parts: List[str] = []
    keys = list(order or counts.keys())
    if order is None:
        keys = sorted(keys)
    for key in keys:
        count = int(counts.get(key) or 0)
        if count <= 0:
            continue
        label = _count_label(key, count, label_map=label_map)
        parts.append(f"{count} {label}")
    return ", ".join(parts) if parts else "none"


def _top_highlights(issue_type_counts: Dict[str, int], *, limit: int = 3) -> List[str]:
    highlights: List[str] = []
    ordered_items = sorted(
        issue_type_counts.items(),
        key=lambda item: (-int(item[1]), _count_label(item[0], int(item[1]), label_map=_VALIDATION_ISSUE_LABELS)),
    )
    for code, count in ordered_items[:limit]:
        label = _count_label(code, int(count), label_map=_VALIDATION_ISSUE_LABELS)
        highlights.append(f"{int(count)} {label}")
    return highlights


def _normalized_count_map(value: Any, *, order: Iterable[str] | None = None) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    if isinstance(value, dict):
        for key, count in value.items():
            name = str(key).strip()
            if not name:
                continue
            counts[name] = _int_or_zero(count)
    ordered_keys = list(order or ())
    if order is not None:
        for key in ordered_keys:
            counts.setdefault(str(key), 0)
    ordered = sorted(counts)
    if order is not None:
        ordered = ordered_keys + [key for key in sorted(counts) if key not in ordered_keys]
    return {key: int(counts.get(key) or 0) for key in ordered if int(counts.get(key) or 0) > 0 or order is not None}


def _changed_count_entries(
    previous_counts: Dict[str, int],
    current_counts: Dict[str, int],
    *,
    label_map: Dict[str, Any] | None = None,
) -> List[Dict[str, Any]]:
    changed: List[Dict[str, Any]] = []
    for key in sorted(set(previous_counts) | set(current_counts)):
        previous_value = int(previous_counts.get(key) or 0)
        current_value = int(current_counts.get(key) or 0)
        if previous_value == current_value:
            continue
        changed.append(
            {
                "key": key,
                "label": _count_label(key, max(previous_value, current_value, 1), label_map=label_map),
                "previous_count": previous_value,
                "current_count": current_value,
                "delta": current_value - previous_value,
            }
        )
    changed.sort(key=lambda item: (abs(int(item.get("delta") or 0)) * -1, str(item.get("label") or "")))
    return changed


def _issue_type_delta_summary(changed_issue_types: List[Dict[str, Any]], *, limit: int = 3) -> str:
    fragments: List[str] = []
    for entry in changed_issue_types[:limit]:
        previous_count = int(entry.get("previous_count") or 0)
        current_count = int(entry.get("current_count") or 0)
        label = str(entry.get("label") or "issue type").strip()
        if previous_count == 0 and current_count > 0:
            fragments.append(f"introduced {label} ({previous_count} -> {current_count})")
        elif current_count == 0 and previous_count > 0:
            fragments.append(f"resolved {label} ({previous_count} -> {current_count})")
        elif current_count > previous_count:
            fragments.append(f"increased {label} ({previous_count} -> {current_count})")
        else:
            fragments.append(f"reduced {label} ({previous_count} -> {current_count})")
    return "; ".join(fragments)


def _category_delta_summary(changed_categories: List[Dict[str, Any]], *, limit: int = 3) -> str:
    fragments: List[str] = []
    for entry in changed_categories[:limit]:
        label = str(entry.get("label") or "category").strip()
        fragments.append(f"{label} {int(entry.get('previous_count') or 0)} -> {int(entry.get('current_count') or 0)}")
    return "; ".join(fragments)


def _count_label(key: str, count: int, *, label_map: Dict[str, Any] | None = None) -> str:
    if isinstance(label_map, dict):
        label = label_map.get(key)
        if isinstance(label, tuple):
            singular, plural = label
            return singular if count == 1 else plural
        if isinstance(label, str) and label.strip():
            return label.strip()
    if count == 1:
        return str(key).replace("_", " ").strip()
    return f"{str(key).replace('_', ' ').strip()}s"


def _int_or_zero(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _extract_layout_snapshot(details: Dict[str, Any]) -> Dict[str, Any]:
    candidate = _first_layout_candidate(details)
    if not isinstance(candidate, dict):
        return {}

    layout_id = str(candidate.get("layout_id") or details.get("layout_id") or "platformer_layout").strip() or "platformer_layout"
    layout_name = str(candidate.get("layout_name") or details.get("layout_name") or layout_id.replace("_", " ")).strip() or "platformer layout"
    surfaces: List[Dict[str, Any]] = []
    ladders: List[Dict[str, Any]] = []
    elevators: List[Dict[str, Any]] = []
    obstacles: List[Dict[str, Any]] = []
    objects: List[Dict[str, Any]] = []

    ground = _normalize_surface(candidate.get("ground"), object_id="ground", object_type="ground")
    if ground:
        surfaces.append({**ground, "surface_id": "ground", "surface_kind": "ground"})
        objects.append({**ground, "object_type": "ground"})

    for item in candidate.get("platforms", []):
        surface = _normalize_surface(item, object_id=str(item.get("name") or item.get("object_id") or "platform").strip(), object_type="platform")
        if not surface:
            continue
        surface["surface_id"] = str(surface.get("object_id") or "platform").strip()
        surface["surface_kind"] = "platform"
        surfaces.append(surface)
        objects.append(dict(surface))

    for item in candidate.get("ladders", []):
        ladder = _normalize_ladder(item)
        if ladder:
            ladders.append(ladder)
            objects.append(dict(ladder))

    for item in candidate.get("elevators", []):
        elevator = _normalize_elevator(item)
        if elevator:
            elevators.append(elevator)
            objects.append(dict(elevator))

    for item in candidate.get("objects", []):
        normalized = _normalize_object(item)
        if not normalized:
            continue
        object_type = str(normalized.get("object_type") or "").strip()
        if object_type == "platform":
            surface = _normalize_surface(normalized, object_id=str(normalized.get("object_id") or "platform").strip(), object_type="platform")
            if surface and not any(str(existing.get("surface_id") or "") == str(surface.get("object_id") or "") for existing in surfaces):
                surface["surface_id"] = str(surface.get("object_id") or "platform").strip()
                surface["surface_kind"] = "platform"
                surfaces.append(surface)
            objects.append(dict(normalized))
            continue
        if object_type == "ladder":
            ladder = _normalize_ladder(normalized)
            if ladder and not any(str(existing.get("object_id") or "") == str(ladder.get("object_id") or "") for existing in ladders):
                ladders.append(ladder)
            objects.append(dict(normalized))
            continue
        if object_type == "elevator":
            elevator = _normalize_elevator(normalized)
            if elevator and not any(str(existing.get("object_id") or "") == str(elevator.get("object_id") or "") for existing in elevators):
                elevators.append(elevator)
            objects.append(dict(normalized))
            continue
        if object_type in {"obstacle_cluster", "enemy_spawn_anchor", "collectible_anchor"}:
            obstacles.append(dict(normalized))
            objects.append(dict(normalized))

    if not surfaces:
        lowest_surfaces = [
            _normalize_surface(item, object_id=str(item.get("object_id") or item.get("name") or "platform").strip(), object_type="platform")
            for item in objects
            if str(item.get("object_type") or "").strip() == "platform"
        ]
        lowest_surfaces = [item for item in lowest_surfaces if item]
        for item in lowest_surfaces:
            item["surface_id"] = str(item.get("object_id") or "platform").strip()
            item["surface_kind"] = "platform"
            surfaces.append(item)

    return {
        "layout_id": layout_id,
        "layout_name": layout_name,
        "surfaces": _sorted_objects(surfaces),
        "ladders": _sorted_objects(ladders),
        "elevators": _sorted_objects(elevators),
        "obstacles": _sorted_objects(obstacles),
        "objects": _sorted_objects(objects),
    }


def _first_layout_candidate(details: Dict[str, Any]) -> Dict[str, Any] | None:
    for key in ("corrected_layout", "platformer_layout", "generated_layout", "layout", "level_data"):
        candidate = details.get(key)
        if isinstance(candidate, dict):
            return candidate
    return None


def _normalize_surface(value: Any, *, object_id: str, object_type: str) -> Dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    normalized = _normalize_object({**value, "object_id": object_id, "object_type": object_type})
    if not normalized:
        return None
    position = list(normalized.get("position") or [0.0, 0.0, 0.0])
    height = float(normalized.get("height") or _default_dimension(object_type, "height"))
    top_y = _float_or_none(value.get("top_y"))
    if top_y is None:
        if object_type == "ground":
            top_y = float(position[1])
        else:
            top_y = float(position[1])
    return {
        **normalized,
        "center_x": float(value.get("center_x") or position[0]),
        "center_z": float(value.get("center_z") or position[2]),
        "top_y": float(top_y),
        "width": float(value.get("width") or normalized.get("width") or _default_dimension(object_type, "width")),
        "depth": float(value.get("depth") or normalized.get("depth") or _default_dimension(object_type, "depth")),
        "height": height,
    }


def _normalize_ladder(value: Any) -> Dict[str, Any] | None:
    normalized = _normalize_object(value)
    if not normalized or str(normalized.get("object_type") or "") != "ladder":
        return None
    position = list(normalized.get("position") or [0.0, 0.0, 0.0])
    height = float(normalized.get("height") or _default_dimension("ladder", "height"))
    bottom_y = _float_or_none(value.get("bottom_y")) if isinstance(value, dict) else None
    top_y = _float_or_none(value.get("top_y")) if isinstance(value, dict) else None
    if bottom_y is None:
        bottom_y = float(position[1])
    if top_y is None:
        top_y = float(bottom_y) + height
    return {
        **normalized,
        "center_x": float(value.get("center_x") if isinstance(value, dict) and value.get("center_x") is not None else position[0]),
        "center_z": float(value.get("center_z") if isinstance(value, dict) and value.get("center_z") is not None else position[2]),
        "bottom_y": float(bottom_y),
        "top_y": float(top_y),
        "height": height,
    }


def _normalize_elevator(value: Any) -> Dict[str, Any] | None:
    normalized = _normalize_object(value)
    if not normalized or str(normalized.get("object_type") or "") != "elevator":
        return None
    position = list(normalized.get("position") or [0.0, 0.0, 0.0])
    travel_height = _float_or_none(value.get("travel_height")) if isinstance(value, dict) else None
    if travel_height is None:
        travel_height = _default_dimension("elevator", "travel_height")
    base_y = _float_or_none(value.get("base_y")) if isinstance(value, dict) else None
    if base_y is None:
        base_y = float(position[1])
    top_y = _float_or_none(value.get("top_y")) if isinstance(value, dict) else None
    if top_y is None:
        top_y = float(base_y) + float(travel_height)
    return {
        **normalized,
        "center_x": float(value.get("center_x") if isinstance(value, dict) and value.get("center_x") is not None else position[0]),
        "center_z": float(value.get("center_z") if isinstance(value, dict) and value.get("center_z") is not None else position[2]),
        "base_y": float(base_y),
        "top_y": float(top_y),
        "travel_height": float(travel_height),
        "width": float(normalized.get("width") or _default_dimension("elevator", "width")),
        "depth": float(normalized.get("depth") or _default_dimension("elevator", "depth")),
    }


def _normalize_object(value: Any) -> Dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    object_id = str(value.get("object_id") or value.get("name") or "").strip()
    object_type = _normalize_type(value.get("object_type") or value.get("type") or "")
    if not object_id or object_type not in SUPPORTED_PLATFORMER_LAYOUT_VALIDATION_TYPES | {"ground"}:
        return None
    position = _vector3(value.get("position"))
    if position is None:
        center_x = _float_or_none(value.get("center_x"))
        center_z = _float_or_none(value.get("center_z"))
        center_y = _float_or_none(value.get("center_y"))
        if center_y is None:
            center_y = _float_or_none(value.get("top_y"))
        if center_x is not None and center_y is not None and center_z is not None:
            position = [float(center_x), float(center_y), float(center_z)]
    if position is None:
        return None

    size = _vector3(value.get("size")) or _vector3(value.get("scale")) or []
    width = _float_or_none(value.get("width"))
    depth = _float_or_none(value.get("depth"))
    height = _float_or_none(value.get("height"))
    if width is None:
        width = float(size[0]) if len(size) >= 1 else _default_dimension(object_type, "width")
    if height is None:
        height = float(size[1]) if len(size) >= 2 else _default_dimension(object_type, "height")
    if depth is None:
        depth = float(size[2]) if len(size) >= 3 else _default_dimension(object_type, "depth")
    return {
        "object_id": object_id,
        "object_type": object_type,
        "position": [round(float(position[0]), 4), round(float(position[1]), 4), round(float(position[2]), 4)],
        "width": round(float(width), 4),
        "height": round(float(height), 4),
        "depth": round(float(depth), 4),
    }


def _player_capabilities_from_state(state: Dict[str, Any] | None, *, details: Dict[str, Any]) -> Dict[str, Any]:
    contexts = {}
    if isinstance(state, dict):
        tuning_state = state.get("session_tuning_state") if isinstance(state.get("session_tuning_state"), dict) else {}
        contexts = tuning_state.get("contexts") if isinstance(tuning_state.get("contexts"), dict) else {}
    platformer = contexts.get("platformer") if isinstance(contexts.get("platformer"), dict) else {}
    return {
        "jump_height": _first_float(
            details.get("new_jump_height"),
            details.get("jump_height_value"),
            ((platformer.get("jump_height") or {}) if isinstance(platformer.get("jump_height"), dict) else {}).get("observed_value"),
            1.2,
        ),
        "gravity": _first_float(
            details.get("new_gravity"),
            details.get("gravity_value"),
            ((platformer.get("gravity") or {}) if isinstance(platformer.get("gravity"), dict) else {}).get("observed_value"),
            9.81,
        ),
        "speed": _first_float(
            details.get("new_speed"),
            details.get("speed_value"),
            ((platformer.get("speed") or {}) if isinstance(platformer.get("speed"), dict) else {}).get("observed_value"),
            5.5,
        ),
        "max_step_height": 0.3,
    }


def _player_capabilities_from_details(details: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "jump_height": _first_float(details.get("new_jump_height"), details.get("jump_height_value"), 1.2),
        "gravity": _first_float(details.get("new_gravity"), details.get("gravity_value"), 9.81),
        "speed": _first_float(details.get("new_speed"), details.get("speed_value"), 5.5),
        "max_step_height": 0.3,
    }


def _normalize_player_capabilities(value: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "jump_height": max(0.0, float(value.get("jump_height", 1.2) or 1.2)),
        "gravity": abs(float(value.get("gravity", 9.81) or 9.81)) or 9.81,
        "speed": max(0.0, float(value.get("speed", 5.5) or 5.5)),
        "max_step_height": max(0.0, float(value.get("max_step_height", 0.3) or 0.3)),
    }


def _jump_capacity(player_capabilities: Dict[str, Any]) -> float:
    return float(player_capabilities.get("jump_height", 1.2) or 1.2)


def _gap_capacity(player_capabilities: Dict[str, Any]) -> float:
    jump_height = _jump_capacity(player_capabilities)
    gravity = abs(float(player_capabilities.get("gravity", 9.81) or 9.81)) or 9.81
    speed = float(player_capabilities.get("speed", 5.5) or 5.5)
    vertical_velocity = math.sqrt(max(0.0, 2.0 * gravity * jump_height))
    air_time = 0.0 if gravity == 0.0 else (2.0 * vertical_velocity) / gravity
    return max(0.0, speed * air_time)


def _reachable_surface_ids(
    *,
    surfaces: List[Dict[str, Any]],
    ladders: List[Dict[str, Any]],
    elevators: List[Dict[str, Any]],
    jump_capacity: float,
    gap_capacity: float,
    step_capacity: float,
) -> set[str]:
    surface_map = {str(surface.get("surface_id") or "").strip(): dict(surface) for surface in surfaces}
    reachable_ids = _starting_surface_ids(surfaces)
    changed = True
    while changed:
        changed = False
        for surface_id, surface in surface_map.items():
            if surface_id in reachable_ids:
                continue
            if any(
                _surface_reachable(
                    surface_map[source_id],
                    surface,
                    jump_capacity=jump_capacity,
                    gap_capacity=gap_capacity,
                    step_capacity=step_capacity,
                )
                for source_id in reachable_ids
                if source_id in surface_map
            ):
                reachable_ids.add(surface_id)
                changed = True

        for ladder in ladders:
            bottom_ids = _connected_surface_ids(surfaces, x=float(ladder.get("center_x", 0.0)), z=float(ladder.get("center_z", 0.0)), y=float(ladder.get("bottom_y", 0.0)))
            top_ids = _connected_surface_ids(surfaces, x=float(ladder.get("center_x", 0.0)), z=float(ladder.get("center_z", 0.0)), y=float(ladder.get("top_y", 0.0)))
            if bottom_ids & reachable_ids and top_ids - reachable_ids:
                reachable_ids.update(top_ids)
                changed = True

        for elevator in elevators:
            bottom_ids = _connected_surface_ids(surfaces, x=float(elevator.get("center_x", 0.0)), z=float(elevator.get("center_z", 0.0)), y=float(elevator.get("base_y", 0.0)))
            top_ids = _connected_surface_ids(surfaces, x=float(elevator.get("center_x", 0.0)), z=float(elevator.get("center_z", 0.0)), y=float(elevator.get("top_y", 0.0)))
            if bottom_ids & reachable_ids and top_ids - reachable_ids:
                reachable_ids.update(top_ids)
                changed = True
    return reachable_ids


def _starting_surface_ids(surfaces: List[Dict[str, Any]]) -> set[str]:
    ground_ids = {
        str(surface.get("surface_id") or "").strip()
        for surface in surfaces
        if str(surface.get("surface_kind") or "") == "ground" and str(surface.get("surface_id") or "").strip()
    }
    if ground_ids:
        return ground_ids
    platform_surfaces = [surface for surface in surfaces if str(surface.get("surface_kind") or "") == "platform"]
    if not platform_surfaces:
        return set()
    lowest_y = min(float(surface.get("top_y", 0.0)) for surface in platform_surfaces)
    return {
        str(surface.get("surface_id") or "").strip()
        for surface in platform_surfaces
        if abs(float(surface.get("top_y", 0.0)) - lowest_y) <= 0.25
    }


def _surface_reachable(
    source: Dict[str, Any],
    target: Dict[str, Any],
    *,
    jump_capacity: float,
    gap_capacity: float,
    step_capacity: float,
) -> bool:
    if str(source.get("surface_id") or "") == str(target.get("surface_id") or ""):
        return False
    height_delta = max(0.0, float(target.get("top_y", 0.0)) - float(source.get("top_y", 0.0)))
    gap = _surface_gap(source, target)
    if height_delta <= step_capacity and gap <= 0.6:
        return True
    return height_delta <= jump_capacity and gap <= gap_capacity


def _nearest_reachable_surface(
    surface: Dict[str, Any],
    *,
    reachable_surface_ids: set[str],
    surface_map: Dict[str, Dict[str, Any]],
) -> Dict[str, Any] | None:
    candidates: List[tuple[float, float, Dict[str, Any]]] = []
    for surface_id in reachable_surface_ids:
        candidate = surface_map.get(surface_id)
        if not isinstance(candidate, dict):
            continue
        gap = _surface_gap(candidate, surface)
        height_delta = max(0.0, float(surface.get("top_y", 0.0)) - float(candidate.get("top_y", 0.0)))
        candidates.append((gap, height_delta, candidate))
    if not candidates:
        return None
    candidates.sort(key=lambda item: (round(item[0], 4), round(item[1], 4), str(item[2].get("surface_id") or "")))
    return candidates[0][2]


def _unreachable_surface_issue(
    surface: Dict[str, Any],
    *,
    nearest_surface: Dict[str, Any] | None,
    jump_capacity: float,
    gap_capacity: float,
) -> Dict[str, Any]:
    surface_id = str(surface.get("surface_id") or surface.get("object_id") or "platform").strip() or "platform"
    position = _position_payload(surface)
    if not isinstance(nearest_surface, dict):
        return {
            "code": "unreachable_platform",
            "severity": "error",
            "object_id": surface_id,
            "object_type": "platform",
            "message": f"Unreachable platform detected at position {position}: no valid traversal origin was found.",
            "position": position,
        }
    gap = _surface_gap(nearest_surface, surface)
    height_delta = max(0.0, float(surface.get("top_y", 0.0)) - float(nearest_surface.get("top_y", 0.0)))
    source_label = str(nearest_surface.get("surface_id") or "ground").strip() or "ground"
    if gap > gap_capacity:
        return {
            "code": "gap_exceeds_jump_capability",
            "severity": "error",
            "object_id": surface_id,
            "object_type": "platform",
            "message": (
                f"Gap exceeds jump capability for {surface_id} at position {position}: "
                f"required gap {gap:.3f}m from {source_label}, max supported {gap_capacity:.3f}m."
            ),
            "position": position,
            "required_gap": round(gap, 3),
            "max_gap": round(gap_capacity, 3),
        }
    return {
        "code": "unreachable_platform",
        "severity": "error",
        "object_id": surface_id,
        "object_type": "platform",
        "message": (
            f"Unreachable platform detected at position {position}: required jump height {height_delta:.3f}m "
            f"from {source_label}, max supported {jump_capacity:.3f}m."
        ),
        "position": position,
        "required_jump_height": round(height_delta, 3),
        "max_jump_height": round(jump_capacity, 3),
    }


def _ladder_issues(
    ladder: Dict[str, Any],
    *,
    surfaces: List[Dict[str, Any]],
    reachable_surface_ids: set[str],
) -> List[Dict[str, Any]]:
    ladder_id = str(ladder.get("object_id") or "ladder").strip() or "ladder"
    x = float(ladder.get("center_x", 0.0))
    z = float(ladder.get("center_z", 0.0))
    bottom_y = float(ladder.get("bottom_y", 0.0))
    top_y = float(ladder.get("top_y", 0.0))
    bottom_ids = _connected_surface_ids(surfaces, x=x, z=z, y=bottom_y)
    top_ids = _connected_surface_ids(surfaces, x=x, z=z, y=top_y)
    issues: List[Dict[str, Any]] = []
    if not bottom_ids or not top_ids:
        issues.append(
            {
                "code": "invalid_ladder",
                "severity": "error",
                "object_id": ladder_id,
                "object_type": "ladder",
                "message": f"Ladder does not connect to valid platform surfaces: {ladder_id} ends in empty space.",
                "position": _position_payload(ladder),
            }
        )
        return issues
    if not (bottom_ids & reachable_surface_ids):
        issues.append(
            {
                "code": "invalid_ladder",
                "severity": "error",
                "object_id": ladder_id,
                "object_type": "ladder",
                "message": f"Ladder base is not connected to a reachable traversal path: {ladder_id}.",
                "position": _position_payload(ladder),
            }
        )
    return issues


def _elevator_issues(
    elevator: Dict[str, Any],
    *,
    surfaces: List[Dict[str, Any]],
    reachable_surface_ids: set[str],
) -> List[Dict[str, Any]]:
    elevator_id = str(elevator.get("object_id") or "elevator").strip() or "elevator"
    x = float(elevator.get("center_x", 0.0))
    z = float(elevator.get("center_z", 0.0))
    base_y = float(elevator.get("base_y", 0.0))
    top_y = float(elevator.get("top_y", 0.0))
    bottom_ids = _connected_surface_ids(surfaces, x=x, z=z, y=base_y)
    top_ids = _connected_surface_ids(surfaces, x=x, z=z, y=top_y)
    issues: List[Dict[str, Any]] = []
    if not bottom_ids or not (bottom_ids & reachable_surface_ids):
        issues.append(
            {
                "code": "unreachable_elevator",
                "severity": "error",
                "object_id": elevator_id,
                "object_type": "elevator",
                "message": f"Elevator is outside the reachable traversal path: {elevator_id}.",
                "position": _position_payload(elevator),
            }
        )
    if not top_ids:
        issues.append(
            {
                "code": "invalid_elevator_destination",
                "severity": "error",
                "object_id": elevator_id,
                "object_type": "elevator",
                "message": f"Elevator does not connect to a valid destination platform: {elevator_id}.",
                "position": _position_payload(elevator),
            }
        )
    return issues


def _overlap_and_crowding_issues(objects: List[Dict[str, Any]], *, obstacles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    issues: List[Dict[str, Any]] = []
    seen_overlap_pairs: set[tuple[str, str]] = set()
    seen_crowding_ids: set[str] = set()
    sorted_objects = _sorted_objects(objects)
    for index, left in enumerate(sorted_objects):
        left_id = str(left.get("object_id") or "").strip()
        if not left_id:
            continue
        crowding_neighbors = 0
        for right in sorted_objects[index + 1 :]:
            right_id = str(right.get("object_id") or "").strip()
            if not right_id:
                continue
            if _skip_structural_overlap(left, right):
                continue
            if _objects_overlap(left, right):
                pair = tuple(sorted((left_id, right_id)))
                if pair not in seen_overlap_pairs:
                    seen_overlap_pairs.add(pair)
                    issues.append(
                        {
                            "code": "overlapping_objects",
                            "severity": "warning",
                            "object_id": left_id,
                            "other_object_id": right_id,
                            "object_type": str(left.get("object_type") or "").strip(),
                            "message": f"Overlapping objects detected: {left_id} overlaps {right_id}.",
                            "position": _position_payload(left),
                        }
                    )
            if _object_distance(left, right) < _CROWDING_RADIUS and abs(float(left.get("position", [0.0, 0.0, 0.0])[1]) - float(right.get("position", [0.0, 0.0, 0.0])[1])) <= 1.0:
                crowding_neighbors += 1
        if crowding_neighbors >= 2 and left_id not in seen_crowding_ids:
            seen_crowding_ids.add(left_id)
            issues.append(
                {
                    "code": "cramped_layout",
                    "severity": "warning",
                    "object_id": left_id,
                    "object_type": str(left.get("object_type") or "").strip(),
                    "message": f"Obstacle density exceeds safe threshold near {left_id}.",
                    "position": _position_payload(left),
                }
            )

    obstacle_objects = [item for item in obstacles if str(item.get("object_type") or "") == "obstacle_cluster"]
    for obstacle in obstacle_objects:
        obstacle_id = str(obstacle.get("object_id") or "").strip()
        if not obstacle_id or obstacle_id in seen_crowding_ids:
            continue
        nearby_count = sum(1 for other in obstacle_objects if _object_distance(obstacle, other) <= _CROWDING_CLUSTER_RADIUS)
        if nearby_count > _CROWDING_CLUSTER_LIMIT:
            seen_crowding_ids.add(obstacle_id)
            issues.append(
                {
                    "code": "cramped_layout",
                    "severity": "warning",
                    "object_id": obstacle_id,
                    "object_type": "obstacle_cluster",
                    "message": f"Obstacle density exceeds safe threshold near {obstacle_id}.",
                    "position": _position_payload(obstacle),
                }
            )
    return issues


def _connected_surface_ids(surfaces: Iterable[Dict[str, Any]], *, x: float, z: float, y: float) -> set[str]:
    connected: set[str] = set()
    for surface in surfaces:
        surface_id = str(surface.get("surface_id") or "").strip()
        if not surface_id:
            continue
        if abs(float(surface.get("top_y", 0.0)) - y) > _CONNECTION_VERTICAL_TOLERANCE:
            continue
        if _point_inside_surface(x=x, z=z, surface=surface):
            connected.add(surface_id)
    return connected


def _point_inside_surface(*, x: float, z: float, surface: Dict[str, Any]) -> bool:
    half_width = float(surface.get("width", 0.0)) / 2.0 + 0.3
    half_depth = float(surface.get("depth", 0.0)) / 2.0 + 0.3
    return (
        abs(x - float(surface.get("center_x", 0.0))) <= half_width
        and abs(z - float(surface.get("center_z", 0.0))) <= half_depth
    )


def _surface_gap(left: Dict[str, Any], right: Dict[str, Any]) -> float:
    dx = max(
        0.0,
        abs(float(left.get("center_x", 0.0)) - float(right.get("center_x", 0.0)))
        - (float(left.get("width", 0.0)) / 2.0 + float(right.get("width", 0.0)) / 2.0),
    )
    dz = max(
        0.0,
        abs(float(left.get("center_z", 0.0)) - float(right.get("center_z", 0.0)))
        - (float(left.get("depth", 0.0)) / 2.0 + float(right.get("depth", 0.0)) / 2.0),
    )
    return math.hypot(dx, dz)


def _objects_overlap(left: Dict[str, Any], right: Dict[str, Any]) -> bool:
    if _axis_gap(left.get("position", [0.0, 0.0, 0.0])[0], left.get("width", 0.0), right.get("position", [0.0, 0.0, 0.0])[0], right.get("width", 0.0)) > 0.0:
        return False
    if _axis_gap(left.get("position", [0.0, 0.0, 0.0])[2], left.get("depth", 0.0), right.get("position", [0.0, 0.0, 0.0])[2], right.get("depth", 0.0)) > 0.0:
        return False
    if _axis_gap(left.get("position", [0.0, 0.0, 0.0])[1], left.get("height", 0.0), right.get("position", [0.0, 0.0, 0.0])[1], right.get("height", 0.0)) > 0.35:
        return False
    return True


def _skip_structural_overlap(left: Dict[str, Any], right: Dict[str, Any]) -> bool:
    left_type = str(left.get("object_type") or "").strip()
    right_type = str(right.get("object_type") or "").strip()
    return {left_type, right_type} in ({"ladder", "platform"}, {"elevator", "platform"})


def _axis_gap(left_center: Any, left_size: Any, right_center: Any, right_size: Any) -> float:
    return max(0.0, abs(float(left_center or 0.0) - float(right_center or 0.0)) - (float(left_size or 0.0) / 2.0 + float(right_size or 0.0) / 2.0))


def _object_distance(left: Dict[str, Any], right: Dict[str, Any]) -> float:
    left_position = list(left.get("position") or [0.0, 0.0, 0.0])
    right_position = list(right.get("position") or [0.0, 0.0, 0.0])
    return math.dist((float(left_position[0]), float(left_position[1]), float(left_position[2])), (float(right_position[0]), float(right_position[1]), float(right_position[2])))


def _position_payload(value: Dict[str, Any]) -> List[float]:
    position = _vector3(value.get("position"))
    if position is not None:
        return [round(float(item), 3) for item in position]
    return [
        round(float(value.get("center_x", 0.0)), 3),
        round(float(value.get("top_y", value.get("base_y", 0.0)) or 0.0), 3),
        round(float(value.get("center_z", 0.0)), 3),
    ]


def _sorted_issues(issues: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    severity_rank = {"error": 0, "warning": 1, "info": 2}
    return sorted(
        issues,
        key=lambda item: (
            severity_rank.get(str(item.get("severity") or "warning"), 9),
            str(item.get("code") or ""),
            str(item.get("object_id") or ""),
            str(item.get("other_object_id") or ""),
        ),
    )


def _sorted_objects(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return sorted(items, key=lambda item: (str(item.get("object_type") or ""), str(item.get("object_id") or item.get("surface_id") or "")))


def _normalize_type(value: Any) -> str:
    text = str(value or "").strip().lower()
    chars: List[str] = []
    previous_separator = False
    for character in text:
        if character.isalnum():
            chars.append(character)
            previous_separator = False
            continue
        if previous_separator:
            continue
        chars.append("_")
        previous_separator = True
    return "".join(chars).strip("_")


def _default_dimension(object_type: str, dimension: str) -> float:
    return float((_DEFAULT_DIMENSIONS.get(object_type) or {}).get(dimension) or 1.0)


def _vector3(value: Any) -> List[float] | None:
    if not isinstance(value, list) or len(value) < 3:
        return None
    try:
        return [float(value[0]), float(value[1]), float(value[2])]
    except (TypeError, ValueError):
        return None


def _float_or_none(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _first_float(*values: Any) -> float:
    for value in values:
        converted = _float_or_none(value)
        if converted is not None:
            return float(converted)
    return 0.0


__all__ = [
    "SUPPORTED_PLATFORMER_LAYOUT_VALIDATION_TYPES",
    "enrich_platformer_layout_validation_result",
    "extract_platformer_layout_validation_metadata",
    "validate_platformer_layout_snapshot",
]