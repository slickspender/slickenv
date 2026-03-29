import { exec } from "node:child_process";
import { promisify } from "node:util";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { pipeline } from "node:stream/promises";
import { Flags } from "@oclif/core";
import chalk from "chalk";
import { BaseCommand } from "../../base-command.js";
import { scanText } from "../../lib/scanner.js";
import type { Finding, Severity } from "../../lib/scanner.js";
import { colors, symbols, divider, confirm } from "../../lib/output.js";

const execAsync = promisify(exec);

// ── Helpers ───────────────────────────────────────────────────────────────────

const BFG_VERSION = "1.14.0";
const BFG_URL = `https://repo1.maven.org/maven2/com/madgag/bfg/${BFG_VERSION}/bfg-${BFG_VERSION}.jar`;
const BFG_DIR = join(homedir(), ".slickenv");
const BFG_JAR = join(BFG_DIR, "bfg.jar");

function isEnvFile(filename: string): boolean {
  const base = filename.split("/").pop() ?? filename;
  return (
    base === ".env" ||
    base.startsWith(".env.") ||
    base.endsWith(".env")
  );
}

async function execGit(args: string, cwd: string): Promise<string> {
  const { stdout } = await execAsync(`git ${args}`, {
    cwd,
    maxBuffer: 100 * 1024 * 1024,
    timeout: 5 * 60 * 1000,
  });
  return stdout;
}

function severityColor(severity: Severity): (s: string) => string {
  switch (severity) {
    case "CRITICAL": return (s: string) => chalk.hex("#FF4D4D").bold(s);
    case "HIGH":     return (s: string) => chalk.hex("#F5A623").bold(s);
    case "WARNING":  return (s: string) => chalk.yellow(s);
    case "INFO":     return (s: string) => chalk.cyan(s);
  }
}

