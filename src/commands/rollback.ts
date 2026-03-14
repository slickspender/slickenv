import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../base-command.js";
import { createApiClient } from "../lib/api.js";
import { writeConfig, findConfigDir, loadConfig } from "../lib/config.js";
import { confirm } from "../lib/output.js";

export default class Rollback extends BaseCommand {
  static override description = "Roll back to a previous version (creates a new version — non-destructive)";

  static override examples = [
    "slickenv rollback 3",
    "slickenv rollback 3 --yes",
  ];

  static override args = {
    version: Args.integer({
      description: "Version number to roll back to",
      required: true,
    }),
  };

  static override flags = {
    ...BaseCommand.baseFlags,
    yes: Flags.boolean({
      char: "y",
      description: "Auto-confirm rollback",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Rollback);

    if (!flags.yes) {
      const ok = await confirm(`Roll back ${this.slickenvConfig.defaultEnvironment} to v${args.version}? This creates a new version.`);
      if (!ok) {
        this.info("Cancelled.");
        return;
      }
    }

    const client = createApiClient(this.slickenvConfig.apiUrl, this.authToken);

    const result = await client.mutation("versions:rollback" as any, {
      projectId: this.slickenvConfig.projectId,
      label: this.slickenvConfig.defaultEnvironment,
      targetVersion: args.version,
    }) as any;

    // Update local config
    const configDir = await findConfigDir();
    if (configDir) {
      const config = await loadConfig(configDir);
      config.lastSyncedVersion = result.newVersion;
      await writeConfig(config, configDir);
    }

    this.success(`Rolled back to v${args.version}. New active version: v${result.newVersion}.`);
  }
}
