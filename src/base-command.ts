import { Command, Flags } from "@oclif/core";
import type { SlickEnvConfig } from "@slickenv/types";
import { loadConfig } from "./lib/config.js";
import { getValidToken } from "./lib/auth.js";
import { colors, symbols } from "./lib/output.js";
import { ConfigError, AuthError, ParseError, ApiRequestError } from "./lib/errors.js";

export abstract class BaseCommand extends Command {
  /** Override to false in commands that don't need a .slickenv config (login, init) */
  protected requiresConfig = true;

  /** Override to false in commands that don't need auth (login) */
  protected requiresAuth = true;

  protected slickenvConfig!: SlickEnvConfig;
  protected authToken!: string;

  static baseFlags = {
    json: Flags.boolean({
      description: "Output as JSON",
      default: false,
    }),
    "no-color": Flags.boolean({
      description: "Disable colour output",
      default: false,
    }),
    verbose: Flags.boolean({
      description: "Show additional debug information",
      default: false,
    }),
  };

  async init(): Promise<void> {
    await super.init();

    if (this.requiresConfig) {
      try {
        this.slickenvConfig = await loadConfig();
      } catch (error) {
        this.fail(this.extractMessage(error));
      }
    }

    if (this.requiresAuth) {
      try {
        this.authToken = await getValidToken();
      } catch (error) {
        this.fail(this.extractMessage(error));
      }
    }
  }

  // ── Output Helpers ───────────────────────────────────────────────

  protected success(msg: string): void {
    this.log(`${colors.success(symbols.success)}  ${msg}`);
  }

  protected info(msg: string): void {
    this.log(`${colors.info(symbols.info)}  ${msg}`);
  }

  protected warning(msg: string): void {
    this.log(`${colors.warning(symbols.warning)}  ${msg}`);
  }

  protected fail(msg: string): never {
    this.log(`${colors.error(symbols.error)}  ${msg}`);
    this.exit(1);
  }

  // ── Error Handling ─────────────────────────────────────────────

  /**
   * Extract a user-friendly message from any error type.
   * Handles: ConfigError, AuthError, Convex ConvexError, ParseError, ApiRequestError,
   * standard Error, and unknown objects.
   */
  private extractMessage(error: unknown): string {
    if (error instanceof ConfigError || error instanceof AuthError) {
      return error.message;
    }

    if (error instanceof ParseError) {
      return error.line
        ? `Parse error on line ${error.line}: ${error.message}`
        : error.message;
    }

    if (error instanceof ApiRequestError) {
      return error.message;
    }

    // Convex ConvexError — has { data: { message: string } }
    if (error && typeof error === "object") {
      const err = error as Record<string, any>;
      if (err.data?.message && typeof err.data.message === "string") {
        return err.data.message;
      }
    }

    if (error instanceof Error) {
      // Filter out unhelpful raw error messages
      const msg = error.message;
      if (msg.includes("fetch failed") || msg.includes("ECONNREFUSED")) {
        return "Could not reach the SlickEnv server. Check your internet connection and try again.";
      }
      if (msg.includes("EACCES") || msg.includes("permission denied")) {
        return `Permission denied: ${msg.replace(/.*permission denied,?\s*/, "")}`;
      }
      if (msg.includes("ENOENT")) {
        return `File not found: ${msg.replace(/.*ENOENT:?\s*(no such file or directory,?\s*)?/, "")}`;
      }
      if (msg.includes("Unsupported state or unable to authenticate data")) {
        return "Decryption failed. The encryption key may have changed — try re-initialising with `slickenv init`.";
      }
      return msg;
    }

    if (typeof error === "string") {
      return error;
    }

    return "An unexpected error occurred.";
  }

  protected catch(error: Error & { exitCode?: number }): Promise<unknown> {
    // oclif uses exitCode 0 for help/version — don't intercept those
    if (error.exitCode === 0) {
      return super.catch(error);
    }

    const message = this.extractMessage(error);
    this.log(`${colors.error(symbols.error)}  ${message}`);

    // In verbose mode, show the full error for debugging
    const flags = (this as any).flags ?? {};
    if (flags.verbose && error instanceof Error && error.stack) {
      this.log(`\n${colors.info(error.stack)}`);
    }

    return this.exit(1);
  }
}
