import { Flags } from "@oclif/core";
import { BaseCommand } from "../base-command.js";
import { createApiClient } from "../lib/api.js";
import { colors, symbols, header, divider } from "../lib/output.js";
import chalk from "chalk";

export default class Versions extends BaseCommand {
  static override description = "List version history for the current environment";

  static override examples = [
    "slickenv versions",
    "slickenv versions --limit 10",
  ];

  static override flags = {
    ...BaseCommand.baseFlags,
    limit: Flags.integer({
      description: "Number of versions to show",
      default: 20,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Versions);
    const client = createApiClient(this.slickenvConfig.apiUrl, this.authToken);

    const result = await client.query("versions:list" as any, {
      projectId: this.slickenvConfig.projectId,
      label: this.slickenvConfig.defaultEnvironment,
      limit: flags.limit,
    }) as any;

    if (!result.versions || result.versions.length === 0) {
      this.log("");
      this.log(`  ${chalk.dim("No versions found.")}`);
      this.log(`  ${chalk.dim("Run")} ${colors.highlight("slickenv push")} ${chalk.dim("to create one.")}`);
      this.log("");
      return;
    }

    this.log("");
    this.log(header(this.slickenvConfig.projectName, this.slickenvConfig.defaultEnvironment));
    this.log(divider());

    for (const v of result.versions) {
      const date = new Date(v.createdAt).toLocaleString();
      const versionStr = colors.version(`v${String(v.version).padStart(2, " ")}`);
      const activeMarker = v.isActive ? ` ${colors.success(symbols.bullet)} ${colors.success("active")}` : "";
      const vars = chalk.dim(`${v.variableCount} vars`);
      const summary = v.changeSummary ? `  ${chalk.dim("—")} ${chalk.italic(v.changeSummary)}` : "";

      this.log(`  ${versionStr}  ${colors.timestamp(date)}  ${vars}${activeMarker}${summary}`);
    }

    this.log("");
  }
}
