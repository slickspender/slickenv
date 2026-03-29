import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, basename, extname } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { Flags } from "@oclif/core";
import chalk from "chalk";
import { BaseCommand } from "../base-command.js";
import { colors, symbols, divider, isTTY } from "../lib/output.js";
import type { Finding, Severity } from "../lib/scanner.js";
import { scanText, calculateScore } from "../lib/scanner.js";
import { getStoredToken } from "../lib/keychain.js";
import { loadConfig } from "../lib/config.js";
import { createApiClient } from "../lib/api.js";

// ── Constants ────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".turbo",
  "__pycache__",
]);

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svgz",
  ".ico",
  ".pdf",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".mp4",
  ".mov",
  ".mp3",
  ".wav",
  ".zip",
  ".gz",
  ".tar",
  ".jar",
  ".exe",
  ".bin",
]);

const SKIP_FILES = new Set([
  "bun.lock",
  "yarn.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
]);

const MAX_FILE_SIZE = 1024 * 1024; // 1 MB

const SEVERITY_ORDER: Record<Severity, number> = {
  CRITICAL: 4,
  HIGH: 3,
  WARNING: 2,
  INFO: 1,
};

const SEVERITY_EMOJI: Record<Severity, string> = {
  CRITICAL: "🔴",
  HIGH: "🟠",
  WARNING: "🟡",
  INFO: "🔵",
};

const DETAIL_LIMITS: Record<Severity, number> = {
  CRITICAL: 20,
  HIGH: 12,
  WARNING: 8,
  INFO: 0,
};

const AUTO_REPORT_THRESHOLD = 25;

// ── AI-generated secret patterns ─────────────────────────────────────

