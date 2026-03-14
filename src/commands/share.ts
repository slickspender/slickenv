import { Flags } from "@oclif/core";
import { BaseCommand } from "../base-command.js";
import { createApiClient } from "../lib/api.js";
import { confirm, colors, mask } from "../lib/output.js";
import { decodeJwt } from "../lib/auth.js";
import { deriveKey, decrypt } from "../lib/crypto.js";

export default class Share extends BaseCommand {
  static override description = "Generate a shareable view of the current environment";

  static override examples = [
    "slickenv share",
    "slickenv share --public-only",
    "slickenv share --reveal",
  ];

  static override flags = {
    ...BaseCommand.baseFlags,
    "public-only": Flags.boolean({
      description: "Show only public variables",
      default: false,
    }),
    reveal: Flags.boolean({
      description: "Show private variable values in plaintext (requires confirmation)",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Share);

    if (flags.reveal && !flags["public-only"]) {
      const ok = await confirm("Reveal all private variable values in plaintext?");
      if (!ok) {
        this.info("Cancelled.");
        return;
      }
    }

    const client = createApiClient(this.slickenvConfig.apiUrl, this.authToken);

    // For reveal mode, pull the full encrypted data and decrypt locally
    if (flags.reveal) {
      const result = await client.query("environments:pull" as any, {
        projectId: this.slickenvConfig.projectId,
        label: this.slickenvConfig.defaultEnvironment,
      }) as any;

      const project = await client.query("projects:get" as any, {
        projectId: this.slickenvConfig.projectId,
      }) as any;

      const jwt = decodeJwt(this.authToken);
      const key = deriveKey(jwt.sub as string, this.slickenvConfig.projectId, Buffer.from(project.salt, "base64"));

      this.log("");
      this.log(`  ${colors.key(project.name)} / ${this.slickenvConfig.defaultEnvironment}  v${result.version}`);
      this.log("");

      const vars = flags["public-only"]
        ? result.variables.filter((v: any) => v.visibility === "public")
        : result.variables;

      for (const v of vars) {
        const value = v.isEncrypted && v.iv ? decrypt(v.value, v.iv, key) : v.value;
        this.log(`  ${v.key}=${value}`);
      }

      this.log("");
      this.log(`  ${vars.length} variable${vars.length === 1 ? "" : "s"}`);
      this.log("");
      return;
    }

    // Non-reveal mode: use the snapshot endpoint (masks private values)
    const snapshot = await client.query("sharing:createSnapshot" as any, {
      projectId: this.slickenvConfig.projectId,
      label: this.slickenvConfig.defaultEnvironment,
      publicOnly: flags["public-only"],
    }) as any;

    this.log("");
    this.log(`  ${colors.key(snapshot.project.name)} / ${snapshot.label}  v${snapshot.version}`);
    this.log("");

    for (const v of snapshot.variables) {
      const displayValue = v.visibility === "private" ? mask() : v.value;
      this.log(`  ${v.key}=${displayValue}`);
    }

    this.log("");
    this.log(`  ${snapshot.variables.length} variable${snapshot.variables.length === 1 ? "" : "s"}`);
    this.log("");
  }
}
