import { describe, expect, test } from "bun:test";
import {
  calculateScore,
  maskValue,
  scanText,
  type Finding,
} from "../scanner.js";

const STRIPE_LIVE_KEY = "sk_" + "live_" + "51ABCDEFabcdefghijklmnop";
const STRIPE_TEST_KEY = "sk_" + "test_" + "51ABCDEFabcdefghijklmnop";
const STRIPE_RESTRICTED_KEY = "rk_" + "live_" + "51ABCDEFabcdefghijklmnop";
const SLACK_BOT_TOKEN = "xox" + "b-123456789012-abcdefghijklmnopqrst";
const SHOPIFY_ACCESS_TOKEN = "sh" + "pat_1234567890abcdef1234567890abcdef";
const SHOPIFY_SHARED_SECRET = "shp" + "ss_1234567890abcdef1234567890abcdef";
const NEW_RELIC_LICENSE_KEY = "NR" + "AK-ABCDEFGHIJKLMNOPQRSTUVWXYZ1";

// ---------------------------------------------------------------------------
// maskValue
// ---------------------------------------------------------------------------

describe("maskValue", () => {
  test("short values (≤12 chars) show first 4 + '...'", () => {
    expect(maskValue("secret")).toBe("secr...");
    expect(maskValue("abcd")).toBe("abcd...");
    // 12 chars → ≤12 → first 4 + "..."
    expect(maskValue("123456789012")).toBe("1234...");
  });

  test("long values (>12 chars) show first 8 + '...' + last 4", () => {
    expect(maskValue("sk_live_51abcdefghijkl")).toBe("sk_live_...ijkl");
    expect(maskValue("AKIAIOSFODNN7EXAMPLE")).toBe("AKIAIOSF...MPLE");
  });

  test("exactly 12 chars is treated as short", () => {
    // 12 chars → ≤12 → first 4 + "..."
    expect(maskValue("123456789012")).toBe("1234...");
  });

  test("13 chars is treated as long", () => {
    expect(maskValue("1234567890123")).toBe("12345678...0123");
  });
});

// ---------------------------------------------------------------------------
// calculateScore
// ---------------------------------------------------------------------------

describe("calculateScore", () => {
  test("returns 100 for no findings", () => {
    expect(calculateScore([])).toBe(100);
  });

  test("deducts 20 per CRITICAL finding", () => {
    const findings: Finding[] = [
      {
        type: "aws-access-key",
        severity: "CRITICAL",
        file: "test.env",
        line: 1,
        maskedValue: "AKIA...MPLE",
        fixSuggestion: "",
      },
    ];
    expect(calculateScore(findings)).toBe(80);
  });

  test("returns 0 when deductions exceed 100", () => {
    const findings: Finding[] = Array.from({ length: 10 }, (_, i) => ({
      type: "aws-access-key",
      severity: "CRITICAL" as const,
      file: "test.env",
      line: i + 1,
      maskedValue: "AKIA...MPLE",
      fixSuggestion: "",
    }));
    // 10 × 20 = 200 → clamped to 0
    expect(calculateScore(findings)).toBe(0);
  });

  test("deducts 10 per HIGH finding", () => {
    const findings: Finding[] = [
      {
        type: "google-api-key",
        severity: "HIGH",
        file: "test.env",
        line: 1,
        maskedValue: "AIza...xxxx",
        fixSuggestion: "",
      },
      {
        type: "google-api-key",
        severity: "HIGH",
        file: "test.env",
        line: 2,
        maskedValue: "AIza...yyyy",
        fixSuggestion: "",
      },
    ];
    expect(calculateScore(findings)).toBe(80);
  });

  test("deducts 5 per WARNING finding", () => {
    const findings: Finding[] = [
      {
        type: "stripe-test-key",
        severity: "WARNING",
        file: "test.env",
        line: 1,
        maskedValue: "sk_test_...",
        fixSuggestion: "",
      },
    ];
    expect(calculateScore(findings)).toBe(95);
  });

  test("deducts 1 per INFO finding", () => {
    const findings: Finding[] = [
      {
        type: "high-entropy-string",
        severity: "INFO",
        file: "test.env",
        line: 1,
        maskedValue: "abcdefgh...wxyz",
        fixSuggestion: "",
      },
    ];
    expect(calculateScore(findings)).toBe(99);
  });

  test("mixed severity findings are summed correctly", () => {
    const findings: Finding[] = [
      { type: "a", severity: "CRITICAL", file: "f", line: 1, maskedValue: "", fixSuggestion: "" },
      { type: "b", severity: "HIGH",     file: "f", line: 2, maskedValue: "", fixSuggestion: "" },
      { type: "c", severity: "WARNING",  file: "f", line: 3, maskedValue: "", fixSuggestion: "" },
      { type: "d", severity: "INFO",     file: "f", line: 4, maskedValue: "", fixSuggestion: "" },
    ];
    // 100 - 20 - 10 - 5 - 1 = 64
    expect(calculateScore(findings)).toBe(64);
  });
});

