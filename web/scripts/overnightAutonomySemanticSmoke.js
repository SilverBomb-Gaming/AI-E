const { chromium } = require("playwright");

function extractSection(page, headingName) {
  return page
    .getByRole("heading", { name: headingName, exact: true })
    .locator("xpath=ancestor::section[1]")
    .innerText();
}

async function waitForOperatorPage(page, url, timeout = 90000) {
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

async function waitForSectionText(page, headingName, predicate, timeout = 15000) {
  const startedAt = Date.now();
  let lastSectionText = null;

  while ((Date.now() - startedAt) < timeout) {
    try {
      lastSectionText = await extractSection(page, headingName);
      if (predicate(lastSectionText)) {
        return;
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
    supervisedSession: await extractSection(page, "Supervised Autonomy Session"),
    overnightAutonomy: await extractSection(page, "Overnight Autonomy"),
    runtimeTimeline: await extractSection(page, "Runtime Timeline"),
  };
}

async function main() {
  const url = process.env.AIE_OPERATOR_SMOKE_URL || "http://127.0.0.1:3012/operator";
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await waitForOperatorPage(page, url);
    await page.getByText("State Source: Live Runtime", { exact: false }).waitFor({ timeout: 30000 });
    await waitForSectionText(
      page,
      "Overnight Autonomy",
      (sectionText) => sectionText.toLowerCase().includes("review bounded overnight recovery") && sectionText.toLowerCase().includes("pending"),
      30000,
    );

    const before = await snapshot(page, "before_review");

    await page.getByRole("button", { name: "Approve Review", exact: true }).click();
    await waitForSectionText(
      page,
      "Overnight Autonomy",
      (sectionText) => sectionText.toLowerCase().includes("approved"),
      15000,
    );

    const afterApprove = await snapshot(page, "after_approve");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("State Source: Live Runtime", { exact: false }).waitFor({ timeout: 15000 });
    await waitForSectionText(
      page,
      "Overnight Autonomy",
      (sectionText) => sectionText.toLowerCase().includes("approved"),
      15000,
    );

    const refreshed = await snapshot(page, "after_refresh");

    console.log(JSON.stringify({ url, before, afterApprove, refreshed }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});