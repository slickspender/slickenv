import { exec } from "node:child_process";
import { promisify } from "node:util";
import { Flags } from "@oclif/core";
import chalk from "chalk";
import { BaseCommand } from "../../base-command.js";
import { scanText } from "../../lib/scanner.js";
import type { Severity } from "../../lib/scanner.js";
import { colors, symbols, divider } from "../../lib/output.js";

const execAsync = promisify(exec);

// ── Helpers ───────────────────────────────────────────────────────────────────

function isEnvFile(filename: string): boolean {
  const base = filename.split("/").pop() ?? filename;
  return (
    base === ".env" ||
    base.startsWith(".env.") ||
    base.endsWith(".env")
  );
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);

  if (diff < 60) return `${diff} seconds ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)} days ago`;
  if (diff < 31536000) return `${Math.floor(diff / 2592000)} months ago`;
  return `${Math.floor(diff / 31536000)} years ago`;
}

function severityLabel(severity: Severity): string {
  switch (severity) {
    case "CRITICAL": return chalk.hex("#FF4D4D").bold("CRITICAL");
    case "HIGH":     return chalk.hex("#F5A623").bold("HIGH    ");
    case "WARNING":  return chalk.yellow.bold("WARNING ");
    case "INFO":     return chalk.cyan.bold("INFO    ");
  }
}

async function execGit(args: string, cwd: string): Promise<string> {
  const { stdout } = await execAsync(`git ${args}`, {
    cwd,
    maxBuffer: 100 * 1024 * 1024,
    timeout: 5 * 60 * 1000,
  });
  return stdout;
}

// ── Command ───────────────────────────────────────────────────────────────────

export default class GitAudit extends BaseCommand {
  static override description = "Show a visual timeline of all commits that contain leaked secrets.";

  static override examples = [
    "slickenv git audit",
  ];

  static override flags = {
    ...BaseCommand.baseFlags,
    dir: Flags.string({
      description: "Git repo directory",
      default: process.cwd(),
    }),
  };

  protected override requiresConfig = false;
  protected override requiresAuth = false;

  async run(): Promise<void> {
    const { flags } = await this.parse(GitAudit);
    const repoDir = flags.dir;

    // Verify this is a git repo
    try {
      await execGit("rev-parse --git-dir", repoDir);
    } catch {
      this.fail(
        `Not a git repository: ${repoDir}\n` +
        `     Run this command inside a git repo or use --dir to specify one.`
      );
    }

    // Get all commits with metadata
    let logOutput: string;
    try {
      logOutput = await execGit(
        "log --all --name-only --format='%H|%ai|%an|%D|%s'",
        repoDir
      );
    } catch (err: any) {
      this.fail(`Failed to read git log: ${err.message}`);
    }

    // Parse commit log
    interface CommitRecord {
      hash: string;
      date: string;
      author: string;
      refs: string;
      subject: string;
      files: string[];
    }

    const commits: CommitRecord[] = [];
    let current: CommitRecord | null = null;

    for (const rawLine of logOutput!.split("\n")) {
      const line = rawLine.trim();

      if (!line) {
        if (current && current.files.length > 0) {
          commits.push(current);
        }
        current = null;
        continue;
      }

      // Commit header lines have the form hash|date|author|refs|subject
      if (line.includes("|")) {
        const parts = line.split("|");
        if (parts.length >= 4 && parts[0]!.length === 40) {
          if (current && current.files.length > 0) {
            commits.push(current);
          }
          current = {
            hash: parts[0]!.trim(),
            date: parts[1]!.trim(),
            author: parts[2]!.trim(),
            refs: parts[3]!.trim(),
            subject: parts.slice(4).join("|").trim(),
            files: [],
          };
          continue;
        }
      }

      if (current && line.length > 0 && !line.startsWith("'")) {
        current.files.push(line);
      }
    }
    if (current && current.files.length > 0) {
      commits.push(current);
    }

    // Filter to env-related commits and scan them
    interface AuditEntry {
      hash: string;
      date: string;
      author: string;
      refs: string;
      subject: string;
      file: string;
      findingType: string;
      maskedValue: string;
      severity: Severity;
    }

    const entries: AuditEntry[] = [];
    const branchSet = new Set<string>();

    for (const commit of commits) {
      const envFiles = commit.files.filter(isEnvFile);
      if (envFiles.length === 0) continue;

      for (const file of envFiles) {
        let content: string;
        try {
          content = await execGit(`show ${commit.hash}:${file}`, repoDir);
        } catch {
          continue;
        }

        const findings = scanText(content, file);
        for (const finding of findings) {
          entries.push({
            hash: commit.hash,
            date: commit.date,
            author: commit.author,
            refs: commit.refs,
            subject: commit.subject,
            file: file,
            findingType: finding.type,
            maskedValue: finding.maskedValue,
            severity: finding.severity,
          });

          // Collect unique branches
          if (commit.refs) {
            for (const ref of commit.refs.split(",")) {
              const trimmed = ref.trim().replace(/^HEAD -> /, "");
              if (trimmed && !trimmed.startsWith("tag:")) {
                branchSet.add(trimmed);
              }
            }
          }
        }
      }
    }

    // ── Output ────────────────────────────────────────────────────────────────
    this.log("");
    this.log(`  ${colors.key("Git Secret Audit Timeline")}`);
    this.log(`  ${divider(25)}`);
    this.log("");

    if (entries.length === 0) {
      this.log(
        `  ${colors.success(symbols.success)}  No secret-related commits found in history.`
      );
      this.log("");
      return;
    }

    for (const entry of entries) {
      const shortHash = entry.hash.slice(0, 7);
      const when = relativeTime(entry.date);
      const isMergedToMain = /\b(main|master)\b/.test(entry.refs);
      const branchDisplay = entry.refs
        ? (entry.refs.split(",")[0]?.trim() ?? entry.refs)
        : "unknown";

      this.log(
        `  ${severityLabel(entry.severity)}  ${chalk.cyan(shortHash)} ${chalk.dim("·")} ${chalk.dim(when)} ${chalk.dim("·")} ${chalk.white(entry.author)}`
      );
      this.log(`            ${chalk.dim("File:")}    ${colors.key(entry.file)}`);
      this.log(`            ${chalk.dim("Type:")}    ${entry.findingType} ${chalk.dim(`(${entry.maskedValue})`)}`);
      this.log(
        `            ${chalk.dim("Branch:")}  ${branchDisplay}` +
        (isMergedToMain ? chalk.hex("#F5A623")(" (merged) ⚠️") : "")
      );
      if (entry.subject) {
        this.log(`            ${chalk.dim("Subject:")} ${chalk.italic(entry.subject)}`);
      }
      this.log("");
    }

    this.log(`  ${divider(25)}`);
    this.log(
      `  ${entries.length} commit${entries.length === 1 ? "" : "s"} with secrets across ${branchSet.size} branch${branchSet.size === 1 ? "" : "es"}`
    );
    this.log("");
  }
}
