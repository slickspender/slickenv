import { describe, expect, test } from "bun:test";
import { deriveKey, encrypt, decrypt, generateProjectSalt } from "../crypto.js";
describe("crypto", () => {
    const userId = "user_123";
    const projectId = "project_456";
    const salt = Buffer.from(generateProjectSalt(), "base64");
    test("deriveKey returns a 32-byte buffer", () => {
        const key = deriveKey(userId, projectId, salt);
        expect(key).toBeInstanceOf(Buffer);
        expect(key.length).toBe(32);
    });
    test("deriveKey is deterministic", () => {
        const key1 = deriveKey(userId, projectId, salt);
        const key2 = deriveKey(userId, projectId, salt);
        expect(key1.equals(key2)).toBe(true);
    });
    test("deriveKey produces different keys for different inputs", () => {
        const key1 = deriveKey(userId, projectId, salt);
        const key2 = deriveKey("user_other", projectId, salt);
        expect(key1.equals(key2)).toBe(false);
    });
    test("encrypt/decrypt round trip", () => {
        const key = deriveKey(userId, projectId, salt);
        const plaintext = "my-secret-api-key-12345";
        const { ciphertext, iv } = encrypt(plaintext, key);
        expect(ciphertext).not.toBe(plaintext);
        expect(iv).toBeTruthy();
        const decrypted = decrypt(ciphertext, iv, key);
        expect(decrypted).toBe(plaintext);
    });
    test("encrypt produces different ciphertext each time (random IV)", () => {
        const key = deriveKey(userId, projectId, salt);
        const plaintext = "same-value";
        const result1 = encrypt(plaintext, key);
        const result2 = encrypt(plaintext, key);
        expect(result1.ciphertext).not.toBe(result2.ciphertext);
        expect(result1.iv).not.toBe(result2.iv);
        // Both should decrypt to same value
        expect(decrypt(result1.ciphertext, result1.iv, key)).toBe(plaintext);
        expect(decrypt(result2.ciphertext, result2.iv, key)).toBe(plaintext);
    });
    test("decrypt fails with wrong key", () => {
        const key = deriveKey(userId, projectId, salt);
        const wrongKey = deriveKey("wrong_user", projectId, salt);
        const { ciphertext, iv } = encrypt("secret", key);
        expect(() => decrypt(ciphertext, iv, wrongKey)).toThrow();
    });
    test("decrypt fails with tampered ciphertext", () => {
        const key = deriveKey(userId, projectId, salt);
        const { ciphertext, iv } = encrypt("secret", key);
        // Tamper with the ciphertext
        const buf = Buffer.from(ciphertext, "base64");
        buf[0] = buf[0] ^ 0xff;
        const tampered = buf.toString("base64");
        expect(() => decrypt(tampered, iv, key)).toThrow();
    });
    test("handles empty string", () => {
        const key = deriveKey(userId, projectId, salt);
        const { ciphertext, iv } = encrypt("", key);
        expect(decrypt(ciphertext, iv, key)).toBe("");
    });
    test("handles unicode values", () => {
        const key = deriveKey(userId, projectId, salt);
        const plaintext = "password=p@$$w0rd!🔑";
        const { ciphertext, iv } = encrypt(plaintext, key);
        expect(decrypt(ciphertext, iv, key)).toBe(plaintext);
    });
    test("generateProjectSalt returns base64 string", () => {
        const salt = generateProjectSalt();
        expect(typeof salt).toBe("string");
        const decoded = Buffer.from(salt, "base64");
        expect(decoded.length).toBe(32);
    });
});
//# sourceMappingURL=crypto.test.js.map