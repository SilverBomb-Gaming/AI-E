const { chromium } = require("playwright");

function extractSectionText(page, headingName) {
  return page
    .getByRole("heading", { name: headingName, exact: true })
    .locator("xpath=ancestor::section[1]")
    .innerText();
}

async function waitForSectionText(page, headingName, predicate, timeout = 15000) {
  await page.waitForFunction(
    ({ headingName }) => {
      const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6"));
      const heading = headings.find((node) => node.textContent?.trim() === headingName);

      if (!heading) {
        return null;
      }

      const section = heading.closest("section");
      return section ? section.innerText : null;
    },
    { headingName },
    { timeout },
  );

  await page.waitForFunction(
    ({ headingName, predicateSource }) => {
      const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6"));
      const heading = headings.find((node) => node.textContent?.trim() === headingName);

      if (!heading) {
        return false;
      }

      const section = heading.closest("section");
      if (!section) {
        return false;
      }

      const predicate = new Function("sectionText", predicateSource);
      return Boolean(predicate(section.innerText));
    },
    {
      headingName,
      predicateSource: `return (${predicate.toString()})(sectionText);`,
    },
    { timeout },
  );
}

async function snapshot(page, label) {
  const activeGoal = await extractSectionText(page, "Active Goal");
  const goalQueue = await extractSectionText(page, "Goal Queue");
  const blockedGoals = await extractSectionText(page, "Blocked Goals");
  const approvals = await extractSectionText(page, "Approvals Required");
  const runtimeStatus = await extractSectionText(page, "Runtime Status");

  return {
    label,
    activeGoal,
    goalQueue,
    blockedGoals,
    approvals,
    runtimeStatus,
  };
}

async function main() {
  const url = process.env.AIE_OPERATOR_SMOKE_URL || "http://127.0.0.1:3012/operator";
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.getByText("State Source: Live Runtime", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: "Approve", exact: true }).waitFor({ timeout: 15000 });

    const before = await snapshot(page, "before_click");

    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await waitForSectionText(
      page,
      "Approvals Required",
      (sectionText) =>
        sectionText.includes("No approvals are currently pending.") &&
        !sectionText.includes("goal-approval-gate"),
    );

    const immediate = await snapshot(page, "after_click");

    await waitForSectionText(
      page,
      "Active Goal",
      (sectionText) => sectionText.includes("No goal currently owns the active slot."),
      20000,
    );
    await waitForSectionText(
      page,
      "Goal Queue",
      (sectionText) => sectionText.includes("No queued goals."),
      20000,
    );
    await waitForSectionText(
      page,
      "Blocked Goals",
      (sectionText) => sectionText.includes("No blocked goals."),
      20000,
    );
    await waitForSectionText(
      page,
      "Approvals Required",
      (sectionText) => sectionText.includes("No approvals are currently pending."),
      20000,
    );

    const delayed = await snapshot(page, "after_autonomous_ticks");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("State Source: Live Runtime", { exact: false }).waitFor({ timeout: 15000 });
    const refreshed = await snapshot(page, "after_refresh");

    console.log(JSON.stringify({
      url,
      before,
      immediate,
      delayed,
      refreshed,
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});