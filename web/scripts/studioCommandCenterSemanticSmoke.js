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
  const summaryCard = await page.getByRole("heading", { name: "Studio Summary", exact: true }).count()
    ? await page.getByRole("heading", { name: "Studio Summary", exact: true }).locator("xpath=ancestor::article[1]").innerText()
    : null;

  return {
    label,
    stateSource: await page.locator("main").locator("text=State Source:").first().innerText(),
    commandCenter: await extractSection(page, "Studio Command Center"),
    autonomousSessions: await extractSection(page, "Autonomous Sessions"),
    runtimeIntrospection: await extractSection(page, "Runtime Introspection"),
    summaryCard,
  };
}

async function main() {
  const url = process.env.AIE_OPERATOR_SMOKE_URL || "http://127.0.0.1:3017/operator";
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await waitForOperatorPage(page, url);
    await page.getByText("State Source: Live Runtime", { exact: false }).waitFor({ timeout: 30000 });
    await page.getByText("Client Controls: Ready", { exact: false }).waitFor({ timeout: 30000 });
    await waitForSectionText(
      page,
      "Autonomous Sessions",
      (sectionText) => {
        const normalized = sectionText.toLowerCase();
        return normalized.includes("demo-session-feature-ui")
          && normalized.includes("demo-session-bugfix-delivery")
          && normalized.includes("tracked sessions");
      },
      30000,
    );
    await waitForSectionText(
      page,
      "Studio Command Center",
      (sectionText) => {
        const normalized = sectionText.toLowerCase();
        return normalized.includes("health score")
          && normalized.includes("blocked")
          && normalized.includes("pending deliveries")
          && normalized.includes("recommended operator actions");
      },
      30000,
    );

    const before = await snapshot(page, "before_actions");

    await page.getByRole("button", { name: "Pause All Sessions", exact: true }).click();
    await waitForSectionText(page, "Runtime Introspection", (sectionText) => /pause_all_sessions persisted for studio command center state/i.test(sectionText), 30000);
    const afterPause = await snapshot(page, "after_pause_all");

    await page.getByRole("button", { name: "Resume Safe Sessions", exact: true }).click();
    await waitForSectionText(page, "Runtime Introspection", (sectionText) => /resume_safe_sessions persisted for studio command center state/i.test(sectionText), 30000);
    const afterResume = await snapshot(page, "after_resume_safe");

    await page.getByRole("button", { name: "Acknowledge Studio Risk", exact: true }).click();
    await waitForSectionText(page, "Runtime Introspection", (sectionText) => /acknowledge_studio_risk persisted for studio command center state/i.test(sectionText), 30000);
    const afterAcknowledge = await snapshot(page, "after_acknowledge");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("State Source: Live Runtime", { exact: false }).waitFor({ timeout: 15000 });
    await waitForSectionText(page, "Runtime Introspection", (sectionText) => /acknowledge_studio_risk persisted for studio command center state/i.test(sectionText), 15000);
    const afterAcknowledgeRefresh = await snapshot(page, "after_acknowledge_refresh");

    await page.getByRole("button", { name: "Request Studio Summary", exact: true }).click();
    await page.getByRole("heading", { name: "Studio Summary", exact: true }).waitFor({ timeout: 30000 });
    const afterSummary = await snapshot(page, "after_summary");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("State Source: Live Runtime", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByRole("heading", { name: "Studio Summary", exact: true }).waitFor({ timeout: 15000 });
    await waitForSectionText(page, "Runtime Introspection", (sectionText) => /request_studio_summary persisted for studio command center state/i.test(sectionText), 15000);
    const refreshed = await snapshot(page, "after_refresh");

    console.log(JSON.stringify({ url, before, afterPause, afterResume, afterAcknowledge, afterAcknowledgeRefresh, afterSummary, refreshed }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});