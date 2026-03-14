import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { unlink } from "node:fs/promises";

const SERVICE = "slickenv-cli";
const ACCOUNT = "auth-token";
const TOKEN_FILE = join(homedir(), ".slickenv", "token");

interface KeytarModule {
  setPassword(service: string, account: string, password: string): Promise<void>;
  getPassword(service: string, account: string): Promise<string | null>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

/**
 * Try to import keytar at runtime. Returns null if unavailable.
 * keytar is a soft dependency — it requires native bindings.
 */
async function getKeytar(): Promise<KeytarModule | null> {
  try {
    // Dynamic import with variable to prevent TS from resolving the module
    const moduleName = "keytar";
    return (await import(moduleName)) as unknown as KeytarModule;
  } catch {
    return null;
  }
}

/**
 * Store auth token. Tries OS keychain first, falls back to file.
 */
export async function storeToken(token: string): Promise<void> {
  const keytar = await getKeytar();

  if (keytar) {
    try {
      await keytar.setPassword(SERVICE, ACCOUNT, token);
      return;
    } catch {
      // Keychain failed — fall through to file
    }
  }

  // File fallback (chmod 600)
  await mkdir(dirname(TOKEN_FILE), { recursive: true });
  await writeFile(TOKEN_FILE, token, { encoding: "utf8", mode: 0o600 });
}

/**
 * Retrieve stored auth token.
 * Priority: OS keychain → file fallback.
 */
export async function getStoredToken(): Promise<string | null> {
  const keytar = await getKeytar();

  if (keytar) {
    try {
      const token = await keytar.getPassword(SERVICE, ACCOUNT);
      if (token) return token;
    } catch {
      // Keychain failed — fall through to file
    }
  }

  // File fallback
  try {
    const token = await readFile(TOKEN_FILE, "utf8");
    return token.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Delete stored auth token from all storage locations.
 */
export async function deleteToken(): Promise<void> {
  const keytar = await getKeytar();

  if (keytar) {
    try {
      await keytar.deletePassword(SERVICE, ACCOUNT);
    } catch {
      // Ignore — may not exist
    }
  }

  try {
    await unlink(TOKEN_FILE);
  } catch {
    // Ignore — file may not exist
  }
}
