import { Args } from "@oclif/core";
import { BaseCommand } from "../../base-command.js";
import { createApiClient } from "../../lib/api.js";
import { confirm } from "../../lib/output.js";

export default class MembersRemove extends BaseCommand {
  static override description = "Remove a member from the current project";

  static override examples = [
    "slickenv members remove user@example.com",
  ];

  static override args = {
    email: Args.string({
      description: "Email address of the member to remove",
      required: true,
    }),
  };

  static override flags = {
    ...BaseCommand.baseFlags,
  };

  async run(): Promise<void> {
    const { args } = await this.parse(MembersRemove);
    const client = createApiClient(this.slickenvConfig.apiUrl, this.authToken);

    // First, list members to find the userId for the given email
    const members = (await client.query("members:listMembers" as any, {
      projectId: this.slickenvConfig.projectId,
    })) as any[];

    const target = members.find(
      (m) => m.email.toLowerCase() === args.email.toLowerCase()
    );

    if (!target) {
      this.fail(`No member found with email "${args.email}".`);
    }

    if (target.role === "owner") {
      this.fail("The project owner cannot be removed.");
    }

    const ok = await confirm(`Remove ${args.email} from this project?`);
    if (!ok) {
      this.info("Cancelled.");
      return;
    }

    try {
      await client.mutation("members:remove" as any, {
        projectId: this.slickenvConfig.projectId,
        userId: target.userId,
      });
    } catch (error: any) {
      const msg = error?.data?.message ?? error?.message ?? "Failed to remove member.";
      this.fail(msg);
    }

    this.success(`Removed ${args.email} from the project.`);
  }
}
