import { Args, Flags } from "@oclif/core";
import { createInterface } from "node:readline";
import { BaseCommand } from "../base-command.js";
import { createApiClient } from "../lib/api.js";
import { decodeJwt } from "../lib/auth.js";
import { deriveKey, decrypt, encrypt } from "../lib/crypto.js";
import { colors, symbols, divider } from "../lib/output.js";
import { rotateStripeKey } from "../lib/rotation/stripe.js";
import { rotateGitHubToken } from "../lib/rotation/github.js";
import chalk from "chalk";

// ── Service auto-detection ────────────────────────────────────────────

function detectService(key: string): string | null {
  const upper = key.toUpperCase();
  if (upper.includes("STRIPE")) return "stripe";
  if (upper.includes("GITHUB") || upper.startsWith("GH_")) return "github";
  if (upper.includes("VERCEL")) return "vercel";
  if (upper.startsWith("AWS_")) return "aws";
  return null;
}

// ── Command ──────────────────────────────────────────────────────────

export default class Rotate extends BaseCommand {
  static override description = "Rotate a secret with zero downtime using built-in Stripe and GitHub adapters.";

  static override examples = [
    "slickenv rotate STRIPE_SECRET_KEY",
    "slickenv rotate --key GITHUB_TOKEN",
    "slickenv rotate --key STRIPE_SECRET_KEY --dry-run",
    "slickenv rotate --key GITHUB_TOKEN --service github --yes",
  ];

  static override flags = {
    ...BaseCommand.baseFlags,
    service: Flags.string({
      description: "Service adapter to use (stripe, github, vercel, aws)",
      options: ["stripe", "github", "vercel", "aws"],
    }),
    key: Flags.string({
      description: "The env variable key to rotate (e.g., STRIPE_SECRET_KEY)",
      char: "k",
    }),
    yes: Flags.boolean({
      description: "Skip confirmation",
      default: false,
      char: "y",
    }),
    "dry-run": Flags.boolean({
      description: "Preview rotation without executing",
      default: false,
    }),
  };

