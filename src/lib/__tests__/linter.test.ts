import { describe, expect, test } from "bun:test";
import { lintEnvFile, type LintIssue } from "../linter.js";
import type { ParsedVariable } from "@slickenv/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVar(overrides: Partial<ParsedVariable> & { key: string }): ParsedVariable {
  return {
    value: "somevalue",
    visibility: "private",
    type: "string",
    required: false,
    metadataWasInjected: true,
    ...overrides,
  };
}

function hasRule(issues: LintIssue[], rule: string): boolean {
  return issues.some((i) => i.rule === rule);
}

// ---------------------------------------------------------------------------
// Rule 1: lowercase-key
// ---------------------------------------------------------------------------

describe("rule: lowercase-key", () => {
  test("flags a key that is not fully uppercase", () => {
    const issues = lintEnvFile([makeVar({ key: "dataBaseUrl" })]);
    expect(hasRule(issues, "lowercase-key")).toBe(true);
  });

  test("flags a mixed-case key", () => {
    const issues = lintEnvFile([makeVar({ key: "Api_Key" })]);
    expect(hasRule(issues, "lowercase-key")).toBe(true);
  });

  test("does not flag an uppercase key", () => {
    const issues = lintEnvFile([makeVar({ key: "DATABASE_URL" })]);
    expect(hasRule(issues, "lowercase-key")).toBe(false);
  });

  test("issue message suggests the uppercased key", () => {
    const issues = lintEnvFile([makeVar({ key: "myKey" })]);
    const issue = issues.find((i) => i.rule === "lowercase-key");
    expect(issue?.message).toContain("MYKEY");
  });
});

// ---------------------------------------------------------------------------
// Rule 2: starts-with-digit
// ---------------------------------------------------------------------------

