# SUMMARY

AI-E has entered the project context injection and workflow approval UX frontier. Runtime routing now carries lightweight project meaning into provider prompts, and mutation-capable workflow replies expose a visible pending-approval state in the conversation shell.

# FACTS

- Runtime prompts now include BABYLON project context when the user references BABYLON.
- BABYLON is explicitly described as the user's current game project, not an acronym.
- Routed responses are normalized to remove invented BABYLON acronym expansions.
- Approval-required routed replies now show a scoped action pending card in the conversation panel.
- The pending card presents request, risk, boundary, and actions for approve plan, cancel, and view scope.
- Approval card visibility is driven by AI-E governance state, not runtime text.
- Regression tests cover BABYLON context preservation and approval-card scope helpers.

# ASSUMPTIONS

- BABYLON is the user's current game project in this workspace context.
- Approval UX in this slice records plan approval only; it does not execute mutations or commands.
- Future bounded execution work will connect approved plans to actual mutation/execution workflows.

# RECOMMENDATIONS

- Promote project context into a configurable project profile when more projects are supported.
- Persist pending approval records in a backend workflow store before enabling execution.
- Keep runtime text advisory and keep AI-E truth lines/card state as the operational source of authority.

# TIMESTAMP

2026-05-18
