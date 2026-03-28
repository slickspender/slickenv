import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { runCli, requireToken, hasToken } from "./helpers/cli.js";
import { createTempDir, removeTempDir } from "./helpers/tmp.js";
import { createTestClient, archiveProject } from "./helpers/cleanup.js";
import type { ConvexHttpClient } from "convex/browser";

const TEST_ENV_CONTENT = `# @visibility=private @type=string
SECRET_KEY=e2e-secret-value-123
# @visibility=public @type=string
PUBLIC_URL=https://example.com
# @visibility=private @type=number @required=true
PORT=3000
`;

describe.skipIf(!hasToken)("slickenv push & pull", () => {
  let client: ConvexHttpClient;
  let tmpDir: string;
  let projectId: string;

  beforeAll(async () => {
    const token = requireToken();
    client = createTestClient(token);

    tmpDir = await createTempDir();
    const name = `e2e-pushpull-${Date.now()}`;
    const initResult = await runCli(["init", "--name", name], { cwd: tmpDir });
    expect(initResult.exitCode).toBe(0);

    const config = JSON.parse(await readFile(join(tmpDir, ".slickenv"), "utf8"));
    projectId = config.projectId;
  });

  afterAll(async () => {
    if (projectId) {
      await archiveProject(client, projectId);
    }
    if (tmpDir) {
      await removeTempDir(tmpDir);
    }
  });

  test("push then pull round-trip preserves values", async () => {
    const envPath = join(tmpDir, ".env");
    await writeFile(envPath, TEST_ENV_CONTENT, "utf8");

    const pushResult = await runCli(["push", "--yes"], { cwd: tmpDir });
    expect(pushResult.exitCode).toBe(0);
    expect(pushResult.stdout).toContain("Pushed");
    expect(pushResult.stdout).toMatch(/v1/);

    await unlink(envPath);

    const pullResult = await runCli(["pull", "--yes"], { cwd: tmpDir });
    expect(pullResult.exitCode).toBe(0);
    expect(pullResult.stdout).toContain("Pulled");

    const pulled = await readFile(envPath, "utf8");
    expect(pulled).toContain("SECRET_KEY=e2e-secret-value-123");
    expect(pulled).toContain("PUBLIC_URL=https://example.com");
    expect(pulled).toContain("PORT=3000");
    expect(pulled).toContain("@visibility=private");
    expect(pulled).toContain("@visibility=public");
  }, 60_000);

  test("push detects no changes on second push", async () => {
    const result = await runCli(["push", "--yes"], { cwd: tmpDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No changes detected");
  }, 30_000);

  test("push with message creates new version", async () => {
    const envPath = join(tmpDir, ".env");
    const content = await readFile(envPath, "utf8");
    const updated = content.replace(
      "PUBLIC_URL=https://example.com",
      "PUBLIC_URL=https://updated.example.com"
    );
    await writeFile(envPath, updated, "utf8");

    const result = await runCli(["push", "--yes", "-m", "e2e test update"], { cwd: tmpDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Pushed");
    expect(result.stdout).toMatch(/v2/);
  }, 30_000);

  test("pull specific version gets older data", async () => {
    const result = await runCli(["pull", "--yes", "--version", "1"], { cwd: tmpDir });
    expect(result.exitCode).toBe(0);

    const envPath = join(tmpDir, ".env");
    const content = await readFile(envPath, "utf8");
    expect(content).toContain("PUBLIC_URL=https://example.com");
    expect(content).not.toContain("PUBLIC_URL=https://updated.example.com");
  }, 30_000);

  test("push without .env file fails gracefully", async () => {
    const emptyDir = await createTempDir();
    try {
      const config = await readFile(join(tmpDir, ".slickenv"), "utf8");
      await writeFile(join(emptyDir, ".slickenv"), config, "utf8");

      const result = await runCli(["push", "--yes"], { cwd: emptyDir });
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("File not found");
    } finally {
      await removeTempDir(emptyDir);
    }
  }, 30_000);
});
