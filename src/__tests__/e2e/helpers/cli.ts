import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const BIN_PATH = join(import.meta.dir, "../../../../bin/run.js");
const TOKEN_FILE = join(homedir(), ".slickenv", "token");

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Spawn the CLI binary as a subprocess and capture output.
 */
export async function runCli(
  args: string[],
  options?: {
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
  }
): Promise<CliResult> {
  const timeout = options?.timeout ?? 30_000;
  const token = getToken();

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    NO_COLOR: "1",
    ...(token ? { SLICKENV_TOKEN: token } : {}),
    ...options?.env,
  };

  const proc = Bun.spawn(["bun", "run", BIN_PATH, ...args], {
    cwd: options?.cwd ?? process.cwd(),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const timer = setTimeout(() => proc.kill(), timeout);

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;
  clearTimeout(timer);

  return { stdout, stderr, exitCode };
}

/**
 * Read token from ~/.slickenv/token.
 */
function getToken(): string | undefined {
  try {
    const token = readFileSync(TOKEN_FILE, "utf8").trim();
    return token || undefined;
  } catch {
    return undefined;
  }
}

/**
 * True if a valid token file exists — used for describe.skipIf.
 */
export const hasToken: boolean = (() => {
  try {
    const token = readFileSync(TOKEN_FILE, "utf8").trim();
    return token.length > 0;
  } catch {
    return false;
  }
})();

/**
 * Get token or throw — call this in beforeAll to fail fast.
 */
export function requireToken(): string {
  const token = getToken();
  if (!token) {
    throw new Error("Not logged in. Run `slickenv login` first, then re-run the tests.");
  }
  return token;
}
