import { describe, test, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runCli, requireToken, hasToken } from "./helpers/cli.js";
import { createTempDir, removeTempDir } from "./helpers/tmp.js";
import { createTestClient, archiveProject } from "./helpers/cleanup.js";

const CALLBACK_PORT = 9876;

describe.skipIf(!hasToken)("slickenv login", () => {
  test("callback server starts and accepts token", async () => {
    const token = requireToken();

    // Spawn login without token so the callback server starts
    const proc = Bun.spawn(
      ["bun", "run", join(import.meta.dir, "../../../../bin/run.js"), "login"],
      {
        env: {
          ...process.env as Record<string, string>,
          NO_COLOR: "1",
          SLICKENV_TOKEN: "",
        },
        stdout: "pipe",
        stderr: "pipe",
      }
    );

    // Poll until the callback server is up
    let serverReady = false;
    for (let i = 0; i < 20; i++) {
      try {
        const res = await fetch(`http://localhost:${CALLBACK_PORT}/`);
        if (res.status === 404) {
          serverReady = true;
          break;
        }
      } catch {
        // not ready yet
      }
      await Bun.sleep(250);
    }

    if (!serverReady) {
      proc.kill();
      throw new Error("Login callback server did not start within 5 seconds");
    }

    // Send the token to the callback
    const callbackRes = await fetch(
      `http://localhost:${CALLBACK_PORT}/callback?token=${encodeURIComponent(token)}`
    );
    expect(callbackRes.status).toBe(200);

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Logged in successfully");
  }, 30_000);

  test("init works with stored token (no browser needed)", async () => {
    const token = requireToken();
    const tmpDir = await createTempDir();
    let projectId: string | undefined;

    try {
      const name = `e2e-login-tok-${Date.now()}`;
      const result = await runCli(["init", "--name", name], { cwd: tmpDir });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Project initialised");

      const config = JSON.parse(await readFile(join(tmpDir, ".slickenv"), "utf8"));
      projectId = config.projectId;
    } finally {
      if (projectId) {
        const client = createTestClient(token);
        await archiveProject(client, projectId);
      }
      await removeTempDir(tmpDir);
    }
  }, 30_000);
});
