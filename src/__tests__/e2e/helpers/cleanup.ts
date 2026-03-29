import { ConvexHttpClient } from "convex/browser";

const API_URL = process.env.SLICKENV_API_URL ?? "https://adjoining-sheep-555.convex.cloud";

/**
 * Create an authenticated Convex client for test cleanup.
 */
export function createTestClient(token: string): ConvexHttpClient {
  const client = new ConvexHttpClient(API_URL);
  client.setAuth(token);
  return client;
}

/**
 * Archive a project created during testing.
 */
export async function archiveProject(
  client: ConvexHttpClient,
  projectId: string
): Promise<void> {
  try {
    await client.mutation("projects:archive" as any, { projectId });
  } catch {
    // Best-effort cleanup — don't fail the test suite
  }
}
