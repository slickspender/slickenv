import chalk from "chalk";
import { createInterface } from "node:readline";
import type { Variable } from "@slickenv/types";

// ── Status Symbols ───────────────────────────────────────────────────

export const symbols = {
  success: "✓",
  warning: "⚠",
  error: "✗",
  info: "→",
  unchanged: "·",
  modified: "~",
  added: "+",
  removed: "-",
  bullet: "●",
} as const;

// ── Color Helpers ────────────────────────────────────────────────────

export const colors = {
  success: chalk.hex("#00E5A0"),
  warning: chalk.hex("#F5A623"),
  error: chalk.hex("#FF4D4D"),
  info: chalk.dim,
  key: chalk.bold.white,
  value: chalk.dim.white,
  privateValue: chalk.dim.gray,
  version: chalk.cyan,
  email: chalk.dim.italic,
  timestamp: chalk.dim.gray,
  brand: chalk.bold.hex("#16A34A"),
  label: chalk.dim,
  highlight: chalk.hex("#16A34A"),
  url: chalk.underline.cyan,
} as const;

// ── TTY Detection ────────────────────────────────────────────────────

export const isTTY = Boolean(process.stdout.isTTY && process.stdin.isTTY);

// ── Formatting Helpers ───────────────────────────────────────────────

export function header(project: string, env: string): string {
  return `  ${colors.brand("slickenv")} ${chalk.dim("/")} ${colors.key(project)} ${chalk.dim("/")} ${colors.highlight(env)}`;
}

export function divider(width = 40): string {
  return `  ${chalk.dim("─".repeat(width))}`;
}

export function dim(msg: string): string {
  return chalk.dim(msg);
}

// ── Masking ──────────────────────────────────────────────────────────

export function mask(): string {
  return "****";
}

export function displayVariable(variable: Pick<Variable, "key" | "value" | "visibility" | "isEncrypted">): string {
  if (variable.visibility === "private" || variable.isEncrypted) {
    return `${colors.key(variable.key)}${chalk.dim("=")}${colors.privateValue(mask())}`;
  }
  return `${colors.key(variable.key)}${chalk.dim("=")}${colors.value(variable.value)}`;
}

// ── Sanitize for Logging ─────────────────────────────────────────────

const SENSITIVE_KEYS = ["value", "password", "secret", "token", "key", "authorization"];

export function sanitizeForLogging(obj: unknown): unknown {
  if (typeof obj === "object" && obj !== null) {
    const sanitized = { ...(obj as Record<string, unknown>) };
    for (const key of Object.keys(sanitized)) {
      if (SENSITIVE_KEYS.includes(key.toLowerCase())) {
        sanitized[key] = "[REDACTED]";
      }
    }
    return sanitized;
  }
  return obj;
}

// ── Interactive Confirmation ─────────────────────────────────────────

export async function confirm(message: string): Promise<boolean> {
  if (!isTTY) {
    return false;
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise<boolean>((resolve) => {
    rl.question(`  ${message} ${chalk.dim("(y/N)")} `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}
