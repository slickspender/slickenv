import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Create an isolated temp directory for a test run.
 */
export async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "slickenv-e2e-"));
}

/**
 * Remove a temp directory and all its contents.
 */
export async function removeTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
