import { exec } from "node:child_process";
import { promisify } from "node:util";
import { Flags } from "@oclif/core";
import chalk from "chalk";
import { BaseCommand } from "../../base-command.js";
import { scanText } from "../../lib/scanner.js";
import type { Finding, Severity } from "../../lib/scanner.js";
import { colors, symbols, divider } from "../../lib/output.js";

const execAsync = promisify(exec);

// ── Types ────────────────────────────────────────────────────────────────────

interface CommitMeta {
  hash: string;
  date: string;
  refs: string;
}

interface GitFinding extends Finding {
  commitHash: string;
  commitDate: string;
  commitRefs: string;
  isInHead: boolean;
}

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

function severityColor(severity: Severity): (s: string) => string {
  switch (severity) {
    case "CRITICAL": return (s: string) => chalk.hex("#FF4D4D").bold(s);
    case "HIGH":     return (s: string) => chalk.hex("#F5A623").bold(s);
    case "WARNING":  return (s: string) => chalk.yellow(s);
    case "INFO":     return (s: string) => chalk.cyan(s);
  }
}

function severityDot(severity: Severity): string {
  switch (severity) {
    case "CRITICAL": return chalk.hex("#FF4D4D")("🔴");
    case "HIGH":     return chalk.hex("#F5A623")("🟠");
    case "WARNING":  return chalk.yellow("🟡");
    case "INFO":     return chalk.cyan("🔵");
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

export default class GitScan extends BaseCommand {
  static override description = "Search your entire git commit history for exposed secrets across 53 patterns.";

  static override examples = [
    "slickenv git scan",
  ];

  static override flags = {
    ...BaseCommand.baseFlags,
    dir: Flags.string({
      description: "Git repo directory",
      default: process.cwd(),
    }),
    branch: Flags.string({
      description: "Scan only this branch (default: all branches)",
    }),
    ci: Flags.boolean({
      description: "Output as JSON for CI environments",
      default: false,
    }),
    limit: Flags.integer({
      description: "Maximum number of findings to show",
      default: 50,
    }),
  };

  protected override requiresConfig = false;
  protected override requiresAuth = false;

  async run(): Promise<void> {
    const { flags } = await this.parse(GitScan);
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

    const isCi = flags.ci;
    if (!isCi) {
      this.log("");
      this.log(`  ${chalk.dim("Scanning git history... (may take a moment for large repos)")}`);
    }

    // ── Step 1: Get all commits + their files ────────────────────────────────
    const logArgs = flags.branch
      ? `log ${flags.branch} --name-only --format='%H|%ai|%D'`
      : `log --all --name-only --format='%H|%ai|%D'`;

    let logOutput: string;
    try {
      logOutput = await execGit(logArgs, repoDir);
    } catch (err: any) {
      this.fail(`Failed to read git log: ${err.message}`);
    }

    // Parse commit log into { meta, files[] } blocks
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

      // Lines with | separators are commit headers
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

    const commitsScanned = commitBlocks.length;

    // ── Step 2: Scan .env files in each commit ────────────────────────────────
    const allFindings: GitFinding[] = [];
    const dedupeSet = new Set<string>();

    // Current HEAD files for "still present" check
    let headFiles: Set<string> = new Set();
    try {
      const headTree = await execGit("ls-tree -r --name-only HEAD", repoDir);
      headFiles = new Set(headTree.split("\n").map((f) => f.trim()).filter(Boolean));
    } catch {
      // No HEAD yet (empty repo), ignore
    }

    for (const block of commitBlocks) {
      const envFiles = block.files.filter(isEnvFile);
      if (envFiles.length === 0) continue;

      for (const file of envFiles) {
        let content: string;
        try {
          content = await execGit(`show ${block.meta.hash}:${file}`, repoDir);
        } catch {
          // File may have been deleted or renamed — skip
          continue;
        }

        const findings = scanText(content, file);
        for (const finding of findings) {
          const key = `${finding.type}:${finding.maskedValue}:${block.meta.hash}`;
          if (dedupeSet.has(key)) continue;
          dedupeSet.add(key);

          // Check if still in HEAD
          let isInHead = false;
          if (headFiles.has(file)) {
            try {
              const headContent = await execGit(`show HEAD:${file}`, repoDir);
              const headFindings = scanText(headContent, file);
              isInHead = headFindings.some(
                (hf) => hf.type === finding.type && hf.maskedValue === finding.maskedValue
              );
            } catch {
              isInHead = false;
            }
          }

          allFindings.push({
            ...finding,
            commitHash: block.meta.hash,
            commitDate: block.meta.date,
            commitRefs: block.meta.refs,
            isInHead,
          });
        }
      }
    }

    // ── Step 3: Scan patch diffs for added lines ──────────────────────────────
    const patchArgs = flags.branch
      ? `log ${flags.branch} -p --unified=0 --format='COMMIT:%H|%ai|%D'`
      : `log --all -p --unified=0 --format='COMMIT:%H|%ai|%D'`;

    try {
      const patchOutput = await execGit(patchArgs, repoDir);
      let patchMeta: CommitMeta | null = null;
      let patchFile = "";
      const addedLines: string[] = [];

      const flushPatch = () => {
        if (!patchMeta || !patchFile || addedLines.length === 0) return;
        const joined = addedLines.join("\n");
        const findings = scanText(joined, patchFile);
        for (const finding of findings) {
          const key = `${finding.type}:${finding.maskedValue}:${patchMeta!.hash}`;
          if (dedupeSet.has(key)) return;
          dedupeSet.add(key);

          const isInHead = headFiles.has(patchFile);
          allFindings.push({
            ...finding,
            commitHash: patchMeta!.hash,
            commitDate: patchMeta!.date,
            commitRefs: patchMeta!.refs,
            isInHead,
          });
        }
      };

      for (const rawLine of patchOutput.split("\n")) {
        const line = rawLine;

        if (line.startsWith("COMMIT:")) {
          flushPatch();
          const rest = line.slice(7);
          const parts = rest.split("|");
          patchMeta = {
            hash: parts[0]!.trim(),
            date: parts[1]!.trim(),
            refs: parts.slice(2).join("|").trim(),
          };
          patchFile = "";
          addedLines.length = 0;
          continue;
        }

        if (line.startsWith("diff --git")) {
          flushPatch();
          addedLines.length = 0;
          // Extract b/ filename
          const match = line.match(/b\/(.+)$/);
          patchFile = match ? match[1]! : "";
          continue;
        }

        if (line.startsWith("+") && !line.startsWith("+++") && isEnvFile(patchFile)) {
          addedLines.push(line.slice(1));
        }
      }
      flushPatch();
    } catch {
      // Patch scan is best-effort — ignore errors
    }

    // ── Step 4: Sort and limit ────────────────────────────────────────────────
    const severityOrder: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, WARNING: 2, INFO: 3 };
    allFindings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    const limited = allFindings.slice(0, flags.limit);

    // ── Output ────────────────────────────────────────────────────────────────

    if (isCi) {
      const summary = {
        critical: allFindings.filter((f) => f.severity === "CRITICAL").length,
        high: allFindings.filter((f) => f.severity === "HIGH").length,
        warning: allFindings.filter((f) => f.severity === "WARNING").length,
        info: allFindings.filter((f) => f.severity === "INFO").length,
      };
      this.log(
        JSON.stringify(
          {
            findings: allFindings.map((f) => ({
              type: f.type,
              severity: f.severity,
              file: f.file,
              line: f.line,
              maskedValue: f.maskedValue,
              fixSuggestion: f.fixSuggestion,
              commitHash: f.commitHash,
              commitDate: f.commitDate,
              commitRefs: f.commitRefs,
              isInHead: f.isInHead,
            })),
            commitsScanned,
            summary,
          },
          null,
          2
        )
      );
      return;
    }

    // Human-readable output
    this.log(`  ${divider(38)}`);
    this.log("");

    if (allFindings.length === 0) {
      this.log(
        `  ${colors.success(symbols.success)}  Git history is clean — no secrets found in ${commitsScanned.toLocaleString()} commits`
      );
      this.log("");
      return;
    }

    for (const finding of limited) {
      const shortHash = finding.commitHash.slice(0, 7);
      const when = relativeTime(finding.commitDate);
      const refLabel = finding.commitRefs
        ? ` · ${chalk.dim(finding.commitRefs.split(",")[0]?.trim())}`
        : "";
      const headWarning = finding.isInHead
        ? chalk.hex("#FF4D4D")(" ⚠ still in HEAD")
        : "";

      // Determine branch info
      const refs = finding.commitRefs;
      const isMergedToMain = /\b(main|master)\b/.test(refs);
      const branchDisplay = refs
        ? refs.split(",")[0]?.trim() ?? refs
        : "unknown";

      this.log(
        `  ${severityDot(finding.severity)} ${severityColor(finding.severity)(finding.severity)}` +
        `  commit ${chalk.cyan(shortHash)}${refLabel} ${chalk.dim(`(${when})`)}${headWarning}`
      );
      this.log(`     ${chalk.dim("File:")}    ${colors.key(finding.file)}`);
      this.log(
        `     ${chalk.dim("Branch:")}  ${branchDisplay}` +
        (isMergedToMain ? chalk.hex("#F5A623")(" ⚠️  (merged to main)") : "")
      );
      this.log(`     ${chalk.dim("Type:")}    ${finding.type}`);
      this.log(`     ${chalk.dim("Value:")}   ${colors.error(finding.maskedValue)}`);
      this.log("");
    }

    this.log(`  ${divider(42)}`);
    if (allFindings.length > flags.limit) {
      this.log(
        `  ${colors.warning(symbols.warning)}  Showing ${flags.limit} of ${allFindings.length} findings. Use --limit to see more.`
      );
    }
    this.log(
      `  Found ${colors.error(String(allFindings.length))} secret${allFindings.length === 1 ? "" : "s"} in ${chalk.dim(commitsScanned.toLocaleString())} commits`
    );
    this.log(`  Run: ${chalk.cyan("slickenv git clean")}  to remove from history`);
    this.log("");
  }
}
