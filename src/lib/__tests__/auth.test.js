import { describe, expect, test } from "bun:test";
import { decodeJwt, isExpired, isNearExpiry } from "../auth.js";
function createJwt(payload) {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = "fake-signature";
    return `${header}.${body}.${signature}`;
}
describe("decodeJwt", () => {
    test("decodes a valid JWT payload", () => {
        const token = createJwt({ sub: "user_123", email: "test@example.com" });
        const payload = decodeJwt(token);
        expect(payload.sub).toBe("user_123");
        expect(payload.email).toBe("test@example.com");
    });
    test("throws on malformed token (not 3 parts)", () => {
        expect(() => decodeJwt("not-a-jwt")).toThrow("invalid");
        expect(() => decodeJwt("two.parts")).toThrow("invalid");
    });
    test("throws on invalid base64 payload", () => {
        expect(() => decodeJwt("header.!!!invalid!!!.signature")).toThrow();
    });
});
describe("isExpired", () => {
    test("returns false for a token expiring in the future", () => {
        const futureExp = Math.floor(Date.now() / 1000) + 3600;
        const token = createJwt({ exp: futureExp });
        expect(isExpired(token)).toBe(false);
    });
    test("returns true for an expired token", () => {
        const pastExp = Math.floor(Date.now() / 1000) - 100;
        const token = createJwt({ exp: pastExp });
        expect(isExpired(token)).toBe(true);
    });
    test("returns true if no exp claim", () => {
        const token = createJwt({ sub: "user_123" });
        expect(isExpired(token)).toBe(true);
    });
});
describe("isNearExpiry", () => {
    test("returns false for token expiring well in the future", () => {
        const futureExp = Math.floor(Date.now() / 1000) + 3600;
        const token = createJwt({ exp: futureExp });
        expect(isNearExpiry(token)).toBe(false);
    });
    test("returns true for token expiring within 5 minutes", () => {
        const nearExp = Math.floor(Date.now() / 1000) + 120; // 2 minutes
        const token = createJwt({ exp: nearExp });
        expect(isNearExpiry(token)).toBe(true);
    });
    test("returns true for already expired token", () => {
        const pastExp = Math.floor(Date.now() / 1000) - 10;
        const token = createJwt({ exp: pastExp });
        expect(isNearExpiry(token)).toBe(true);
    });
});
//# sourceMappingURL=auth.test.js.map