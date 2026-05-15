const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const results = {
    loadSuccess: false,
    noErrors: true,
    stateSourceVisible: false,
    demoSeedFound: false,
    approveSuccess: false,
    pauseSuccess: false,
    resumeSuccess: false,
    retrySuccess: false
  };

  try {
    await page.goto("http://localhost:3000/operator");
    const content = await page.content();
    
    if (content.includes("500") || content.includes("Module build failed")) {
      results.noErrors = false;
    }
    results.loadSuccess = true;

    results.stateSourceVisible = await page.isVisible("text=State Source:");
    results.demoSeedFound = await page.isVisible("text=Demo Seed");

    await page.screenshot({ path: "E:/AI projects 2025/AI-E/runner_artifacts/operator-live-provider-initial.png" });
    console.log("Initial page loaded");

    const approveBtn = page.locator("button:has-text(\"Approve\")");
    if (await approveBtn.count() > 0) {
      await approveBtn.first().click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: "E:/AI projects 2025/AI-E/runner_artifacts/operator-live-provider-approved.png" });
      results.approveSuccess = true;
      console.log("Approve clicked");
    }

    const pauseBtn = page.locator("button:has-text(\"Pause\")");
    if (await pauseBtn.count() > 0) {
      await pauseBtn.first().click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: "E:/AI projects 2025/AI-E/runner_artifacts/operator-live-provider-paused.png" });
      results.pauseSuccess = true;
      console.log("Pause clicked");
    }

    const resumeBtn = page.locator("button:has-text(\"Resume\")");
    if (await resumeBtn.count() > 0) {
      await resumeBtn.first().click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: "E:/AI projects 2025/AI-E/runner_artifacts/operator-live-provider-resumed.png" });
      results.resumeSuccess = true;
      console.log("Resume clicked");
    }

    const retryBtn = page.locator("button:has-text(\"Retry\")");
    if (await retryBtn.count() > 0) {
      await retryBtn.first().click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: "E:/AI projects 2025/AI-E/runner_artifacts/operator-live-provider-retried.png" });
      results.retrySuccess = true;
      console.log("Retry clicked");
    }

    console.log(JSON.stringify(results, null, 2));
  } catch (err) {
    console.error(err);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
