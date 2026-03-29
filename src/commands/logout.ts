import { BaseCommand } from "../base-command.js";
import { deleteToken } from "../lib/keychain.js";
import { resolveToken } from "../lib/auth.js";

export default class Logout extends BaseCommand {
  static override description = "Revoke token and clear local auth";

  static override examples = [
    "slickenv logout",
  ];

  static override flags = {
    ...BaseCommand.baseFlags,
  };

  protected override requiresConfig = false;
  protected override requiresAuth = false;

  async run(): Promise<void> {
    const token = await resolveToken();
    if (!token) {
      this.info("Not currently authenticated.");
      return;
    }

    await deleteToken();
    this.success("Logged out. Token cleared from local storage.");
  }
}
