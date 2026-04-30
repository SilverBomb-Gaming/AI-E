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
    chatSection: await extractSection(page, "AI-E Chat"),
    runtimeIntrospection: await extractSection(page, "Runtime Introspection"),
    latestSummary: await page.getByText("Latest Chat Summary", { exact: false }).count()
      ? await page.getByText("Latest Chat Summary", { exact: false }).locator("xpath=ancestor::article[1]").innerText()
      : null,
  };
}

async function main() {
  const url = process.env.AIE_OPERATOR_SMOKE_URL || "http://127.0.0.1:3020/operator";
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await waitForOperatorPage(page, url);
    await page.getByText("State Source: Live Runtime", { exact: false }).waitFor({ timeout: 30000 });
    await page.getByText("Client Controls: Ready", { exact: false }).waitFor({ timeout: 30000 });
    await waitForSectionText(
      page,
      "AI-E Chat",
      (sectionText) => {
        const normalized = sectionText.toLowerCase();
        return normalized.includes("session status")
          && normalized.includes("boundary")
          && normalized.includes("conversation log");
      },
      30000,
    );

    const before = await snapshot(page, "before_actions");

    const chatSection = page.getByRole("heading", { name: "AI-E Chat", exact: true }).locator("xpath=ancestor::section[1]");
    await chatSection.getByPlaceholder("Describe the task, constraint, or ambiguity you want AI-E to route safely.").fill("make enemies smarter when grenade blows up");
    await chatSection.getByRole("button", { name: "Submit Chat Message", exact: true }).click();
    await waitForSectionText(page, "Runtime Introspection", (sectionText) => /submit_chat_message persisted for conversational command state/i.test(sectionText), 30000);
    const afterSubmit = await snapshot(page, "after_submit");

    await chatSection.getByRole("button", { name: "Select", exact: true }).first().click();
    await waitForSectionText(page, "Runtime Introspection", (sectionText) => /select_chat_option persisted for conversational command state/i.test(sectionText), 30000);
    const afterSelect = await snapshot(page, "after_select");

    await chatSection.getByRole("button", { name: "Request Chat Summary", exact: true }).click();
    await waitForSectionText(page, "Runtime Introspection", (sectionText) => /request_chat_summary persisted for conversational command state/i.test(sectionText), 30000);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("State Source: Live Runtime", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText("Latest Chat Summary", { exact: false }).waitFor({ timeout: 30000 });
    const afterSummary = await snapshot(page, "after_summary");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("State Source: Live Runtime", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText("Latest Chat Summary", { exact: false }).waitFor({ timeout: 15000 });
    await waitForSectionText(page, "Runtime Introspection", (sectionText) => /request_chat_summary persisted for conversational command state/i.test(sectionText), 15000);
    const refreshed = await snapshot(page, "after_refresh");

    console.log(JSON.stringify({ url, before, afterSubmit, afterSelect, afterSummary, refreshed }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});