const AI_PATTERNS: Array<{ name: string; pattern: RegExp; severity: Severity; fixSuggestion: string }> = [
  {
    name: "Hardcoded secret in variable declaration",
    pattern: /const\s+\w+\s*=\s*['"`](sk_live_|AKIA|ghp_|sk-)[^'"`]+['"`]/g,
    severity: "CRITICAL",
    fixSuggestion: "Move to .env → slickenv add KEY=<value>",
  },
  {
    name: "NEXT_PUBLIC_ variable with secret-looking value",
    pattern: /NEXT_PUBLIC_\w+\s*=\s*['"`][^'"`]{16,}['"`]/g,
    severity: "HIGH",
    fixSuggestion: "NEXT_PUBLIC_ variables are exposed to the browser. Use server-side env vars instead.",
  },
  {
    name: "Fallback literal in process.env",
    pattern: /process\.env\.\w+\s*\|\|\s*['"`][^'"`]{10,}['"`]/g,
    severity: "HIGH",
    fixSuggestion: "Remove fallback literal — it defeats the purpose of env vars. Use slickenv pull to ensure the key is always set.",
  },
  {
    name: "Secret key in code comment",
    pattern: /\/\/.*?(sk_live_|AKIA|ghp_)/g,
    severity: "CRITICAL",
    fixSuggestion: "Remove secret from comment immediately. Rotate the key and move it to .env.",
  },
  {
    name: "console.log with potential secret",
    pattern: /console\.log\(.*?(key|secret|token|password)/gi,
    severity: "WARNING",
    fixSuggestion: "Remove console.log statements that may print sensitive values.",
  },
];

// ── File walker ──────────────────────────────────────────────────────

async function walkDir(dir: string, baseDir: string): Promise<string[]> {
  const results: string[] = [];

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    try {
      // Resolve symlinks gracefully
      const fileStat = await stat(fullPath);

      if (fileStat.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const nested = await walkDir(fullPath, baseDir);
        results.push(...nested);
      } else if (fileStat.isFile()) {
        if (fileStat.size > MAX_FILE_SIZE) continue;
        results.push(relative(baseDir, fullPath));
      }
    } catch {
      // Skip symlinks that error or inaccessible files
      continue;
    }
  }

  return results;
}

// ── Glob-like filter helpers ─────────────────────────────────────────

function matchesEnvVariants(name: string): boolean {
  if (
    name === ".env" ||
    name === ".env.local" ||
    name === ".env.production" ||
    name === ".env.staging" ||
    name === ".env.development" ||
    name === ".env.test" ||
    name === ".env.backup" ||
    name === ".env.old"
  ) return true;
  if (name.endsWith(".env")) return true;
  return false;
}

function matchesLogFiles(relPath: string): boolean {
  const name = basename(relPath);
  if (name.endsWith(".log")) return true;
  if (relPath.startsWith("logs/") || relPath.includes("/logs/")) return true;
  return false;
}

function matchesDockerFiles(name: string): boolean {
  if (
    name === "Dockerfile" ||
    name === "docker-compose.yml" ||
    name.endsWith(".dockerfile")
  ) return true;
  if (name.startsWith("docker-compose.") && name.endsWith(".yml")) return true;
  return false;
}

function matchesCiCdFiles(relPath: string, name: string): boolean {
  if (relPath.startsWith(".github/workflows/") && name.endsWith(".yml")) return true;
  if (relPath === ".circleci/config.yml") return true;
  if (name === ".gitlab-ci.yml") return true;
  if (name === "Jenkinsfile") return true;
  if (name === ".travis.yml") return true;
  return false;
}

function matchesConfigFiles(name: string): boolean {
  const configNames = [
    "package.json",
    "config.js",
    "config.ts",
    "settings.py",
    "database.yml",
    "application.yml",
    "config.yml",
  ];
  return configNames.includes(name);
}

function matchesBuildOutputs(relPath: string): boolean {
  if (relPath.startsWith("dist/") && relPath.endsWith(".js")) return true;
  if (relPath.startsWith("build/") && relPath.endsWith(".js")) return true;
  if (relPath.startsWith(".next/") && relPath.endsWith(".js")) return true;
  return false;
}

function matchesSourceFiles(relPath: string): boolean {
  // All source files not in skipped dirs — the walker already filters those,
  // but also skip build outputs here (they have their own category)
  if (matchesBuildOutputs(relPath)) return false;
  return true;
}

function isAiGeneratedTarget(name: string): boolean {
  const ext = extname(name);
  return [".ts", ".js", ".tsx", ".jsx", ".py"].includes(ext);
}

function isProbablyBinaryPath(relPath: string): boolean {
  return BINARY_EXTENSIONS.has(extname(relPath).toLowerCase());
}

function shouldSkipFile(relPath: string): boolean {
  return SKIP_FILES.has(basename(relPath));
}

function isLikelyFixturePath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return (
    lower.includes("__tests__") ||
    lower.includes("/test/") ||
    lower.includes("/tests/") ||
    lower.endsWith(".test.ts") ||
    lower.endsWith(".test.js") ||
    lower.endsWith(".spec.ts") ||
    lower.endsWith(".spec.js") ||
    lower.includes("/fixtures/") ||
    lower.includes("/examples/") ||
    lower.includes("/example/") ||
    lower.includes("/docs/") ||
    lower.includes("/blog/") ||
    lower.includes("/scripts/")
  );
}

// ── Severity filtering ───────────────────────────────────────────────

function severityAtOrAbove(finding: Finding, minSeverity: Severity): boolean {
  return SEVERITY_ORDER[finding.severity] >= SEVERITY_ORDER[minSeverity];
}

// ── Main command ─────────────────────────────────────────────────────

export default class Scan extends BaseCommand {
  private lastProgressLine = "";

  static override description = "Scan current files for leaked secrets. Use --git for history and --mcp for MCP config files.";

  static override examples = [
    "slickenv scan",
    "slickenv scan --files",
    "slickenv scan --git",
    "slickenv scan --mcp",
    "slickenv scan --ci",
    "slickenv scan --severity critical",
  ];

  static override flags = {
    ...BaseCommand.baseFlags,
    dir: Flags.string({
      description: "Scan a specific directory instead of cwd",
      helpValue: "<path>",
    }),
    files: Flags.boolean({
      description: "Scan files only (skip git history)",
      default: false,
    }),
    git: Flags.boolean({
      description: "Scan git history only (skip files)",
      default: false,
    }),
    mcp: Flags.boolean({
      description: "Scan MCP config files only",
      default: false,
    }),
    "ai-generated": Flags.boolean({
      description: "Look for AI-generated hardcoded secrets in .ts/.js/.py files",
      default: false,
    }),
    ci: Flags.boolean({
      description: "Output machine-readable JSON for CI/CD pipelines",
      default: false,
    }),
    fix: Flags.boolean({
      description: "Interactive fix mode — show findings and ask which to address",
      default: false,
    }),
    severity: Flags.string({
      description: "Only show findings at this level or above (CRITICAL, HIGH, WARNING, INFO)",
      default: "INFO",
      options: ["CRITICAL", "HIGH", "WARNING", "INFO"],
      helpValue: "<level>",
    }),
  };

  protected override requiresConfig = false;
  protected override requiresAuth = false;

  async run(): Promise<void> {
    const { flags } = await this.parse(Scan);

    const scanDir = flags.dir ? flags.dir : process.cwd();
    const minSeverity = (flags.severity ?? "INFO") as Severity;
    const isCi = flags.ci;

    const allFindings: Finding[] = [];
    let filesScanned = 0;

    if (!isCi) {
      process.stdout.write(`\n  Scanning project: ${chalk.bold(basename(scanDir))}\n`);
      process.stdout.write(`  ${chalk.dim("(Scanning...)")}\n`);
      this.log(divider());
    }

    // ── MCP-only mode ──────────────────────────────────────────────
    if (flags.mcp) {
      const mcpFiles = await this.collectMcpFiles(scanDir);

      for (let index = 0; index < mcpFiles.length; index++) {
        const filePath = mcpFiles[index]!;
        this.renderProgress("MCP", index + 1, mcpFiles.length, isCi);
        try {
          const content = await readFile(filePath, "utf8");
          const rel = filePath.startsWith(scanDir)
            ? relative(scanDir, filePath)
            : filePath;
          const findings = scanText(content, rel);
          allFindings.push(...findings);
          filesScanned++;
        } catch {
          // skip unreadable
        }
      }

      this.finishProgress(isCi);
      this.outputResults(allFindings, filesScanned, minSeverity, isCi, flags.fix);
      if (flags.fix) await this.runInteractiveFix(allFindings, minSeverity, scanDir);
      return;
    }

    // ── Git-only mode ──────────────────────────────────────────────
    if (flags.git) {
      const gitFindings = await this.scanGitHistory(scanDir, isCi);
      allFindings.push(...gitFindings.findings);
      filesScanned += gitFindings.filesScanned;
      this.outputResults(allFindings, filesScanned, minSeverity, isCi, flags.fix);
      if (flags.fix) await this.runInteractiveFix(allFindings, minSeverity, scanDir);
      return;
    }

    // ── File scan (default or --files) ─────────────────────────────
    const allRelPaths = await walkDir(scanDir, scanDir);

    for (let index = 0; index < allRelPaths.length; index++) {
      const relPath = allRelPaths[index]!;
      this.renderProgress("Files", index + 1, allRelPaths.length, isCi);
      const name = basename(relPath);
      const fullPath = join(scanDir, relPath);

      if (isProbablyBinaryPath(relPath)) continue;
      if (shouldSkipFile(relPath)) continue;

      const isEnv = matchesEnvVariants(name);
      const isLog = matchesLogFiles(relPath);
      const isDocker = matchesDockerFiles(name);
      const isCiCd = matchesCiCdFiles(relPath, name);
      const isConfig = matchesConfigFiles(name);
      const isSource = matchesSourceFiles(relPath);

      const shouldScan = isEnv || isLog || isDocker || isCiCd || isConfig || isSource;

      if (!shouldScan) continue;

      let content: string;
      try {
        content = await readFile(fullPath, "utf8");
      } catch {
        continue;
      }

      const findings = scanText(content, relPath);

      allFindings.push(...findings);

      // AI-generated pattern check
      if (flags["ai-generated"] && isAiGeneratedTarget(name)) {
        const aiFindings = this.scanAiGenerated(content, relPath);
        allFindings.push(...aiFindings);
      }

      filesScanned++;
    }

    this.finishProgress(isCi);
    this.outputResults(allFindings, filesScanned, minSeverity, isCi, flags.fix);
    if (flags.fix) await this.runInteractiveFix(allFindings, minSeverity, scanDir);

    if (!isCi) {
      const score = calculateScore(allFindings);
      const summary = {
        critical: allFindings.filter((f) => f.severity === "CRITICAL").length,
        high: allFindings.filter((f) => f.severity === "HIGH").length,
        warning: allFindings.filter((f) => f.severity === "WARNING").length,
        info: allFindings.filter((f) => f.severity === "INFO").length,
      };
      await this.storeResultsIfAuthenticated(allFindings, filesScanned, score, summary, scanDir);
    }
  }

  // ── Collect MCP config files ───────────────────────────────────────

  private async collectMcpFiles(scanDir: string): Promise<string[]> {
    const candidates: string[] = [
      join(scanDir, ".cursor", "mcp.json"),
      join(scanDir, "claude_desktop_config.json"),
      join(homedir(), ".config", "claude", "config.json"),
      join(scanDir, ".claude", "config.json"),
      join(scanDir, ".continue", "config.json"),
    ];

    const result: string[] = [];

    // Check static candidates
    for (const candidate of candidates) {
      try {
        await stat(candidate);
        result.push(candidate);
      } catch {
        // doesn't exist
      }
    }

    // Find any JSON files in project containing "mcpServers"
    try {
      const allFiles = await walkDir(scanDir, scanDir);
      for (const relPath of allFiles) {
        if (!relPath.endsWith(".json")) continue;
        const fullPath = join(scanDir, relPath);
        try {
          const content = await readFile(fullPath, "utf8");
          if (content.includes('"mcpServers"')) {
            if (!result.includes(fullPath)) {
              result.push(fullPath);
            }
          }
        } catch {
          // skip
        }
      }
    } catch {
      // skip
    }

    return result;
  }

  // ── Git history scan ───────────────────────────────────────────────

  private async scanGitHistory(
    scanDir: string,
    isCi = false
  ): Promise<{ findings: Finding[]; filesScanned: number }> {
    const findings: Finding[] = [];
    let filesScanned = 0;

    try {
      const { execSync } = await import("node:child_process");

      // Get list of files that have ever been committed
      const logOutput = execSync("git log --all --name-only --format='' 2>/dev/null", {
        cwd: scanDir,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
        timeout: 30000,
      });

      const gitFiles = [...new Set(
        logOutput
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.length > 0)
      )];

      for (let index = 0; index < gitFiles.length; index++) {
        const gitFile = gitFiles[index]!;
        this.renderProgress("Git", index + 1, gitFiles.length, isCi);
        if (isProbablyBinaryPath(gitFile)) continue;
        if (shouldSkipFile(gitFile)) continue;
        try {
          const content = execSync(
            `git show HEAD:"${gitFile}" 2>/dev/null`,
            {
              cwd: scanDir,
              encoding: "utf8",
              maxBuffer: MAX_FILE_SIZE,
              timeout: 10000,
            }
          );
          const fileFindings = scanText(content, `git:${gitFile}`);
          findings.push(...fileFindings);
          filesScanned++;
        } catch {
          // File may not exist in HEAD (deleted), skip
        }
      }
    } catch {
      // Not a git repo or git not available — silently skip
    }

    this.finishProgress(isCi);
    return { findings, filesScanned };
  }

  private renderProgress(label: string, current: number, total: number, isCi: boolean): void {
    if (isCi || total <= 0 || !process.stdout.isTTY) return;
    if (current < total && current % 25 !== 0 && current !== 1) return;

    const percent = Math.min(100, Math.round((current / total) * 100));
    const line = `  ${chalk.dim(`${label}: scanned ${current}/${total} (${percent}%)`)}`;
    const padded = line.padEnd(Math.max(this.lastProgressLine.length, line.length));
    process.stdout.write(`\r${padded}`);
    this.lastProgressLine = padded;
  }

  private finishProgress(isCi: boolean): void {
    if (isCi || !process.stdout.isTTY || !this.lastProgressLine) return;
    process.stdout.write("\r" + " ".repeat(this.lastProgressLine.length) + "\r");
    this.lastProgressLine = "";
  }

  // ── AI-generated pattern scan ──────────────────────────────────────

  private scanAiGenerated(content: string, filePath: string): Finding[] {
    const findings: Finding[] = [];
    const lines = content.split("\n");

    for (const { name, pattern, severity, fixSuggestion } of AI_PATTERNS) {
      // Reset lastIndex for global patterns
      pattern.lastIndex = 0;

      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        // Find line number
        const upToMatch = content.slice(0, match.index);
        const lineNumber = upToMatch.split("\n").length;
        void lines[lineNumber - 1]; // line context reserved for future use

        // Mask the matched value
        const rawVal = match[0];
        const masked =
          rawVal.length > 12
            ? rawVal.slice(0, 6) + "..." + rawVal.slice(-4)
            : rawVal.slice(0, 4) + "...";

        findings.push({
          type: name,
          severity,
          file: filePath,
          line: lineNumber,
          maskedValue: masked,
          fixSuggestion,
        });

        // Prevent infinite loop on zero-length matches
        if (match.index === pattern.lastIndex) {
          pattern.lastIndex++;
        }
      }

      // Reset after use
      pattern.lastIndex = 0;
    }

    return findings;
  }

  // ── Output ─────────────────────────────────────────────────────────

  private outputResults(
    allFindings: Finding[],
    filesScanned: number,
    minSeverity: Severity,
    isCi: boolean,
    isFix: boolean
  ): void {
    // Filter by severity
    const filtered = allFindings.filter((f) =>
      severityAtOrAbove(f, minSeverity)
    );

    const score = calculateScore(allFindings);
    const filteredSummary = {
      critical: filtered.filter((f) => f.severity === "CRITICAL").length,
      high: filtered.filter((f) => f.severity === "HIGH").length,
      warning: filtered.filter((f) => f.severity === "WARNING").length,
      info: filtered.filter((f) => f.severity === "INFO").length,
    };
    const reportPath = filtered.length >= AUTO_REPORT_THRESHOLD
      ? this.writeReportFile(filtered, filesScanned, score, filteredSummary)
      : null;

    if (isCi) {
      this.log(
        JSON.stringify({ score, findings: filtered, filesScanned, summary: filteredSummary }, null, 2)
      );
      if (filteredSummary.critical > 0 || filteredSummary.high > 0) {
        this.exit(1);
      }
      return;
    }

    if (allFindings.length === 0) {
      this.log("");
      this.log(
        `  ${colors.success(symbols.success)}  ${chalk.bold("Clean scan")} — no secrets detected in ${chalk.bold(String(filesScanned))} files  🛡️`
      );
      this.log(`  Score: ${this.scoreLabel(score)}`);
      this.log("");
      return;
    }

    if (filtered.length === 0) {
      this.log("");
      this.log(
        `  ${colors.success(symbols.success)}  ${chalk.bold(`No findings at ${minSeverity} or above`)}`
      );
      this.log(`  Lower-severity findings still affected the overall score: ${this.scoreLabel(score)}`);
      this.log(`  Files scanned: ${chalk.bold(String(filesScanned))}`);
      this.log("");
      return;
    }

    // Group by severity
    const bySeverity: Record<Severity, Finding[]> = {
      CRITICAL: [],
      HIGH: [],
      WARNING: [],
      INFO: [],
    };

    for (const finding of filtered) {
      bySeverity[finding.severity].push(finding);
    }

    const orderedSeverities: Severity[] = ["CRITICAL", "HIGH", "WARNING", "INFO"];

    this.log("");
    this.log(
      `  Summary  ${chalk.dim(`CRITICAL ${filteredSummary.critical}  HIGH ${filteredSummary.high}  WARNING ${filteredSummary.warning}  INFO ${filteredSummary.info}`)}`
    );
    this.log(`  Files scanned: ${chalk.bold(String(filesScanned))}   Score: ${this.scoreLabel(score)}`);
    if (reportPath) {
      this.log(`  Full report: ${colors.url(reportPath)}`);
    }
    this.log("");

    for (const sev of orderedSeverities) {
      const group = bySeverity[sev];
      if (group.length === 0) continue;

      const detailLimit = DETAIL_LIMITS[sev];
      const shown = group.slice(0, detailLimit);
      const hiddenCount = group.length - shown.length;

      this.log(
        `  ${SEVERITY_EMOJI[sev]} ${chalk.bold(sev)}  ${chalk.dim(`(${group.length} finding${group.length === 1 ? "" : "s"})`)}`
      );
      this.log("");

      if (shown.length === 0) {
        this.log(`     ${chalk.dim("Detailed output suppressed for low-signal INFO findings.")}`);
        this.log("");
      }

      shown.forEach((finding, idx) => {
        const num = String(idx + 1).padStart(2, " ");
        this.log(`     ${chalk.dim(num + ".")} ${colors.key(finding.type)}`);

        const fileLabel = finding.line > 0
          ? `${finding.file} (line ${finding.line})`
          : finding.file;
        this.log(`        ${chalk.dim("File:")}   ${colors.url(fileLabel)}`);

        if (finding.maskedValue) {
          this.log(`        ${chalk.dim("Value:")}  ${chalk.yellow(finding.maskedValue)}`);
        }

        const fixtureLike = isLikelyFixturePath(finding.file);
        if (fixtureLike) {
          this.log(`        ${chalk.dim("Note:")}   ${chalk.dim("Likely test/example/demo content.")}`);
        }

        const fixText = fixtureLike
          ? "If intentional for tests/docs, keep it synthetic or construct it at runtime. If not intentional, remove it from source and rotate any real credential."
          : finding.fixSuggestion;

        if (fixText) {
          this.log(`        ${chalk.dim("Fix:")}    ${chalk.dim(fixText)}`);
        }

        this.log("");
      });

      if (hiddenCount > 0) {
        this.log(`     ${chalk.dim(`... ${hiddenCount} more ${sev} finding${hiddenCount === 1 ? "" : "s"} not shown`)}`);
        this.log("");
      }
    }

    if (isFix && isTTY && (filteredSummary.critical > 0 || filteredSummary.high > 0)) {
      this.log(
        `  ${colors.info(symbols.info)}  ${chalk.dim("Interactive fix mode starting — press")} ${chalk.bold("Enter")} ${chalk.dim("to step through CRITICAL/HIGH findings.")}`
      );
      this.log("");
    } else if (isFix && !isTTY) {
      this.log(
        `  ${colors.info(symbols.info)}  ${chalk.dim("Fix mode requires an interactive terminal. Run without --ci to use it.")}`
      );
      this.log("");
    }
  }

  // ── Interactive Fix ────────────────────────────────────────────────

  private async runInteractiveFix(
    findings: Finding[],
    minSeverity: Severity,
    scanDir: string
  ): Promise<void> {
    if (!isTTY) return;

    const actionable = findings.filter(
      (f) => (f.severity === "CRITICAL" || f.severity === "HIGH") && severityAtOrAbove(f, minSeverity)
    );

    if (actionable.length === 0) {
      this.log(`  ${colors.success(symbols.success)}  No CRITICAL or HIGH findings to address.`);
      this.log("");
      return;
    }

    // Load existing ignore list
    const ignoreFile = join(scanDir, ".slickenv", "scan-ignore.json");
    let ignored: Array<{ type: string; file: string; line: number }> = [];
    try {
      const raw = await readFile(ignoreFile, "utf8");
      ignored = JSON.parse(raw);
    } catch { /* no ignore file yet */ }

    const ignoredSet = new Set(ignored.map((e) => `${e.type}:${e.file}:${e.line}`));

    const toFix = actionable.filter((f) => !ignoredSet.has(`${f.type}:${f.file}:${f.line}`));

    if (toFix.length === 0) {
      this.log(`  ${colors.success(symbols.success)}  All CRITICAL/HIGH findings are already in your ignore list.`);
      this.log("");
      return;
    }

    this.log(divider());
    this.log(`  ${chalk.bold("Interactive Fix")}  ${chalk.dim(`${toFix.length} finding${toFix.length === 1 ? "" : "s"} to review`)}`);
    this.log(divider());
    this.log("");

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q: string): Promise<string> =>
      new Promise((resolve) => rl.question(q, (a) => resolve(a.trim().toLowerCase())));

    const newlyIgnored: Array<{ type: string; file: string; line: number }> = [];
    let addressed = 0;
    let skipped = 0;

    for (let i = 0; i < toFix.length; i++) {
      const f = toFix[i]!;
      const num = `${i + 1}/${toFix.length}`;
      const sevColor = f.severity === "CRITICAL" ? colors.error : colors.warning;

      this.log(`  ${sevColor(chalk.bold(`[${f.severity}]`))}  ${colors.key(f.type)}  ${chalk.dim(num)}`);
      this.log(`  ${chalk.dim("File:")}   ${colors.url(f.file)}${f.line > 0 ? chalk.dim(`:${f.line}`) : ""}`);
      if (f.maskedValue) {
        this.log(`  ${chalk.dim("Value:")}  ${chalk.yellow(f.maskedValue)}`);
      }
      if (f.fixSuggestion) {
        this.log(`  ${chalk.dim("Fix:")}    ${chalk.dim(f.fixSuggestion)}`);
      }
      this.log("");
      this.log(
        `  ${chalk.dim("[Enter]")} ${chalk.dim("next")}  ${chalk.dim("[i]")} ignore this finding  ${chalk.dim("[q]")} quit fix mode`
      );

      const answer = await ask("  > ");

      if (answer === "q") {
        this.log(`\n  ${chalk.dim("Quit fix mode.")}`);
        this.log("");
        break;
      } else if (answer === "i") {
        newlyIgnored.push({ type: f.type, file: f.file, line: f.line });
        this.log(`  ${colors.info(symbols.info)}  ${chalk.dim("Added to ignore list.")}`);
        addressed++;
      } else {
        skipped++;
      }
      this.log("");
    }

    rl.close();

    // Save updated ignore list
    if (newlyIgnored.length > 0) {
      const updated = [...ignored, ...newlyIgnored];
      await mkdir(join(scanDir, ".slickenv"), { recursive: true });
      await writeFile(ignoreFile, JSON.stringify(updated, null, 2) + "\n", "utf8");
      this.log(`  ${colors.success(symbols.success)}  ${newlyIgnored.length} finding${newlyIgnored.length === 1 ? "" : "s"} added to ${chalk.dim(".slickenv/scan-ignore.json")}`);
    }

    this.log(`  ${chalk.dim(`Fix session complete — ${addressed} addressed, ${skipped} skipped, ${toFix.length - addressed - skipped} remaining`)}`);
    this.log("");
  }

  private writeReportFile(
    findings: Finding[],
    filesScanned: number,
    score: number,
    summary: { critical: number; high: number; warning: number; info: number }
  ): string {
    const reportsDir = join(process.cwd(), ".slickenv", "reports");
    const timestamp = new Date().toISOString().replace(/[:]/g, "-");
    const reportPath = join(reportsDir, `scan-${timestamp}.md`);

    const lines: string[] = [
      "# SlickEnv Scan Report",
      "",
      `- Generated: ${new Date().toISOString()}`,
      `- Files scanned: ${filesScanned}`,
      `- Score: ${score}/100`,
      `- Summary: CRITICAL ${summary.critical}, HIGH ${summary.high}, WARNING ${summary.warning}, INFO ${summary.info}`,
      "",
    ];

    for (const sev of ["CRITICAL", "HIGH", "WARNING", "INFO"] as Severity[]) {
      const group = findings.filter((f) => f.severity === sev);
      if (group.length === 0) continue;

      lines.push(`## ${sev} (${group.length})`, "");
      group.forEach((finding, index) => {
        const fixtureLike = isLikelyFixturePath(finding.file);
        lines.push(`### ${index + 1}. ${finding.type}`);
        lines.push(`- File: ${finding.file}${finding.line > 0 ? `:${finding.line}` : ""}`);
        lines.push(`- Value: ${finding.maskedValue || "(masked unavailable)"}`);
        if (fixtureLike) {
          lines.push(`- Note: Likely test/example/demo content.`);
        }
        lines.push(`- Fix: ${fixtureLike ? "If intentional for tests/docs, keep it synthetic or construct it at runtime. Otherwise remove it and rotate any real credential." : finding.fixSuggestion}`);
        lines.push("");
      });
    }

    void mkdir(reportsDir, { recursive: true }).then(() =>
      writeFile(reportPath, lines.join("\n"), "utf8")
    );

    return reportPath;
  }

  // ── Optional telemetry storage ─────────────────────────────────────

  async storeResultsIfAuthenticated(
    findings: Finding[],
    filesScanned: number,
    score: number,
    summary: { critical: number; high: number; warning: number; info: number },
    scanDir: string
  ): Promise<void> {
    try {
      const token = await getStoredToken();
      if (!token) return;

      let projectId: string | undefined;
      try {
        const config = await loadConfig();
        projectId = config.projectId;
      } catch {
        // No config — store without project association
      }

      const client = createApiClient(undefined, token);
      await client.mutation("scanning:storeFileScan" as any, {
        projectId,
        scanDir,
        filesScanned,
        findings: findings.slice(0, 500).map((f) => ({
          type: f.type,
          severity: f.severity,
          file: f.file,
          line: f.line,
          maskedValue: f.maskedValue,
        })),
        summary: { ...summary, score },
      });
    } catch {
      // Silently ignore storage errors — scan output is unaffected
    }
  }

  // ── Score label ────────────────────────────────────────────────────

  private scoreLabel(score: number): string {
    const label = `${score}/100`;
    if (score >= 90) return colors.success(chalk.bold(label));
    if (score >= 70) return colors.warning(chalk.bold(label));
    return colors.error(chalk.bold(label));
  }
}
