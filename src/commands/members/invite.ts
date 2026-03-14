import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../../base-command.js";
import { createApiClient } from "../../lib/api.js";

export default class MembersInvite extends BaseCommand {
  static override description = "Invite a member to the current project";

  static override examples = [
    "slickenv members invite user@example.com",
    "slickenv members invite user@example.com --role admin",
    "slickenv members invite user@example.com --role viewer",
  ];

  static override args = {
    email: Args.string({
      description: "Email address of the user to invite",
      required: true,
    }),
  };

  static override flags = {
    ...BaseCommand.baseFlags,
    role: Flags.string({
      description: "Role to assign",
      options: ["admin", "member", "viewer"],
      default: "member",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(MembersInvite);
    const client = createApiClient(this.slickenvConfig.apiUrl, this.authToken);

    try {
      await client.mutation("members:invite" as any, {
        projectId: this.slickenvConfig.projectId,
        email: args.email,
        role: flags.role as "admin" | "member" | "viewer",
      });
    } catch (error: any) {
      const msg = error?.data?.message ?? error?.message ?? "Failed to invite member.";
      this.fail(msg);
    }

    this.success(`Invited ${args.email} as ${flags.role}.`);
  }
}
