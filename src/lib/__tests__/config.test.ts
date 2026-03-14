import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeFile, readFile } from "node:fs/promises";
import { findConfigDir, loadConfig, writeConfig, CONFIG_FILENAME } from "../config.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "slickenv-config-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

const validConfig = {
  version: 1,
  projectId: "proj_123",
  projectName: "test-project",
  defaultEnvironment: "production",
  apiUrl: "https://apienv.slickspender.com",
};

describe("findConfigDir", () => {
  test("returns null when no config exists", async () => {
    const result = await findConfigDir(tempDir);
    expect(result).toBeNull();
  });

  test("finds config in the given directory", async () => {
    await writeFile(join(tempDir, CONFIG_FILENAME), JSON.stringify(validConfig));
    const result = await findConfigDir(tempDir);
    expect(result).toBe(tempDir);
  });

  test("finds config in a parent directory", async () => {
    await writeFile(join(tempDir, CONFIG_FILENAME), JSON.stringify(validConfig));
    const childDir = join(tempDir, "src", "lib");
    await mkdir(childDir, { recursive: true });
    const result = await findConfigDir(childDir);
    expect(result).toBe(tempDir);
  });
});

describe("loadConfig", () => {
  test("throws ConfigError when no config found", async () => {
    expect(loadConfig(tempDir)).rejects.toThrow("No .slickenv config found");
  });

  test("loads a valid config", async () => {
    await writeFile(join(tempDir, CONFIG_FILENAME), JSON.stringify(validConfig));
    const config = await loadConfig(tempDir);
    expect(config.projectId).toBe("proj_123");
    expect(config.projectName).toBe("test-project");
    expect(config.apiUrl).toBe("https://apienv.slickspender.com");
  });

  test("throws on corrupted JSON", async () => {
    await writeFile(join(tempDir, CONFIG_FILENAME), "not-json{{{");
    expect(loadConfig(tempDir)).rejects.toThrow("corrupted or invalid");
  });

  test("throws when required fields are missing", async () => {
    await writeFile(join(tempDir, CONFIG_FILENAME), JSON.stringify({ version: 1 }));
    expect(loadConfig(tempDir)).rejects.toThrow("corrupted or invalid");
  });

  test("throws when projectId is empty string", async () => {
    const config = { ...validConfig, projectId: "" };
    await writeFile(join(tempDir, CONFIG_FILENAME), JSON.stringify(config));
    expect(loadConfig(tempDir)).rejects.toThrow("corrupted or invalid");
  });
});

describe("writeConfig", () => {
  test("writes config as formatted JSON", async () => {
    await writeConfig(validConfig, tempDir);
    const raw = await readFile(join(tempDir, CONFIG_FILENAME), "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.projectId).toBe("proj_123");
    expect(raw).toContain("\n"); // formatted with indentation
    expect(raw.endsWith("\n")).toBe(true); // trailing newline
  });

  test("roundtrips through write then load", async () => {
    await writeConfig(validConfig, tempDir);
    const loaded = await loadConfig(tempDir);
    expect(loaded).toEqual(validConfig);
  });

  test("preserves optional fields", async () => {
    const configWithSync = { ...validConfig, lastSyncedVersion: 5 };
    await writeConfig(configWithSync, tempDir);
    const loaded = await loadConfig(tempDir);
    expect(loaded.lastSyncedVersion).toBe(5);
  });
});
