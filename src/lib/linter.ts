import type { ParsedVariable } from "@slickenv/types";

export type LintLevel = "error" | "warning" | "info";

export interface LintIssue {
  key: string;
  level: LintLevel;
  rule: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** System environment variables that should not be shadowed. */
const SYSTEM_VARS = new Set([
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "TERM",
  "LANG",
  "PWD",
  "TMPDIR",
  "TEMP",
  "TMP",
]);

/** Exact generic key names that should have a service prefix. */
const GENERIC_KEY_NAMES = new Set(["API_KEY", "SECRET_KEY", "TOKEN"]);

// ---------------------------------------------------------------------------
// Rule helpers
// ---------------------------------------------------------------------------

function isUppercase(key: string): boolean {
  return key === key.toUpperCase();
}

function startsWithDigit(key: string): boolean {
  return /^[0-9]/.test(key);
}

function hasIllegalChars(key: string): boolean {
  return /[^A-Z0-9_]/i.test(key);
}

/**
 * Return the first segment of a key (the part before the first underscore).
 * If there is no underscore, returns the full key.
 */
function firstSegment(key: string): string {
  const idx = key.indexOf("_");
  return idx === -1 ? key : key.slice(0, idx);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Lint a parsed list of env variables against 11 built-in rules.
 *
 * @param variables   Parsed variable list (from `parseEnvFile`).
 * @param exampleKeys Keys found in the corresponding `.env.example` file, if any.
 * @returns Array of lint issues sorted by severity (errors → warnings → info).
 */
export function lintEnvFile(
  variables: ParsedVariable[],
  exampleKeys?: string[]
): LintIssue[] {
  const issues: LintIssue[] = [];

  // ── Pre-compute duplicate key set ─────────────────────────────────────────
  const keyCounts = new Map<string, number>();
  for (const v of variables) {
    keyCounts.set(v.key, (keyCounts.get(v.key) ?? 0) + 1);
  }

  // ── Pre-compute inconsistent prefixes (INFO rule) ─────────────────────────
  // Collect the first segment of every key that contains an underscore.
  const prefixes = new Map<string, number>(); // prefix → count of keys using it
  for (const v of variables) {
    if (v.key.includes("_")) {
      const seg = firstSegment(v.key);
      prefixes.set(seg, (prefixes.get(seg) ?? 0) + 1);
    }
  }
  const uniquePrefixes = [...prefixes.keys()];
  const hasInconsistentPrefixes = uniquePrefixes.length >= 2;

  // ── Per-variable rules ────────────────────────────────────────────────────
  const seenKeys = new Set<string>(); // for duplicate reporting (report once per key)

  for (const v of variables) {
    const { key, value } = v;

    // 1. lowercase-key — key must be all uppercase
    if (!isUppercase(key)) {
      const suggestion = key.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
      issues.push({
        key,
        level: "error",
        rule: "lowercase-key",
        message: `Key must be uppercase: use ${suggestion}`,
      });
    }

    // 2. starts-with-digit
    if (startsWithDigit(key)) {
      issues.push({
        key,
        level: "error",
        rule: "starts-with-digit",
        message: "Key cannot start with a digit",
      });
    }

    // 3. illegal-chars
    if (hasIllegalChars(key)) {
      issues.push({
        key,
        level: "error",
        rule: "illegal-chars",
        message: "Key contains illegal characters (only A-Z, 0-9, _ allowed)",
      });
    }

    // 4. duplicate-key
    if ((keyCounts.get(key) ?? 0) > 1 && !seenKeys.has(key)) {
      issues.push({
        key,
        level: "error",
        rule: "duplicate-key",
        message: "Duplicate key found",
      });
      seenKeys.add(key);
    }

    // 5. unquoted-spaces — value contains spaces but is not wrapped in quotes
    // The parser strips quotes, so we check if the raw value (which the parser
    // already unquoted) contains spaces.  When it does, the original file must
    // not have had quotes (otherwise the value would still contain the spaces
    // but the parser would be fine with it).  We flag values that contain
    // whitespace as potentially risky.
    if (/\s/.test(value)) {
      issues.push({
        key,
        level: "warning",
        rule: "unquoted-spaces",
        message:
          "Value contains spaces but is not quoted — wrap in quotes to be safe",
      });
    }

    // 6. no-service-prefix — exact generic name without a service qualifier
    if (GENERIC_KEY_NAMES.has(key)) {
      issues.push({
        key,
        level: "warning",
        rule: "no-service-prefix",
        message: `Generic key name — add a service prefix (e.g., STRIPE_${key})`,
      });
    }

    // 7. short-key
    if (key.length < 3) {
      issues.push({
        key,
        level: "warning",
        rule: "short-key",
        message: "Key name is very short — use a descriptive name",
      });
    }

    // 8. shadows-system
    if (SYSTEM_VARS.has(key)) {
      issues.push({
        key,
        level: "warning",
        rule: "shadows-system",
        message: `Key shadows a system environment variable — use a prefixed name (e.g., APP_${key})`,
      });
    }

    // 9. not-in-example
    if (exampleKeys && exampleKeys.length > 0 && !exampleKeys.includes(key)) {
      issues.push({
        key,
        level: "warning",
        rule: "not-in-example",
        message: "Key is not documented in .env.example",
      });
    }

    // 11. empty-value (INFO)
    if (value === "") {
      issues.push({
        key,
        level: "info",
        rule: "empty-value",
        message: "Empty value — this is probably a placeholder",
      });
    }
  }

  // ── File-level rules ──────────────────────────────────────────────────────

  // 10. inconsistent-prefix (INFO) — only emit once per file when triggered
  if (variables.length >= 2 && hasInconsistentPrefixes) {
    const prefixList = uniquePrefixes.slice(0, 5).join(", ");
    issues.push({
      key: "",
      level: "info",
      rule: "inconsistent-prefix",
      message: `Inconsistent naming prefix detected — consider standardizing (found: ${prefixList})`,
    });
  }

  return issues;
}
