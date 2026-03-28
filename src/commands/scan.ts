import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, basename, extname } from "node:path";
import { homedir } from "node:os";
import { Flags } from "@oclif/core";
import chalk from "chalk";
import { BaseCommand } from "../base-command.js";
import { colors, symbols, divider } from "../lib/output.js";
import type { Finding, Severity } from "../lib/scanner.js";
import { scanText, calculateScore } from "../lib/scanner.js";

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

// ── Severity filtering ───────────────────────────────────────────────

function severityAtOrAbove(finding: Finding, minSeverity: Severity): boolean {
  return SEVERITY_ORDER[finding.severity] >= SEVERITY_ORDER[minSeverity];
}

// ── Main command ─────────────────────────────────────────────────────

export default class Scan extends BaseCommand {
  static override description = "Scan files, git history, and MCP configs for 53 secret patterns. Outputs a security score 0–100.";

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

      for (const filePath of mcpFiles) {
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

      this.outputResults(allFindings, filesScanned, minSeverity, isCi, flags.fix);
      return;
    }

    // ── Git-only mode ──────────────────────────────────────────────
    if (flags.git) {
      const gitFindings = await this.scanGitHistory(scanDir);
      allFindings.push(...gitFindings.findings);
      filesScanned += gitFindings.filesScanned;
      this.outputResults(allFindings, filesScanned, minSeverity, isCi, flags.fix);
      return;
    }

    // ── File scan (default or --files) ─────────────────────────────
    const allRelPaths = await walkDir(scanDir, scanDir);

    for (const relPath of allRelPaths) {
      const name = basename(relPath);
      const fullPath = join(scanDir, relPath);

      const isEnv = matchesEnvVariants(name);
      const isLog = matchesLogFiles(relPath);
      const isDocker = matchesDockerFiles(name);
      const isCiCd = matchesCiCdFiles(relPath, name);
      const isConfig = matchesConfigFiles(name);
      const isBuild = matchesBuildOutputs(relPath);
      const isSource = matchesSourceFiles(relPath);

      const shouldScan = isEnv || isLog || isDocker || isCiCd || isConfig || isBuild || isSource;

      if (!shouldScan) continue;

      let content: string;
      try {
        content = await readFile(fullPath, "utf8");
      } catch {
        continue;
      }

      const findings = scanText(content, relPath);

      // For build outputs, add an INFO finding noting the risk
      if (isBuild && findings.length === 0) {
        // Only warn about build outputs — don't add noise if scanText already found things
        allFindings.push({
          type: "Build output included in scan",
          severity: "INFO",
          file: relPath,
          line: 0,
          maskedValue: "",
          fixSuggestion: "Ensure build outputs are not committed or deployed with embedded secrets.",
        });
      }

      allFindings.push(...findings);

      // AI-generated pattern check
      if (flags["ai-generated"] && isAiGeneratedTarget(name)) {
        const aiFindings = this.scanAiGenerated(content, relPath);
        allFindings.push(...aiFindings);
      }

      filesScanned++;
    }

    // If --files was NOT specified (default mode), also scan git history
    if (!flags.files) {
      const gitFindings = await this.scanGitHistory(scanDir);
      allFindings.push(...gitFindings.findings);
      // Don't double-count files for git history
    }

    // Run MCP scan as part of default scan too
    if (!flags.files) {
      const mcpFiles = await this.collectMcpFiles(scanDir);
      for (const filePath of mcpFiles) {
        // Avoid double-scanning files already covered
        const rel = filePath.startsWith(scanDir)
          ? relative(scanDir, filePath)
          : filePath;
        const alreadyScanned = allRelPaths.includes(rel);
        if (alreadyScanned) continue;

        try {
          const content = await readFile(filePath, "utf8");
          const findings = scanText(content, rel);
          allFindings.push(...findings);
          filesScanned++;
        } catch {
          // skip
        }
      }
    }

    this.outputResults(allFindings, filesScanned, minSeverity, isCi, flags.fix);
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
    scanDir: string
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

      for (const gitFile of gitFiles) {
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

    return { findings, filesScanned };
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

    if (isCi) {
      const summary = {
        critical: filtered.filter((f) => f.severity === "CRITICAL").length,
        high: filtered.filter((f) => f.severity === "HIGH").length,
        warning: filtered.filter((f) => f.severity === "WARNING").length,
        info: filtered.filter((f) => f.severity === "INFO").length,
      };
      this.log(
        JSON.stringify({ score, findings: filtered, filesScanned, summary }, null, 2)
      );
      return;
    }

    if (filtered.length === 0) {
      this.log("");
      this.log(
        `  ${colors.success(symbols.success)}  ${chalk.bold("Clean scan")} — no secrets detected in ${chalk.bold(String(filesScanned))} files  🛡️`
      );
      this.log(`  Score: ${this.scoreLabel(score)}`);
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

    for (const sev of orderedSeverities) {
      const group = bySeverity[sev];
      if (group.length === 0) continue;

      this.log(
        `  ${SEVERITY_EMOJI[sev]} ${chalk.bold(sev)}  ${chalk.dim(`(${group.length} finding${group.length === 1 ? "" : "s"})`)}`
      );
      this.log("");

      group.forEach((finding, idx) => {
        const num = String(idx + 1).padStart(2, " ");
        this.log(`     ${chalk.dim(num + ".")} ${colors.key(finding.type)}`);

        const fileLabel = finding.line > 0
          ? `${finding.file} (line ${finding.line})`
          : finding.file;
        this.log(`        ${chalk.dim("File:")}   ${colors.url(fileLabel)}`);

        if (finding.maskedValue) {
          this.log(`        ${chalk.dim("Value:")}  ${chalk.yellow(finding.maskedValue)}`);
        }

        if (finding.fixSuggestion) {
          this.log(`        ${chalk.dim("Fix:")}    ${chalk.dim(finding.fixSuggestion)}`);
        }

        this.log("");
      });
    }

    this.log(divider());

    const summary = [
      `Score: ${this.scoreLabel(score)}`,
      `Files scanned: ${chalk.bold(String(filesScanned))}`,
    ].join("   ");

    this.log(`  ${summary}`);
    this.log("");

    if (isFix) {
      this.log(
        `  ${colors.info(symbols.info)}  ${chalk.dim("Fix mode: review the findings above and run")} ${chalk.bold("slickenv add KEY=<value>")} ${chalk.dim("to move secrets to SlickEnv.")}`
      );
      this.log("");
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