describe("rule: starts-with-digit", () => {
  test("flags a key starting with a digit", () => {
    const issues = lintEnvFile([makeVar({ key: "1_BAD_KEY" })]);
    expect(hasRule(issues, "starts-with-digit")).toBe(true);
  });

  test("does not flag a key starting with a letter", () => {
    const issues = lintEnvFile([makeVar({ key: "GOOD_KEY" })]);
    expect(hasRule(issues, "starts-with-digit")).toBe(false);
  });

  test("does not flag a key starting with underscore", () => {
    const issues = lintEnvFile([makeVar({ key: "_INTERNAL" })]);
    expect(hasRule(issues, "starts-with-digit")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rule 3: illegal-chars
// ---------------------------------------------------------------------------

describe("rule: illegal-chars", () => {
  test("flags a key with a hyphen", () => {
    const issues = lintEnvFile([makeVar({ key: "MY-KEY" })]);
    expect(hasRule(issues, "illegal-chars")).toBe(true);
  });

  test("flags a key with a dot", () => {
    const issues = lintEnvFile([makeVar({ key: "MY.KEY" })]);
    expect(hasRule(issues, "illegal-chars")).toBe(true);
  });

  test("does not flag a key with only A-Z, 0-9, and underscore", () => {
    const issues = lintEnvFile([makeVar({ key: "MY_KEY_123" })]);
    expect(hasRule(issues, "illegal-chars")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rule 4: duplicate-key
// ---------------------------------------------------------------------------

describe("rule: duplicate-key", () => {
  test("flags duplicate keys in the same variable list", () => {
    const issues = lintEnvFile([
      makeVar({ key: "API_KEY" }),
      makeVar({ key: "API_KEY", value: "other" }),
    ]);
    expect(hasRule(issues, "duplicate-key")).toBe(true);
  });

  test("duplicate issue is emitted only once per key", () => {
    const issues = lintEnvFile([
      makeVar({ key: "API_KEY" }),
      makeVar({ key: "API_KEY", value: "other" }),
    ]);
    const dupes = issues.filter((i) => i.rule === "duplicate-key");
    expect(dupes).toHaveLength(1);
  });

  test("does not flag unique keys", () => {
    const issues = lintEnvFile([
      makeVar({ key: "KEY_A" }),
      makeVar({ key: "KEY_B" }),
    ]);
    expect(hasRule(issues, "duplicate-key")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rule 5: unquoted-spaces
// ---------------------------------------------------------------------------

describe("rule: unquoted-spaces", () => {
  test("flags a value containing spaces", () => {
    const issues = lintEnvFile([makeVar({ key: "GREETING", value: "hello world" })]);
    expect(hasRule(issues, "unquoted-spaces")).toBe(true);
  });

  test("does not flag a value without spaces", () => {
    const issues = lintEnvFile([makeVar({ key: "GREETING", value: "hello" })]);
    expect(hasRule(issues, "unquoted-spaces")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rule 6: no-service-prefix
// ---------------------------------------------------------------------------

describe("rule: no-service-prefix", () => {
  test("flags the exact key API_KEY", () => {
    const issues = lintEnvFile([makeVar({ key: "API_KEY" })]);
    expect(hasRule(issues, "no-service-prefix")).toBe(true);
  });

  test("flags the exact key SECRET_KEY", () => {
    const issues = lintEnvFile([makeVar({ key: "SECRET_KEY" })]);
    expect(hasRule(issues, "no-service-prefix")).toBe(true);
  });

  test("flags the exact key TOKEN", () => {
    const issues = lintEnvFile([makeVar({ key: "TOKEN" })]);
    expect(hasRule(issues, "no-service-prefix")).toBe(true);
  });

  test("does not flag STRIPE_API_KEY (has service prefix)", () => {
    const issues = lintEnvFile([makeVar({ key: "STRIPE_API_KEY" })]);
    expect(hasRule(issues, "no-service-prefix")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rule 7: short-key
// ---------------------------------------------------------------------------

describe("rule: short-key", () => {
  test("flags a key with 1 character", () => {
    const issues = lintEnvFile([makeVar({ key: "X" })]);
    expect(hasRule(issues, "short-key")).toBe(true);
  });

  test("flags a key with 2 characters", () => {
    const issues = lintEnvFile([makeVar({ key: "DB" })]);
    expect(hasRule(issues, "short-key")).toBe(true);
  });

  test("does not flag a key with 3+ characters", () => {
    const issues = lintEnvFile([makeVar({ key: "PORT" })]);
    expect(hasRule(issues, "short-key")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rule 8: shadows-system
// ---------------------------------------------------------------------------

describe("rule: shadows-system", () => {
  const systemVars = ["PATH", "HOME", "USER", "SHELL", "TERM", "LANG", "PWD", "TMPDIR", "TEMP", "TMP"];

  for (const sv of systemVars) {
    test(`flags ${sv}`, () => {
      const issues = lintEnvFile([makeVar({ key: sv })]);
      expect(hasRule(issues, "shadows-system")).toBe(true);
    });
  }

  test("does not flag APP_PATH", () => {
    const issues = lintEnvFile([makeVar({ key: "APP_PATH" })]);
    expect(hasRule(issues, "shadows-system")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rule 9: not-in-example
// ---------------------------------------------------------------------------

describe("rule: not-in-example", () => {
  test("flags a key absent from exampleKeys", () => {
    const issues = lintEnvFile(
      [makeVar({ key: "UNDOCUMENTED_KEY" })],
      ["DATABASE_URL", "PORT"]
    );
    expect(hasRule(issues, "not-in-example")).toBe(true);
  });

  test("does not flag a key present in exampleKeys", () => {
    const issues = lintEnvFile(
      [makeVar({ key: "DATABASE_URL" })],
      ["DATABASE_URL", "PORT"]
    );
    expect(hasRule(issues, "not-in-example")).toBe(false);
  });

  test("does not trigger when exampleKeys is undefined", () => {
    const issues = lintEnvFile([makeVar({ key: "ANY_KEY" })]);
    expect(hasRule(issues, "not-in-example")).toBe(false);
  });

  test("does not trigger when exampleKeys is an empty array", () => {
    const issues = lintEnvFile([makeVar({ key: "ANY_KEY" })], []);
    expect(hasRule(issues, "not-in-example")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rule 10: inconsistent-prefix
// ---------------------------------------------------------------------------

describe("rule: inconsistent-prefix", () => {
  test("flags when 2+ different prefixes are used", () => {
    const issues = lintEnvFile([
      makeVar({ key: "DB_HOST" }),
      makeVar({ key: "DATABASE_URL" }),
      makeVar({ key: "CACHE_TTL" }),
    ]);
    expect(hasRule(issues, "inconsistent-prefix")).toBe(true);
  });

  test("does not flag when all keys share the same prefix", () => {
    const issues = lintEnvFile([
      makeVar({ key: "DB_HOST" }),
      makeVar({ key: "DB_PORT" }),
      makeVar({ key: "DB_NAME" }),
    ]);
    expect(hasRule(issues, "inconsistent-prefix")).toBe(false);
  });

  test("does not flag a single-key file", () => {
    const issues = lintEnvFile([makeVar({ key: "DB_HOST" })]);
    expect(hasRule(issues, "inconsistent-prefix")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rule 11: empty-value
// ---------------------------------------------------------------------------

describe("rule: empty-value", () => {
  test("flags a variable with an empty value", () => {
    const issues = lintEnvFile([makeVar({ key: "OPTIONAL_KEY", value: "" })]);
    expect(hasRule(issues, "empty-value")).toBe(true);
  });

  test("empty-value is emitted at info level", () => {
    const issues = lintEnvFile([makeVar({ key: "OPTIONAL_KEY", value: "" })]);
    const issue = issues.find((i) => i.rule === "empty-value");
    expect(issue?.level).toBe("info");
  });

  test("does not flag a non-empty value", () => {
    const issues = lintEnvFile([makeVar({ key: "OPTIONAL_KEY", value: "something" })]);
    expect(hasRule(issues, "empty-value")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Valid input — no issues
// ---------------------------------------------------------------------------

describe("valid input produces no issues", () => {
  test("a well-formed, fully-documented env file emits no errors", () => {
    const vars: ParsedVariable[] = [
      makeVar({ key: "DATABASE_URL", value: "postgres://localhost/mydb" }),
      makeVar({ key: "REDIS_URL", value: "redis://localhost:6379" }),
      makeVar({ key: "PORT", value: "3000" }),
    ];
    const exampleKeys = ["DATABASE_URL", "REDIS_URL", "PORT"];
    const issues = lintEnvFile(vars, exampleKeys);
    const errors = issues.filter((i) => i.level === "error");
    expect(errors).toHaveLength(0);
  });

  test("returns empty array for empty variable list", () => {
    const issues = lintEnvFile([]);
    expect(issues).toHaveLength(0);
  });
});