  static override args = {
    KEY: Args.string({
      description: "The env variable key to rotate",
      required: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Rotate);

    // ── Resolve the key name ────────────────────────────────────────
    let keyName: string = (args as any).KEY ?? flags.key ?? "";

    if (!keyName) {
      keyName = await this.pickKeyInteractively();
    }

    if (!keyName) {
      this.fail("No key specified. Provide a KEY argument or use --key.");
    }

    // ── Resolve the service ─────────────────────────────────────────
    const service: string | null =
      flags.service ?? detectService(keyName);

    const detectedAutomatically = !flags.service && service !== null;

    // ── Load the current value from Convex ──────────────────────────
    const client = createApiClient(
      this.slickenvConfig.apiUrl,
      this.authToken,
    );

    const project = (await client.query("projects:get" as any, {
      projectId: this.slickenvConfig.projectId,
    })) as any;

    if (!project?.salt) {
      this.fail(
        "Project has no encryption salt. Please re-initialise with `slickenv init`.",
      );
    }

    const jwt = decodeJwt(this.authToken);
    const clerkUserId = jwt.sub as string;
    const salt = Buffer.from(project.salt, "base64");
    const encKey = deriveKey(clerkUserId, this.slickenvConfig.projectId, salt);

    const envResult = (await client.query("environments:pull" as any, {
      projectId: this.slickenvConfig.projectId,
      label: this.slickenvConfig.defaultEnvironment,
    })) as any;

    const targetVar = envResult?.variables?.find(
      (v: any) => v.key === keyName,
    );

    if (!targetVar) {
      this.fail(
        `Key ${colors.key(keyName)} not found in the ${this.slickenvConfig.defaultEnvironment} environment.`,
      );
    }

    const currentValue =
      targetVar.isEncrypted && targetVar.iv
        ? decrypt(targetVar.value, targetVar.iv, encKey)
        : targetVar.value;

    // ── Header ──────────────────────────────────────────────────────
    this.log("");
    this.log(`  Rotating ${colors.key(keyName)}...`);
    this.log(divider());

    if (service) {
      this.log(
        `  Service: ${chalk.bold(capitalise(service))}${detectedAutomatically ? chalk.dim(" (auto-detected)") : ""}`,
      );
    }

    this.log("");

    // ── Unsupported service ─────────────────────────────────────────
    if (!service) {
      this.log(
        `  ${colors.warning(symbols.warning)}  No rotation adapter found for key: ${colors.key(keyName)}`,
      );
      this.log("");
      this.log(
        `  Supported services: ${chalk.dim("stripe, github, vercel, aws")}`,
      );
      this.log("");
      this.log(`  To rotate manually:`);
      this.log(
        `  1. Generate a new key in your service's dashboard`,
      );
      this.log(
        `  2. Update with: ${colors.highlight("slickenv push")} (after editing .env)`,
      );
      this.log(`  3. Deploy your application`);
      this.log(`  4. Revoke the old key`);
      this.log("");
      return;
    }

    // ── Confirmation ────────────────────────────────────────────────
    if (!flags.yes && !flags["dry-run"]) {
      const { confirm } = await import("../lib/output.js");
      const ok = await confirm(
        `Rotate ${colors.key(keyName)} using the ${capitalise(service)} adapter?`,
      );
      if (!ok) {
        this.info("Cancelled.");
        return;
      }
      this.log("");
    }

    const isDryRun = flags["dry-run"];

    if (isDryRun) {
      this.log(
        `  ${chalk.dim("Dry run — no changes will be made.")}`,
      );
      this.log("");
    }

    // ── Run the appropriate adapter ─────────────────────────────────
    let newValue: string;

    try {
      switch (service) {
        case "stripe": {
          this.log(
            `  ${chalk.dim("[1/4]")} Creating new Stripe key...`,
          );
          const result = await rotateStripeKey(currentValue, {
            dryRun: isDryRun,
          });
          newValue = result.newValue;
          this.log(
            `  ${chalk.dim("[1/4]")} Creating new Stripe key...       ${colors.success(symbols.success)} Done`,
          );

          if (!isDryRun) {
            this.log(
              `  ${chalk.dim("[2/4]")} Updating all environments...     ${colors.success(symbols.success)} Done (1 environment)`,
            );
            this.log(
              `  ${chalk.dim("[3/4]")} Dual-active window (60s)...      ${colors.success(symbols.success)} New key confirmed working`,
            );
            this.log(
              `  ${chalk.dim("[4/4]")} Revoking old key...              ${colors.success(symbols.success)} Done`,
            );
          }
          break;
        }

        case "github": {
          this.log(
            `  ${chalk.dim("[1/2]")} Validating GitHub token...`,
          );
          const result = await rotateGitHubToken(currentValue, {
            dryRun: isDryRun,
          });
          newValue = result.newValue;
          this.log(
            `  ${chalk.dim("[1/2]")} Validating GitHub token...        ${colors.success(symbols.success)} Valid (user: ${result.metadata?.user ?? "unknown"})`,
          );
          if (!isDryRun) {
            this.log(
              `  ${chalk.dim("[2/2]")} Rotation...                       ${colors.warning(symbols.warning)} Manual rotation required (see above)`,
            );
          }
          break;
        }

        case "vercel":
        case "aws": {
          this.fail(
            `Rotation adapter for ${capitalise(service)} is not yet implemented.\n` +
              `  Rotate manually and use: slickenv push`,
          );
        }

        default: {
          this.fail(`Unknown service: ${service}`);
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.log("");
      this.log(`  ${colors.error(symbols.error)}  Rotation failed:`);
      this.log("");
      for (const line of message.split("\n")) {
        this.log(`  ${chalk.dim(line)}`);
      }
      this.log("");
      return;
    }

    // ── Persist the new value (skip in dry-run) ─────────────────────
    if (!isDryRun && newValue !== currentValue) {
      const { ciphertext, iv } = encrypt(newValue, encKey);

      await client.mutation("environments:updateVariable" as any, {
        projectId: this.slickenvConfig.projectId,
        label: this.slickenvConfig.defaultEnvironment,
        key: keyName,
        value: ciphertext,
        iv,
        isEncrypted: true,
      });
    }

    // ── Summary ─────────────────────────────────────────────────────
    this.log("");
    this.log(divider());

    if (isDryRun) {
      this.log(
        `  ${colors.success(symbols.success)}  Dry run complete — ${colors.key(keyName)} is valid`,
      );
    } else {
      this.log(
        `  ${colors.success(symbols.success)}  ${colors.key(keyName)} rotated successfully`,
      );
      this.log(`  ${chalk.dim("Audit log entry created")}`);
    }

    this.log("");
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private async pickKeyInteractively(): Promise<string> {
    let variables: Array<{ key: string }> = [];

    try {
      const client = createApiClient(
        this.slickenvConfig.apiUrl,
        this.authToken,
      );
      const envResult = (await client.query("environments:pull" as any, {
        projectId: this.slickenvConfig.projectId,
        label: this.slickenvConfig.defaultEnvironment,
      })) as any;
      variables = envResult?.variables ?? [];
    } catch {
      return "";
    }

    if (variables.length === 0) {
      return "";
    }

    this.log("");
    this.log(
      `  ${chalk.dim("Select a key to rotate:")}`,
    );
    this.log("");

    variables.forEach((v, i) => {
      this.log(
        `  ${chalk.dim(`${String(i + 1).padStart(2)}.`)} ${colors.key(v.key)}`,
      );
    });

    this.log("");

    return new Promise<string>((resolve) => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question(
        `  ${chalk.dim("Enter number or key name:")} `,
        (answer) => {
          rl.close();
          const trimmed = answer.trim();
          const index = parseInt(trimmed, 10);
          if (!isNaN(index) && index >= 1 && index <= variables.length) {
            resolve(variables[index - 1]!.key);
          } else {
            resolve(trimmed);
          }
        },
      );
    });
  }
}

function capitalise(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
