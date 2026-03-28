import { describe, expect, test } from "bun:test";
import { parseEnvFile } from "../parser.js";
describe("parseEnvFile", () => {
    test("parses simple KEY=value pairs", () => {
        const result = parseEnvFile("FOO=bar\nBAZ=qux");
        expect(result).toHaveLength(2);
        expect(result[0].key).toBe("FOO");
        expect(result[0].value).toBe("bar");
        expect(result[1].key).toBe("BAZ");
        expect(result[1].value).toBe("qux");
    });
    test("handles double-quoted values", () => {
        const result = parseEnvFile('KEY="hello world"');
        expect(result[0].value).toBe("hello world");
    });
    test("handles single-quoted values", () => {
        const result = parseEnvFile("KEY='hello world'");
        expect(result[0].value).toBe("hello world");
    });
    test("handles empty values", () => {
        const result = parseEnvFile("EMPTY=");
        expect(result[0].value).toBe("");
    });
    test("strips export prefix", () => {
        const result = parseEnvFile("export API_KEY=secret123");
        expect(result[0].key).toBe("API_KEY");
        expect(result[0].value).toBe("secret123");
    });
    test("skips comments and blank lines", () => {
        const content = `
# This is a comment
FOO=bar

# Another comment
BAZ=qux
`;
        const result = parseEnvFile(content);
        expect(result).toHaveLength(2);
    });
    test("parses metadata annotations", () => {
        const content = `# @visibility=public @required=true @type=number @example=8080
PORT=3000`;
        const result = parseEnvFile(content);
        expect(result[0].visibility).toBe("public");
        expect(result[0].required).toBe(true);
        expect(result[0].type).toBe("number");
        expect(result[0].example).toBe("8080");
        expect(result[0].metadataWasInjected).toBe(false);
    });
    test("defaults to private visibility and string type", () => {
        const result = parseEnvFile("SECRET=abc");
        expect(result[0].visibility).toBe("private");
        expect(result[0].type).toBe("string");
        expect(result[0].required).toBe(false);
        expect(result[0].metadataWasInjected).toBe(true);
    });
    test("last occurrence wins for duplicate keys", () => {
        const content = "KEY=first\nKEY=second";
        const result = parseEnvFile(content);
        expect(result).toHaveLength(1);
        expect(result[0].value).toBe("second");
    });
    test("handles values with = signs", () => {
        const result = parseEnvFile("URL=postgres://user:pass@host/db?ssl=true");
        expect(result[0].value).toBe("postgres://user:pass@host/db?ssl=true");
    });
    test("skips lines without = sign", () => {
        const result = parseEnvFile("VALID=yes\ninvalid_line\nALSO_VALID=yes");
        expect(result).toHaveLength(2);
    });
    test("validates key format", () => {
        expect(() => parseEnvFile("123BAD=value")).toThrow();
    });
    test("metadata resets on blank line", () => {
        const content = `# @visibility=public

SECRET=abc`;
        const result = parseEnvFile(content);
        expect(result[0].visibility).toBe("private");
        expect(result[0].metadataWasInjected).toBe(true);
    });
    test("handles underscore-prefixed keys", () => {
        const result = parseEnvFile("_INTERNAL=value");
        expect(result[0].key).toBe("_INTERNAL");
    });
});
//# sourceMappingURL=parser.test.js.map