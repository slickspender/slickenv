import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { SlickEnvConfig, GlobalConfig } from "@slickenv/types";
import { ConfigError } from "./errors.js";

export const CONFIG_FILENAME = ".slickenv";
const GLOBAL_CONFIG_DIR = join(homedir(), ".slickenv");
const GLOBAL_CONFIG_FILE = join(GLOBAL_CONFIG_DIR, "config.json");

/**
 * Walk up from `startDir` looking for a .slickenv config file.
 * Returns the directory containing it, or null if not found.
 */
export async function findConfigDir(startDir?: string): Promise<string | null> {
  let dir = startDir ?? process.cwd();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await readFile(join(dir, CONFIG_FILENAME), "utf8");
      return dir;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) return null; // reached filesystem root
      dir = parent;
    }
  }
}

/**
 * Load the .slickenv config from the current or parent directory.
 * Throws ConfigError if not found or invalid.
 */
export async function loadConfig(startDir?: string): Promise<SlickEnvConfig> {
  const configDir = await findConfigDir(startDir);

  if (!configDir) {
    throw new ConfigError(
      "No .slickenv config found.\nRun `slickenv init` to set up this project."
    );
  }

  try {
    const raw = await readFile(join(configDir, CONFIG_FILENAME), "utf8");
    const parsed = JSON.parse(raw) as SlickEnvConfig;

    if (!parsed.projectId || !parsed.projectName || !parsed.apiUrl) {
      throw new ConfigError(
        "Your .slickenv config file appears to be corrupted or invalid.\nTo fix: delete .slickenv and run `slickenv init` to re-link this project."
      );
    }

    return parsed;
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError(
      "Your .slickenv config file appears to be corrupted or invalid.\nTo fix: delete .slickenv and run `slickenv init` to re-link this project."
    );
  }
}

/**
 * Write a .slickenv config file to the given directory.
 */
export async function writeConfig(config: SlickEnvConfig, dir: string): Promise<void> {
  const content = JSON.stringify(config, null, 2) + "\n";
  await writeFile(join(dir, CONFIG_FILENAME), content, "utf8");
}

/**
 * Load global CLI config from ~/.slickenv/config.json.
 * Returns empty config if file doesn't exist.
 */
export async function loadGlobalConfig(): Promise<GlobalConfig> {
  try {
    const raw = await readFile(GLOBAL_CONFIG_FILE, "utf8");
    return JSON.parse(raw) as GlobalConfig;
  } catch {
    return {};
  }
}
