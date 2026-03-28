# Changelog

All notable changes to this project will be documented in this file.

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

### Secret Rotation Engine
- `slickenv rotate` — zero-downtime rotation with dual-active credential window
- Stripe and GitHub adapters built in; auto-detects service from key name
- `slickenv status` now shows rotation age with color-coded warnings (orange >180 days, red >365 days)

### Secret Reference Runtime
- `slickenv run -- <command>` — resolves `slickenv://KEY` references at runtime
- Values exist only in process memory — never written to disk, logs, or environment files

### Env Linter
- 11 lint rules run silently on every `push` and `pull`
- 4 errors (block push): lowercase key enforcement, duplicate keys, unquoted values with spaces, invalid format
- 5 warnings: empty values, excessively long values, missing `.env.example` entry, suspicious value patterns
- 2 info: key naming conventions, annotation suggestions

### Smart Init
- `slickenv init` now auto-scans source files for `process.env.X` references and pre-populates `.env` with detected keys
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
