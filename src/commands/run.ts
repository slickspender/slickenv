import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Flags } from "@oclif/core";
import { BaseCommand } from "../base-command.js";
import { createApiClient } from "../lib/api.js";
import { decodeJwt } from "../lib/auth.js";
import { deriveKey, decrypt } from "../lib/crypto.js";
import { colors, symbols } from "../lib/output.js";
import chalk from "chalk";

export default class Run extends BaseCommand {
  static override description = "Run any command with slickenv://KEY references resolved to real values — secrets stay in memory only.";

  static override examples = [
    "slickenv run -- node server.js",
    "slickenv run -- npm run dev",
    "slickenv run -- python manage.py runserver",
  ];

  // Allow arbitrary trailing arguments after --
  static override strict = false;

  static override flags = {
    ...BaseCommand.baseFlags,
    env: Flags.string({
      description: "Environment to resolve references from",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Run);

    // Find -- separator in the raw process argv
    const doubleDashIdx = process.argv.indexOf("--");
    const cmd =
      doubleDashIdx >= 0 ? process.argv.slice(doubleDashIdx + 1) : [];

    if (cmd.length === 0) {
      this.fail(
        "No command specified. Usage: slickenv run -- <command>",
      );
    }

    // ── Read local .env ─────────────────────────────────────────────
    let envContent: string;
    try {
      envContent = await readFile(join(process.cwd(), ".env"), "utf8");
    } catch {
      this.fail("No .env file found. Run slickenv pull first.");
    }

    // ── Find slickenv:// references ─────────────────────────────────
    const references: Array<{ envKey: string; secretKey: string }> = [];

    for (const line of envContent!.split("\n")) {
      const match = line
        .trim()
        .match(/^([A-Z_][A-Z0-9_]*)=slickenv:\/\/([A-Z_][A-Z0-9_]*)$/);
      if (match) {
        references.push({ envKey: match[1]!, secretKey: match[2]! });
      }
    }

    // ── Build the resolved environment ──────────────────────────────
    const resolvedEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
    };

    if (references.length > 0) {
      this.log(
        `  ${colors.info("Resolving")} ${references.length} slickenv:// reference${references.length === 1 ? "" : "s"}...`,
      );

      // Fetch real values from Convex
      const client = createApiClient(
        this.slickenvConfig.apiUrl,
        this.authToken,
      );

      const project = (await client.query("projects:get" as any, {
        projectId: this.slickenvConfig.projectId,
      })) as any;

      if (!project?.salt) {
        this.fail(
          "Project has no encryption salt. Please re-initialise with `slickenv init`.",
        );
      }

      const envLabel =
        flags.env ?? this.slickenvConfig.defaultEnvironment;

      const envResult = (await client.query("environments:pull" as any, {
        projectId: this.slickenvConfig.projectId,
        label: envLabel,
      })) as any;

      const jwt = decodeJwt(this.authToken);
      const clerkUserId = jwt.sub as string;
      const salt = Buffer.from(project.salt, "base64");
      const key = deriveKey(
        clerkUserId,
        this.slickenvConfig.projectId,
        salt,
      );

      const remoteMap = new Map<string, string>();
      for (const v of envResult.variables) {
        const value =
          v.isEncrypted && v.iv ? decrypt(v.value, v.iv, key) : v.value;
        remoteMap.set(v.key, value);
      }

      for (const ref of references) {
        const value = remoteMap.get(ref.secretKey);
        if (value !== undefined) {
          resolvedEnv[ref.envKey] = value;
          this.log(
            `  ${colors.success(symbols.success)}  ${colors.key(ref.envKey)}`,
          );
        } else {
          this.log(
            `  ${colors.warning(symbols.warning)}  ${ref.secretKey} not found in remote — skipping`,
          );
        }
      }

      this.log("");
    }

    // ── Inject non-reference vars from .env into the environment ────
    for (const line of envContent!.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const k = trimmed.slice(0, eqIdx).trim();
      const v = trimmed.slice(eqIdx + 1).trim();
      if (!v.startsWith("slickenv://") && k) {
        // Strip surrounding quotes if present
        resolvedEnv[k] = v.replace(/^['"]|['"]$/g, "");
      }
    }

    // ── Spawn the command ───────────────────────────────────────────
    this.log(`  ${chalk.dim("Starting:")} ${cmd.join(" ")}`);
    this.log("");

    const child = spawn(cmd[0]!, cmd.slice(1), {
      env: resolvedEnv,
      stdio: "inherit",
      shell: false,
    });

    await new Promise<void>((resolve, reject) => {
      child.on("exit", (code) => {
        if (code !== 0) {
          reject(new Error(`Process exited with code ${code}`));
        } else {
          resolve();
        }
      });
      child.on("error", reject);
    });
  }
}
