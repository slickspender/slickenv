# Changelog

All notable changes to this project will be documented in this file.

## [1.2.001] - 2026-03-30

### `slickenv login`
- Opens the dashboard (`/dashboard`) in the browser automatically after successful authentication

### `slickenv scan`
- Silently stores scan results to the dashboard after every file scan when the user is authenticated
- No extra flags required — runs in the background and never blocks or errors visible output
- Results appear in the dashboard under the project's security overview once linked via `.slickenv` config

## [1.2.000] - 2026-03-29

### `slickenv init` — Security Wizard
- Interactive security setup menu on `init`: choose Recommended (all three), Scan only, Git only, AI only, Custom, or Skip
- `--security <profile>` flag: `recommended`, `all`, `scan`, `git`, `ai`, `none`
- `--yes` / `-y` — accept recommended setup (scan + git + AI) without prompting
- Individual flags: `--scan`, `--git-safety`, `--ai-safety`, `--full-setup`, `--skip-setup`
- Writes `.slickenv/reports/init-setup.md` with a summary of what was enabled and recommended next steps
- Inline auth: if no session exists, `init` launches browser login automatically instead of failing

### `slickenv scan` — Expanded Scanner
- `--severity <level>` — filter output to `CRITICAL`, `HIGH`, `WARNING`, or `INFO`
- `--dir <path>` — scan a specific directory instead of cwd
- `--ai-generated` — extra pattern pass for AI-generated secrets: hardcoded key literals, `NEXT_PUBLIC_` with secret-looking values, `process.env.X || "fallback"`, secrets in comments, `console.log` with sensitive keys
- `--fix` — prints fix guidance alongside each finding
- Auto scan report: when findings reach 25 or more, a full Markdown report is saved to `.slickenv/reports/scan-<timestamp>.md`
- Fixture/test path detection: findings inside `__tests__/`, `fixtures/`, `examples/`, `docs/`, `.spec.ts`, `.test.ts` are labelled as likely non-production to reduce false-positive noise
- Progress indicator shows files scanned in real time (cleared on completion)

### `slickenv git scan` — History Scan Upgrades
- `--branch <name>` — limit scan to a single branch instead of all branches
- `--ci` — output full findings as JSON (structured for CI pipelines)
- `--limit <n>` — cap findings shown (default 50)
- Patch diff scanning: now also parses `git log -p` diffs so secrets deleted from HEAD but still present in older commits are caught
- `isInHead` field: each finding is marked if the same secret is still present in the current HEAD

### `slickenv git protect` — Repo-Managed Hooks
- Hook now installs to `.githooks/pre-commit` (tracked in the repo) instead of `.git/hooks/`
- Auto-configures `git config core.hooksPath .githooks` so the hook applies immediately without manual setup
- `--uninstall` flag — removes the SlickEnv pre-commit hook and unsets `core.hooksPath`
- Auto-updates `.gitignore` with `.env`, `.env.*`, and `*.env` entries on install

### `slickenv ai protect` — Broader Tool Coverage + New Flags
- Now generates ignore files for **Windsurf** (`.windsurfignore`) and **Continue.dev** (`.continuerc.json` with `fileExcludePatterns`)
- `--dry-run` — preview which files would be created without writing anything
- `--append` — merge SlickEnv patterns into existing ignore files instead of overwriting
- `--dir <path>` — run against a specific directory
- Idempotency: files already containing the SlickEnv header are skipped unless `--append` is passed
- 18 standard patterns covering `.env` variants, credential files, MCP configs, key files, and backup env files

### `slickenv ai status` — More Tools + Secret Reference Analysis
- Now detects and reports on **Windsurf**, **JetBrains AI** (`.idea` / `.junie/guidelines.md`), and **Cline/RooCode** (`.roo` / `.cline` → `.clinerules`)
- Multi-path detection: tools with multiple possible config locations (e.g. Cline/RooCode) are found regardless of which path is used
- Secret reference analysis: shows how many keys in `.env` use `slickenv://` references vs still storing plaintext values
- Fixed-width table columns for consistent alignment at all terminal widths

---

## [1.1.000] - 2026-03-27

### Secret Scanner
- `slickenv scan` — 53-pattern secret detection engine covering AWS, Stripe, GitHub, OpenAI, Anthropic, JWT, database URLs, private keys, and more
- Flags: `--files`, `--git`, `--mcp`, `--ai-generated`, `--ci`, `--fix`, `--severity`
- Security score 0–100 with severity breakdown (critical / high / medium / info)
- Scans files, git-tracked paths, MCP config files, and AI-generated code in one command

### Git History Protection
- `slickenv git scan` — searches entire commit history for exposed secrets using all 53 patterns
- `slickenv git audit` — visual timeline of secret-containing commits with author, date, hash
- `slickenv git clean` — guided BFG Repo-Cleaner wrapper: backup → clean → gc → force-push instructions
- `slickenv git protect` — installs pre-commit hook that blocks secrets before they enter git history

### AI Safety Layer
- `slickenv ai protect` — generates `.cursorignore`, `.claudeignore`, `.copilotignore`, `.aiexclude`
- `slickenv ai status` — shows which AI coding tools are protected and which ignore files exist
- `slickenv://KEY` reference system — AI tools and logs never see real values

### Secret Reference Runtime
- `slickenv run -- <command>` — resolves `slickenv://KEY` references at runtime
- Values exist only in process memory — never written to disk, logs, or environment files

### Env Linter
- 11 lint rules run silently on every `push` and `pull`
- 4 errors (block push): lowercase key enforcement, duplicate keys, unquoted values with spaces, invalid format
- 5 warnings: empty values, excessively long values, missing `.env.example` entry, suspicious value patterns
- 2 info: key naming conventions, annotation suggestions

### Smart Init
- `slickenv init` now auto-scans source files for `process.env.X` references and lists any keys not yet present in `.env`
- Interactive security wizard: choose Scan, Git Safety, AI Safety, or All of the Above

### Encrypted Share Links
- `slickenv share --link` — AES-256-GCM encrypted, one-time self-destructing share links
- Flags: `--expires` (duration), `--reads` (max reads), `--password` (optional passphrase)
- Per-link encryption key — server never holds plaintext values

---

## [1.0.125] - 2026-03-15

### Added
- Public GitHub repository at [github.com/SlickSpender/slickenv](https://github.com/SlickSpender/slickenv)
- MIT license
- Community files (Contributing, Code of Conduct, Security Policy)
- Automated npm publishing via GitHub Actions with provenance
- GitHub Releases with auto-generated notes

### Changed
- Badge colors in README for better visual distinction
- Standalone TypeScript configuration (no longer depends on monorepo root)

## [1.0.124] - 2026-03-14

### Added
- Comment preservation in `.env` files during push — existing comments are no longer overwritten
- Metadata annotations are only injected above variables that don't already have them
- Backend hardening: rate limiting, input validation, plan enforcement across all Convex functions

### Changed
- Improved CLI output with colored formatting and status symbols
- README redesign with badges, security table, and CI/CD section

## [1.0.0] - 2026-02-01

### Added
- Initial release
- Core commands: `login`, `logout`, `init`, `push`, `pull`, `status`
- Version management: `versions`, `diff`, `rollback`
- Team management: `members list`, `members invite`, `members remove`
- Sharing: `share`, `export`
- AES-256-GCM client-side encryption
- OS keychain token storage with file fallback
- Browser-based OAuth authentication via Clerk
