import { BaseCommand } from "../../base-command.js";
import { createApiClient } from "../../lib/api.js";
import { colors } from "../../lib/output.js";

export default class MembersList extends BaseCommand {
  static override description = "List all members of the current project";

  static override examples = [
    "slickenv members list",
    "slickenv members list --json",
  ];

  static override flags = {
    ...BaseCommand.baseFlags,
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MembersList);
    const client = createApiClient(this.slickenvConfig.apiUrl, this.authToken);

    const members = (await client.query("members:listMembers" as any, {
      projectId: this.slickenvConfig.projectId,
    })) as any[];

    if (flags.json) {
      this.log(JSON.stringify(members, null, 2));
      return;
    }

    this.log("");
    this.log(`  ${colors.key(this.slickenvConfig.projectName)} — ${members.length} member${members.length === 1 ? "" : "s"}`);
    this.log("");

    for (const m of members) {
      const role = m.role === "owner"
        ? colors.warning("owner")
        : m.role === "admin"
          ? colors.success("admin")
          : colors.info(m.role);
      const name = m.name ? `${m.name} ` : "";
      this.log(`  ${name}${colors.email(m.email)}  ${role}`);
    }

    this.log("");
  }
}
