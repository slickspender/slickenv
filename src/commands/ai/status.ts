import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { Flags } from "@oclif/core";
import { BaseCommand } from "../../base-command.js";
import { colors, symbols, divider } from "../../lib/output.js";
import chalk from "chalk";

interface AiToolDef {
  name: string;
  detectionPath: string | string[];
  ignoreFile: string;
  alwaysCheck?: boolean;
}

const AI_TOOLS: AiToolDef[] = [
  { name: "Cursor", detectionPath: ".cursor", ignoreFile: ".cursorignore" },
  { name: "Claude Code", detectionPath: ".claude", ignoreFile: ".claudeignore" },
  {
    name: "GitHub Copilot",
    detectionPath: ".github/copilot-instructions.md",
    ignoreFile: ".copilotignore",
    alwaysCheck: true,
  },
  {
    name: "Continue.dev",
    detectionPath: ".continue",
    ignoreFile: ".continuerc.json",
  },
  { name: "Windsurf", detectionPath: ".windsurf", ignoreFile: ".windsurfignore" },
  { name: "JetBrains AI", detectionPath: ".idea", ignoreFile: ".junie/guidelines.md" },
  {
    name: "Cline/RooCode",
    detectionPath: [".roo", ".cline"],
    ignoreFile: ".clinerules",
  },
];

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function detectTool(projectDir: string, tool: AiToolDef): Promise<boolean> {
  if (tool.alwaysCheck) return true;

  const paths = Array.isArray(tool.detectionPath)
    ? tool.detectionPath
    : [tool.detectionPath];

  for (const p of paths) {
    if (await pathExists(join(projectDir, p))) return true;
  }
  return false;
}

async function ignoreFileProtects(filePath: string): Promise<boolean> {
  try {
    const content = await readFile(filePath, "utf8");
    // Basic check: does the file contain ".env" anywhere
    return content.includes(".env");
  } catch {
    return false;
  }
}

async function checkContinueRc(filePath: string): Promise<boolean> {
  try {
    const raw = await readFile(filePath, "utf8");
    const config = JSON.parse(raw) as Record<string, unknown>;
    const patterns = config.fileExcludePatterns;
    if (Array.isArray(patterns)) {
      return patterns.some((p) => typeof p === "string" && p.includes(".env"));
    }
    return false;
  } catch {
    return false;
  }
}

async function countEnvFiles(projectDir: string): Promise<string[]> {
  // Check for common .env file patterns
  const envCandidates = [
    ".env",
    ".env.local",
    ".env.production",
    ".env.staging",
    ".env.development",
    ".env.test",
  ];

  const found: string[] = [];
  for (const f of envCandidates) {
    if (await pathExists(join(projectDir, f))) {
      found.push(f);
    }
  }
  return found;
}

interface SecretRefStats {
  total: number;
  slickenvRefs: number;
  plaintext: number;
}

async function analyzeEnvReferences(projectDir: string): Promise<SecretRefStats> {
  const envPath = join(projectDir, ".env");
  try {
    const content = await readFile(envPath, "utf8");
    const lines = content
      .split("\n")
      .filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="));

    let slickenvRefs = 0;
    let plaintext = 0;

    for (const line of lines) {
      const eqIdx = line.indexOf("=");
      if (eqIdx === -1) continue;
      const value = line.slice(eqIdx + 1).trim();
      if (value.startsWith("slickenv://")) {
        slickenvRefs++;
      } else {
        plaintext++;
      }
    }

    return { total: lines.length, slickenvRefs, plaintext };
  } catch {
    return { total: 0, slickenvRefs: 0, plaintext: 0 };
  }
}

export default class AiStatus extends BaseCommand {
  static override description = "Show which AI coding tools are protected and which ignore files exist in this project.";

  static override examples = [
    "slickenv ai status",
  ];

  static override flags = {
    ...BaseCommand.baseFlags,
    dir: Flags.string({
      description: "Project directory (default: current working directory)",
      default: "",
    }),
  };

  protected override requiresConfig = false;
  protected override requiresAuth = false;

