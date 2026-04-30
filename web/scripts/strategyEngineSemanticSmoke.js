const { chromium } = require("playwright");

function extractSection(page, headingName) {
  return page
    .getByRole("heading", { name: headingName, exact: true })
    .locator("xpath=ancestor::section[1]")
    .innerText();
}

async function waitForOperatorPage(page, url, timeout = 120000) {
  const startedAt = Date.now();
  let lastError = null;

  while ((Date.now() - startedAt) < timeout) {
    try {
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      if (response && response.ok()) {
        return;
      }
      lastError = new Error(`Navigation reached ${url} without an OK response.`);
    } catch (error) {
      lastError = error;
    }

    await page.waitForTimeout(500);
  }

  throw new Error([
    `Timed out waiting for ${url} to become reachable.`,
    lastError instanceof Error ? lastError.message : String(lastError),
  ].join("\n\n"));
}

async function waitForSectionText(page, headingName, predicate, timeout = 20000) {
  const startedAt = Date.now();
  let lastSectionText = null;

  while ((Date.now() - startedAt) < timeout) {
    try {
      lastSectionText = await extractSection(page, headingName);
      if (predicate(lastSectionText)) {
        return lastSectionText;
      }
    } catch {
      lastSectionText = null;
    }

    await page.waitForTimeout(250);
  }

  throw new Error(`Timed out waiting for section ${headingName}. Last text: ${lastSectionText ?? "<unavailable>"}`);
}

async function snapshot(page, label) {
  return {
    label,
    stateSource: await page.locator("main").locator("text=State Source:").first().innerText(),
    strategySection: await extractSection(page, "Strategy Portfolio"),
    runtimeIntrospection: await extractSection(page, "Runtime Introspection"),
    strategySummary: await page.getByText("Top recommended goal:", { exact: false }).count()
      ? await page.getByText("Top recommended goal:", { exact: false }).locator("xpath=ancestor::article[1]").innerText()
      : null,
  };
}

async function main() {
  const url = process.env.AIE_OPERATOR_SMOKE_URL || "http://127.0.0.1:3019/operator";
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await waitForOperatorPage(page, url);
    await page.getByText("State Source: Live Runtime", { exact: false }).waitFor({ timeout: 30000 });
    await page.getByText("Client Controls: Ready", { exact: false }).waitFor({ timeout: 30000 });
    await waitForSectionText(
      page,
      "Strategy Portfolio",
      (sectionText) => {
        const normalized = sectionText.toLowerCase();
        return normalized.includes("proposed strategic goals")
          && normalized.includes("top portfolio score")
          && normalized.includes("strategy summary package")
          && normalized.includes("recommended next action");
      },
      30000,
    );

    const before = await snapshot(page, "before_actions");

    const strategySection = page.getByRole("heading", { name: "Strategy Portfolio", exact: true }).locator("xpath=ancestor::section[1]");
    const proposedGoal = strategySection.getByRole("heading", { name: "Expand creator template coverage", exact: true }).locator("xpath=ancestor::article[1]");
    const approvedGoal = strategySection.getByRole("heading", { name: "Ship first playable studio loop", exact: true }).locator("xpath=ancestor::article[1]");

    await proposedGoal.getByRole("button", { name: "Approve Strategy Goal", exact: true }).click();
    await waitForSectionText(page, "Runtime Introspection", (sectionText) => /approve_strategy_goal persisted for strategy portfolio state/i.test(sectionText), 30000);
    const afterApprove = await snapshot(page, "after_approve");

    await approvedGoal.getByRole("button", { name: "Activate Strategy Goal", exact: true }).click();
    await waitForSectionText(page, "Runtime Introspection", (sectionText) => /activate_strategy_goal persisted for strategy portfolio state/i.test(sectionText), 30000);
    const afterActivate = await snapshot(page, "after_activate");

    await approvedGoal.getByRole("button", { name: "Decompose Strategy Goal", exact: true }).click();
    await waitForSectionText(page, "Runtime Introspection", (sectionText) => /decompose_strategy_goal persisted for strategy portfolio state/i.test(sectionText), 30000);
    const afterDecompose = await snapshot(page, "after_decompose");

    await strategySection.getByRole("button", { name: "Request Strategy Summary", exact: true }).click();
    await page.getByText("Top recommended goal:", { exact: false }).waitFor({ timeout: 30000 });
    const afterSummary = await snapshot(page, "after_summary");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("State Source: Live Runtime", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText("Top recommended goal:", { exact: false }).waitFor({ timeout: 15000 });
    await waitForSectionText(page, "Runtime Introspection", (sectionText) => /request_strategy_summary persisted for strategy portfolio state/i.test(sectionText), 15000);
    const refreshed = await snapshot(page, "after_refresh");

    console.log(JSON.stringify({ url, before, afterApprove, afterActivate, afterDecompose, afterSummary, refreshed }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});