import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  detectEntryPoints,
  detectTestFiles,
  findRelevantFiles,
  listRepoFiles,
  summarizeDirectoryStructure,
} from "./repoContext";

async function createRepoFixture(root: string) {
  await mkdir(path.join(root, "web", "lib", "aie"), { recursive: true });
  await mkdir(path.join(root, "web", "app", "api", "autonomous"), { recursive: true });
  await mkdir(path.join(root, "tests"), { recursive: true });

  await writeFile(path.join(root, "README.md"), "repo fixture\n", "utf8");
  await writeFile(path.join(root, "web", "package.json"), '{"name":"fixture"}\n', "utf8");
  await writeFile(path.join(root, "web", "lib", "aie", "repoContext.ts"), "export const repoContext = true;\n", "utf8");
  await writeFile(path.join(root, "web", "lib", "aie", "repoContext.test.ts"), "export const repoContextTest = true;\n", "utf8");
  await writeFile(path.join(root, "web", "headless_autonomy.ts"), "export const headless = true;\n", "utf8");
  await writeFile(path.join(root, "web", "local_node.ts"), "export const localNode = true;\n", "utf8");
  await writeFile(path.join(root, "web", "app", "api", "autonomous", "route.ts"), "export const route = true;\n", "utf8");
  await writeFile(path.join(root, "tests", "repo-context.spec.ts"), "export const fixtureTest = true;\n", "utf8");
}

test("repoContext lists repo files and summarizes the directory structure", async () => {
  const fixtureRoot = path.resolve(process.cwd(), "temp-phase4f-repo-context");
  await rm(fixtureRoot, { recursive: true, force: true });
  await createRepoFixture(fixtureRoot);

  try {
    const files = await listRepoFiles(fixtureRoot);
    const summary = await summarizeDirectoryStructure(fixtureRoot);

    assert.ok(files.includes("web/lib/aie/repoContext.ts"));
    assert.ok(files.includes("web/headless_autonomy.ts"));
    assert.ok(summary.topLevelDirectories.includes("web"));
    assert.match(summary.summary, /Top directories/i);
    assert.match(summary.summary, /Notable zones/i);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("repoContext detects test files, entry points, and relevant files for a goal", async () => {
  const fixtureRoot = path.resolve(process.cwd(), "temp-phase4f-repo-relevance");
  await rm(fixtureRoot, { recursive: true, force: true });
  await createRepoFixture(fixtureRoot);

  try {
    const testFiles = await detectTestFiles(fixtureRoot);
    const entryPoints = await detectEntryPoints(fixtureRoot);
    const relevantFiles = await findRelevantFiles("Locate repo context tests and local node entrypoint", fixtureRoot, {
      recentChangedPaths: ["web/lib/aie/repoContext.ts"],
    });

    assert.ok(testFiles.includes("web/lib/aie/repoContext.test.ts"));
    assert.ok(entryPoints.includes("web/headless_autonomy.ts"));
    assert.ok(entryPoints.includes("web/local_node.ts"));
    assert.ok(relevantFiles.some((file) => file.path === "web/lib/aie/repoContext.ts"));
    assert.ok(relevantFiles.some((file) => file.path === "web/local_node.ts"));
    assert.ok(relevantFiles.some((file) => file.pairedTestFiles.includes("web/lib/aie/repoContext.test.ts")));
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});