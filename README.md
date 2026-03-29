<div align="center">

# SlickEnv

**Secret lifecycle security for developers.**

Scan → Protect → Sync → Rotate → Retire

[![npm version](https://img.shields.io/npm/v/slickenv?color=4ade80&labelColor=18181b&style=flat-square)](https://www.npmjs.com/package/slickenv)
[![npm downloads](https://img.shields.io/npm/dm/slickenv?color=60a5fa&labelColor=18181b&style=flat-square)](https://www.npmjs.com/package/slickenv)
[![License: MIT](https://img.shields.io/badge/License-MIT-f472b6?labelColor=18181b&style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-≥18-fb923c?labelColor=18181b&style=flat-square)](https://nodejs.org)

[Website](https://env.slickspender.com) · [Docs](https://env.slickspender.com/docs) · [Changelog](https://env.slickspender.com/changelog)

</div>

---

SlickEnv is a CLI-first tool for secret lifecycle security. It helps you find exposed secrets, clean git history, protect projects from AI tool leakage, sync encrypted `.env` files, share them safely, and rotate credentials with less risk.

## Highlights

- 53 built-in secret patterns for files, git history, MCP configs, and AI-generated code
- Pre-commit protection and guided git-history cleanup
- AI-tool protection via generated ignore files and `slickenv://` runtime references
- Encrypted sync, version history, rollback, and team sharing
- Built-in rotation flows and age tracking for stale credentials

## What It Does

### 1. Scan & Detect
Find secrets before attackers do. SlickEnv's 53-pattern engine scans your files, entire git history, MCP config files, and AI-generated code.

```bash
slickenv scan               # scan files in the current project
slickenv scan --git         # scan git history only
slickenv scan --mcp         # scan MCP config files
slickenv scan --ci          # exit 1 on critical findings (for CI pipelines)
```

### 2. Protect & Control
Stop secrets from leaking — now and in the future.

```bash
slickenv git protect        # install pre-commit hook (blocks secrets at commit time)
slickenv ai protect         # generate .cursorignore, .claudeignore, .copilotignore
slickenv git clean          # guided BFG cleanup of git history
```

### 3. Sync & Rotate
Push encrypted `.env` files to the cloud. Roll back to any version. Rotate secrets with zero downtime.

```bash
slickenv push               # encrypt and push to remote (with lint check)
slickenv pull               # pull latest version
slickenv rotate STRIPE_KEY  # zero-downtime rotation with dual-active window
```

## Available Today

| Area | What you can use now |
|------|-----------------------|
| Secret scanning | `slickenv scan`, `slickenv scan --git`, `slickenv scan --mcp`, `slickenv scan --ai-generated`, `slickenv scan --ci` |
| Git protection | `slickenv git scan`, `slickenv git audit`, `slickenv git clean`, `slickenv git protect` |
| AI safety | `slickenv ai protect`, `slickenv ai status`, `slickenv run -- <cmd>` |
| Env sync | `slickenv push`, `slickenv pull`, `slickenv status`, `slickenv diff`, `slickenv versions`, `slickenv rollback` |
| Sharing and teams | `slickenv share`, `slickenv members list|invite|remove` |
| Rotation | `slickenv rotate`, rotation age tracking in `slickenv status` |

## Coming Soon

These are planned and actively being worked on. They are not fully available in the package today.

| Feature | Status |
|---------|--------|
| Share link recipient page | Open encrypted share links in the browser and redeem them without CLI-only handoff |
| `slickenv scan --fix` interactive remediation | Guided fix flow for findings instead of scan-only output |
| Security overview dashboard | Browser view for security score, recent findings, and project health |
| Git history timeline | Visual commit-by-commit view of past secret exposures |
| AI exposure monitor | Dashboard view showing which projects and tools are still exposed to AI agents |
| Audit log and drift monitor | Track who changed what and compare staging vs production over time |
| Vercel and AWS rotation adapters | Extend built-in rotation beyond Stripe and GitHub |
| Rotation health checks | Automatic post-rotation verification for safer zero-downtime rollouts |

---

## Installation

```bash
npm install -g slickenv
```

**Requirements:** Node.js ≥ 18

---

## Quick Start

```bash
# 1. Initialise project (includes auth + security wizard)
slickenv init

# 2. Scan for exposed secrets
slickenv scan

# 3. Protect from AI tools and future commits
slickenv ai protect
slickenv git protect

# 4. Push encrypted .env to remote
slickenv push

# 5. Check drift and secret age
slickenv status
```

---

## Commands

### Core Sync

| Command | Description |
|---------|-------------|
| `slickenv init` | Initialise a project (with smart source-code scan + security wizard) |
| `slickenv login` | Authenticate via browser OAuth (GitHub or Google) |
| `slickenv logout` | Sign out and remove stored credentials |
| `slickenv push` | Push local `.env` to remote — encrypted, versioned, and linted |
| `slickenv pull` | Pull latest version from remote |
| `slickenv status` | Compare local vs remote (includes rotation age tracking) |
| `slickenv diff` | Show added, removed, and modified variables |
| `slickenv versions` | List version history |
| `slickenv rollback <v>` | Roll back to a previous version |
| `slickenv export` | Generate `.env.example` with values masked |
| `slickenv share` | View or share env variables, including encrypted one-time links |
| `slickenv run -- <cmd>` | Run a command with `slickenv://KEY` references resolved |

### Secret Scanner

```bash
slickenv scan [flags]
```

| Flag | Description |
|------|-------------|
| `--files` | Scan files only and skip git-history mode |
| `--git` | Scan git history only and skip file scanning |
| `--mcp` | Scan MCP config files (mcp.json, .mcp/) |
| `--ai-generated` | Extra pass for AI-generated hardcoded secrets in .ts/.js/.py files |
| `--ci` | Output machine-readable JSON for CI/CD pipelines |
| `--fix` | Show fix guidance alongside each finding |
| `--severity` | Filter output: `CRITICAL`, `HIGH`, `WARNING`, `INFO` |
| `--dir` | Scan a specific directory instead of cwd |

### Git History Protection

| Command | Description |
|---------|-------------|
| `slickenv git scan` | Search entire commit history for exposed secrets (53 patterns) |
| `slickenv git audit` | Visual timeline of commits containing secrets |
| `slickenv git clean` | Guided BFG Repo-Cleaner: backup → clean → gc → force-push |
| `slickenv git protect` | Install repo-managed pre-commit hook (`.githooks/`) that blocks secret commits |
| `slickenv git protect --uninstall` | Remove the SlickEnv pre-commit hook |

`slickenv git scan` flags:

| Flag | Description |
|------|-------------|
| `--branch <name>` | Scan only this branch instead of all branches |
| `--ci` | Output findings as JSON for CI pipelines |
| `--limit <n>` | Cap number of findings shown (default 50) |

### AI Safety

| Command | Description |
|---------|-------------|
| `slickenv ai protect` | Generate `.cursorignore`, `.claudeignore`, `.copilotignore`, `.aiexclude` |
| `slickenv ai status` | Show which AI tools are protected in this project |

### Secret Rotation

```bash
slickenv rotate <KEY> [flags]
```

| Flag | Description |
|------|-------------|
| `--key, -k` | The env variable key to rotate |
| `--service` | Force adapter: `stripe`, `github` (auto-detected by default) |
| `--yes, -y` | Skip confirmation prompt |
| `--dry-run` | Validate current key without executing rotation |

### Team Management

| Command | Description |
|---------|-------------|
| `slickenv members list` | List all project members and their roles |
| `slickenv members invite <email>` | Invite a team member |
| `slickenv members remove <email>` | Remove a team member |

---

## The slickenv:// Reference System

Instead of putting real secrets in your code or config files, use `slickenv://` references. The `slickenv run` command resolves them at runtime — values exist only in the child process environment, never on disk.

```bash
# In your app config or environment file:
DATABASE_URL=slickenv://DATABASE_URL
STRIPE_KEY=slickenv://STRIPE_KEY

# At runtime:
slickenv run -- node server.js
slickenv run -- npm run dev
```

---

## Metadata Annotations

Tag `.env` variables with metadata using inline comments:

```bash
# @visibility public
# @type url
# @required true
# @example https://example.com
DATABASE_URL=postgres://localhost:5432/myapp

# @visibility private
# @type secret
STRIPE_SECRET_KEY=sk_live_...
```

Supported tags: `@visibility` (public/private), `@type` (string/number/url/secret/boolean), `@required` (true/false), `@example <value>`

---

## Env Linter

The env linter runs automatically on every `push` and `pull`. It checks 11 rules silently and only surfaces issues when they affect your workflow.

**Errors** (block push):
- Lowercase variable names
- Duplicate keys
- Values with unquoted spaces
- Invalid `.env` format

**Warnings** (shown, don't block):
- Empty values
- Values over 4000 characters
- Key present in `.env` but missing from `.env.example`
- Suspicious-looking plaintext secrets

**Info:**
- Key naming convention suggestions
- Missing metadata annotation suggestions

---

## Package Scope

SlickEnv is intentionally focused on environment-variable security and workflows. It is not trying to replace a full enterprise secrets platform, cloud deployment system, or general-purpose vault. The package is strongest when you want CLI-first scanning, protection, sync, and rotation around `.env` files.

---

## Security Model

| Layer | Mechanism |
|-------|-----------|
| Encryption at rest | AES-256-GCM, client-side before upload |
| Encryption in transit | TLS 1.3 |
| Key derivation | PBKDF2-SHA256 (per-user, per-project) |
| Auth token storage | OS system keychain (macOS Keychain, Linux Secret Service) |
| Server model | Zero-knowledge — server stores only ciphertext |
| Pre-commit protection | 53-pattern hook blocks secrets before `git commit` |
| AI tool protection | `.aiignore` files prevent Cursor/Claude/Copilot from reading `.env` |
| Share link encryption | Per-link AES-256-GCM key, one-time self-destruct |

---

## CI/CD Integration

Use a `SLICKENV_TOKEN` environment variable for non-interactive authentication in CI:

```yaml
# GitHub Actions
- name: Pull env
  env:
    SLICKENV_TOKEN: ${{ secrets.SLICKENV_TOKEN }}
  run: slickenv pull

# With secret scanning in CI
- name: Scan for secrets
  env:
    SLICKENV_TOKEN: ${{ secrets.SLICKENV_TOKEN }}
  run: slickenv scan --ci   # exits 1 if critical/high findings
```

Generate a token: `slickenv login` stores it in your keychain. Copy it from there or use `SLICKENV_TOKEN` directly with a long-lived token from the dashboard.

---

## License

MIT © [SlickSpender](https://github.com/SlickSpender)