  async run(): Promise<void> {
    const { flags } = await this.parse(AiStatus);
    const projectDir = flags.dir || process.cwd();

    this.log("");
    this.log(`  ${chalk.bold("AI Tool Security Status")}`);
    this.log(divider(49));

    // Column widths
    const COL_TOOL = 22;
    const COL_FILE = 22;
    const COL_STATUS = 10;

    // Table header
    this.log(
      `  ${"Tool".padEnd(COL_TOOL)}${"Ignore File".padEnd(COL_FILE)}${"Status"}`
    );
    this.log(
      `  ${"─".repeat(COL_TOOL - 2).padEnd(COL_TOOL)}${"─".repeat(COL_FILE - 2).padEnd(COL_FILE)}${"─".repeat(COL_STATUS)}`
    );

    interface ToolResult {
      name: string;
      ignoreFile: string;
      detected: boolean;
      protected: boolean;
    }

    const results: ToolResult[] = [];
    let exposedCount = 0;

    for (const tool of AI_TOOLS) {
      const detected = await detectTool(projectDir, tool);

      if (!detected) {
        const row: ToolResult = {
          name: tool.name,
          ignoreFile: tool.ignoreFile,
          detected: false,
          protected: false,
        };
        results.push(row);

        this.log(
          `  ${chalk.dim(tool.name.padEnd(COL_TOOL))}${chalk.dim(tool.ignoreFile.padEnd(COL_FILE))}${chalk.dim("– Not detected")}`
        );
        continue;
      }

      const ignoreFilePath = join(projectDir, tool.ignoreFile);
      let isProtected: boolean;

      if (tool.ignoreFile === ".continuerc.json") {
        isProtected = await checkContinueRc(ignoreFilePath);
      } else {
        isProtected = await ignoreFileProtects(ignoreFilePath);
      }

      if (!isProtected) exposedCount++;

      const statusText = isProtected
        ? colors.success(`${symbols.success} Safe`)
        : colors.error(`${symbols.error} EXPOSED`);

      const nameCol = detected ? chalk.white(tool.name.padEnd(COL_TOOL)) : chalk.dim(tool.name.padEnd(COL_TOOL));
      const fileCol = chalk.dim(tool.ignoreFile.padEnd(COL_FILE));

      results.push({ name: tool.name, ignoreFile: tool.ignoreFile, detected, protected: isProtected });

      this.log(`  ${nameCol}${fileCol}${statusText}`);
    }

    this.log("");
    this.log(divider(49));

    // Summary
    if (exposedCount === 0) {
      this.log(
        `  ${colors.success(symbols.success)}  ${chalk.bold("All detected AI tools are configured to protect secrets")}`
      );
    } else {
      this.log(
        `  ${colors.warning(symbols.warning)}  ${colors.warning(`${exposedCount} tool${exposedCount === 1 ? "" : "s"} can read your secrets`)}`
      );
    }

    this.log("");

    // Secret reference analysis
    const envFiles = await countEnvFiles(projectDir);
    const stats = await analyzeEnvReferences(projectDir);

    if (stats.total > 0) {
      const refLabel = "Secret References:";
      this.log(
        `  ${chalk.dim(refLabel.padEnd(20))}${stats.slickenvRefs}/${stats.total} secrets using ${colors.highlight("slickenv://")} references`
      );
      if (stats.plaintext > 0) {
        this.log(
          `  ${"".padEnd(20)}${colors.warning(`${stats.plaintext} secret${stats.plaintext === 1 ? "" : "s"} still exist as plaintext in .env`)}`
        );
      }
      this.log("");
    } else if (envFiles.length > 0 && exposedCount > 0) {
      // Env files found but couldn't parse (permissions, etc)
      this.log(
        `  ${chalk.dim("Env files found:")} ${envFiles.map((f) => colors.warning(f)).join(", ")}`
      );
      this.log("");
    }

    if (exposedCount > 0) {
      this.log(
        `  Run: ${colors.highlight("slickenv ai protect")}  to fix all issues`
      );
      this.log("");
    }
  }
}
