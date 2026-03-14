import { readFile, writeFile, access } from "node:fs/promises";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { createServer } from "node:http";
import { exec } from "node:child_process";
import { Flags } from "@oclif/core";
import { BaseCommand } from "../base-command.js";
import { findConfigDir, writeConfig, CONFIG_FILENAME } from "../lib/config.js";
import { createApiClient } from "../lib/api.js";
import { resolveToken, isExpired } from "../lib/auth.js";
import { storeToken } from "../lib/keychain.js";
import { isTTY, colors, symbols, divider } from "../lib/output.js";
import type { SlickEnvConfig } from "@slickenv/types";
import chalk from "chalk";

const CALLBACK_PORT = 9876;
const AUTH_TIMEOUT_MS = 120_000;

export default class Init extends BaseCommand {
  static override description = "Initialise a SlickEnv project in the current directory";

  static override examples = [
    "slickenv init",
    "slickenv init --name my-app --env production",
  ];

  static override flags = {
    ...BaseCommand.baseFlags,
    name: Flags.string({
      description: "Project name",
    }),
    env: Flags.string({
      description: "Environment label (e.g. production, staging)",
      default: "production",
    }),
  };

  protected override requiresConfig = false;
  protected override requiresAuth = false;

  async run(): Promise<void> {
    const { flags } = await this.parse(Init);

    // Check if already initialised
    const existingDir = await findConfigDir();
    if (existingDir) {
      this.warning(`Project already initialised (found ${CONFIG_FILENAME} in ${existingDir}).`);
      return;
    }

    // Ensure we have a valid auth token, logging in automatically if needed
    await this.ensureAuth();

    // Resolve project name
    let projectName = flags.name;
    if (!projectName) {
      projectName = isTTY ? await this.prompt("Project name", basename(process.cwd())) : basename(process.cwd());
    }

    const envLabel = flags.env ?? "production";

    // Create project via Convex
    const client = createApiClient(undefined, this.authToken);
    let result: { projectId: string; slug: string };

    try {
      result = await client.mutation("projects:create" as any, {
        name: projectName,
      }) as any;
    } catch (error: any) {
      const msg = error?.data?.message ?? error?.message ?? "Failed to create project.";
      this.fail(msg);
    }

    // Write .slickenv config
    const config: SlickEnvConfig = {
      version: 1,
      projectId: result!.projectId,
      projectName,
      defaultEnvironment: envLabel,
      apiUrl: process.env.SLICKENV_API_URL ?? "https://adjoining-sheep-555.convex.cloud",
    };

    await writeConfig(config, process.cwd());

    // Add .env to .gitignore if not already there
    await this.ensureGitignore();

    this.log("");
    this.log(`  ${colors.success(symbols.success)}  ${chalk.bold("Project initialised")}`);
    this.log(divider());
    this.log(`  ${chalk.dim("Project")}     ${colors.key(projectName)}`);
    this.log(`  ${chalk.dim("Slug")}        ${colors.highlight(result!.slug)}`);
    this.log(`  ${chalk.dim("Environment")} ${colors.highlight(envLabel)}`);
    this.log(`  ${chalk.dim("Config")}      ${CONFIG_FILENAME}`);
    this.log("");
    this.log(`  ${chalk.dim("Next:")} ${colors.highlight("slickenv push")} ${chalk.dim("to sync your .env")}`);
    this.log("");
  }

  private async prompt(message: string, defaultValue: string): Promise<string> {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
      rl.question(`  ${message} ${chalk.dim(`(${defaultValue})`)}: `, (answer) => {
        rl.close();
        resolve(answer.trim() || defaultValue);
      });
    });
  }

  private async ensureGitignore(): Promise<void> {
    const gitignorePath = join(process.cwd(), ".gitignore");
    try {
      await access(gitignorePath);
      const content = await readFile(gitignorePath, "utf8");
      if (!content.includes(".env")) {
        await writeFile(gitignorePath, content.trimEnd() + "\n.env\n", "utf8");
      }
    } catch {
      await writeFile(gitignorePath, ".env\n", "utf8");
    }
  }

  /**
   * Check for a valid token; if missing or expired, run the browser login flow inline.
   */
  private async ensureAuth(): Promise<void> {
    const existing = await resolveToken();
    if (existing && !isExpired(existing)) {
      this.authToken = existing;
      return;
    }

    this.log("");
    this.log(`  ${colors.info("No active session — launching browser login...")}`);
    this.log("");

    const token = await this.waitForAuthCallback();
    await storeToken(token);

    try {
      const client = createApiClient(undefined, token);
      await client.mutation("users:ensureUser" as any);
    } catch {
      // Will retry on next command if user sync fails
    }

    this.authToken = token;
    this.log(`  ${colors.success(symbols.success)}  ${chalk.bold("Logged in successfully.")}`);
    this.log("");
  }

  private async waitForAuthCallback(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const connections = new Set<import("node:net").Socket>();

      const timeout = setTimeout(() => {
        for (const conn of connections) conn.destroy();
        server.close();
        reject(new Error("Authentication timed out. Please try again."));
      }, AUTH_TIMEOUT_MS);

      const server = createServer((req, res) => {
        const url = new URL(req.url ?? "/", `http://localhost:${CALLBACK_PORT}`);

        if (url.pathname === "/callback") {
          const token = url.searchParams.get("token");
          if (token) {
            res.writeHead(200, { "Content-Type": "text/html", "Connection": "close" });
            res.end("<html><body style=\"font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#0a0a0a;color:#fafafa\"><div style=\"text-align:center\"><h1>Authenticated</h1><p>You can close this window and return to your terminal.</p></div></body></html>", () => {
              clearTimeout(timeout);
              for (const conn of connections) conn.destroy();
              server.close(() => resolve(token));
            });
          } else {
            res.writeHead(400, { "Content-Type": "text/plain" });
            res.end("Missing token parameter.");
          }
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      server.on("connection", (conn) => {
        connections.add(conn);
        conn.on("close", () => connections.delete(conn));
      });

      server.listen(CALLBACK_PORT, () => {
        const authBase = process.env.SLICKENV_AUTH_URL ?? "https://env.slickspender.com";
        const authUrl = `${authBase}/login?callback=http://localhost:${CALLBACK_PORT}/callback`;
        this.openBrowser(authUrl);
      });

      server.on("error", (err) => {
        clearTimeout(timeout);
        reject(new Error(`Could not start auth server on port ${CALLBACK_PORT}: ${err.message}`));
      });
    });
  }

  private openBrowser(url: string): void {
    const { platform } = process;
    const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
    exec(`${cmd} "${url}"`);
    this.log(`  If the browser doesn't open, visit:`);
    this.log(`  ${chalk.underline.cyan(url)}`);
    this.log("");
  }
}
