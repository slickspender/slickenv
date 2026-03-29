import { createServer } from "node:http";
import { exec } from "node:child_process";
import { BaseCommand } from "../base-command.js";
import { storeToken } from "../lib/keychain.js";
import { createApiClient } from "../lib/api.js";
import { colors, symbols } from "../lib/output.js";
import chalk from "chalk";

const CALLBACK_PORT = 9876;
const AUTH_TIMEOUT_MS = 120_000;

export default class Login extends BaseCommand {
  static override description = "Authenticate via browser OAuth";

  static override examples = [
    "slickenv login",
  ];

  static override flags = {
    ...BaseCommand.baseFlags,
  };

  protected override requiresConfig = false;
  protected override requiresAuth = false;

  async run(): Promise<void> {
    this.log("");
    this.log(`  ${chalk.bold.hex("#16A34A")("slickenv")} ${chalk.dim("login")}`);
    this.log(`  ${chalk.dim("─".repeat(40))}`);
    this.log(`  ${colors.info("Waiting for browser authentication...")}`);
    this.log("");

    const token = await this.waitForAuthCallback();
    await storeToken(token);

    try {
      const client = createApiClient(undefined, token);
      await client.mutation("users:ensureUser" as any);
      this.log("");
      this.log(`  ${colors.success(symbols.success)}  ${chalk.bold("Logged in successfully.")}`);
      const dashBase = process.env.SLICKENV_AUTH_URL ?? "https://env.slickspender.com";
      this.openBrowser(`${dashBase}/dashboard`);
      this.log(`  ${chalk.dim("→")}  Opening dashboard…`);
      this.log("");
    } catch {
      this.log("");
      this.success("Token saved. Could not sync user record — will retry on next command.");
    }
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
