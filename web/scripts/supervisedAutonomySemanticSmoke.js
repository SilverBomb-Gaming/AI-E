const { chromium } = require("playwright");

function extractSection(page, headingName) {
  return page
    .getByRole("heading", { name: headingName, exact: true })
    .locator("xpath=ancestor::section[1]")
    .innerText();
}

async function maybeExtractSection(page, headingName) {
  try {
    return await extractSection(page, headingName);
  } catch {
    return null;
  }
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
  await page.waitForFunction(
    ({ headingName, predicateSource }) => {
      const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6"));
      const heading = headings.find((node) => node.textContent?.trim() === headingName);
      const sectionText = heading?.closest("section")?.innerText ?? null;
      if (!sectionText) {
        return false;
      }

      const localPredicate = new Function("sectionText", predicateSource);
      return Boolean(localPredicate(sectionText));
    },
    {
      headingName,
      predicateSource: `return (${predicate.toString()})(sectionText);`,
    },
    { timeout },
  );
}

async function snapshot(page, label) {
  return {
    label,
    approvals: await extractSection(page, "Approvals Required"),
    runtimeStatus: await extractSection(page, "Runtime Status"),
    agentRuntime: await extractSection(page, "Agent Runtime"),
    supervisedSession: await extractSection(page, "Supervised Autonomy Session"),
    executionChains: await extractSection(page, "Execution Chains"),
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
    await page.getByText("Client Controls: Ready", { exact: false }).waitFor({ timeout: 30000 });

    await waitForSectionText(
      page,
      "Supervised Autonomy Session",
      (sectionText) => sectionText.includes("pending approval") && sectionText.includes("0 / 6"),
      30000,
    );

    const before = await snapshot(page, "before_approval");

    await page.getByRole("button", { name: "Approve", exact: true }).click();

    await waitForSectionText(
      page,
      "Supervised Autonomy Session",
      (sectionText) => sectionText.includes("running"),
      30000,
    );
    await waitForSectionText(
      page,
      "Runtime Timeline",
      (sectionText) => sectionText.includes("grant_session_approval persisted for supervised session state") && sectionText.includes("Checkpoint supervised-checkpoint-"),
      30000,
    );

    const afterApproval = await snapshot(page, "after_approval");

    await page.getByRole("button", { name: "Pause Session", exact: true }).click();
    await waitForSectionText(
      page,
      "Supervised Autonomy Session",
      (sectionText) => sectionText.includes("paused"),
      15000,
    );
    await waitForSectionText(
      page,
      "Runtime Timeline",
      (sectionText) => sectionText.includes("pause_supervised_session persisted for supervised session state"),
      15000,
    );

    const afterPause = await snapshot(page, "after_pause");

    await page.getByRole("button", { name: "Resume Session", exact: true }).click();
    await waitForSectionText(
      page,
      "Supervised Autonomy Session",
      (sectionText) => sectionText.includes("running"),
      15000,
    );
    await waitForSectionText(
      page,
      "Runtime Timeline",
      (sectionText) => sectionText.includes("resume_supervised_session persisted for supervised session state"),
      15000,
    );

    const afterResume = await snapshot(page, "after_resume");

    await page.getByRole("button", { name: "Stop Session", exact: true }).click();
    await waitForSectionText(
      page,
      "Supervised Autonomy Session",
      (sectionText) => sectionText.includes("stopped by operator"),
      15000,
    );
    await waitForSectionText(
      page,
      "Runtime Timeline",
      (sectionText) => sectionText.includes("stop_supervised_session persisted for supervised session state"),
      15000,
    );

    const afterStop = await snapshot(page, "after_stop");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("State Source: Live Runtime", { exact: false }).waitFor({ timeout: 15000 });
    await waitForSectionText(
      page,
      "Supervised Autonomy Session",
      (sectionText) => sectionText.includes("stopped by operator"),
      15000,
    );

    const refreshed = await snapshot(page, "after_refresh");
    const diagnostics = {
      activeGoal: await maybeExtractSection(page, "Active Goal"),
    };

    console.log(JSON.stringify({
      url,
      before,
      afterApproval,
      afterPause,
      afterResume,
      afterStop,
      refreshed,
      diagnostics,
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});