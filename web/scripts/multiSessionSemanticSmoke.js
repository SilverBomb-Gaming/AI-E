const { chromium } = require("playwright");

function extractSection(page, headingName) {
  return page
    .getByRole("heading", { name: headingName, exact: true })
    .locator("xpath=ancestor::section[1]")
    .innerText();
}

function extractSessionRow(page, sessionId) {
  return page
    .getByRole("heading", { name: sessionId, exact: true })
    .locator("xpath=ancestor::article[1]")
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

async function waitForSessionRow(page, sessionId, predicate, timeout = 20000) {
  const startedAt = Date.now();
  let lastRowText = null;

  while ((Date.now() - startedAt) < timeout) {
    try {
      lastRowText = await extractSessionRow(page, sessionId);
      if (predicate(lastRowText)) {
        return lastRowText;
      }
    } catch {
      lastRowText = null;
    }

    await page.waitForTimeout(250);
  }

  throw new Error(`Timed out waiting for session row ${sessionId}. Last text: ${lastRowText ?? "<unavailable>"}`);
}

async function snapshot(page, label) {
  return {
    label,
    stateSource: await page.locator("main").locator("text=State Source:").first().innerText(),
    autonomousSessions: await extractSection(page, "Autonomous Sessions"),
    runtimeIntrospection: await extractSection(page, "Runtime Introspection"),
    featureSession: await extractSessionRow(page, "demo-session-feature-ui"),
    bugfixSession: await extractSessionRow(page, "demo-session-bugfix-delivery"),
  };
}

async function clickRowButton(page, sessionId, label) {
  const card = page
    .getByRole("heading", { name: sessionId, exact: true })
    .locator("xpath=ancestor::article[1]");
  await card.getByRole("button", { name: label, exact: true }).click();
}

async function main() {
  const url = process.env.AIE_OPERATOR_SMOKE_URL || "http://127.0.0.1:3016/operator";
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
          && normalized.includes("shared_file")
          && normalized.includes("unlocks");
      },
      30000,
    );

    const before = await snapshot(page, "before_actions");

    await clickRowButton(page, "demo-session-feature-ui", "Pause");
    await waitForSessionRow(page, "demo-session-feature-ui", (rowText) => /paused/i.test(rowText), 30000);
    const afterPause = await snapshot(page, "after_pause");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("State Source: Live Runtime", { exact: false }).waitFor({ timeout: 15000 });
    await waitForSessionRow(page, "demo-session-feature-ui", (rowText) => /paused/i.test(rowText), 15000);

    await clickRowButton(page, "demo-session-feature-ui", "Resume");
    await waitForSessionRow(page, "demo-session-feature-ui", (rowText) => /pending/i.test(rowText), 30000);
    const afterResume = await snapshot(page, "after_resume");

    await clickRowButton(page, "demo-session-bugfix-delivery", "Critical");
    await waitForSessionRow(page, "demo-session-bugfix-delivery", (rowText) => /critical/i.test(rowText), 30000);
    const afterPriority = await snapshot(page, "after_priority");

    await clickRowButton(page, "demo-session-bugfix-delivery", "Merge");
    await waitForSessionRow(page, "demo-session-bugfix-delivery", (rowText) => /completed/i.test(rowText), 30000);
    await waitForSessionRow(page, "demo-session-feature-ui", (rowText) => /Queued work 2/i.test(rowText), 30000);
    const afterMerge = await snapshot(page, "after_merge");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("State Source: Live Runtime", { exact: false }).waitFor({ timeout: 15000 });
    await waitForSessionRow(page, "demo-session-bugfix-delivery", (rowText) => /completed/i.test(rowText), 15000);
    await waitForSessionRow(page, "demo-session-feature-ui", (rowText) => /Queued work 2/i.test(rowText), 15000);
    const refreshed = await snapshot(page, "after_refresh");

    console.log(JSON.stringify({ url, before, afterPause, afterResume, afterPriority, afterMerge, refreshed }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});