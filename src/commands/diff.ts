import { Args } from "@oclif/core";
import { BaseCommand } from "../base-command.js";
import { createApiClient } from "../lib/api.js";
import { colors, symbols } from "../lib/output.js";

export default class Diff extends BaseCommand {
  static override description = "Show the diff between two specific versions";

  static override examples = [
    "slickenv diff 3 5",
  ];

  static override args = {
    "version-a": Args.integer({
      description: "First version to compare",
      required: true,
    }),
    "version-b": Args.integer({
      description: "Second version to compare",
      required: true,
    }),
  };

  static override flags = {
    ...BaseCommand.baseFlags,
  };

  async run(): Promise<void> {
    const { args } = await this.parse(Diff);
    const client = createApiClient(this.slickenvConfig.apiUrl, this.authToken);

    const result = await client.query("versions:diff" as any, {
      projectId: this.slickenvConfig.projectId,
      label: this.slickenvConfig.defaultEnvironment,
      versionA: args["version-a"],
      versionB: args["version-b"],
    }) as any;

    this.log("");
    this.log(`  ${colors.key(this.slickenvConfig.projectName)} / ${this.slickenvConfig.defaultEnvironment}`);
    this.log(`  Comparing v${result.versionA} ... v${result.versionB}`);
    this.log("");

    for (const d of result.diffs) {
      if (d.status === "unchanged") continue;

      const sym = d.status === "added" ? symbols.added
        : d.status === "removed" ? symbols.removed
        : symbols.modified;

      const color = d.status === "added" ? colors.success
        : d.status === "removed" ? colors.error
        : colors.warning;

      this.log(`  ${color(sym)}  ${d.key}`);
    }

    this.log("");
    this.log(`  ${colors.success(`+${result.summary.added}`)} added  ${colors.error(`-${result.summary.removed}`)} removed  ${colors.warning(`~${result.summary.modified}`)} modified  ${colors.info(`${result.summary.unchanged} unchanged`)}`);
    this.log("");
  }
}
