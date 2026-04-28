const { chromium } = require("playwright");

function extractSectionText(page, headingName) {
  return page
    .getByRole("heading", { name: headingName, exact: true })
    .locator("xpath=ancestor::section[1]")
    .innerText();
}

async function maybeExtractSectionText(page, headingName) {
  try {
    return await extractSectionText(page, headingName);
  } catch {
    return null;
  }
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

async function waitForSectionTextWithDiagnostics(page, headingName, predicate, label, url, timeout = 15000) {
  try {
    await waitForSectionText(page, headingName, predicate, timeout);
  } catch (error) {
    const activeGoal = await maybeExtractSectionText(page, "Active Goal");
    const approvals = await maybeExtractSectionText(page, "Approvals Required");
    const runtimeTimeline = await maybeExtractSectionText(page, "Runtime Timeline");
    const runtimeIntrospection = await maybeExtractSectionText(page, "Runtime Introspection");
    const runtimeStatus = await maybeExtractSectionText(page, "Runtime Status");
    const agentRuntime = await maybeExtractSectionText(page, "Agent Runtime");
    const executionChains = await maybeExtractSectionText(page, "Execution Chains");

    throw new Error([
      `Timed out while waiting for ${label}.`,
      `URL: ${url}`,
      `Active Goal Section: ${activeGoal ?? "<missing>"}`,
      `Approvals Required Section: ${approvals ?? "<missing>"}`,
      `Runtime Timeline Section: ${runtimeTimeline ?? "<missing>"}`,
      `Runtime Introspection Section: ${runtimeIntrospection ?? "<missing>"}`,
      `Runtime Status Section: ${runtimeStatus ?? "<missing>"}`,
      `Agent Runtime Section: ${agentRuntime ?? "<missing>"}`,
      `Execution Chains Section: ${executionChains ?? "<missing>"}`,
      error instanceof Error ? error.message : String(error),
    ].join("\n\n"));
  }
}

async function buildPreApprovalDiagnostics(page, url) {
  const activeGoal = await maybeExtractSectionText(page, "Active Goal");
  const approvals = await maybeExtractSectionText(page, "Approvals Required");
  const runtimeStatus = await maybeExtractSectionText(page, "Runtime Status");
  const agentRuntime = await maybeExtractSectionText(page, "Agent Runtime");
  const executionChains = await maybeExtractSectionText(page, "Execution Chains");

  return [
    `URL: ${url}`,
    `Active Goal Section: ${activeGoal ?? "<missing>"}`,
    `Approvals Required Section: ${approvals ?? "<missing>"}`,
    `Runtime Status Section: ${runtimeStatus ?? "<missing>"}`,
    `Agent Runtime Section: ${agentRuntime ?? "<missing>"}`,
    `Execution Chains Section: ${executionChains ?? "<missing>"}`,
  ].join("\n\n");
}

async function waitForOperatorPageNavigation(page, url, timeout = 45000) {
  const startedAt = Date.now();
  let lastError = null;

  while ((Date.now() - startedAt) < timeout) {
    try {
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
      if (response && response.ok()) {
        return;
      }

      lastError = new Error(`Navigation reached ${url} but did not return an OK response.`);
    } catch (error) {
      lastError = error;
    }

    await page.waitForTimeout(500);
  }

  throw new Error([
    `Timed out waiting for /operator to become reachable at ${url}.`,
    lastError instanceof Error ? lastError.message : String(lastError),
  ].join("\n\n"));
}

async function waitForSeededPreApprovalState(page, url, timeout = 45000) {
  await page.getByText("State Source: Live Runtime", { exact: false }).waitFor({ timeout });
  await page.getByText("Client Controls: Ready", { exact: false }).waitFor({ timeout });

  try {
    await page.waitForFunction(
      () => {
        const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6"));
        const findSectionText = (headingName) => {
          const heading = headings.find((node) => node.textContent?.trim() === headingName);
          return heading?.closest("section")?.innerText ?? null;
        };

        const activeGoalText = findSectionText("Active Goal");
        const approvalsText = findSectionText("Approvals Required");

        return Boolean(
          activeGoalText
          && approvalsText
          && activeGoalText.includes("Complete live runtime approval gate")
          && approvalsText.includes("goal-approval-gate")
          && approvalsText.includes("Approve"),
        );
      },
      undefined,
      { timeout },
    );
  } catch (error) {
    const diagnostics = await buildPreApprovalDiagnostics(page, url);
    throw new Error([
      "Timed out waiting for the hydrated seeded pre-approval operator state.",
      diagnostics,
      error instanceof Error ? error.message : String(error),
    ].join("\n\n"));
  }
}

async function snapshot(page, label) {
  const activeGoal = await extractSectionText(page, "Active Goal");
  const goalQueue = await extractSectionText(page, "Goal Queue");
  const blockedGoals = await extractSectionText(page, "Blocked Goals");
  const approvals = await extractSectionText(page, "Approvals Required");
  const runtimeStatus = await extractSectionText(page, "Runtime Status");
  const runtimeIntrospection = await extractSectionText(page, "Runtime Introspection");
  const agentRuntime = await extractSectionText(page, "Agent Runtime");
  const executionChains = await extractSectionText(page, "Execution Chains");
  const runtimeTimeline = await extractSectionText(page, "Runtime Timeline");

  return {
    label,
    activeGoal,
    goalQueue,
    blockedGoals,
    approvals,
    runtimeStatus,
    runtimeIntrospection,
    agentRuntime,
    executionChains,
    runtimeTimeline,
  };
}

async function main() {
  const url = process.env.AIE_OPERATOR_SMOKE_URL || "http://127.0.0.1:3012/operator";
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await waitForOperatorPageNavigation(page, url);
    await waitForSeededPreApprovalState(page, url);

    const before = await snapshot(page, "before_click");

    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await waitForSectionTextWithDiagnostics(
      page,
      "Approvals Required",
      (sectionText) =>
        sectionText.includes("No approvals are currently pending.")
        && !sectionText.includes("goal-approval-gate"),
      "post-approval clearance",
      url,
      30000,
    );
    await waitForSectionTextWithDiagnostics(
      page,
      "Runtime Timeline",
      (sectionText) => sectionText.includes("Safety gate:") && sectionText.includes("executor-agent") && sectionText.includes("Execution chain"),
      "immediate runtime timeline transition",
      url,
      30000,
    );
    await waitForSectionTextWithDiagnostics(
      page,
      "Agent Runtime",
      (sectionText) => sectionText.includes("planner-agent") && sectionText.includes("executor-agent") && sectionText.includes("approved"),
      "agent runtime assignment",
      url,
      30000,
    );
    await waitForSectionTextWithDiagnostics(
      page,
      "Execution Chains",
      (sectionText) => {
        const normalized = sectionText.toLowerCase();
        return normalized.includes("execution-chain-")
          && (normalized.includes("active") || normalized.includes("completed"))
          && normalized.includes("step:");
      },
      "execution chain progression",
      url,
      30000,
    );

    const immediate = await snapshot(page, "after_click");

    await waitForSectionTextWithDiagnostics(
      page,
      "Active Goal",
      (sectionText) => sectionText.includes("No goal currently owns the active slot."),
      "delayed active goal completion",
      url,
      45000,
    );
    await waitForSectionTextWithDiagnostics(
      page,
      "Goal Queue",
      (sectionText) => sectionText.includes("No queued goals."),
      "delayed queue drain",
      url,
      45000,
    );
    await waitForSectionTextWithDiagnostics(
      page,
      "Blocked Goals",
      (sectionText) => sectionText.includes("No blocked goals."),
      "delayed blocked-goal clear",
      url,
      45000,
    );
    await waitForSectionTextWithDiagnostics(
      page,
      "Approvals Required",
      (sectionText) => sectionText.includes("No approvals are currently pending."),
      "delayed approval clearance persistence",
      url,
      45000,
    );
    await waitForSectionTextWithDiagnostics(
      page,
      "Execution Chains",
      (sectionText) => {
        const normalized = sectionText.toLowerCase();
        return normalized.includes("execution-chain-")
          && (normalized.includes("completed") || normalized.includes("active"));
      },
      "delayed execution chain persistence",
      url,
      45000,
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



