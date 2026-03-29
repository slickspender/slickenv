import { getStoredToken } from "./keychain.js";
import { AuthError } from "./errors.js";

/**
 * Decode a JWT payload without verifying the signature.
 * Signature verification is done server-side by Convex.
 */
export function decodeJwt(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new AuthError("TOKEN_INVALID", "Authentication token is invalid. Run `slickenv login`.");
  }

  try {
    const payload = Buffer.from(parts[1]!, "base64url").toString("utf8");
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    throw new AuthError("TOKEN_INVALID", "Authentication token is invalid. Run `slickenv login`.");
  }
}

/**
 * Check if a JWT is expired.
 */
export function isExpired(token: string): boolean {
  const { exp } = decodeJwt(token);
  if (typeof exp !== "number") return true;
  return exp < Math.floor(Date.now() / 1000);
}

/**
 * Check if a JWT is within 5 minutes of expiry.
 */
export function isNearExpiry(token: string): boolean {
  const { exp } = decodeJwt(token);
  if (typeof exp !== "number") return true;
  const fiveMinutesFromNow = Math.floor(Date.now() / 1000) + 300;
  return exp < fiveMinutesFromNow;
}

/**
 * Resolve token from all sources.
 * Priority: SLICKENV_TOKEN env → OS keychain → file fallback.
 */
export async function resolveToken(): Promise<string | null> {
  // 1. Environment variable (CI/CD)
  if (process.env.SLICKENV_TOKEN) {
    return process.env.SLICKENV_TOKEN;
  }

  // 2. OS keychain + file fallback
  return getStoredToken();
}

/**
 * Get a valid auth token.
 * Throws AuthError if no token or token is expired.
 *
 * Note: Token lifetime is controlled by the Clerk JWT template settings.
 * Set "Token Lifetime" on the "convex" template in the Clerk Dashboard
 * (recommended: 2592000 = 30 days for CLI usage).
 */
export async function getValidToken(): Promise<string> {
  const token = await resolveToken();

  if (!token) {
    throw new AuthError(
      "NOT_AUTHENTICATED",
      "Not authenticated. Run `slickenv login`."
    );
  }

  if (isExpired(token)) {
    throw new AuthError(
      "TOKEN_EXPIRED",
      "Session expired. Run `slickenv login` to reconnect."
    );
  }

  return token;
}
