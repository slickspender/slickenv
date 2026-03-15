# Contributing to SlickENV

Thanks for your interest in contributing! Here's how to get started.

## Getting Started

1. **Fork** the repository
2. **Clone** your fork locally
3. **Install** dependencies:
   ```bash
   bun install
   ```
4. **Build** the project:
   ```bash
   bun run build
   ```
5. **Run tests:**
   ```bash
   bun test src/lib/__tests__/
   ```

## Development

SlickENV is built with:
- **Runtime**: Bun
- **CLI framework**: oclif 4.x
- **Language**: TypeScript (strict mode)

### Project Structure

```
├── src/
│   ├── commands/       # CLI commands (oclif)
│   ├── lib/            # Core logic (parser, crypto, config, api)
│   └── base-command.ts # Base class for all commands
├── types/              # Shared TypeScript types
├── bin/                # CLI entry point
└── dist/               # Build output
```

### Running Locally

```bash
# Run a command directly during development
bun run ./bin/dev.js <command>

# Example
bun run ./bin/dev.js push -m "test"
```

## Submitting Changes

1. Create a feature branch: `git checkout -b feat/my-feature`
2. Make your changes
3. Run tests: `bun test src/lib/__tests__/`
4. Run typecheck: `bun run typecheck`
5. Commit with a descriptive message
6. Push and open a Pull Request

## Commit Messages

Use conventional commit style:
- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation
- `refactor:` code change that neither fixes a bug nor adds a feature
- `test:` adding or updating tests

## Reporting Bugs

Open an issue at [github.com/SlickSpender/slickenv/issues](https://github.com/SlickSpender/slickenv/issues) with:
- Steps to reproduce
- Expected vs actual behavior
- CLI version (`slickenv --version`)
- OS and Node.js version

## Code of Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
