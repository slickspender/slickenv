import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  pbkdf2Sync,
} from "node:crypto";

/**
 * Derive an AES-256 encryption key from user identity and project context.
 *
 * Uses PBKDF2-SHA256 with 100,000 iterations.
 * The derived key is never stored — re-derived on each operation.
 */
export function deriveKey(
  clerkUserId: string,
  projectId: string,
  salt: Buffer
): Buffer {
  return pbkdf2Sync(
    `${clerkUserId}:${projectId}`,
    salt,
    100_000,
    32, // 256 bits
    "sha256"
  );
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 *
 * Returns base64-encoded ciphertext (with auth tag appended) and IV.
 * A fresh random 12-byte IV is generated for each call.
 */
export function encrypt(
  plaintext: string,
  key: Buffer
): { ciphertext: string; iv: string } {
  const iv = randomBytes(12); // 96-bit IV as recommended for GCM
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag(); // 128-bit auth tag

  // Append auth tag to ciphertext for storage
  const combined = Buffer.concat([encrypted, tag]);

  return {
    ciphertext: combined.toString("base64"),
    iv: iv.toString("base64"),
  };
}

/**
 * Decrypt an AES-256-GCM ciphertext.
 *
 * Expects base64-encoded ciphertext (with auth tag appended) and IV.
 * Throws if the auth tag is invalid (tampered data).
 */
export function decrypt(
  ciphertext: string,
  iv: string,
  key: Buffer
): string {
  const combined = Buffer.from(ciphertext, "base64");
  const ivBuf = Buffer.from(iv, "base64");

  // Last 16 bytes are the GCM auth tag
  const tag = combined.subarray(combined.length - 16);
  const encrypted = combined.subarray(0, combined.length - 16);

  const decipher = createDecipheriv("aes-256-gcm", key, ivBuf);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    "utf8"
  );
}

/**
 * Generate a random 32-byte salt for project encryption.
 * Returns base64-encoded string for storage in Convex.
 */
export function generateProjectSalt(): string {
  return randomBytes(32).toString("base64");
}