// ---------------------------------------------------------------------------
// scanText — pattern detection
// ---------------------------------------------------------------------------

describe("scanText", () => {
  // ── AWS ──────────────────────────────────────────────────────────────────
  test("detects AWS Access Key ID", () => {
    const findings = scanText("AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE", "test.env");
    expect(findings.some((f) => f.type === "aws-access-key")).toBe(true);
  });

  test("detects AWS Secret Access Key with aws context", () => {
    const content = "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    const findings = scanText(content, "test.env");
    expect(findings.some((f) => f.type === "aws-secret-key")).toBe(true);
  });

  // ── Stripe ────────────────────────────────────────────────────────────────
  test("detects Stripe live secret key", () => {
    const findings = scanText(
      `STRIPE_SECRET_KEY=${STRIPE_LIVE_KEY}`,
      "test.env"
    );
    expect(findings.some((f) => f.type === "stripe-live-key")).toBe(true);
  });

  test("detects Stripe test secret key", () => {
    const findings = scanText(
      `STRIPE_SECRET_KEY=${STRIPE_TEST_KEY}`,
      "test.env"
    );
    expect(findings.some((f) => f.type === "stripe-test-key")).toBe(true);
  });

  test("detects Stripe restricted key", () => {
    const findings = scanText(
      `STRIPE_KEY=${STRIPE_RESTRICTED_KEY}`,
      "test.env"
    );
    expect(findings.some((f) => f.type === "stripe-restricted-key")).toBe(true);
  });

  // ── GitHub ────────────────────────────────────────────────────────────────
  test("detects GitHub classic PAT", () => {
    const findings = scanText(
      "GH_TOKEN=ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ",
      "test.env"
    );
    expect(findings.some((f) => f.type === "github-pat-classic")).toBe(true);
  });

  test("detects GitHub OAuth token", () => {
    const findings = scanText(
      "GITHUB_TOKEN=gho_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ",
      "test.env"
    );
    expect(findings.some((f) => f.type === "github-oauth")).toBe(true);
  });

  test("detects GitHub Actions token", () => {
    const findings = scanText(
      "GITHUB_TOKEN=ghs_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ",
      "test.env"
    );
    expect(findings.some((f) => f.type === "github-actions")).toBe(true);
  });

  // ── OpenAI ────────────────────────────────────────────────────────────────
  test("detects OpenAI API key", () => {
    // The pattern requires 48+ alphanum chars after "sk-"
    const key = "sk-" + "a".repeat(48);
    const findings = scanText(`OPENAI_API_KEY=${key}`, "test.env");
    expect(findings.some((f) => f.type === "openai-key")).toBe(true);
  });

  // ── Anthropic ─────────────────────────────────────────────────────────────
  test("detects Anthropic API key", () => {
    const key = "sk-ant-" + "a".repeat(92);
    const findings = scanText(`ANTHROPIC_KEY=${key}`, "test.env");
    expect(findings.some((f) => f.type === "anthropic-key")).toBe(true);
  });

  // ── Google ────────────────────────────────────────────────────────────────
  test("detects Google API key", () => {
    const findings = scanText(
      "GOOGLE_API_KEY=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI",
      "test.env"
    );
    expect(findings.some((f) => f.type === "google-api-key")).toBe(true);
  });

  // ── NPM ───────────────────────────────────────────────────────────────────
  test("detects NPM access token", () => {
    const findings = scanText(
      "NPM_TOKEN=npm_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij",
      "test.env"
    );
    expect(findings.some((f) => f.type === "npm-token")).toBe(true);
  });

  // ── Slack ─────────────────────────────────────────────────────────────────
  test("detects Slack bot token", () => {
    const findings = scanText(
      `SLACK_TOKEN=${SLACK_BOT_TOKEN}`,
      "test.env"
    );
    expect(findings.some((f) => f.type === "slack-token")).toBe(true);
  });

  // ── SendGrid ──────────────────────────────────────────────────────────────
  test("detects SendGrid API key", () => {
    const findings = scanText(
      "SENDGRID_KEY=SG.abcdefghijklmnopqrstuvw.ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq",
      "test.env"
    );
    expect(findings.some((f) => f.type === "sendgrid-key")).toBe(true);
  });

  // ── Database URLs ─────────────────────────────────────────────────────────
  test("detects PostgreSQL connection string", () => {
    const findings = scanText(
      "DATABASE_URL=postgresql://myuser:mypassword@localhost:5432/mydb",
      "test.env"
    );
    expect(findings.some((f) => f.type === "db-postgres")).toBe(true);
  });

  test("detects MySQL connection string", () => {
    const findings = scanText(
      "DB_URL=mysql://root:secret@127.0.0.1:3306/mydb",
      "test.env"
    );
    expect(findings.some((f) => f.type === "db-mysql")).toBe(true);
  });

  test("detects MongoDB connection string", () => {
    const findings = scanText(
      "MONGO_URI=mongodb://user:pass@cluster0.mongodb.net/mydb",
      "test.env"
    );
    expect(findings.some((f) => f.type === "db-mongodb")).toBe(true);
  });

  // ── Shopify ───────────────────────────────────────────────────────────────
  test("detects Shopify access token", () => {
    const findings = scanText(
      `SHOPIFY_TOKEN=${SHOPIFY_ACCESS_TOKEN}`,
      "test.env"
    );
    expect(findings.some((f) => f.type === "shopify-access-token")).toBe(true);
  });

  test("detects Shopify shared secret", () => {
    const findings = scanText(
      `SHOPIFY_SECRET=${SHOPIFY_SHARED_SECRET}`,
      "test.env"
    );
    expect(findings.some((f) => f.type === "shopify-shared-secret")).toBe(true);
  });

  // ── Square ────────────────────────────────────────────────────────────────
  test("detects Square access token", () => {
    const findings = scanText(
      "SQUARE_TOKEN=sq0atp-abcdefghijklmnopqrstuvw",
      "test.env"
    );
    expect(findings.some((f) => f.type === "square-access-token")).toBe(true);
  });

  // ── New Relic ─────────────────────────────────────────────────────────────
  test("detects New Relic license key", () => {
    const findings = scanText(
      `NEW_RELIC_LICENSE_KEY=${NEW_RELIC_LICENSE_KEY}`,
      "test.env"
    );
    expect(findings.some((f) => f.type === "new-relic-license")).toBe(true);
  });

  test("does not flag ordinary source-code assignments as high entropy", () => {
    const findings = scanText(
      "fontData = readFileSync(fontPath).buffer as ArrayBuffer",
      "generate-medium-images.ts"
    );
    expect(findings.some((f) => f.type === "high-entropy-string")).toBe(false);
  });

  test("does not flag regex pattern definitions inside scanner source", () => {
    const findings = scanText(
      'pattern: /"type": "service_account"/,',
      "scanner.ts"
    );
    expect(findings.some((f) => f.type === "firebase-service-account")).toBe(false);
  });

  test("does not flag obvious placeholder env values as high entropy", () => {
    const findings = scanText(
      "CONVEX_DEPLOYMENT=dev:your_convex_deployment_name",
      ".env.example"
    );
    expect(findings.some((f) => f.type === "high-entropy-string")).toBe(false);
  });

  // ── Private key ───────────────────────────────────────────────────────────
  test("detects RSA private key block", () => {
    const findings = scanText(
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...",
      "id_rsa"
    );
    expect(findings.some((f) => f.type === "private-key")).toBe(true);
  });

  // ── Comment skipping ──────────────────────────────────────────────────────
  test("skips comment lines for regular patterns", () => {
    const findings = scanText(
      `# STRIPE_SECRET_KEY=${STRIPE_LIVE_KEY}`,
      "test.env"
    );
    expect(findings.some((f) => f.type === "stripe-live-key")).toBe(false);
  });

  // ── Deduplication ─────────────────────────────────────────────────────────
  test("does not produce duplicate findings for the same value on the same line", () => {
    const line = `TOKEN=${STRIPE_LIVE_KEY}`;
    const findings = scanText(line, "test.env");
    const stripeFindings = findings.filter((f) => f.type === "stripe-live-key");
    expect(stripeFindings).toHaveLength(1);
  });

  // ── File / line metadata ──────────────────────────────────────────────────
  test("populates file and line number correctly", () => {
    const content = `FIRST=foo\nSTRIPE_KEY=${STRIPE_LIVE_KEY}`;
    const findings = scanText(content, ".env.production");
    const f = findings.find((x) => x.type === "stripe-live-key");
    expect(f).toBeDefined();
    expect(f!.file).toBe(".env.production");
    expect(f!.line).toBe(2);
  });

  // ── Masked value format ───────────────────────────────────────────────────
  test("maskedValue follows the expected format", () => {
    const findings = scanText(
      `STRIPE_KEY=${STRIPE_LIVE_KEY}`,
      "test.env"
    );
    const f = findings.find((x) => x.type === "stripe-live-key");
    expect(f).toBeDefined();
    expect(f!.maskedValue).toMatch(/^.{8}\.\.\..{4}$/);
  });
});
