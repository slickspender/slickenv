import { randomBytes, createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { Flags } from "@oclif/core";
import { BaseCommand } from "../base-command.js";
import { createApiClient } from "../lib/api.js";
import { confirm, colors, mask, isTTY } from "../lib/output.js";
import { decodeJwt } from "../lib/auth.js";
import { deriveKey, decrypt, encrypt } from "../lib/crypto.js";
import chalk from "chalk";

function parseExpiry(expires: string): number {
  const match = expires.match(/^(\d+)(h|d|m)$/);
  if (!match) throw new Error('Invalid expiry format. Use: 1h, 24h, 7d, 30m');
  const [, num, unit] = match;
  const ms = { h: 3600000, d: 86400000, m: 60000 }[unit as 'h' | 'd' | 'm']!;
  return Date.now() + parseInt(num!) * ms;
}

export default class Share extends BaseCommand {
  static override description = "Generate a shareable view of the current environment";

  static override examples = [
    "slickenv share",
    "slickenv share --public-only",
    "slickenv share --reveal",
    "slickenv share --link",
    "slickenv share --link --expires 7d --reads 3",
    "slickenv share --link --password",
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
    link: Flags.boolean({
      char: 'l',
      description: 'Create a one-time encrypted share link (expires after first read)',
      default: false,
    }),
    expires: Flags.string({
      description: 'Link expiry time (e.g., 1h, 24h, 7d)',
      default: '24h',
    }),
    reads: Flags.integer({
      description: 'Number of times the link can be read',
      default: 1,
    }),
    password: Flags.boolean({
      description: 'Add password protection to the share link',
      default: false,
    }),
    env: Flags.string({
      description: 'Environment to share (default: current)',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Share);

    const client = createApiClient(this.slickenvConfig.apiUrl, this.authToken);

    // --link mode: create encrypted one-time share link
    if (flags.link) {
      const envLabel = flags.env ?? this.slickenvConfig.defaultEnvironment;

      // Fetch environment variables
      const result = await client.query("environments:pull" as any, {
        projectId: this.slickenvConfig.projectId,
        label: envLabel,
      }) as any;

      if (!result?.variables) {
        this.fail("No environment data found. Push first with `slickenv push`.");
      }

      // Decrypt variables client-side
      const project = await client.query("projects:get" as any, {
        projectId: this.slickenvConfig.projectId,
      }) as any;

      const jwt = decodeJwt(this.authToken);
      const projectKey = deriveKey(jwt.sub as string, this.slickenvConfig.projectId, Buffer.from(project.salt, "base64"));

      const plainVars: Array<{ key: string; value: string; visibility: string }> = [];
      for (const v of result.variables) {
        const value = v.isEncrypted && v.iv ? decrypt(v.value, v.iv, projectKey) : v.value;
        plainVars.push({ key: v.key, value, visibility: v.visibility ?? 'private' });
      }

      // Create a random 32-byte token and a new random encryption key (not the project key)
      const token = randomBytes(32).toString('hex');
      const shareKey = randomBytes(32);

      // Encrypt the payload with the share key
      const payload = JSON.stringify(plainVars);
      const { ciphertext: encryptedPayload, iv } = encrypt(payload, shareKey);

      // Parse expiry
      let expiresAt: number;
      try {
        expiresAt = parseExpiry(flags.expires);
      } catch (err: any) {
        this.fail(err.message);
      }

      // Handle optional password
      let passwordHash: string | undefined;
      if (flags.password) {
        const pw = await this.promptPassword("Enter share link password");
        if (pw) {
          passwordHash = createHash('sha256').update(pw).digest('hex');
        }
      }

      // Store in Convex
      await client.mutation("sharing:createLink" as any, {
        token,
        encryptedPayload,
        iv,
        encryptionKey: shareKey.toString('base64'),
        expiresAt: expiresAt!,
        maxReads: flags.reads,
        passwordHash,
      });

      const shareUrl = `https://env.slickspender.com/s/${token}`;

      // Format expiry for display
      const expiresMatch = flags.expires.match(/^(\d+)(h|d|m)$/);
      let expiresDisplay = flags.expires;
      if (expiresMatch) {
        const [, num, unit] = expiresMatch;
        const unitLabel = { h: 'hour', d: 'day', m: 'minute' }[unit as 'h' | 'd' | 'm']!;
        expiresDisplay = `${num} ${unitLabel}${parseInt(num!) !== 1 ? 's' : ''} from now`;
      }

      this.log("");
      this.log(`  ${colors.success("✓")}  Share link created`);
      this.log("");
      this.log(`  ${chalk.dim("URL:")}     ${colors.url(shareUrl)}`);
      this.log(`  ${chalk.dim("Expires:")} ${expiresDisplay}`);
      this.log(`  ${chalk.dim("Reads:")}   ${flags.reads}${flags.reads === 1 ? ' (self-destructs after first view)' : ''}`);
      if (passwordHash) {
        this.log(`  ${chalk.dim("Password protected")}`);
      }
      this.log("");
      this.log(`  Send this link to your teammate. It cannot be opened ${flags.reads === 1 ? 'twice' : `more than ${flags.reads} times`}.`);
      this.log("");
      return;
    }

    if (flags.reveal && !flags["public-only"]) {
      const ok = await confirm("Reveal all private variable values in plaintext?");
      if (!ok) {
        this.info("Cancelled.");
        return;
      }
    }

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

  private async promptPassword(message: string): Promise<string> {
    if (!isTTY) return '';
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
      rl.question(`  ${message}: `, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }
}
