# Platformer Layout Spatial Validation

## Purpose

AI-E now performs bounded spatial validation for platformer layouts. This layer detects invalid or nonsensical geometry and reports deterministic findings through the existing result, experiment, evaluation, and proof surfaces.

This layer does not move geometry, regenerate layouts, or silently fix traversal problems.

## Supported Checks

- Reachability for platform surfaces against the current jump, gravity, and speed envelope
- Ladder endpoint validity
- Elevator reachability and destination validity
- Gap feasibility against current jump distance
- Overlap and crowding heuristics for structural objects and obstacle clusters

## Supported Inputs

The validator accepts either:

- corrected layout payloads with an `objects` list
- richer level-data payloads with `ground`, `platforms`, `ladders`, `elevators`, and `objects`

When payloads only provide positions, AI-E uses documented deterministic defaults for object dimensions. Those defaults are used for detection only.

## Output Fields

Validation results are stored on result details using fields such as:

- `layout_validation_available`
- `layout_validation_status`
- `layout_validation_summary`
- `layout_validation_issue_count`
- `layout_validation_blocking_issue_count`
- `layout_validation_issue_codes`
- `layout_validation_issue_messages`
- `layout_validation_issues`

## Example Findings

- `Unreachable platform detected at position [8.0, 2.0, 0.0]`
- `Ladder does not connect to valid platform surfaces`
- `Gap exceeds jump capability for platform_far`
- `Obstacle density exceeds safe threshold near obstacle_cluster_02`

## Safety Boundaries

- No autonomous correction is performed.
- No geometry is moved automatically.
- No procedural redesign is triggered by this layer.
- Manual correction remains the required human step when issues are detected.