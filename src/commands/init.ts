import { readFile, writeFile, access, readdir, mkdir, chmod } from "node:fs/promises";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { createServer } from "node:http";
import { exec } from "node:child_process";
import { Flags } from "@oclif/core";
import { BaseCommand } from "../base-command.js";
import { findConfigDir, writeConfig, CONFIG_FILENAME } from "../lib/config.js";
import { createApiClient } from "../lib/api.js";
import { resolveToken, isExpired } from "../lib/auth.js";
import { storeToken } from "../lib/keychain.js";
import { isTTY, colors, symbols, divider } from "../lib/output.js";
import { parseEnvFile } from "../lib/parser.js";
import type { SlickEnvConfig } from "@slickenv/types";
import chalk from "chalk";

const CALLBACK_PORT = 9876;
const AUTH_TIMEOUT_MS = 120_000;

export default class Init extends BaseCommand {
  static override description = "Create a SlickEnv project and walk users through the main security protections during setup.";

  static override examples = [
    "slickenv init",
    "slickenv init --name my-app --env production",
    "slickenv init --security recommended",
    "slickenv init --security git",
    "slickenv init --yes",
  ];

  static override flags = {
    ...BaseCommand.baseFlags,
    name: Flags.string({
      description: "Project name",
    }),
    env: Flags.string({
      description: "Environment label (e.g. production, staging)",
      default: "production",
    }),
    security: Flags.string({
      description: "Security setup profile: recommended, all, scan, git, ai, none",
      options: ["recommended", "all", "scan", "git", "ai", "none"],
      helpValue: "<profile>",
    }),
    yes: Flags.boolean({
      char: "y",
      description: "Accept the recommended security setup without prompting",
      default: false,
    }),
    scan: Flags.boolean({
      description: 'Run a current-files secret scan during init',
      default: false,
      allowNo: true,
    }),
    'git-safety': Flags.boolean({
      description: 'Install the repo-managed pre-commit hook and configure git protection',
      default: false,
      allowNo: true,
    }),
    'ai-safety': Flags.boolean({
      description: 'Generate AI ignore files for Cursor, Claude Code, Copilot, and similar tools',
      default: false,
      allowNo: true,
    }),
    'full-setup': Flags.boolean({
      description: 'Enable scan + git safety + AI safety',
      default: false,
    }),
    'skip-setup': Flags.boolean({
      description: 'Skip all security setup during init',
      default: false,
    }),
  };

  protected override requiresConfig = false;
  protected override requiresAuth = false;

  async run(): Promise<void> {
    const { flags } = await this.parse(Init);

    // Check if already initialised
    const existingDir = await findConfigDir();
    if (existingDir) {
      this.warning(`Project already initialised (found ${CONFIG_FILENAME} in ${existingDir}).`);
      return;
    }

    // Ensure we have a valid auth token, logging in automatically if needed
    await this.ensureAuth();

    // Resolve project name
    let projectName = flags.name;
    if (!projectName) {
      projectName = isTTY ? await this.prompt("Project name", basename(process.cwd())) : basename(process.cwd());
    }

    const envLabel = flags.env ?? "production";

    // Create project via Convex
    const client = createApiClient(undefined, this.authToken);
    let result: { projectId: string; slug: string };

    try {
      result = await client.mutation("projects:create" as any, {
        name: projectName,
      }) as any;
    } catch (error: any) {
      const msg = error?.data?.message ?? error?.message ?? "Failed to create project.";
      this.fail(msg);
    }

    // Write .slickenv config
    const config: SlickEnvConfig = {
      version: 1,
      projectId: result!.projectId,
      projectName,
      defaultEnvironment: envLabel,
      apiUrl: process.env.SLICKENV_API_URL ?? "https://adjoining-sheep-555.convex.cloud",
    };

    await writeConfig(config, process.cwd());

    // Add .env to .gitignore if not already there
    await this.ensureGitignore();

    this.log("");
    this.log(`  ${colors.success(symbols.success)}  ${chalk.bold("Project initialised")}`);
    this.log(divider());
    this.log(`  ${chalk.dim("Project")}     ${colors.key(projectName)}`);
    this.log(`  ${chalk.dim("Slug")}        ${colors.highlight(result!.slug)}`);
    this.log(`  ${chalk.dim("Environment")} ${colors.highlight(envLabel)}`);
    this.log(`  ${chalk.dim("Config")}      ${CONFIG_FILENAME}`);
    this.log("");
    this.log(`  ${chalk.dim("Next:")} ${colors.highlight("slickenv push")} ${chalk.dim("to sync your .env")}`);
    this.log("");

    // Smart scan: detect env var references from source code
    await this.smartScan(process.cwd());

    // Security setup wizard
    await this.runSecuritySetup(flags, projectName, envLabel);
  }

