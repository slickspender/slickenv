import { ConvexHttpClient } from "convex/browser";
import { sanitizeForLogging } from "./output.js";

const DEFAULT_API_URL = process.env.SLICKENV_API_URL ?? "https://adjoining-sheep-555.convex.cloud";

/**
 * Create an authenticated Convex HTTP client.
 */
export function createApiClient(
  apiUrl?: string,
  token?: string
): ConvexHttpClient {
  const url = apiUrl ?? DEFAULT_API_URL;

  const isLocalhost = url.startsWith("http://localhost") || url.startsWith("http://127.0.0.1");
  if (!url.startsWith("https://") && !isLocalhost) {
    throw new Error("API URL must use HTTPS.");
  }

  const client = new ConvexHttpClient(url);

  if (token) {
    client.setAuth(token);
  }

  return client;
}

/**
 * Log an API request with sensitive headers redacted.
 * Only outputs in verbose mode.
 */
export function logRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  verbose: boolean
): void {
  if (!verbose) return;

  const safeHeaders = { ...headers };
  if (safeHeaders["Authorization"]) {
    safeHeaders["Authorization"] = "Bearer [REDACTED]";
  }

  console.debug(`→ ${method} ${url}`, sanitizeForLogging(safeHeaders));
}
