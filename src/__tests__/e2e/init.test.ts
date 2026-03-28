import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runCli, requireToken, hasToken } from "./helpers/cli.js";
import { createTempDir, removeTempDir } from "./helpers/tmp.js";
import { createTestClient, archiveProject } from "./helpers/cleanup.js";
import type { ConvexHttpClient } from "convex/browser";

describe.skipIf(!hasToken)("slickenv init", () => {
  let client: ConvexHttpClient;
  const projectIds: string[] = [];
  let tmpDir: string;

  beforeAll(() => {
    const token = requireToken();
    client = createTestClient(token);
  });

  beforeEach(async () => {
    tmpDir = await createTempDir();
  });

  afterEach(async () => {
    await removeTempDir(tmpDir);
  });

  afterAll(async () => {
    for (const id of projectIds) {
      await archiveProject(client, id);
    }
  });

  test("initialises a project with --name flag", async () => {
    const name = `e2e-init-${Date.now()}`;
    const result = await runCli(["init", "--name", name], { cwd: tmpDir });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Project initialised");

    const configPath = join(tmpDir, ".slickenv");
    const config = JSON.parse(await readFile(configPath, "utf8"));

    expect(config.projectId).toBeTruthy();
    expect(config.projectName).toBe(name);
    expect(config.defaultEnvironment).toBe("production");
    expect(config.apiUrl).toBeTruthy();

    projectIds.push(config.projectId);

    const gitignore = await readFile(join(tmpDir, ".gitignore"), "utf8");
    expect(gitignore).toContain(".env");
  }, 30_000);

  test("warns when already initialised", async () => {
    const name = `e2e-init-dup-${Date.now()}`;

    const first = await runCli(["init", "--name", name], { cwd: tmpDir });
    expect(first.exitCode).toBe(0);

    const config = JSON.parse(await readFile(join(tmpDir, ".slickenv"), "utf8"));
    projectIds.push(config.projectId);

    const second = await runCli(["init", "--name", `${name}-2`], { cwd: tmpDir });
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toContain("already initialised");
  }, 30_000);

  test("uses custom environment label with --env", async () => {
    const name = `e2e-init-env-${Date.now()}`;
    const result = await runCli(["init", "--name", name, "--env", "staging"], { cwd: tmpDir });

    expect(result.exitCode).toBe(0);

    const config = JSON.parse(await readFile(join(tmpDir, ".slickenv"), "utf8"));
    expect(config.defaultEnvironment).toBe("staging");

    projectIds.push(config.projectId);
  }, 30_000);
});
