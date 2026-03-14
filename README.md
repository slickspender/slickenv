<p align="center">
  <img src="https://env.slickspender.com/icon.svg" alt="SlickENV" width="80" />
</p>

<h1 align="center">SlickENV</h1>

<p align="center">
  Securely manage, sync, and version <code>.env</code> files across your team - with end-to-end encryption.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/slickenv"><img src="https://img.shields.io/npm/v/slickenv?color=16A34A&label=npm" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/slickenv"><img src="https://img.shields.io/npm/dm/slickenv?color=16A34A" alt="npm downloads" /></a>
  <a href="https://github.com/SlickSpender/slickenv/blob/main/LICENSE"><img src="https://img.shields.io/github/license/SlickSpender/slickenv?color=16A34A" alt="license" /></a>
  <a href="https://github.com/SlickSpender/slickenv/actions/workflows/publish.yml"><img src="https://img.shields.io/github/actions/workflow/status/SlickSpender/slickenv/publish.yml?label=publish&color=16A34A" alt="publish" /></a>
  <a href="https://env.slickspender.com"><img src="https://img.shields.io/badge/docs-env.slickspender.com-16A34A" alt="docs" /></a>
</p>

---

### Why SlickENV?

> Sharing `.env` files over Slack, email, or sticky notes is insecure and error-prone. SlickENV gives your team a single source of truth with git-like version control and military-grade encryption.

- **End-to-end encrypted** — Private variables are encrypted client-side with AES-256-GCM before leaving your machine
- **Version history** — Every push creates an immutable version you can diff, rollback, or audit
- **Team sync** — Pull the latest environment from anywhere, always in sync
- **Role-based access** — Invite members as admin, member, or viewer
- **Zero knowledge** — The server stores only ciphertext and can never read your secrets

---

## Install

```bash
npm install -g slickenv
```

Or run directly without installing:

```bash
npx slickenv
```

**Requirements:** Node.js 18+

---

## Quick Start

```bash
# 1. Authenticate via browser
slickenv login

# 2. Initialize a project in your repo
slickenv init --name my-app

# 3. Push your .env to SlickEnv
slickenv push -m "Initial environment"

# 4. Pull from another machine or teammate
slickenv pull

# 5. Invite a teammate
slickenv members invite teammate@company.com --role member
```

---

## Commands

### Authentication

| Command | Description |
| --- | --- |
| `slickenv login` | Authenticate via browser OAuth (credentials stored in OS keychain) |
| `slickenv logout` | Revoke your token and clear local credentials |

### Project Setup

```bash
slickenv init --name my-app --env production
```

| Flag | Description | Default |
| --- | --- | --- |
| `--name` | Project name | Current directory name |
| `--env` | Default environment label | `production` |

### Push & Pull

#### `slickenv push`

Push local `.env` changes. Private variables are encrypted before upload.

```bash
slickenv push -m "Add Stripe keys" --yes
```

| Flag | Description | Default |
| --- | --- | --- |
| `--file` | Path to env file | `.env` |
| `--force` | Skip conflict check | `false` |
| `-m, --message` | Version description | — |
| `-y, --yes` | Auto-confirm prompts | `false` |

#### `slickenv pull`

Pull the latest (or a specific) version and write it to your local `.env`.

```bash
slickenv pull --version 3 --dry-run
```

| Flag | Description | Default |
| --- | --- | --- |
| `--version` | Pull a specific version | latest |
| `--dry-run` | Preview without writing to disk | `false` |
| `-y, --yes` | Auto-confirm overwrite | `false` |

#### `slickenv status`

Show what's different between your local `.env` and the remote version.

### Version History

#### `slickenv versions`

List version history for the current environment.

```bash
slickenv versions --limit 10
```

| Flag | Description | Default |
| --- | --- | --- |
| `--limit` | Number of versions to show | `20` |

#### `slickenv diff <version-a> <version-b>`

Show what changed between two versions.

```bash
slickenv diff 3 5
```

#### `slickenv rollback <version>`

Roll back to a previous version (non-destructive — creates a new version with the target's contents).

```bash
slickenv rollback 2 --yes
```

| Flag | Description | Default |
| --- | --- | --- |
| `-y, --yes` | Auto-confirm rollback | `false` |

### Sharing & Export

#### `slickenv share`

Generate a shareable view of the current environment. Private values are masked by default.

```bash
slickenv share                # masked private values
slickenv share --public-only  # public variables only
slickenv share --reveal       # show everything in plain text
```

| Flag | Description | Default |
| --- | --- | --- |
| `--public-only` | Show only public variables | `false` |
| `--reveal` | Show private values unmasked | `false` |

#### `slickenv export`

Generate a `.env.example` with metadata annotations. Public values are included; private values show only examples or placeholders.

```bash
slickenv export --out .env.example
```

| Flag | Description | Default |
| --- | --- | --- |
| `--out` | Output file path | `.env.example` |

### Team Management

#### `slickenv members list`

List all members of the current project with their roles.

```bash
slickenv members list
```

#### `slickenv members invite <email>`

Invite a user to the current project (they must already have a SlickEnv account).

```bash
slickenv members invite user@example.com --role admin
```

| Flag | Description | Options | Default |
| --- | --- | --- | --- |
| `--role` | Role to assign | `admin`, `member`, `viewer` | `member` |

**Roles:**
| Role | Permissions |
| --- | --- |
| **admin** | Full access including member management |
| **member** | Read and write access to environments |
| **viewer** | Read-only access |

#### `slickenv members remove <email>`

Remove a member from the current project.

```bash
slickenv members remove user@example.com
```

### Global Flags

Available on all commands:

| Flag | Description |
| --- | --- |
| `--json` | Output as JSON |
| `--no-color` | Disable colored output |
| `--verbose` | Show debug information |

---

## `.env` Metadata Annotations

Add metadata as comments above your variables to control encryption, type checking, and more:

```bash
# @visibility=public @type=string @required=true
APP_NAME=my-app

# @visibility=private @required=true @example=sk_live_xxx
STRIPE_SECRET_KEY=sk_live_abc123

# @visibility=public @type=number
PORT=3000
```

| Annotation | Values | Default |
| --- | --- | --- |
| `@visibility` | `public`, `private` | `private` |
| `@type` | `string`, `number`, `boolean` | `string` |
| `@required` | `true`, `false` | `false` |
| `@example` | Any value | — |

> **`private`** variables are encrypted client-side before syncing. **`public`** variables are stored as plaintext.

---

## CI/CD

Authenticate non-interactively using the `SLICKENV_TOKEN` environment variable:

```bash
export SLICKENV_TOKEN=your-token
slickenv pull --yes
```

Works with GitHub Actions, GitLab CI, CircleCI, and any CI/CD platform.

---

## Security

SlickEnv uses **client-side AES-256-GCM encryption** — private variables never leave your machine unencrypted.

| Layer | Detail |
| --- | --- |
| **Key derivation** | PBKDF2-SHA256 with 100,000 iterations |
| **Encryption** | AES-256-GCM with unique 12-byte IV per variable |
| **Auth tags** | 128-bit authentication tags for tamper detection |
| **Token storage** | OS keychain via keytar (chmod 600 file fallback) |
| **Server model** | Zero-knowledge — server stores only ciphertext |

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

<p align="center">
  <a href="https://env.slickspender.com">Documentation</a> &middot; <a href="https://github.com/SlickSpender/slickenv/issues">Report a Bug</a> &middot; <a href="https://github.com/SlickSpender/slickenv">GitHub</a> &middot; <a href="https://slickspender.com">SlickSpender</a>
</p>
