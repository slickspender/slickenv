# Changelog

All notable changes to this project will be documented in this file.

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
