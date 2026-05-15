# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke_operator.spec.ts >> operator smoke pass
- Location: smoke_operator.spec.ts:3:5

# Error details

```
Error: expect: Property 'first' not found.
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - main [ref=e2]:
    - generic [ref=e3]:
      - generic [ref=e4]:
        - generic [ref=e5]:
          - generic [ref=e6]:
            - paragraph [ref=e7]: Operator Dashboard v0
            - heading "See runtime state, blockers, and operator actions in one surface." [level=1] [ref=e8]
            - paragraph [ref=e9]: This minimal UI uses the dashboard-state read model plus a runtime state provider to show what AI-E is doing, what is blocked, and what the operator can change next.
          - generic [ref=e10]:
            - link "Home" [ref=e11] [cursor=pointer]:
              - /url: /
            - button "Refresh state" [ref=e12] [cursor=pointer]
        - generic [ref=e13]:
          - paragraph [ref=e14]: "State Source: Demo Seed"
          - paragraph [ref=e15]: This dashboard is using seeded demo state. It demonstrates AI-E reasoning and controls but is not connected to live runtime state yet.
          - paragraph [ref=e16]: No live runtime state store and runtime id were provided to the operator runtime state provider. This dashboard is using seeded demo state. It demonstrates AI-E reasoning and controls but is not connected to live runtime state yet.
        - generic [ref=e17]:
          - generic [ref=e18]:
            - paragraph [ref=e19]: Runtime
            - generic [ref=e21]: runtime paused
            - paragraph [ref=e22]: Explicit session approval is required before the work session can run.
          - generic [ref=e23]:
            - paragraph [ref=e24]: Queue
            - generic [ref=e26]: queue idle
            - paragraph [ref=e27]: No background queue is currently active.
          - generic [ref=e28]:
            - paragraph [ref=e29]: Updated
            - paragraph [ref=e30]: 2026-04-26T12:00:00.000Z
            - paragraph [ref=e31]: Demo Seed state loaded.
      - generic [ref=e32]:
        - generic [ref=e33]:
          - paragraph [ref=e34]: "1"
          - heading "Active Goal" [level=2] [ref=e35]
          - article [ref=e37]:
            - generic [ref=e38]:
              - generic [ref=e39]:
                - generic [ref=e40]:
                  - heading "Stabilize KBM input lane" [level=3] [ref=e41]
                  - generic [ref=e42]: active
                - paragraph [ref=e43]: This goal is currently running because it already owns the active execution slot.
                - paragraph [ref=e44]: Priority high
              - button "Pause" [ref=e46] [cursor=pointer]
        - generic [ref=e47]:
          - paragraph [ref=e48]: "2"
          - heading "Goal Queue" [level=2] [ref=e49]
          - generic [ref=e51]:
            - article [ref=e52]:
              - generic [ref=e54]:
                - generic [ref=e55]:
                  - heading "Renew approval for bounded runtime handoff" [level=3] [ref=e56]
                  - generic [ref=e57]: pending
                - paragraph [ref=e58]: This goal is queued and waiting for selection.
                - paragraph [ref=e59]: Priority medium
            - article [ref=e60]:
              - generic [ref=e62]:
                - generic [ref=e63]:
                  - heading "Audit reload window timing" [level=3] [ref=e64]
                  - generic [ref=e65]: pending
                - paragraph [ref=e66]: This goal is queued and waiting for selection.
                - paragraph [ref=e67]: Priority medium
            - generic [ref=e68]:
              - paragraph [ref=e69]: Paused goals
              - paragraph [ref=e71]: No paused goals.
        - generic [ref=e72]:
          - paragraph [ref=e73]: "3"
          - heading "Blocked Goals" [level=2] [ref=e74]
          - article [ref=e77]:
            - generic [ref=e78]:
              - generic [ref=e79]:
                - generic [ref=e80]:
                  - heading "Verify grenade launch lane" [level=3] [ref=e81]
                  - generic [ref=e82]: dependency
                - paragraph [ref=e83]: Verify grenade launch lane depends_on stabilize-kbm-input.
                - paragraph [ref=e84]: "Blockers: stabilize-kbm-input"
              - button "Retry" [ref=e85] [cursor=pointer]
        - generic [ref=e86]:
          - paragraph [ref=e87]: "4"
          - heading "Recovery Recommendations" [level=2] [ref=e88]
          - generic [ref=e90]:
            - article [ref=e91]:
              - generic [ref=e92]:
                - generic [ref=e93]:
                  - generic [ref=e94]:
                    - heading "request operator review" [level=3] [ref=e95]
                    - generic [ref=e96]: high
                  - paragraph [ref=e97]: "Matched failure codes: missing_file; validation status: validation_failed; validation recommendation: review_required. The event indicates an expected file or output is missing."
                  - paragraph [ref=e98]: "Source: controlled_validation | Category: missing_file"
                - button "Retry verify-grenade-lane" [ref=e99] [cursor=pointer]
            - article [ref=e100]:
              - generic [ref=e101]:
                - generic [ref=e102]:
                  - generic [ref=e103]:
                    - heading "retry after refresh" [level=3] [ref=e104]
                    - generic [ref=e105]: medium
                  - paragraph [ref=e106]: "Matched blocker codes: session_approval_required; validation status: validation_passed; validation recommendation: keep_changes. The event indicates stale or missing approval state."
                  - paragraph [ref=e107]: "Source: session_runtime | Category: stale_approval"
                - button "Retry verify-grenade-lane" [ref=e108] [cursor=pointer]
        - generic [ref=e109]:
          - paragraph [ref=e110]: "5"
          - heading "Approvals Required" [level=2] [ref=e111]
          - article [ref=e114]:
            - generic [ref=e115]:
              - generic [ref=e116]:
                - generic [ref=e117]:
                  - heading "autonomous-work-session-20260426115200-renew-approval-for-bounded-runtime-hando" [level=3] [ref=e118]
                  - generic [ref=e119]: approval required
                - paragraph [ref=e120]: Explicit session approval is required before the work session can run.
                - paragraph [ref=e121]: "Needs: session"
              - button "Approve" [ref=e122] [cursor=pointer]
        - generic [ref=e123]:
          - paragraph [ref=e124]: "6"
          - heading "Runtime Status" [level=2] [ref=e125]
          - article [ref=e128]:
            - generic [ref=e129]:
              - generic [ref=e130]: runtime paused
              - generic [ref=e131]: session planned
              - generic [ref=e132]: goal selected
            - paragraph [ref=e133]: Explicit session approval is required before the work session can run.
            - paragraph [ref=e134]: "session_planned: 0/0 cycles completed for Renew approval for bounded runtime handoff"
            - paragraph [ref=e135]: Continuing active goal 'Stabilize KBM input lane'.
  - alert [ref=e136]
```

