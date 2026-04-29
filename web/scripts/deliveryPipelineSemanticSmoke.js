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
    reviewPackages: await extractSection(page, "Review Packages"),
    deliveryPipeline: await extractSection(page, "Delivery Pipeline"),
    runtimeIntrospection: await extractSection(page, "Runtime Introspection"),
  };
}

async function clickApproveDelivery(page, title) {
  const card = page
    .getByRole("heading", { name: title, exact: true })
    .locator("xpath=ancestor::article[1]");
  await card.getByRole("button", { name: "Approve For Commit", exact: true }).click();
}

async function main() {
  const url = process.env.AIE_OPERATOR_SMOKE_URL || "http://127.0.0.1:3015/operator";
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await waitForOperatorPage(page, url);
    await page.getByText("State Source: Live Runtime", { exact: false }).waitFor({ timeout: 30000 });
    await page.getByText("Client Controls: Ready", { exact: false }).waitFor({ timeout: 30000 });
    await waitForSectionText(
      page,
      "Delivery Pipeline",
      (sectionText) => {
        const normalized = sectionText.toLowerCase();
        return normalized.includes("delivery-proof-work-item") && normalized.includes("awaiting operator approval");
      },
      30000,
    );

    const before = await snapshot(page, "before_delivery_approval");

    await clickApproveDelivery(page, "delivery-proof-work-item");
    await waitForSectionText(
      page,
      "Delivery Pipeline",
      (sectionText) => {
        const normalized = sectionText.toLowerCase();
        return normalized.includes("approved for commit") && normalized.includes("approve for commit");
      },
      30000,
    );

    const afterApproval = await snapshot(page, "after_delivery_approval");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("State Source: Live Runtime", { exact: false }).waitFor({ timeout: 15000 });
    await waitForSectionText(
      page,
      "Delivery Pipeline",
      (sectionText) => {
        const normalized = sectionText.toLowerCase();
        return normalized.includes("approved for commit") && normalized.includes("delivery-proof-work-item");
      },
      15000,
    );

    const refreshed = await snapshot(page, "after_refresh");

    console.log(JSON.stringify({ url, before, afterApproval, refreshed }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});