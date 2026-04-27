import { test, expect } from '@playwright/test';

test('operator smoke pass', async ({ page }) => {
  await page.goto('http://localhost:3000/operator');
  
  // 1) Page loaded with no 500/build error
  await expect(page.locator('text=/Internal Server Error|Build Error/i')).not.toBeVisible();
  await page.screenshot({ path: 'e:/AI projects 2025/AI-E/runner_artifacts/operator-live-provider-initial.png' });
  console.log('Result: Build Error: false');

  // 2) 'State Source:' banner visible
  await expect(page.locator('text=State Source:')).first().toBeVisible();
  console.log('Result: Source Banner Visible: true');

  // 3) 'Demo Seed' visible
  await expect(page.locator('text=Demo Seed').first()).toBeVisible();
  console.log('Result: Demo Seed Visible: true');

  // 4) Approve click
  const approveBtn = page.locator('button:has-text("Approve")').first();
  if (await approveBtn.isVisible()) {
    await approveBtn.click();
    await page.waitForTimeout(1000);
    console.log('Result: Action Approve executed.');
  }
  await page.screenshot({ path: 'e:/AI projects 2025/AI-E/runner_artifacts/operator-live-provider-approved.png' });

  // 5) Pause click
  const pauseBtn = page.locator('button:has-text("Pause")').first();
  if (await pauseBtn.isVisible()) {
    await pauseBtn.click();
    await page.waitForTimeout(1000);
    console.log('Result: Action Pause executed.');
  }
  await page.screenshot({ path: 'e:/AI projects 2025/AI-E/runner_artifacts/operator-live-provider-paused.png' });

  // 6) Resume click
  const resumeBtn = page.locator('button:has-text("Resume")').first();
  if (await resumeBtn.isVisible()) {
    await resumeBtn.click();
    await page.waitForTimeout(1000);
    console.log('Result: Action Resume executed.');
  }
  await page.screenshot({ path: 'e:/AI projects 2025/AI-E/runner_artifacts/operator-live-provider-resumed.png' });

  // 7) Retry click
  const retryBtn = page.locator('button:has-text("Retry")').first();
  if (await retryBtn.isVisible()) {
    await retryBtn.click();
    await page.waitForTimeout(1000);
    console.log('Result: Action Retry executed.');
  }
  await page.screenshot({ path: 'e:/AI projects 2025/AI-E/runner_artifacts/operator-live-provider-retried.png' });
});
