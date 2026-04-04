# AI-E Platformer Procedural Readiness

## Scope

This note defines the bounded tuning families AI-E is expected to support later for procedural platformer work. It does not implement procedural generation in this phase.

## Future Bounded Families

- `gap_size`
- `obstacle_density`
- `collectible_density`
- `hazard_density`
- `enemy_density`
- `route_complexity`
- `segment_count`
- `level_length`
- `room_count`

## Candidate Generic Mapping Shape

- `gap_size`
	likely target_system: `layout`
	likely parameter_family: `gap_size`
	likely bounded tiers: `small / standard / large`
	orientation: `layout`

- `obstacle_density`
	likely target_system: `layout`
	likely parameter_family: `obstacle_density`
	likely bounded tiers: `low / standard / high`
	orientation: `layout`

- `collectible_density`
	likely target_system: `reward`
	likely parameter_family: `collectible_density`
	likely bounded tiers: `low / standard / high`
	orientation: `reward`

- `hazard_density`
	likely target_system: `encounter`
	likely parameter_family: `hazard_density`
	likely bounded tiers: `low / standard / high`
	orientation: `encounter`

- `enemy_density`
	likely target_system: `encounter`
	likely parameter_family: `enemy_density`
	likely bounded tiers: `low / standard / high`
	orientation: `encounter`

- `route_complexity`
	likely target_system: `layout`
	likely parameter_family: `route_complexity`
	likely bounded tiers: `simple / standard / complex`
	orientation: `layout`

- `segment_count`
	likely target_system: `layout`
	likely parameter_family: `segment_count`
	likely bounded tiers: `low / standard / high`
	orientation: `layout`

- `room_count`
	likely target_system: `layout`
	likely parameter_family: `room_count`
	likely bounded tiers: `low / standard / high`
	orientation: `layout`

- `level_length`
	likely target_system: `layout`
	likely parameter_family: `level_length`
	likely bounded tiers: `short / standard / long`
	orientation: `layout`

## Intended Bounded Use

Future procedural platformer support should remain deterministic and bounded in the same style as current tuning domains:

- explicit prompt or explicit plan only
- bounded tiers or deterministic values only
- structured evaluation only
- no autonomous layout invention without an approved bounded family

## Architectural Readiness Rules

- Reuse the generic capability schema.
- Reuse experiment tracking, decision tracking, navigation, and cross-experiment comparison.
- Preserve explicit context and ambiguity blocking.
- Treat procedural families as additive bounded systems, not as a planner redesign.

## Super Monkee Readiness Goal

This milestone keeps AI-E ready for future Super Monkee requirements such as multi-level variation and different startup layouts, while deferring actual procedural generation until bounded families and execution contracts are explicitly defined.