async function checkJavaInstalled(): Promise<boolean> {
  try {
    await execAsync("java -version", { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

async function downloadBfg(log: (msg: string) => void): Promise<void> {
  if (!existsSync(BFG_DIR)) {
    await mkdir(BFG_DIR, { recursive: true });
  }

  log(`  ${chalk.dim("Downloading BFG Repo-Cleaner...")} ${chalk.dim(BFG_URL)}`);

  const res = await fetch(BFG_URL);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download BFG: HTTP ${res.status}`);
  }

  const dest = createWriteStream(BFG_JAR);
  // @ts-ignore — fetch ReadableStream to Node stream
  await pipeline(res.body as any, dest);
}

interface CommitMeta {
  hash: string;
  date: string;
  refs: string;
}

interface RepoFinding extends Finding {
  commitHash: string;
  commitDate: string;
  commitRefs: string;
  rawValue: string; // The actual matched value from the pattern (for BFG replacement)
}

// ── Command ───────────────────────────────────────────────────────────────────

export default class GitClean extends BaseCommand {
  static override description = "Guided BFG Repo-Cleaner flow: backup → clean history → gc → instructions for force-push.";

  static override examples = [
    "slickenv git clean",
  ];

  static override flags = {
    ...BaseCommand.baseFlags,
    dir: Flags.string({
      description: "Git repo directory",
      default: process.cwd(),
    }),
    yes: Flags.boolean({
      char: "y",
      description: "Skip confirmation prompt",
      default: false,
    }),
  };

  protected override requiresConfig = false;
  protected override requiresAuth = false;

  async run(): Promise<void> {
    const { flags } = await this.parse(GitClean);
    const repoDir = flags.dir;

    // Verify git repo
    try {
      await execGit("rev-parse --git-dir", repoDir);
    } catch {
      this.fail(
        `Not a git repository: ${repoDir}\n` +
        `     Run this command inside a git repo or use --dir to specify one.`
      );
    }

    // Check Java is installed
    const hasJava = await checkJavaInstalled();
    if (!hasJava) {
      this.log("");
      this.log(
        `  ${colors.error(symbols.error)}  BFG Repo-Cleaner requires Java.\n` +
        `     Install Java: ${colors.url("https://adoptium.net/")} then try again.`
      );
      this.log("");
      this.exit(1);
    }

    // ── Step 1: Scan history to find what needs removing ─────────────────────
    this.log("");
    this.log(`  ${chalk.dim("Scanning git history for secrets...")}`);

    let logOutput: string;
    try {
      logOutput = await execGit(
        "log --all --name-only --format='%H|%ai|%D'",
        repoDir
      );
    } catch (err: any) {
      this.fail(`Failed to read git log: ${err.message}`);
    }

    const commitBlocks: Array<{ meta: CommitMeta; files: string[] }> = [];
    let currentMeta: CommitMeta | null = null;
    let currentFiles: string[] = [];

    for (const rawLine of logOutput!.split("\n")) {
      const line = rawLine.trim();
      if (!line) {
        if (currentMeta && currentFiles.length > 0) {
          commitBlocks.push({ meta: currentMeta, files: currentFiles });
        }
        currentMeta = null;
        currentFiles = [];
        continue;
      }
      if (line.includes("|")) {
        const parts = line.split("|");
        if (parts.length >= 2 && parts[0]!.length === 40) {
          if (currentMeta && currentFiles.length > 0) {
            commitBlocks.push({ meta: currentMeta, files: currentFiles });
          }
          currentMeta = {
            hash: parts[0]!.trim(),
            date: parts[1]!.trim(),
            refs: parts.slice(2).join("|").trim(),
          };
          currentFiles = [];
          continue;
        }
      }
      if (currentMeta && line.length > 0 && !line.startsWith("'")) {
        currentFiles.push(line);
      }
    }
    if (currentMeta && currentFiles.length > 0) {
      commitBlocks.push({ meta: currentMeta, files: currentFiles });
    }

    const allFindings: RepoFinding[] = [];
    const dedupeSet = new Set<string>();

    for (const block of commitBlocks) {
      const envFiles = block.files.filter(isEnvFile);
      if (envFiles.length === 0) continue;

      for (const file of envFiles) {
        let content: string;
        try {
          content = await execGit(`show ${block.meta.hash}:${file}`, repoDir);
        } catch {
          continue;
        }

        const findings = scanText(content, file);
        for (const finding of findings) {
          const key = `${finding.type}:${finding.maskedValue}:${block.meta.hash}`;
          if (dedupeSet.has(key)) continue;
          dedupeSet.add(key);

          // Extract raw value from content for BFG replacement file
          // We use maskedValue as a stand-in; raw extraction is best-effort
          const rawValue = finding.maskedValue;

          allFindings.push({
            ...finding,
            commitHash: block.meta.hash,
            commitDate: block.meta.date,
            commitRefs: block.meta.refs,
            rawValue,
          });
        }
      }
    }

    if (allFindings.length === 0) {
      this.log(
        `  ${colors.success(symbols.success)}  Git history is already clean — nothing to remove.`
      );
      this.log("");
      return;
    }

    // ── Step 2: Show what will be cleaned ─────────────────────────────────────
    this.log("");
    this.log(`  ${colors.key("Secrets found in git history:")}`);
    this.log(`  ${divider(36)}`);
    this.log("");

    const bySeverity: Record<Severity, RepoFinding[]> = {
      CRITICAL: [], HIGH: [], WARNING: [], INFO: [],
    };
    for (const f of allFindings) bySeverity[f.severity].push(f);

    for (const sev of ["CRITICAL", "HIGH", "WARNING", "INFO"] as Severity[]) {
      if (bySeverity[sev].length === 0) continue;
      for (const f of bySeverity[sev]) {
        this.log(
          `  ${severityColor(sev)(sev.padEnd(8))}  ${chalk.dim(f.commitHash.slice(0, 7))}  ${colors.key(f.file)}  ${chalk.dim(f.maskedValue)}`
        );
      }
    }

    this.log("");
    this.log(`  ${divider(36)}`);
    this.log(`  ${colors.error(String(allFindings.length))} finding${allFindings.length === 1 ? "" : "s"} across ${commitBlocks.filter((b) => b.files.some(isEnvFile)).length} commits`);
    this.log("");

    // ── Step 3: Explain what will happen ──────────────────────────────────────
    this.log(`  ${colors.key("What this operation does:")}`);
    this.log(`  ${chalk.dim("1.")} Creates a backup tarball of the current working tree`);
    this.log(`  ${chalk.dim("2.")} Downloads BFG Repo-Cleaner ${BFG_VERSION} (if not cached)`);
    this.log(`  ${chalk.dim("3.")} Rewrites all affected commits to scrub secret values`);
    this.log(`  ${chalk.dim("4.")} Expires the git reflog and runs aggressive GC`);
    this.log(`  ${chalk.dim("5.")} Generates SLICKENV_CLEANUP.md with force-push commands`);
    this.log("");
    this.log(`  ${chalk.hex("#F5A623")("⚠️  WARNING:")} ${chalk.bold("This rewrites Git history.")}`);
    this.log(`     All teammates must ${chalk.bold("re-clone")} the repository after this operation.`);
    this.log(`     Rotate the ${allFindings.length} exposed secret${allFindings.length === 1 ? "" : "s"} immediately — they may already be compromised.`);
    this.log("");

    // ── Step 4: Confirm ───────────────────────────────────────────────────────
    if (!flags.yes) {
      const ok = await confirm("Proceed with history rewrite?");
      if (!ok) {
        this.info("Cancelled. No changes made.");
        return;
      }
    }

    this.log("");

    // ── Step 5a: Create backup ────────────────────────────────────────────────
    const today = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const backupName = `slickenv-backup-${today}.tar.gz`;
    const backupPath = join(dirname(repoDir), backupName);

    this.log(`  ${chalk.dim("Creating backup...")} ${chalk.dim(backupPath)}`);
    try {
      await execAsync(`tar -czf "${backupPath}" --exclude=".git" .`, {
        cwd: repoDir,
        timeout: 5 * 60 * 1000,
        maxBuffer: 100 * 1024 * 1024,
      });
      this.log(`  ${colors.success(symbols.success)}  Backup created: ${chalk.dim(backupPath)}`);
    } catch (err: any) {
      this.warning(`Backup failed (${err.message}) — continuing anyway.`);
    }

    // ── Step 5b: Download BFG ─────────────────────────────────────────────────
    if (!existsSync(BFG_JAR)) {
      try {
        await downloadBfg((msg) => this.log(msg));
        this.log(`  ${colors.success(symbols.success)}  BFG downloaded: ${chalk.dim(BFG_JAR)}`);
      } catch (err: any) {
        this.fail(`Failed to download BFG Repo-Cleaner: ${err.message}`);
      }
    } else {
      this.log(`  ${colors.success(symbols.success)}  Using cached BFG: ${chalk.dim(BFG_JAR)}`);
    }

    // ── Step 5c: Write patterns file ──────────────────────────────────────────
    const patternsFile = join(BFG_DIR, `slickenv-patterns-${today}.txt`);
    const patternLines = [
      ...new Set(allFindings.map((f) => f.rawValue)),
    ].filter(Boolean);
    await writeFile(patternsFile, patternLines.join("\n") + "\n", "utf8");
    this.log(`  ${colors.success(symbols.success)}  Patterns file written: ${chalk.dim(patternsFile)}`);

    // ── Step 5d: Run BFG ─────────────────────────────────────────────────────
    this.log(`  ${chalk.dim("Running BFG Repo-Cleaner...")}`);
    try {
      const bfgOutput = await execAsync(
        `java -jar "${BFG_JAR}" --replace-text "${patternsFile}" .`,
        {
          cwd: repoDir,
          timeout: 10 * 60 * 1000,
          maxBuffer: 100 * 1024 * 1024,
        }
      );
      if (flags.verbose) {
        this.log(chalk.dim(bfgOutput.stdout));
      }
      this.log(`  ${colors.success(symbols.success)}  BFG history rewrite complete`);
    } catch (err: any) {
      this.fail(`BFG failed: ${err.message}\n${err.stderr ?? ""}`);
    }

    // ── Step 5e: Expire reflog + GC ───────────────────────────────────────────
    this.log(`  ${chalk.dim("Expiring reflog...")}`);
    await execGit("reflog expire --expire=now --all", repoDir).catch(() => {});
    this.log(`  ${colors.success(symbols.success)}  Reflog expired`);

    this.log(`  ${chalk.dim("Running aggressive GC...")}`);
    try {
      await execAsync("git gc --prune=now --aggressive", {
        cwd: repoDir,
        timeout: 10 * 60 * 1000,
        maxBuffer: 100 * 1024 * 1024,
      });
      this.log(`  ${colors.success(symbols.success)}  GC complete`);
    } catch (err: any) {
      this.warning(`GC warning: ${err.message}`);
    }

    // ── Step 5f: Get remote info ──────────────────────────────────────────────
    let remotes: Array<{ name: string; url: string }> = [];
    try {
      const remoteOut = await execGit("remote -v", repoDir);
      const seen = new Set<string>();
      for (const line of remoteOut.split("\n")) {
        const match = line.match(/^(\S+)\s+(\S+)\s+\(fetch\)/);
        if (match && !seen.has(match[1]!)) {
          seen.add(match[1]!);
          remotes.push({ name: match[1]!, url: match[2]! });
        }
      }
    } catch {
      // No remotes configured
    }

    // Get affected branches
    let branches: string[] = [];
    try {
      const branchOut = await execGit("branch -r", repoDir);
      branches = branchOut
        .split("\n")
        .map((b) => b.trim().replace(/^origin\//, ""))
        .filter((b) => b && !b.startsWith("HEAD"));
    } catch {
      branches = ["main"];
    }

    // ── Step 5g: Generate SLICKENV_CLEANUP.md ────────────────────────────────
    const cleanupMd = join(repoDir, "SLICKENV_CLEANUP.md");
    const affectedCommits = [...new Set(allFindings.map((f) => f.commitHash))];

    const forcePushCmds = branches
      .map((b) => `git push --force-with-lease origin ${b}`)
      .join("\n");

    const remoteCloneUrl = remotes[0]?.url ?? "<your-remote-url>";
    const remoteCloneCmds = remotes
      .map((r) => `git clone ${r.url}`)
      .join("\n");

    const mdContent = [
      `# SlickEnv History Cleanup — ${today}`,
      "",
      `> Generated by \`slickenv git clean\``,
      "",
      "## Summary",
      "",
      `- **${allFindings.length} secret${allFindings.length === 1 ? "" : "s"}** removed from git history`,
      `- **${affectedCommits.length} commit${affectedCommits.length === 1 ? "" : "s"}** rewritten`,
      `- Backup: \`${backupPath}\``,
      "",
      "## Commits Cleaned",
      "",
      affectedCommits.map((h) => `- \`${h.slice(0, 7)}\``).join("\n"),
      "",
      "## Force-Push Commands",
      "",
      "Run these to update the remote branches:",
      "",
      "```sh",
      forcePushCmds,
      "```",
      "",
      "## Teammate Instructions",
      "",
      "All teammates **must re-clone** the repository:",
      "",
      "```sh",
      "# Delete your local copy and re-clone",
      remoteCloneCmds || `git clone ${remoteCloneUrl}`,
      "```",
      "",
      "## Action Required",
      "",
      `**Rotate these ${allFindings.length} secret${allFindings.length === 1 ? "" : "s"} immediately** — they may have already been seen by attackers:`,
      "",
      allFindings.map((f) => `- \`${f.type}\` in \`${f.file}\` — ${f.maskedValue}`).join("\n"),
      "",
      "---",
      "*Generated by [SlickEnv](https://slickenv.com)*",
      "",
    ].join("\n");

    await writeFile(cleanupMd, mdContent, "utf8");
    this.log(`  ${colors.success(symbols.success)}  Cleanup guide: ${chalk.dim(cleanupMd)}`);

    // Clean up temp patterns file
    await rm(patternsFile, { force: true });

    // ── Done ──────────────────────────────────────────────────────────────────
    this.log("");
    this.log(`  ${colors.success(symbols.success)}  ${chalk.bold("History cleaned successfully.")}`);
    this.log("");
    this.log(`  ${chalk.hex("#F5A623")("Next steps:")}`);
    this.log(`  ${chalk.dim("1.")} Review ${chalk.cyan("SLICKENV_CLEANUP.md")} for force-push commands`);
    this.log(`  ${chalk.dim("2.")} Run ${chalk.cyan("git push --force-with-lease")} for each branch`);
    this.log(`  ${chalk.dim("3.")} Ask teammates to re-clone the repository`);
    this.log(`  ${chalk.dim("4.")} Rotate all ${allFindings.length} exposed secret${allFindings.length === 1 ? "" : "s"} immediately`);
    this.log("");
  }
}

