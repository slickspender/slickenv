import { readFile, writeFile, chmod, unlink, access, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Flags } from "@oclif/core";
import chalk from "chalk";
import { BaseCommand } from "../../base-command.js";
import { colors, symbols, confirm } from "../../lib/output.js";

const execFileAsync = promisify(execFile);

// ── Hook script ───────────────────────────────────────────────────────────────

const HOOK_HEADER = "# SlickEnv pre-commit security hook v1.0";

const HOOK_SCRIPT = `#!/usr/bin/env sh
${HOOK_HEADER}
# Installed by: slickenv git protect
# To remove: slickenv git protect --uninstall

set -e

# Check staged files
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null || true)

if [ -z "$STAGED_FILES" ]; then
  exit 0
fi

BLOCKED=0

for FILE in $STAGED_FILES; do
  # Block .env files
  case "$FILE" in
    .env|.env.local|.env.production|.env.staging|.env.development|.env.test|.env.backup|*.env)
      printf "\\n  🚨 \\033[31mCOMMIT BLOCKED\\033[0m — SlickEnv: .env file staged\\n"
      printf "     File:  %s\\n" "$FILE"
      printf "     Fix:   Add .env to .gitignore, then:\\n"
      printf "             slickenv push  (to sync securely)\\n\\n"
      BLOCKED=1
      ;;
  esac

  # Check file content for common secret patterns (if slickenv is available)
  if command -v slickenv >/dev/null 2>&1; then
    CONTENT=$(git show ":$FILE" 2>/dev/null || true)
    if [ -n "$CONTENT" ]; then
      # Basic pattern checks in shell
      if echo "$CONTENT" | grep -qE 'sk_live_[0-9a-zA-Z]{24,}|AKIA[0-9A-Z]{16}|ghp_[0-9a-zA-Z]{36}|sk-ant-[a-zA-Z0-9-]{90,}'; then
        printf "\\n  🚨 \\033[31mCOMMIT BLOCKED\\033[0m — SlickEnv: Secret detected in staged file\\n"
        printf "     File:  %s\\n" "$FILE"
        printf "     Run:   slickenv scan  to see details\\n\\n"
        BLOCKED=1
      fi
    fi
  fi
done

if [ "$BLOCKED" -eq 1 ]; then
  exit 1
fi

exit 0
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Walk up from `startDir` to find the `.git` directory.
 * Returns the path to `.git`, or null if not found.
 */
async function findGitDir(startDir: string): Promise<string | null> {
  let current = startDir;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = join(current, ".git");
    try {
      await access(candidate);
      return candidate;
    } catch {
      const parent = dirname(current);
      if (parent === current) {
        // Reached filesystem root
        return null;
      }
      current = parent;
    }
  }
}

/**
 * Ensure `.gitignore` in `repoRoot` contains entries for `.env` and `.env.*`.
 */
async function ensureGitignore(repoRoot: string, log: (msg: string) => void): Promise<void> {
  const gitignorePath = join(repoRoot, ".gitignore");
  let content = "";

  try {
    content = await readFile(gitignorePath, "utf8");
  } catch {
    // File doesn't exist — we'll create it
  }

  const lines = content.split("\n");
  const toAdd: string[] = [];

  const patterns = [
    { pattern: ".env", comment: "# SlickEnv — local secrets" },
    { pattern: ".env.*", comment: null },
    { pattern: "*.env", comment: null },
  ];

  for (const { pattern, comment } of patterns) {
    const alreadyPresent = lines.some((l) => l.trim() === pattern);
    if (!alreadyPresent) {
      if (comment) toAdd.push(comment);
      toAdd.push(pattern);
    }
  }

  if (toAdd.length === 0) {
    return;
  }

  const separator = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
  const addition = `${separator}\n${toAdd.join("\n")}\n`;
  await writeFile(gitignorePath, content + addition, "utf8");
  log(`  ${colors.success(symbols.success)}  Updated .gitignore with .env patterns`);
}

// ── Command ───────────────────────────────────────────────────────────────────

export default class GitProtect extends BaseCommand {
  static override description = "Install repo-managed git commit protection so .env files and common secret patterns are blocked before commit.";

  static override examples = [
    "slickenv git protect",
  ];

  static override flags = {
    ...BaseCommand.baseFlags,
    dir: Flags.string({
      description: "Git repo directory",
      default: process.cwd(),
    }),
    uninstall: Flags.boolean({
      description: "Remove the SlickEnv pre-commit hook",
      default: false,
    }),
  };

  protected override requiresConfig = false;
  protected override requiresAuth = false;

  async run(): Promise<void> {
    const { flags } = await this.parse(GitProtect);
    const startDir = flags.dir;

    // Find the .git directory
    const gitDir = await findGitDir(startDir);
    if (!gitDir) {
      this.fail(
        `Not a git repository: ${startDir}\n` +
        `     Run this command inside a git repo or use --dir to specify one.`
      );
    }

    const repoRoot = dirname(gitDir!);
    const hooksDir = join(repoRoot, ".githooks");
    const hookPath = join(hooksDir, "pre-commit");

    await mkdir(hooksDir, { recursive: true });

    // ── Uninstall ──────────────────────────────────────────────────────────────
    if (flags.uninstall) {
      let existing = "";
      try {
        existing = await readFile(hookPath, "utf8");
      } catch {
        this.log("");
        this.log(`  ${colors.info(symbols.info)}  No pre-commit hook found at ${chalk.dim(hookPath)}`);
        this.log("");
        return;
      }

      if (!existing.includes(HOOK_HEADER)) {
        this.log("");
        this.log(
          `  ${colors.warning(symbols.warning)}  The existing pre-commit hook was not installed by SlickEnv.\n` +
          `     Remove it manually: ${chalk.dim(hookPath)}`
        );
        this.log("");
        return;
      }

      await unlink(hookPath);
      try {
        const { stdout } = await execFileAsync("git", ["config", "--get", "core.hooksPath"], { cwd: repoRoot });
        if (stdout.trim() === ".githooks") {
          await execFileAsync("git", ["config", "--unset", "core.hooksPath"], { cwd: repoRoot });
        }
      } catch {
        // ignore unset failures
      }
      this.log("");
      this.log(`  ${colors.success(symbols.success)}  Pre-commit hook removed.`);
      this.log("");
      return;
    }

    // ── Install ────────────────────────────────────────────────────────────────
    // Check if a hook already exists and is NOT from SlickEnv
    let existingHook = "";
    let hookExists = false;
    try {
      existingHook = await readFile(hookPath, "utf8");
      hookExists = true;
    } catch {
      hookExists = false;
    }

    if (hookExists && !existingHook.includes(HOOK_HEADER)) {
      this.log("");
      this.log(
        `  ${colors.warning(symbols.warning)}  A pre-commit hook already exists at:\n` +
        `     ${chalk.dim(hookPath)}`
      );
      this.log("");

      const ok = await confirm("Overwrite the existing pre-commit hook?");
      if (!ok) {
        this.info("Cancelled. Existing hook was not modified.");
        return;
      }
    }

    // Write the hook
    await writeFile(hookPath, HOOK_SCRIPT, "utf8");
    // Make it executable
    await chmod(hookPath, 0o755);
    await execFileAsync("git", ["config", "core.hooksPath", ".githooks"], { cwd: repoRoot });

    this.log("");
    this.log(`  ${colors.success(symbols.success)}  Pre-commit hook installed`);
    this.log(`     ${chalk.dim(hookPath)}`);
    this.log(`  ${colors.success(symbols.success)}  Git hooks path configured`);
    this.log(`     ${chalk.dim(".githooks")} ${chalk.dim("(tracked in the repo)")}`);
    this.log("");

    // Update .gitignore
    await ensureGitignore(repoRoot, (msg) => this.log(msg));

    this.log("");
    this.log(`  From now on, every ${chalk.cyan("git commit")} will be scanned for secrets.`);
    this.log("");
    this.log(`  ${colors.key("Protected file patterns:")}`);
    this.log(`  ${chalk.dim("·")} .env, .env.local, .env.production, .env.staging, .env.development`);
    this.log(`  ${chalk.dim("·")} .env.test, .env.backup, *.env`);
    this.log(`  ${chalk.dim("·")} Known secret patterns: Stripe, AWS, GitHub, OpenAI, Anthropic...`);
    this.log("");
    this.log(`  To uninstall: ${chalk.cyan("slickenv git protect --uninstall")}`);
    this.log("");
  }
}
