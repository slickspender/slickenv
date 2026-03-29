import type { RotationResult } from "./stripe.js";

export type { RotationResult };

/**
 * Rotate (or validate) a GitHub token.
 *
 * GitHub personal access tokens (classic) and fine-grained PATs cannot be
 * rotated via the API. This adapter validates the current token and surfaces
 * clear manual-rotation instructions via thrown errors.
 *
 * For dry-run mode, only validation is performed.
 */
export async function rotateGitHubToken(
  currentValue: string,
  options: { dryRun?: boolean; tokenName?: string } = {},
): Promise<RotationResult> {
  // ── Classic PATs ─────────────────────────────────────────────────
  if (currentValue.startsWith("ghp_")) {
    if (!options.dryRun) {
      throw new Error(
        "GitHub personal access tokens cannot be rotated via the API.\n" +
          "Rotate manually: https://github.com/settings/tokens\n" +
          "Then update with: slickenv push",
      );
    }
  }

  // ── GitHub Actions / installation tokens ─────────────────────────
  if (currentValue.startsWith("ghs_")) {
    throw new Error(
      "GitHub Actions secrets are managed per-repository.\n" +
        "Rotate via: Settings > Secrets and Variables > Actions\n" +
        "Then update with: slickenv push",
    );
  }

  // ── OAuth tokens ─────────────────────────────────────────────────
  if (currentValue.startsWith("gho_")) {
    throw new Error(
      "GitHub OAuth tokens cannot be rotated via the API.\n" +
        "Re-authorise the OAuth application to obtain a new token.\n" +
        "Then update with: slickenv push",
    );
  }

  // ── Validate the token (used for dry-run and as a pre-flight check) ──
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${currentValue}`,
      "User-Agent": "slickenv-cli/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(
      `GitHub token validation failed: ${response.status} ${response.statusText}`,
    );
  }

  const user = (await response.json()) as { login: string };

  // For dry run (or unknown token formats), return validation result
  return {
    newValue: currentValue,
    metadata: {
      user: user.login,
      validationOnly: true,
      tokenName: options.tokenName,
    },
  };
}
