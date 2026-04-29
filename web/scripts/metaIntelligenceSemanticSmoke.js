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
    metaSection: await extractSection(page, "Meta-Intelligence"),
    runtimeIntrospection: await extractSection(page, "Runtime Introspection"),
    metaSummary: await page.getByText("Must Not Change", { exact: true }).count()
      ? await page.getByText("Must Not Change", { exact: true }).locator("xpath=ancestor::article[1]").innerText()
      : null,
  };
}

async function main() {
  const url = process.env.AIE_OPERATOR_SMOKE_URL || "http://127.0.0.1:3018/operator";
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await waitForOperatorPage(page, url);
    await page.getByText("State Source: Live Runtime", { exact: false }).waitFor({ timeout: 30000 });
    await page.getByText("Client Controls: Ready", { exact: false }).waitFor({ timeout: 30000 });
    await waitForSectionText(
      page,
      "Meta-Intelligence",
      (sectionText) => {
        const normalized = sectionText.toLowerCase();
        return normalized.includes("observed sessions")
          && normalized.includes("detected patterns")
          && normalized.includes("policy recommendations")
          && normalized.includes("persisted policy state");
      },
      30000,
    );

    const before = await snapshot(page, "before_actions");

    const metaSection = page.getByRole("heading", { name: "Meta-Intelligence", exact: true }).locator("xpath=ancestor::section[1]");
    await metaSection.getByRole("button", { name: "Acknowledge", exact: true }).first().click();
    await waitForSectionText(page, "Runtime Introspection", (sectionText) => /acknowledge_pattern persisted for meta intelligence state/i.test(sectionText), 30000);
    const afterAcknowledge = await snapshot(page, "after_acknowledge");

    await metaSection.getByRole("button", { name: "Approve", exact: true }).first().click();
    await waitForSectionText(page, "Runtime Introspection", (sectionText) => /approve_policy_recommendation persisted for meta intelligence state/i.test(sectionText), 30000);
    const afterApprove = await snapshot(page, "after_approve");

    await metaSection.getByRole("button", { name: "Request Meta Summary", exact: true }).click();
    await page.getByText("Must Not Change", { exact: true }).waitFor({ timeout: 30000 });
    const afterSummary = await snapshot(page, "after_summary");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("State Source: Live Runtime", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText("Must Not Change", { exact: true }).waitFor({ timeout: 15000 });
    await waitForSectionText(page, "Runtime Introspection", (sectionText) => /request_meta_summary persisted for meta intelligence state/i.test(sectionText), 15000);
    const refreshed = await snapshot(page, "after_refresh");

    console.log(JSON.stringify({ url, before, afterAcknowledge, afterApprove, afterSummary, refreshed }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});