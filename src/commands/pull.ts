import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Flags } from "@oclif/core";
import { BaseCommand } from "../base-command.js";
import { deriveKey, decrypt } from "../lib/crypto.js";
import { createApiClient } from "../lib/api.js";
import { decodeJwt } from "../lib/auth.js";
import { writeConfig, findConfigDir, loadConfig } from "../lib/config.js";
import { confirm, colors, symbols, displayVariable, header, divider } from "../lib/output.js";
import chalk from "chalk";

export default class Pull extends BaseCommand {
  static override description = "Pull the latest version from SlickEnv to local .env";

  static override examples = [
    "slickenv pull",
    "slickenv pull --version 2",
    "slickenv pull --dry-run",
  ];

  static override flags = {
    ...BaseCommand.baseFlags,
    version: Flags.integer({
      description: "Pull a specific version instead of latest",
    }),
    "dry-run": Flags.boolean({
      description: "Preview without writing to .env",
      default: false,
    }),
    yes: Flags.boolean({
      char: "y",
      description: "Auto-confirm overwrite prompts",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Pull);

    const client = createApiClient(this.slickenvConfig.apiUrl, this.authToken);

    // Fetch environment data
    const pullArgs: any = {
      projectId: this.slickenvConfig.projectId,
      label: this.slickenvConfig.defaultEnvironment,
    };
    if (flags.version !== undefined) {
      pullArgs.version = flags.version;
    }

    const result = await client.query("environments:pull" as any, pullArgs) as any;

    if (!result || !result.variables) {
      this.fail("No environment data found. Push first with `slickenv push`.");
    }

    // Get project for salt
    const project = await client.query("projects:get" as any, {
      projectId: this.slickenvConfig.projectId,
    }) as any;

    // Derive decryption key
    const jwt = decodeJwt(this.authToken);
    const clerkUserId = jwt.sub as string;
    const salt = Buffer.from(project.salt, "base64");
    const key = deriveKey(clerkUserId, this.slickenvConfig.projectId, salt);

    // Decrypt variables and build .env content with metadata comments
    const lines: string[] = [];
    for (const v of result.variables) {
      let value = v.value;
      if (v.isEncrypted && v.iv) {
        value = decrypt(v.value, v.iv, key);
      }

      const meta: string[] = [];
      meta.push(`@visibility=${v.visibility ?? "private"}`);
      meta.push(`@type=${v.type ?? "string"}`);
      if (v.required) meta.push(`@required=true`);
      if (v.example) meta.push(`@example=${v.example}`);
      lines.push(`# ${meta.join(" ")}`);
      lines.push(`${v.key}=${value}`);
    }

    const envContent = lines.join("\n") + "\n";

    // Dry run: display and exit
    if (flags["dry-run"]) {
      this.log("");
      this.log(header(this.slickenvConfig.projectName, this.slickenvConfig.defaultEnvironment));
      this.log(`  ${chalk.dim("Preview of")} ${colors.version(`v${result.version}`)}`);
      this.log(divider());
      for (const v of result.variables) {
        let value = v.value;
        if (v.isEncrypted && v.iv) {
          value = decrypt(v.value, v.iv, key);
        }
        this.log(`  ${displayVariable({ key: v.key, value, visibility: v.visibility, isEncrypted: false })}`);
      }
      this.log("");
      return;
    }

    // Confirm overwrite
    if (!flags.yes) {
      const ok = await confirm(`Overwrite .env with ${colors.version(`v${result.version}`)} (${result.variables.length} variables)?`);
      if (!ok) {
        this.info("Cancelled.");
        return;
      }
    }

    // Write to .env
    const envPath = join(process.cwd(), ".env");
    await writeFile(envPath, envContent, "utf8");

    // Update local config
    const configDir = await findConfigDir();
    if (configDir) {
      const config = await loadConfig(configDir);
      config.lastSyncedVersion = result.version;
      await writeConfig(config, configDir);
    }

    this.log("");
    this.log(`  ${colors.success(symbols.success)}  Pulled ${colors.version(`v${result.version}`)} ${chalk.dim(`(${result.variables.length} variable${result.variables.length === 1 ? "" : "s"} → .env)`)}`);
    this.log("");
  }
}