# Test source

```ts
  1  | ﻿import { test, expect } from '@playwright/test';
  2  | 
  3  | test('operator smoke pass', async ({ page }) => {
  4  |   await page.goto('http://localhost:3000/operator');
  5  |   
  6  |   // 1) Page loaded with no 500/build error
  7  |   await expect(page.locator('text=/Internal Server Error|Build Error/i')).not.toBeVisible();
  8  |   await page.screenshot({ path: 'e:/AI projects 2025/AI-E/runner_artifacts/operator-live-provider-initial.png' });
  9  |   console.log('Result: Build Error: false');
  10 | 
  11 |   // 2) 'State Source:' banner visible
> 12 |   await expect(page.locator('text=State Source:')).first().toBeVisible();
     |                                                   ^ Error: expect: Property 'first' not found.
  13 |   console.log('Result: Source Banner Visible: true');
  14 | 
  15 |   // 3) 'Demo Seed' visible
  16 |   await expect(page.locator('text=Demo Seed').first()).toBeVisible();
  17 |   console.log('Result: Demo Seed Visible: true');
  18 | 
  19 |   // 4) Approve click
  20 |   const approveBtn = page.locator('button:has-text("Approve")').first();
  21 |   if (await approveBtn.isVisible()) {
  22 |     await approveBtn.click();
  23 |     await page.waitForTimeout(1000);
  24 |     console.log('Result: Action Approve executed.');
  25 |   }
  26 |   await page.screenshot({ path: 'e:/AI projects 2025/AI-E/runner_artifacts/operator-live-provider-approved.png' });
  27 | 
  28 |   // 5) Pause click
  29 |   const pauseBtn = page.locator('button:has-text("Pause")').first();
  30 |   if (await pauseBtn.isVisible()) {
  31 |     await pauseBtn.click();
  32 |     await page.waitForTimeout(1000);
  33 |     console.log('Result: Action Pause executed.');
  34 |   }
  35 |   await page.screenshot({ path: 'e:/AI projects 2025/AI-E/runner_artifacts/operator-live-provider-paused.png' });
  36 | 
  37 |   // 6) Resume click
  38 |   const resumeBtn = page.locator('button:has-text("Resume")').first();
  39 |   if (await resumeBtn.isVisible()) {
  40 |     await resumeBtn.click();
  41 |     await page.waitForTimeout(1000);
  42 |     console.log('Result: Action Resume executed.');
  43 |   }
  44 |   await page.screenshot({ path: 'e:/AI projects 2025/AI-E/runner_artifacts/operator-live-provider-resumed.png' });
  45 | 
  46 |   // 7) Retry click
  47 |   const retryBtn = page.locator('button:has-text("Retry")').first();
  48 |   if (await retryBtn.isVisible()) {
  49 |     await retryBtn.click();
  50 |     await page.waitForTimeout(1000);
  51 |     console.log('Result: Action Retry executed.');
  52 |   }
  53 |   await page.screenshot({ path: 'e:/AI projects 2025/AI-E/runner_artifacts/operator-live-provider-retried.png' });
  54 | });
  55 | 
```