  private async prompt(message: string, defaultValue: string): Promise<string> {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
      rl.question(`  ${message} ${chalk.dim(`(${defaultValue})`)}: `, (answer) => {
        rl.close();
        resolve(answer.trim() || defaultValue);
      });
    });
  }

  private async promptChoice(message: string, defaultValue: string): Promise<string> {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
      rl.question(`  ${message} ${chalk.dim(`(default: ${defaultValue})`)}: `, (answer) => {
        rl.close();
        resolve(answer.trim() || defaultValue);
      });
    });
  }

  private async promptYesNo(message: string, defaultValue = true): Promise<boolean> {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const suffix = defaultValue ? "(Y/n)" : "(y/N)";
    return new Promise((resolve) => {
      rl.question(`  ${message} ${chalk.dim(suffix)}: `, (answer) => {
        rl.close();
        const normalized = answer.trim().toLowerCase();
        if (!normalized) return resolve(defaultValue);
        resolve(normalized === "y" || normalized === "yes");
      });
    });
  }

  private async ensureGitignore(): Promise<void> {
    const gitignorePath = join(process.cwd(), ".gitignore");
    try {
      await access(gitignorePath);
      const content = await readFile(gitignorePath, "utf8");
      if (!content.includes(".env")) {
        await writeFile(gitignorePath, content.trimEnd() + "\n.env\n", "utf8");
      }
    } catch {
      await writeFile(gitignorePath, ".env\n", "utf8");
    }
  }

  private async smartScan(dir: string): Promise<void> {
    const patterns = [
      /process\.env\.([A-Z_][A-Z0-9_]*)/g,
      /import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g,
      /os\.environ\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g,
      /os\.getenv\(['"]([A-Z_][A-Z0-9_]*)['"]\)/g,
      /ENV\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g,
    ];

    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rb', '.go'];
    const skipDirs = ['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '__pycache__'];

    const foundKeys = new Set<string>();

    const walk = async (d: string): Promise<void> => {
      try {
        const entries = await readdir(d, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            if (!skipDirs.includes(entry.name)) await walk(join(d, entry.name));
          } else if (extensions.some(ext => entry.name.endsWith(ext))) {
            try {
              const content = await readFile(join(d, entry.name), 'utf8');
              for (const pattern of patterns) {
                pattern.lastIndex = 0;
                let match;
                while ((match = pattern.exec(content)) !== null) {
                  const key = match[1];
                  if (key && key.length > 2) foundKeys.add(key);
                }
              }
            } catch { /* skip unreadable files */ }
          }
        }
      } catch { /* skip unreadable dirs */ }
    };

    await walk(dir);

    // Remove common system env vars
    const systemVars = new Set(['HOME', 'PATH', 'USER', 'SHELL', 'TERM', 'PWD', 'TMPDIR', 'NODE_ENV', 'NODE_PATH']);
    for (const k of systemVars) foundKeys.delete(k);

    if (foundKeys.size === 0) return;

    this.log(`  ${chalk.dim("→")}  Found ${foundKeys.size} env var reference${foundKeys.size === 1 ? '' : 's'} in source code:`);

    // Check which ones are already in .env
    let existingKeys: Set<string> = new Set();
    try {
      const envContent = await readFile(join(dir, '.env'), 'utf8');
      const parsed = parseEnvFile(envContent);
      existingKeys = new Set(parsed.map(v => v.key));
    } catch { /* no .env yet */ }

    const newKeys = [...foundKeys].filter(k => !existingKeys.has(k)).sort();

    if (newKeys.length > 0) {
      this.log(`  ${chalk.dim("→")}  ${newKeys.length} key${newKeys.length === 1 ? '' : 's'} not yet in .env:`);
      for (const key of newKeys.slice(0, 10)) {
        // Classify visibility
        const isPublic = key.startsWith('NEXT_PUBLIC_') || key.startsWith('VITE_') || key.startsWith('REACT_APP_');
        this.log(`    ${chalk.dim("·")}  ${colors.key(key)}  ${chalk.dim(isPublic ? '(public)' : '(private)')}`);
      }
      if (newKeys.length > 10) {
        this.log(`    ${chalk.dim("·")}  ... and ${newKeys.length - 10} more`);
      }
    }
  }

  private async runSecuritySetup(flags: any, projectName: string, envLabel: string): Promise<void> {
    const securityProfile = flags.security as string | undefined;
    const anyExplicit =
      Boolean(
        securityProfile ||
        flags.scan ||
        flags['git-safety'] ||
        flags['ai-safety'] ||
        flags['full-setup'] ||
        flags['skip-setup'] ||
        flags.yes
      );

    if (flags['skip-setup'] || (!isTTY && !anyExplicit)) return;

    let enableScan = false;
    let enableGit = false;
    let enableAi = false;

    if (securityProfile === 'recommended' || securityProfile === 'all' || flags['full-setup']) {
      enableScan = true;
      enableGit = true;
      enableAi = true;
    } else if (securityProfile === 'scan') {
      enableScan = true;
    } else if (securityProfile === 'git') {
      enableGit = true;
    } else if (securityProfile === 'ai') {
      enableAi = true;
    } else if (securityProfile === 'none') {
      return;
    }

    enableScan ||= Boolean(flags.scan);
    enableGit ||= Boolean(flags['git-safety']);
    enableAi ||= Boolean(flags['ai-safety']);

    if (flags.yes && !securityProfile && !flags.scan && !flags['git-safety'] && !flags['ai-safety']) {
      enableScan = true;
      enableGit = true;
      enableAi = true;
    }

    // Interactive menu only if no explicit flags
    if (!anyExplicit && isTTY) {
      this.log('');
      this.log(`  ${chalk.bold('Recommended security setup')} ${chalk.dim('(helps prevent the most common mistakes before first push)')}`);
      this.log('');
      this.log(`  ${chalk.dim('1.')}  ${colors.highlight('Recommended')}       ${chalk.dim('— scan current files + install git protection + generate AI ignore files')}`);
      this.log(`  ${chalk.dim('2.')}  ${colors.error('Scan only')}         ${chalk.dim('— check current files for exposed secrets')}`);
      this.log(`  ${chalk.dim('3.')}  ${colors.warning('Git only')}          ${chalk.dim('— install repo-managed pre-commit protection')}`);
      this.log(`  ${chalk.dim('4.')}  ${colors.info('AI only')}           ${chalk.dim('— generate ignore files for AI coding tools')}`);
      this.log(`  ${chalk.dim('5.')}  ${colors.key('Custom')}            ${chalk.dim('— choose each protection one by one')}`);
      this.log(`  ${chalk.dim('6.')}  Skip for now`);
      this.log('');

      const choice = await this.promptChoice('Choose [1-6]', '1');

      switch (choice.trim()) {
        case '1': enableScan = true; enableGit = true; enableAi = true; break;
        case '2': enableScan = true; break;
        case '3': enableGit = true; break;
        case '4': enableAi = true; break;
        case '5':
          enableScan = await this.promptYesNo('Run a current-files secret scan?', true);
          enableGit = await this.promptYesNo('Install git commit protection?', true);
          enableAi = await this.promptYesNo('Generate AI ignore files?', true);
          break;
        case '6': return;
        default:
          if (choice === '') { enableScan = true; enableGit = true; enableAi = true; }
          else return;
      }
    }

    this.log('');
    this.log(`  ${chalk.dim('Selected protections:')} ${[
      enableScan ? 'scan' : null,
      enableGit ? 'git' : null,
      enableAi ? 'ai' : null,
    ].filter(Boolean).join(', ') || 'none'}`);
    this.log('');

    // --- Run selected security features ---

    if (enableScan) {
      await this.runFileScan(process.cwd());
    }

    if (enableGit) {
      await this.runGitSafety(process.cwd());
    }

    if (enableAi) {
      await this.runAiSafety(process.cwd());
    }

    // Summary
    this.log('');
    this.log(`  ${chalk.bold('Security setup complete.')}`);
    if (enableScan || enableGit || enableAi) {
      this.log('');
      if (enableScan) this.log(`  ${colors.success(symbols.success)}  File scan complete`);
      if (enableGit)  this.log(`  ${colors.success(symbols.success)}  Git safety active — pre-commit hook installed`);
      if (enableAi)   this.log(`  ${colors.success(symbols.success)}  AI safety active — ignore files generated`);
    }
    const reportPath = await this.writeSetupReport({
      projectName,
      envLabel,
      enableScan,
      enableGit,
      enableAi,
    });
    this.log('');
    this.log(`  ${chalk.bold('Recommended next steps')}`);
    this.log(`  ${chalk.dim('1.')}  ${colors.highlight('slickenv push')} ${chalk.dim('to sync your current .env securely')}`);
    this.log(`  ${chalk.dim('2.')}  ${colors.highlight('slickenv status')} ${chalk.dim('to verify drift, sync state, and secret age')}`);
    if (enableAi) this.log(`  ${chalk.dim('3.')}  ${colors.highlight('slickenv ai status')} ${chalk.dim('to confirm AI tools are blocked')}`);
    if (enableGit) this.log(`  ${chalk.dim(enableAi ? '4.' : '3.')}  ${colors.highlight('slickenv git scan')} ${chalk.dim('to audit past git history, not just future commits')}`);
    this.log(`  ${chalk.dim('·')}  Full setup report: ${colors.url(reportPath)}`);
    this.log('');
  }

  private async writeSetupReport(input: {
    projectName: string;
    envLabel: string;
    enableScan: boolean;
    enableGit: boolean;
    enableAi: boolean;
  }): Promise<string> {
    const reportsDir = join(process.cwd(), '.slickenv', 'reports');
    const reportPath = join(reportsDir, 'init-setup.md');

    const enabled = [
      input.enableScan ? 'Current-files secret scan' : null,
      input.enableGit ? 'Git commit protection via .githooks/pre-commit' : null,
      input.enableAi ? 'AI ignore-file protection' : null,
    ].filter(Boolean);

    const lines = [
      '# SlickEnv Setup Report',
      '',
      `- Project: ${input.projectName}`,
      `- Environment: ${input.envLabel}`,
      `- Generated: ${new Date().toISOString()}`,
      '',
      '## Enabled protections',
      ...(enabled.length > 0 ? enabled.map((item) => `- ${item}`) : ['- None']),
      '',
      '## Recommended next steps',
      '- Run `slickenv push` to sync the current `.env` securely.',
      '- Run `slickenv status` to check sync state, drift, and secret age.',
      ...(input.enableAi ? ['- Run `slickenv ai status` to verify AI-tool protection.'] : []),
      ...(input.enableGit ? ['- Run `slickenv git scan` to audit old history, not just future commits.'] : []),
      '',
      '## Main security features',
      '- `scan`: current-file secret scanning',
      '- `git protect`: repo-managed pre-commit protection',
      '- `git scan`: history audit for previously committed secrets',
      '- `ai protect`: ignore-file protection for AI coding tools',
      '- `push` / `pull`: encrypted env sync',
      '- `status`: drift and sync visibility',
      '',
    ];

    await mkdir(reportsDir, { recursive: true });
    await writeFile(reportPath, lines.join('\n'), 'utf8');
    return reportPath;
  }

  private async runFileScan(dir: string): Promise<void> {
    this.log(`  ${chalk.dim('→')}  Running secret scan...`);

    // Import scanner
    const { scanText, calculateScore } = await import('../lib/scanner.js');

    const skipDirs = ['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '__pycache__'];
    const allFindings: any[] = [];
    let filesScanned = 0;

    const walk = async (d: string): Promise<void> => {
      try {
        const entries = await readdir(d, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            if (!skipDirs.includes(entry.name)) await walk(join(d, entry.name));
          } else {
            try {
              const fullPath = join(d, entry.name);
              const { stat } = await import('node:fs/promises');
              const s = await stat(fullPath);
              if (s.size > 1_000_000) continue; // skip >1MB
              const content = await readFile(fullPath, 'utf8');
              const relativePath = fullPath.replace(dir + '/', '');
              const findings = scanText(content, relativePath);
              allFindings.push(...findings);
              filesScanned++;
            } catch { /* skip unreadable */ }
          }
        }
      } catch { /* skip */ }
    };

    await walk(dir);

    const score = calculateScore(allFindings);
    const critical = allFindings.filter(f => f.severity === 'CRITICAL').length;
    const high = allFindings.filter(f => f.severity === 'HIGH').length;

    if (allFindings.length === 0) {
      this.log(`  ${colors.success(symbols.success)}  ${chalk.dim('No secrets found in')} ${filesScanned} ${chalk.dim('files')}  🛡️`);
    } else {
      this.log(`  ${colors.warning(symbols.warning)}  Found ${chalk.bold(String(allFindings.length))} issue${allFindings.length === 1 ? '' : 's'} in ${filesScanned} files ${chalk.dim(`(score: ${score}/100)`)}`);
      if (critical > 0) this.log(`    ${colors.error('·')}  ${critical} CRITICAL — run ${colors.highlight('slickenv scan')} for details`);
      if (high > 0) this.log(`    ${colors.warning('·')}  ${high} HIGH`);
      this.log(`  ${chalk.dim('→')}  Run ${colors.highlight('slickenv scan')} for full details and fix guidance`);
    }
  }

  private async runGitSafety(dir: string): Promise<void> {
    this.log(`  ${chalk.dim('→')}  Setting up git safety...`);

    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);

    // Check if we're in a git repo
    try {
      await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: dir });
    } catch {
      this.log(`  ${chalk.dim('·')}  Not a git repository — skipping git safety`);
      return;
    }

    // Install pre-commit hook
    try {
      // Find .git dir
      const { stdout } = await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: dir });
      void stdout;
      const hooksDir = join(dir, '.githooks');
      const hookPath = join(hooksDir, 'pre-commit');

      const hookScript = `#!/usr/bin/env sh
# SlickEnv pre-commit security hook
# Installed by: slickenv init
# To remove: slickenv git protect --uninstall

STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null || true)
if [ -z "$STAGED_FILES" ]; then exit 0; fi
BLOCKED=0
for FILE in $STAGED_FILES; do
  case "$FILE" in
    .env|.env.local|.env.production|.env.staging|.env.development|.env.test|.env.backup|*.env)
      printf "\\n  🚨 \\033[31mCOMMIT BLOCKED\\033[0m — SlickEnv: .env file staged\\n"
      printf "     File:  %s\\n" "$FILE"
      printf "     Fix:   Add .env to .gitignore, then slickenv push\\n\\n"
      BLOCKED=1
      ;;
  esac
  if command -v slickenv >/dev/null 2>&1; then
    CONTENT=$(git show ":$FILE" 2>/dev/null || true)
    if [ -n "$CONTENT" ]; then
      if echo "$CONTENT" | grep -qE 'sk_live_[0-9a-zA-Z]{24,}|AKIA[0-9A-Z]{16}|ghp_[0-9a-zA-Z]{36}|sk-ant-[a-zA-Z0-9-]{90,}|npm_[A-Za-z0-9]{36}'; then
        printf "\\n  🚨 \\033[31mCOMMIT BLOCKED\\033[0m — SlickEnv: Secret pattern detected\\n"
        printf "     File:  %s\\n" "$FILE"
        printf "     Run:   slickenv scan  for details\\n\\n"
        BLOCKED=1
      fi
    fi
  fi
done
if [ "$BLOCKED" -eq 1 ]; then exit 1; fi
exit 0
`;

      await mkdir(hooksDir, { recursive: true });
      await writeFile(hookPath, hookScript, 'utf8');
      await chmod(hookPath, 0o755);
      await execFileAsync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: dir });
      this.log(`  ${colors.success(symbols.success)}  Pre-commit hook installed ${chalk.dim('(repo-managed via .githooks/pre-commit)')}`);
    } catch {
      this.log(`  ${colors.warning(symbols.warning)}  Could not install pre-commit hook — run ${colors.highlight('slickenv git protect')} manually`);
    }

    // Quick git scan (count only, not full output)
    try {
      const { execFile: ef2 } = await import('node:child_process');
      const { promisify: p2 } = await import('node:util');
      const execFileAsync2 = p2(ef2);
      const { stdout } = await execFileAsync2('git', ['log', '--all', '--oneline'], { cwd: dir, timeout: 10000 });
      const commitCount = stdout.trim().split('\n').filter(Boolean).length;
      if (commitCount > 0) {
        this.log(`  ${chalk.dim('→')}  ${commitCount} commits in history — run ${colors.highlight('slickenv git scan')} for full audit`);
      }
    } catch { /* git not available or no commits */ }
  }

  private async runAiSafety(dir: string): Promise<void> {
    this.log(`  ${chalk.dim('→')}  Setting up AI safety...`);

    // Detect AI tools
    const aiTools: { name: string; dir: string; ignoreFile: string }[] = [
      { name: 'Cursor', dir: '.cursor', ignoreFile: '.cursorignore' },
      { name: 'Claude Code', dir: '.claude', ignoreFile: '.claudeignore' },
      { name: 'Windsurf', dir: '.windsurf', ignoreFile: '.windsurfignore' },
      { name: 'Continue.dev', dir: '.continue', ignoreFile: '.continuerc' },
    ];

    const ignoreContent = `# SlickEnv — AI Tool Secret Protection
.env
.env.*
*.env
.env.local
.env.production
.env.staging
*.pem
*.key
*credentials*
*secret*
.cursor/mcp.json
claude_desktop_config.json
.claude/config.json
mcp.json
`;

    // Always create these
    const alwaysCreate = ['.cursorignore', '.claudeignore', '.copilotignore', '.aiexclude'];
    let created = 0;

    for (const ignoreFile of alwaysCreate) {
      try {
        await writeFile(join(dir, ignoreFile), ignoreContent, 'utf8');
        created++;
      } catch { /* skip */ }
    }

    const detected: string[] = [];
    for (const tool of aiTools) {
      try {
        await access(join(dir, tool.dir));
        detected.push(tool.name);
      } catch { /* not detected */ }
    }

    if (detected.length > 0) {
      this.log(`  ${colors.success(symbols.success)}  ${created} AI ignore files created ${chalk.dim(`(detected: ${detected.join(', ')})`)}`);
    } else {
      this.log(`  ${colors.success(symbols.success)}  ${created} AI ignore files created ${chalk.dim('(protects Cursor, Claude Code, Copilot, Windsurf)')}`);
    }
    this.log(`  ${chalk.dim('→')}  Run ${colors.highlight('slickenv ai status')} to verify protection`);
  }

  /**
   * Check for a valid token; if missing or expired, run the browser login flow inline.
   */
  private async ensureAuth(): Promise<void> {
    const existing = await resolveToken();
    if (existing && !isExpired(existing)) {
      this.authToken = existing;
      return;
    }

    this.log("");
    this.log(`  ${colors.info("No active session — launching browser login...")}`);
    this.log("");

    const token = await this.waitForAuthCallback();
    await storeToken(token);

    try {
      const client = createApiClient(undefined, token);
      await client.mutation("users:ensureUser" as any);
    } catch {
      // Will retry on next command if user sync fails
    }

    this.authToken = token;
    this.log(`  ${colors.success(symbols.success)}  ${chalk.bold("Logged in successfully.")}`);
    this.log("");
  }

  private async waitForAuthCallback(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const connections = new Set<import("node:net").Socket>();

      const timeout = setTimeout(() => {
        for (const conn of connections) conn.destroy();
        server.close();
        reject(new Error("Authentication timed out. Please try again."));
      }, AUTH_TIMEOUT_MS);

      const server = createServer((req, res) => {
        const url = new URL(req.url ?? "/", `http://localhost:${CALLBACK_PORT}`);

        if (url.pathname === "/callback") {
          const token = url.searchParams.get("token");
          if (token) {
            res.writeHead(200, { "Content-Type": "text/html", "Connection": "close" });
            res.end("<html><body style=\"font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#0a0a0a;color:#fafafa\"><div style=\"text-align:center\"><h1>Authenticated</h1><p>You can close this window and return to your terminal.</p></div></body></html>", () => {
              clearTimeout(timeout);
              for (const conn of connections) conn.destroy();
              server.close(() => resolve(token));
            });
          } else {
            res.writeHead(400, { "Content-Type": "text/plain" });
            res.end("Missing token parameter.");
          }
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      server.on("connection", (conn) => {
        connections.add(conn);
        conn.on("close", () => connections.delete(conn));
      });

      server.listen(CALLBACK_PORT, () => {
        const authBase = process.env.SLICKENV_AUTH_URL ?? "https://env.slickspender.com";
        const authUrl = `${authBase}/login?callback=http://localhost:${CALLBACK_PORT}/callback`;
        this.openBrowser(authUrl);
      });

      server.on("error", (err) => {
        clearTimeout(timeout);
        reject(new Error(`Could not start auth server on port ${CALLBACK_PORT}: ${err.message}`));
      });
    });
  }

  private openBrowser(url: string): void {
    const { platform } = process;
    const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
    exec(`${cmd} "${url}"`);
    this.log(`  If the browser doesn't open, visit:`);
    this.log(`  ${chalk.underline.cyan(url)}`);
    this.log("");
  }
}
