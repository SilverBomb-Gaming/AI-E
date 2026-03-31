# AI-E V1 Validation Plan

## Validation Plan

1. Clean-profile smoke test
   Verify the first launch experience with no saved local profile state and confirm the core home -> intake -> result path still works cleanly.
2. Packaged-launch verification
   Verify the packaged app starts cleanly, shows the same v1 surface, and does not depend on a source-only workflow.
3. Demo script validation
   Rehearse the recommended demo path end to end and confirm the visible wording supports a confident walkthrough.
4. Supported-use statement
   Lock the short customer-facing statement that explains what AI-E supports today and what it does not.
5. Recovery/support notes
   Prepare concise local-user notes for blocked requests, missing projects, missing results, and profile reset/recovery.

## Step V1: Clean-Profile Smoke Test Readiness

This step prepares the minimum baseline needed to test AI-E without prior local state.

### Baseline

- Remove or rename `app_state.local.json` before the test so AI-E starts without saved runtime state.
- AI-E will seed a fresh local profile from `app_state.example.json`.
- The example state is intentionally clean for this validation pass:
  - no saved exe path
  - no saved project selection
  - no saved staged prompt
  - onboarding visible on first launch

### What Needs To Be Checked

- startup behavior with no saved profile
- recommended project selection when supported projects are available
- onboarding appearance, dismissal, and manual reopen
- first request path from home -> intake -> review/status -> result
- result and history visibility after a completed run
- failure and blocked-path sanity with an unsupported request

### Exact Smoke-Test Steps

1. Close AI-E.
2. Rename or move `app_state.local.json` out of the repo root.
3. Launch AI-E.
4. Confirm the Home screen loads without prior project, prompt, or onboarding-dismissal state.
5. Confirm AI-E auto-selects the recommended supported project when one is available.
6. Confirm the `Getting Started` panel is visible.
7. Click `Hide tips`, restart AI-E, and confirm the panel stays hidden.
8. Use `Help > Getting Started` and confirm the panel reopens.
9. Use the recommended first request `move zombie forward`.
10. Choose `Prepare Request` and confirm AI-E shows a clear intake decision.
11. If the request is `Ready`, submit it. If it needs approval, open review and use `Approve once`. If it is blocked, revise it to stay within supported scope and prepare it again.
12. Confirm `Live Run Status` can be followed and that `Result Summary` or `Project / Session History` shows the saved outcome after completion.
13. Enter an intentionally unsupported request, prepare it, and confirm the blocked explanation gives a safe next step.

## Deferred To V2+

- Packaged app verification
- Demo rehearsal timing and script polish
- Final supported-use statement for customer handoff
- Recovery/support notes for local-user distribution
