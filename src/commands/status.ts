import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { BaseCommand } from "../base-command.js";
import { createApiClient } from "../lib/api.js";
import { parseEnvFile } from "../lib/parser.js";
import { decodeJwt } from "../lib/auth.js";
import { deriveKey, decrypt } from "../lib/crypto.js";
import { colors, symbols, header, divider } from "../lib/output.js";
import chalk from "chalk";

export default class Status extends BaseCommand {
  static override description = "Show what's different between local .env and remote";

  static override examples = [
    "slickenv status",
  ];

  static override flags = {
    ...BaseCommand.baseFlags,
  };

  async run(): Promise<void> {
    const client = createApiClient(this.slickenvConfig.apiUrl, this.authToken);

    // Get remote status
    const status = await client.query("environments:getStatus" as any, {
      projectId: this.slickenvConfig.projectId,
      label: this.slickenvConfig.defaultEnvironment,
    }) as any;

    this.log("");
    this.log(header(status.project.name, this.slickenvConfig.defaultEnvironment));
    this.log(divider());

    if (!status.exists) {
      this.log(`  ${chalk.dim("No remote environment yet.")}`);
      this.log(`  ${chalk.dim("Run")} ${colors.highlight("slickenv push")} ${chalk.dim("to create one.")}`);
      this.log("");
      return;
    }

    this.log(`  ${chalk.dim("Remote")}  ${colors.version(`v${status.version}`)} ${chalk.dim(`(${status.variableCount} variables)`)}`);
    this.log(`  ${chalk.dim("Synced")}  ${colors.version(`v${this.slickenvConfig.lastSyncedVersion ?? "none"}`)}`);

    // Parse local .env
    let localVars: Map<string, string>;
    try {
      const content = await readFile(join(process.cwd(), ".env"), "utf8");
      const parsed = parseEnvFile(content);
      localVars = new Map(parsed.map((v) => [v.key, v.value]));
    } catch {
      this.log(`  ${chalk.dim("Local")}   ${colors.warning("No .env file found")}`);
      this.log("");
      return;
    }

    this.log(`  ${chalk.dim("Local")}   ${localVars.size} variables`);

    // Fetch remote variables for comparison
    const remote = await client.query("environments:pull" as any, {
      projectId: this.slickenvConfig.projectId,
      label: this.slickenvConfig.defaultEnvironment,
    }) as any;

    // Derive key for decryption
    const project = await client.query("projects:get" as any, {
      projectId: this.slickenvConfig.projectId,
    }) as any;

    const jwt = decodeJwt(this.authToken);
    const key = deriveKey(jwt.sub as string, this.slickenvConfig.projectId, Buffer.from(project.salt, "base64"));

    const remoteVars = new Map<string, string>();
    for (const v of remote.variables) {
      const value = v.isEncrypted && v.iv ? decrypt(v.value, v.iv, key) : v.value;
      remoteVars.set(v.key, value);
    }

    // Compute diff
    const allKeys = new Set([...localVars.keys(), ...remoteVars.keys()]);
    const added: string[] = [];
    const removed: string[] = [];
    const modified: string[] = [];

    for (const k of allKeys) {
      const local = localVars.get(k);
      const remote = remoteVars.get(k);
      if (local !== undefined && remote === undefined) added.push(k);
      else if (local === undefined && remote !== undefined) removed.push(k);
      else if (local !== remote) modified.push(k);
    }

    if (added.length === 0 && removed.length === 0 && modified.length === 0) {
      this.log("");
      this.log(`  ${colors.success(symbols.success)}  ${chalk.bold("In sync.")} ${chalk.dim("No changes detected.")}`);
      this.log("");
      return;
    }

    this.log("");
    for (const k of added) this.log(`  ${colors.success(symbols.added)}  ${colors.key(k)} ${chalk.dim("(local only)")}`);
    for (const k of removed) this.log(`  ${colors.error(symbols.removed)}  ${colors.key(k)} ${chalk.dim("(remote only)")}`);
    for (const k of modified) this.log(`  ${colors.warning(symbols.modified)}  ${colors.key(k)} ${chalk.dim("(modified)")}`);
    this.log(divider());
    this.log(`  ${colors.success(`${added.length} added`)}${chalk.dim(",")} ${colors.error(`${removed.length} removed`)}${chalk.dim(",")} ${colors.warning(`${modified.length} modified`)}`);
    this.log("");
  }
}
