export type Severity = "CRITICAL" | "HIGH" | "WARNING" | "INFO";

export interface Finding {
  type: string;
  severity: Severity;
  file: string;
  line: number;
  maskedValue: string;
  fixSuggestion: string;
}

export interface ScanPattern {
  name: string;
  type: string;
  severity: Severity;
  pattern: RegExp;
  description: string;
  fixSuggestion: string;
  /**
   * When true, the pattern only fires when the line also contains one of the
   * context keywords (case-insensitive).  Used for generic / high-false-positive
   * patterns such as AWS Secret, Heroku UUID, Vercel, Algolia, Okta, Datadog.
   */
  contextKeywords?: string[];
}

// ---------------------------------------------------------------------------
// Pattern library (50+ patterns)
// ---------------------------------------------------------------------------
export const PATTERNS: ScanPattern[] = [
  // ── AWS ──────────────────────────────────────────────────────────────────
  {
    name: "AWS Access Key ID",
    type: "aws-access-key",
    severity: "CRITICAL",
    pattern: /AKIA[0-9A-Z]{16}/,
    description: "AWS Access Key ID detected.",
    fixSuggestion:
      "Rotate the key immediately in the AWS IAM console and never commit credentials to source control.",
  },
  {
    name: "AWS Secret Access Key",
    type: "aws-secret-key",
    severity: "HIGH",
    pattern: /[0-9a-zA-Z/+]{40}/,
    description: "Possible AWS Secret Access Key detected.",
    fixSuggestion:
      "Rotate the AWS secret key and store it in a secrets manager.",
    contextKeywords: ["aws", "secret"],
  },

  // ── Stripe ────────────────────────────────────────────────────────────────
  {
    name: "Stripe Live Secret Key",
    type: "stripe-live-key",
    severity: "CRITICAL",
    pattern: /sk_live_[0-9a-zA-Z]{24,}/,
    description: "Stripe live secret key detected.",
    fixSuggestion:
      "Roll the Stripe key immediately via the Stripe Dashboard → Developers → API keys.",
  },
  {
    name: "Stripe Test Secret Key",
    type: "stripe-test-key",
    severity: "WARNING",
    pattern: /sk_test_[0-9a-zA-Z]{24,}/,
    description: "Stripe test secret key detected.",
    fixSuggestion:
      "Test keys are lower risk, but avoid committing them. Move to environment-based injection.",
  },
  {
    name: "Stripe Restricted Key",
    type: "stripe-restricted-key",
    severity: "HIGH",
    pattern: /rk_live_[0-9a-zA-Z]{24,}/,
    description: "Stripe restricted live key detected.",
    fixSuggestion: "Roll the restricted key via the Stripe Dashboard.",
  },

  // ── GitHub ────────────────────────────────────────────────────────────────
  {
    name: "GitHub Personal Access Token (classic)",
    type: "github-pat-classic",
    severity: "CRITICAL",
    pattern: /ghp_[0-9a-zA-Z]{36}/,
    description: "GitHub classic personal access token detected.",
    fixSuggestion:
      "Revoke the token at github.com/settings/tokens and generate a new fine-grained token.",
  },
  {
    name: "GitHub Fine-grained PAT",
    type: "github-pat-fine",
    severity: "CRITICAL",
    pattern: /github_pat_[0-9a-zA-Z_]{82}/,
    description: "GitHub fine-grained personal access token detected.",
    fixSuggestion:
      "Revoke the token at github.com/settings/tokens immediately.",
  },
  {
    name: "GitHub OAuth Token",
    type: "github-oauth",
    severity: "CRITICAL",
    pattern: /gho_[0-9a-zA-Z]{36}/,
    description: "GitHub OAuth token detected.",
    fixSuggestion:
      "Revoke the OAuth token and audit your GitHub OAuth application.",
  },
  {
    name: "GitHub Actions Token",
    type: "github-actions",
    severity: "CRITICAL",
    pattern: /ghs_[0-9a-zA-Z]{36}/,
    description: "GitHub Actions token detected.",
    fixSuggestion:
      "These tokens are ephemeral, but ensure your workflow does not log or persist them.",
  },

  // ── OpenAI / Anthropic ────────────────────────────────────────────────────
  {
    name: "OpenAI API Key",
    type: "openai-key",
    severity: "CRITICAL",
    // Exclude sk-ant- (Anthropic) and sk-proj- style prefixes by requiring the
    // character after "sk-" to be a plain alphanumeric (not a secondary prefix).
    pattern: /sk-(?!ant-)[a-zA-Z0-9]{48,}/,
    description: "OpenAI API key detected.",
    fixSuggestion:
      "Revoke the key at platform.openai.com/api-keys and rotate immediately.",
  },
  {
    name: "Anthropic API Key",
    type: "anthropic-key",
    severity: "CRITICAL",
    pattern: /sk-ant-[a-zA-Z0-9-]{90,}/,
    description: "Anthropic API key detected.",
    fixSuggestion:
      "Revoke the key at console.anthropic.com and create a new one.",
  },

  // ── Google ────────────────────────────────────────────────────────────────
  {
    name: "Google API Key",
    type: "google-api-key",
    severity: "HIGH",
    pattern: /AIza[0-9A-Za-z\-_]{35}/,
    description: "Google API key detected.",
    fixSuggestion:
      "Restrict or rotate the key via the Google Cloud Console → Credentials.",
  },

  // ── JWT ───────────────────────────────────────────────────────────────────
  {
    name: "JSON Web Token",
    type: "jwt",
    severity: "HIGH",
    pattern: /^ey[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/m,
    description: "A JWT token was found hardcoded.",
    fixSuggestion:
      "Never hardcode JWTs. They carry authentication claims and should be short-lived.",
  },

  // ── Private Keys ──────────────────────────────────────────────────────────
  {
    name: "Private Key Block",
    type: "private-key",
    severity: "CRITICAL",
    pattern: /-----BEGIN (RSA|EC|OPENSSH|DSA|PGP) PRIVATE KEY/,
    description: "PEM-encoded private key block detected.",
    fixSuggestion:
      "Never store private keys in environment files. Use a secrets vault or HSM.",
  },

  // ── Database connection strings ───────────────────────────────────────────
  {
    name: "PostgreSQL Connection String",
    type: "db-postgres",
    severity: "HIGH",
    pattern: /postgre?s(?:ql)?:\/\/[^:]+:[^@]+@/,
    description: "PostgreSQL connection string with credentials detected.",
    fixSuggestion:
      "Use individual host/user/password variables and never hardcode credentials in URLs.",
  },
  {
    name: "MySQL Connection String",
    type: "db-mysql",
    severity: "HIGH",
    pattern: /mysql:\/\/[^:]+:[^@]+@/,
    description: "MySQL connection string with credentials detected.",
    fixSuggestion:
      "Use individual host/user/password variables and inject via a secrets manager.",
  },
  {
    name: "MongoDB Connection String",
    type: "db-mongodb",
    severity: "HIGH",
    pattern: /mongodb(?:\+srv)?:\/\/[^:]+:[^@]+@/,
    description: "MongoDB connection string with credentials detected.",
    fixSuggestion:
      "Use individual connection variables; never embed credentials in the URI.",
  },

  // ── Messaging / Email ─────────────────────────────────────────────────────
  {
    name: "SendGrid API Key",
    type: "sendgrid-key",
    severity: "HIGH",
    pattern: /SG\.[0-9a-zA-Z\-_]{22,}\.[0-9a-zA-Z\-_]{43,}/,
    description: "SendGrid API key detected.",
    fixSuggestion: "Revoke the key at app.sendgrid.com/settings/api_keys.",
  },
  {
    name: "Mailgun API Key",
    type: "mailgun-key",
    severity: "HIGH",
    pattern: /key-[0-9a-zA-Z]{32}/,
    description: "Mailgun API key detected.",
    fixSuggestion:
      "Revoke and regenerate the key via the Mailgun dashboard → API Security.",
  },
  {
    name: "Mailchimp API Key",
    type: "mailchimp-key",
    severity: "HIGH",
    pattern: /[0-9a-f]{32}-us[0-9]{1,2}/,
    description: "Mailchimp API key detected.",
    fixSuggestion:
      "Revoke the key via Mailchimp Account → Extras → API keys.",
  },

  // ── Twilio ────────────────────────────────────────────────────────────────
  {
    name: "Twilio Account SID",
    type: "twilio-account-sid",
    severity: "HIGH",
    pattern: /AC[0-9a-fA-F]{32}/,
    description: "Twilio Account SID detected.",
    fixSuggestion:
      "The SID alone is not a credential, but combined with the auth token it is dangerous. Rotate the auth token.",
  },
  {
    name: "Twilio Auth Token",
    type: "twilio-auth-token",
    severity: "HIGH",
    pattern: /SK[0-9a-fA-F]{32}/,
    description: "Twilio API Key SID detected.",
    fixSuggestion:
      "Revoke the API key via the Twilio Console → Account → API keys.",
  },
  {
    name: "Twilio App SID",
    type: "twilio-app-sid",
    severity: "WARNING",
    pattern: /AP[0-9a-fA-F]{32}/,
    description: "Twilio Application SID detected.",
    fixSuggestion:
      "Application SIDs are configuration identifiers; verify no auth token is also exposed.",
  },

  // ── Slack ─────────────────────────────────────────────────────────────────
  {
    name: "Slack Token",
    type: "slack-token",
    severity: "HIGH",
    pattern: /xox[baprs]\-[0-9a-zA-Z\-]{10,}/,
    description: "Slack API token detected.",
    fixSuggestion:
      "Revoke the token at api.slack.com/apps → your app → OAuth & Permissions.",
  },
  {
    name: "Slack Webhook URL",
    type: "slack-webhook",
    severity: "HIGH",
    pattern:
      /https:\/\/hooks\.slack\.com\/services\/[A-Z0-9]+\/[A-Z0-9]+\/[a-zA-Z0-9]+/,
    description: "Slack incoming webhook URL detected.",
    fixSuggestion:
      "Revoke the webhook at api.slack.com/apps → Incoming Webhooks.",
  },

  // ── PayPal ────────────────────────────────────────────────────────────────
  {
    name: "PayPal Access Token",
    type: "paypal-token",
    severity: "CRITICAL",
    pattern: /access_token\$production\$[0-9a-z]{16}\$[0-9a-f]{32}/,
    description: "PayPal production access token detected.",
    fixSuggestion:
      "Revoke the token immediately via the PayPal Developer Dashboard.",
  },

  // ── Heroku ────────────────────────────────────────────────────────────────
  {
    name: "Heroku API Key",
    type: "heroku-api-key",
    severity: "HIGH",
    pattern:
      /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/,
    description: "Possible Heroku API key (UUID format) detected.",
    fixSuggestion:
      "Revoke the key at dashboard.heroku.com/account → Applications.",
    contextKeywords: ["heroku"],
  },

  // ── Vercel ────────────────────────────────────────────────────────────────
  {
    name: "Vercel Token",
    type: "vercel-token",
    severity: "HIGH",
    pattern: /[a-zA-Z0-9]{24}/,
    description: "Possible Vercel token detected.",
    fixSuggestion:
      "Revoke the token at vercel.com/account/tokens.",
    contextKeywords: ["vercel"],
  },

  // ── NPM ───────────────────────────────────────────────────────────────────
  {
    name: "NPM Access Token",
    type: "npm-token",
    severity: "CRITICAL",
    pattern: /npm_[A-Za-z0-9]{36}/,
    description: "NPM access token detected.",
    fixSuggestion:
      "Revoke the token at npmjs.com → Access Tokens and use .npmrc injection instead.",
  },

  // ── Cloudinary ────────────────────────────────────────────────────────────
  {
    name: "Cloudinary URL",
    type: "cloudinary-url",
    severity: "HIGH",
    pattern: /cloudinary:\/\/[0-9]+:[a-zA-Z0-9]+@/,
    description: "Cloudinary URL with API secret detected.",
    fixSuggestion:
      "Regenerate the API secret in the Cloudinary dashboard and use environment variables.",
  },

  // ── Algolia ───────────────────────────────────────────────────────────────
  {
    name: "Algolia API Key",
    type: "algolia-api-key",
    severity: "HIGH",
    pattern: /\b[a-f0-9]{32}\b/,
    description: "Possible Algolia API key detected.",
    fixSuggestion:
      "Revoke the key at algolia.com/dashboard → API Keys.",
    contextKeywords: ["algolia"],
  },

  // ── Firebase ──────────────────────────────────────────────────────────────
  {
    name: "Firebase Service Account",
    type: "firebase-service-account",
    severity: "CRITICAL",
    pattern: /"type": "service_account"/,
    description: "Firebase service account JSON detected.",
    fixSuggestion:
      "Remove the service account JSON from this file. Use Workload Identity or Secret Manager instead.",
  },

  // ── Shopify ───────────────────────────────────────────────────────────────
  {
    name: "Shopify Access Token",
    type: "shopify-access-token",
    severity: "CRITICAL",
    pattern: /shpat_[0-9a-fA-F]{32}/,
    description: "Shopify access token detected.",
    fixSuggestion:
      "Revoke the token via the Shopify Partner Dashboard → Apps → API credentials.",
  },
  {
    name: "Shopify Shared Secret",
    type: "shopify-shared-secret",
    severity: "CRITICAL",
    pattern: /shpss_[0-9a-fA-F]{32}/,
    description: "Shopify shared secret detected.",
    fixSuggestion:
      "Revoke and regenerate the shared secret in the Shopify Partner Dashboard.",
  },

  // ── Okta ──────────────────────────────────────────────────────────────────
  {
    name: "Okta API Token",
    type: "okta-token",
    severity: "HIGH",
    pattern: /[0-9a-zA-Z_-]{42}/,
    description: "Possible Okta API token detected.",
    fixSuggestion:
      "Revoke the token in your Okta admin console → Security → API → Tokens.",
    contextKeywords: ["okta"],
  },

  // ── Square ────────────────────────────────────────────────────────────────
  {
    name: "Square Access Token",
    type: "square-access-token",
    severity: "CRITICAL",
    pattern: /sq0atp-[0-9A-Za-z\-_]{22}/,
    description: "Square production access token detected.",
    fixSuggestion:
      "Revoke the token via the Square Developer Console → Credentials.",
  },
  {
    name: "Square OAuth Secret",
    type: "square-oauth-secret",
    severity: "CRITICAL",
    pattern: /sq0csp-[0-9A-Za-z\-_]{43}/,
    description: "Square OAuth application secret detected.",
    fixSuggestion:
      "Rotate the OAuth secret via the Square Developer Console.",
  },

  // ── Telegram ──────────────────────────────────────────────────────────────
  {
    name: "Telegram Bot Token",
    type: "telegram-bot-token",
    severity: "HIGH",
    pattern: /[0-9]{9,10}:[a-zA-Z0-9_\-]{35}/,
    description: "Telegram Bot API token detected.",
    fixSuggestion:
      "Revoke the token via @BotFather → /revoke and generate a new one.",
  },

  // ── Datadog ───────────────────────────────────────────────────────────────
  {
    name: "Datadog API Key",
    type: "datadog-api-key",
    severity: "HIGH",
    pattern: /[a-z0-9]{32}/,
    description: "Possible Datadog API key detected.",
    fixSuggestion:
      "Revoke the key at app.datadoghq.com → Organization Settings → API Keys.",
    contextKeywords: ["datadog", "dd_api"],
  },

  // ── New Relic ─────────────────────────────────────────────────────────────
  {
    name: "New Relic License Key",
    type: "new-relic-license",
    severity: "HIGH",
    pattern: /NRAK-[A-Z0-9]{27}/,
    description: "New Relic license key detected.",
    fixSuggestion:
      "Revoke the key in New Relic → Account Settings → Integrations → API keys.",
  },

  // ── HashiCorp Vault ───────────────────────────────────────────────────────
  {
    name: "HashiCorp Vault Token",
    type: "vault-token",
    severity: "HIGH",
    pattern: /s\.[a-zA-Z0-9]{24}/,
    description: "HashiCorp Vault service token detected.",
    fixSuggestion:
      "Revoke the token with `vault token revoke` and use short-lived tokens.",
  },

  // ── Zendesk ───────────────────────────────────────────────────────────────
  {
    name: "Zendesk API Token",
    type: "zendesk-token",
    severity: "HIGH",
    pattern: /[a-zA-Z0-9]{40}\/token/,
    description: "Zendesk API token detected.",
    fixSuggestion:
      "Revoke the token at your-subdomain.zendesk.com/admin/apps-integrations/apis/zendesk-api/settings.",
  },

  // ── PagerDuty ─────────────────────────────────────────────────────────────
  {
    name: "PagerDuty API Key",
    type: "pagerduty-key",
    severity: "HIGH",
    pattern: /u\+[a-zA-Z0-9_]{20}/,
    description: "PagerDuty API user key detected.",
    fixSuggestion:
      "Revoke the key at pagerduty.com → My Profile → User Settings → API Access.",
  },

  // ── Generic / heuristic ───────────────────────────────────────────────────
  {
    name: "Generic Secret Keyword",
    type: "generic-secret-keyword",
    severity: "WARNING",
    pattern: /(password|passwd|pwd|secret|api[_\-.]?key)\s*[=:]\s*['"]?[^\s'"]{8,}/i,
    description:
      "A variable assignment that looks like a secret was detected.",
    fixSuggestion:
      "Move secrets to a secrets manager or vault. Never hardcode credentials.",
  },
  {
    name: "High-Entropy String",
    type: "high-entropy-string",
    severity: "INFO",
    // Matches assignments like VAR=<long value without whitespace>
    pattern: /[A-Z_][A-Z0-9_]*\s*=\s*['"]?([^\s'"]{20,})['"]?/i,
    description: "A long, high-entropy string was detected in a variable assignment.",
    fixSuggestion:
      "Verify this is not a secret. If it is, move it to a secrets manager.",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Calculate the Shannon entropy (bits per symbol) of a string.
 */
function shannonEntropy(s: string): number {
  const freq = new Map<string, number>();
  for (const ch of s) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Return the portion of a line that matches the pattern, or null.
 * Uses a fresh (non-global) copy of the regex to avoid stateful `.lastIndex` issues.
 */
function matchLine(line: string, pattern: RegExp): RegExpMatchArray | null {
  const fresh = new RegExp(pattern.source, pattern.flags.replace("g", ""));
  return fresh.exec(line);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mask a secret value for display.
 *
 * - length ≤ 12: first 4 chars + "..."
 * - length  > 12: first 8 chars + "..." + last 4 chars
 */
export function maskValue(value: string): string {
  if (value.length <= 12) {
    return value.slice(0, 4) + "...";
  }
  return value.slice(0, 8) + "..." + value.slice(-4);
}

/**
 * Scan the text content of a single file and return all findings.
 */
export function scanText(content: string, filename: string): Finding[] {
  const lines = content.split("\n");
  const findings: Finding[] = [];

  // Track (lineNumber, value) pairs to deduplicate identical findings on the same line.
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNumber = i + 1;
    const trimmed = line.trim();

    // Skip comment-only lines for most patterns (they are not live secrets).
    const isComment = trimmed.startsWith("#");

    for (const sp of PATTERNS) {
      // Always allow private-key / firebase patterns even in comments (they are multi-line blobs).
      if (
        isComment &&
        sp.type !== "private-key" &&
        sp.type !== "firebase-service-account"
      ) {
        continue;
      }

      // Context keyword check — pattern only fires when keyword appears on the same line.
      if (sp.contextKeywords && sp.contextKeywords.length > 0) {
        const lowerLine = line.toLowerCase();
        const hasContext = sp.contextKeywords.some((kw) =>
          lowerLine.includes(kw.toLowerCase())
        );
        if (!hasContext) continue;
      }

      // For the high-entropy pattern, add extra entropy gate.
      if (sp.type === "high-entropy-string") {
        const m = matchLine(line, sp.pattern);
        if (!m) continue;
        const candidate = m[1] ?? m[0];
        if (shannonEntropy(candidate) < 3.5) continue;
        const dedupeKey = `${lineNumber}:${sp.type}:${candidate}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        findings.push({
          type: sp.type,
          severity: sp.severity,
          file: filename,
          line: lineNumber,
          maskedValue: maskValue(candidate),
          fixSuggestion: sp.fixSuggestion,
        });
        continue;
      }

      const m = matchLine(line, sp.pattern);
      if (!m) continue;

      const matched = m[0];
      const dedupeKey = `${lineNumber}:${sp.type}:${matched}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      findings.push({
        type: sp.type,
        severity: sp.severity,
        file: filename,
        line: lineNumber,
        maskedValue: maskValue(matched),
        fixSuggestion: sp.fixSuggestion,
      });
    }
  }

  return findings;
}

/**
 * Calculate a security score (0–100) from a set of findings.
 *
 * Deductions: CRITICAL −20, HIGH −10, WARNING −5, INFO −1.
 * Score is clamped to a minimum of 0.
 */
export function calculateScore(findings: Finding[]): number {
  const deductions: Record<Severity, number> = {
    CRITICAL: 20,
    HIGH: 10,
    WARNING: 5,
    INFO: 1,
  };

  let score = 100;
  for (const f of findings) {
    score -= deductions[f.severity];
  }
  return Math.max(0, score);
}
