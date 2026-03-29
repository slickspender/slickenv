import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { Flags } from "@oclif/core";
import { BaseCommand } from "../base-command.js";
import { parseEnvFile, serializeEnvFile } from "../lib/parser.js";
import { deriveKey, encrypt, decrypt } from "../lib/crypto.js";
import { createApiClient } from "../lib/api.js";
import { decodeJwt } from "../lib/auth.js";
import { writeConfig, findConfigDir, loadConfig } from "../lib/config.js";
import { confirm, colors, symbols, header, divider } from "../lib/output.js";
import { lintEnvFile } from "../lib/linter.js";
import type { PushVariableInput } from "@slickenv/types";
import chalk from "chalk";

export default class Push extends BaseCommand {
  static override description = "Push local .env changes to SlickEnv";

  static override examples = [
    "slickenv push",
    'slickenv push --message "Update Redis URL"',
    "slickenv push --force --yes",
    "slickenv push --file .env.production",
  ];

  static override flags = {
    ...BaseCommand.baseFlags,
    file: Flags.string({
      description: "Use a different file instead of .env",
      default: ".env",
    }),
    force: Flags.boolean({
      description: "Skip conflict check and override remote",
      default: false,
    }),
    message: Flags.string({
      char: "m",
      description: "Attach a description to this version",
    }),
    yes: Flags.boolean({
      char: "y",
      description: "Auto-confirm destructive prompts",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Push);

    // Read and parse the local .env file
    const envPath = join(process.cwd(), flags.file);
    let content: string;
    try {
      await access(envPath);
      content = await readFile(envPath, "utf8");
    } catch {
      this.fail(
        `File not found: ${flags.file}\n` +
        `     Create a .env file with your variables first, e.g.:\n\n` +
        `       # @visibility=private @type=string\n` +
        `       API_KEY=your-secret-key\n\n` +
        `     Or specify a different file with --file <path>.`
      );
    }

    const parsed = parseEnvFile(content!);
    if (parsed.length === 0) {
      this.fail(`No variables found in ${flags.file}.`);
    }

    // Run linter
    const lintIssues = lintEnvFile(parsed);
    const lintErrors = lintIssues.filter(i => i.level === 'error');
    const lintWarnings = lintIssues.filter(i => i.level === 'warning');

    if (lintErrors.length > 0) {
      this.log("");
      this.log(`  ${colors.error("Env linter found errors — fix before pushing:")}`);
      for (const issue of lintErrors) {
        this.log(`  ${colors.error("✗")}  ${colors.key(issue.key)}: ${issue.message}`);
      }
      this.log("");
      this.fail("Fix linter errors before pushing.");
    }

    if (lintWarnings.length > 0) {
      this.log(`  ${colors.warning("⚠")}  Linter warnings (${lintWarnings.length}):`);
      for (const issue of lintWarnings) {
        this.log(`    ${chalk.dim("·")}  ${colors.key(issue.key)}: ${issue.message}`);
      }
      this.log("");
    }

    // Inject metadata comments into .env if any variables are missing them
    const needsUpdate = parsed.some((v) => v.metadataWasInjected);
    if (needsUpdate) {
      const updated = serializeEnvFile(parsed, content);
      await writeFile(envPath, updated, "utf8");
      this.info(`Added metadata comments to ${flags.file}.`);
    }

    // Get project salt for encryption
    const client = createApiClient(this.slickenvConfig.apiUrl, this.authToken);
    const project = await client.query("projects:get" as any, {
      projectId: this.slickenvConfig.projectId,
    }) as any;

    if (!project?.salt) {
      this.fail("Project has no encryption salt. Please re-initialise with `slickenv init`.");
    }

    // Derive encryption key
    const jwt = decodeJwt(this.authToken);
    const clerkUserId = jwt.sub as string;
    const salt = Buffer.from(project.salt, "base64");
    const key = deriveKey(clerkUserId, this.slickenvConfig.projectId, salt);

    // Check if there are actual changes compared to remote
    try {
      const remote = await client.query("environments:pull" as any, {
        projectId: this.slickenvConfig.projectId,
        label: this.slickenvConfig.defaultEnvironment,
      }) as any;

      if (remote?.variables) {
        const remoteMap = new Map<string, { value: string; visibility: string; type: string; required: boolean }>();
        for (const rv of remote.variables) {
          let value = rv.value;
          if (rv.isEncrypted && rv.iv) {
            value = decrypt(rv.value, rv.iv, key);
          }
          remoteMap.set(rv.key, { value, visibility: rv.visibility, type: rv.type, required: rv.required });
        }

        const hasChanges =
          parsed.length !== remoteMap.size ||
          parsed.some((v) => {
            const r = remoteMap.get(v.key);
            return !r || r.value !== v.value || r.visibility !== v.visibility || r.type !== v.type || r.required !== v.required;
          });

        if (!hasChanges) {
          this.log("");
          this.log(`  ${colors.success(symbols.success)}  ${chalk.dim("No changes detected. Local .env matches remote.")}`);
          this.log("");
          return;
        }
      }
    } catch {
      // No remote version yet — this is the first push, continue
    }

    // Encrypt private variables
    const variables: PushVariableInput[] = parsed.map((v) => {
      if (v.visibility === "private") {
        const { ciphertext, iv } = encrypt(v.value, key);
        return {
          key: v.key,
          value: ciphertext,
          isEncrypted: true,
          iv,
          visibility: v.visibility,
          type: v.type,
          required: v.required,
          example: v.example,
        };
      }
      return {
        key: v.key,
        value: v.value,
        isEncrypted: false,
        visibility: v.visibility,
        type: v.type,
        required: v.required,
        example: v.example,
      };
    });

    // Determine base version for conflict detection
    const baseVersion = flags.force ? -1 : (this.slickenvConfig.lastSyncedVersion ?? 0);

    // Count by visibility
    const privateCount = parsed.filter((v) => v.visibility === "private").length;
    const publicCount = parsed.length - privateCount;

    // Confirm push
    this.log("");
    this.log(header(this.slickenvConfig.projectName, this.slickenvConfig.defaultEnvironment));
    this.log(divider());
    this.log(`  ${colors.highlight(String(parsed.length))} variable${parsed.length === 1 ? "" : "s"} ${chalk.dim("(")}${colors.error(`${privateCount} private`)}${chalk.dim(",")} ${colors.success(`${publicCount} public`)}${chalk.dim(")")}`);
    if (flags.message) {
      this.log(`  ${chalk.dim("Message:")} ${flags.message}`);
    }
    this.log("");

    if (!flags.yes) {
      const ok = await confirm("Push these changes?");
      if (!ok) {
        this.info("Cancelled.");
        return;
      }
    }

    // Push to Convex
    const result = await client.mutation("environments:push" as any, {
      projectId: this.slickenvConfig.projectId,
      label: this.slickenvConfig.defaultEnvironment,
      variables,
      changeSummary: flags.message,
      baseVersion: flags.force ? (await this.getCurrentVersion(client)) : baseVersion,
    }) as any;

    // Update local config with new version
    const configDir = await findConfigDir();
    if (configDir) {
      const config = await loadConfig(configDir);
      config.lastSyncedVersion = result.newVersion;
      await writeConfig(config, configDir);
    }

    this.log("");
    this.log(`  ${colors.success(symbols.success)}  Pushed ${colors.version(`v${result.newVersion}`)} ${chalk.dim(`(${parsed.length} variable${parsed.length === 1 ? "" : "s"})`)}`);
    this.log("");

    // Auto-generate .env.example after push
    try {
      const examplePath = join(process.cwd(), '.env.example');
      const exampleLines: string[] = ['# Auto-generated by slickenv push\n# Do not commit real values to this file\n'];
      for (const v of parsed) {
        if (v.example) {
          exampleLines.push(`${v.key}=${v.example}`);
        } else if (v.visibility === 'private') {
          exampleLines.push(`${v.key}=your_${v.key.toLowerCase()}_here`);
        } else {
          exampleLines.push(`${v.key}=${v.value}`);
        }
      }
      await writeFile(examplePath, exampleLines.join('\n') + '\n', 'utf8');
      this.log(`  ${chalk.dim("→")}  Generated .env.example`);
    } catch {
      // Non-fatal: .env.example generation is best-effort
    }
  }

  private async getCurrentVersion(client: any): Promise<number> {
    try {
      const status = await client.query("environments:getStatus" as any, {
        projectId: this.slickenvConfig.projectId,
        label: this.slickenvConfig.defaultEnvironment,
      }) as any;
      return status?.version ?? 0;
    } catch {
      return 0;
    }
  }
}
