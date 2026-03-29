import type { ParsedVariable, VariableVisibility, VariableType } from "@slickenv/types";
import { ParseError } from "./errors.js";

const VALID_KEY_REGEX = /^[A-Z_][A-Z0-9_]*$/i;
const MAX_KEY_LENGTH = 256;
const MAX_VALUE_BYTES = 8 * 1024; // 8KB

const METADATA_REGEX = /@(\w+)=(\S+)/g;

/**
 * Validate an environment variable key.
 */
function validateKey(key: string, lineNumber: number): void {
  if (!VALID_KEY_REGEX.test(key)) {
    throw new ParseError(
      `Invalid key "${key}" on line ${lineNumber}. Keys must start with a letter or underscore and contain only letters, numbers, and underscores.`,
      lineNumber
    );
  }

  if (key.length > MAX_KEY_LENGTH) {
    throw new ParseError(
      `Key on line ${lineNumber} exceeds maximum length of ${MAX_KEY_LENGTH} characters.`,
      lineNumber
    );
  }
}

/**
 * Validate an environment variable value.
 */
function validateValue(value: string, key: string): void {
  if (Buffer.byteLength(value, "utf8") > MAX_VALUE_BYTES) {
    throw new ParseError(`Value for "${key}" exceeds maximum size of 8KB.`);
  }
}

/**
 * Parse metadata annotations from a comment line.
 * Supports: @visibility, @required, @type, @example
 */
function parseMetadata(comment: string): Partial<Pick<ParsedVariable, "visibility" | "type" | "required" | "example">> {
  const metadata: Partial<Pick<ParsedVariable, "visibility" | "type" | "required" | "example">> = {};
  let match;

  METADATA_REGEX.lastIndex = 0;
  while ((match = METADATA_REGEX.exec(comment)) !== null) {
    const [, field, value] = match;

    switch (field) {
      case "visibility":
        if (value === "public" || value === "private") {
          metadata.visibility = value as VariableVisibility;
        }
        break;
      case "type":
        if (value === "string" || value === "number" || value === "boolean") {
          metadata.type = value as VariableType;
        }
        break;
      case "required":
        metadata.required = value === "true";
        break;
      case "example":
        metadata.example = value;
        break;
      // Unknown fields silently ignored (forward compatibility)
    }
  }

  return metadata;
}

/**
 * Unquote a value — remove surrounding single or double quotes.
 */
function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Parse a .env file content into typed ParsedVariable[].
 *
 * Supports:
 * - KEY=value, KEY="quoted value", KEY='single quoted'
 * - export KEY=value (export prefix stripped)
 * - Empty values (KEY=)
 * - Metadata annotations: # @visibility=private @required=true @type=string @example=...
 * - Duplicate key warnings (last occurrence wins)
 */
export function parseEnvFile(content: string): ParsedVariable[] {
  const lines = content.split("\n");
  const variables: ParsedVariable[] = [];
  const seenKeys = new Map<string, number>(); // key → line number
  const duplicateWarnings: string[] = [];

  let pendingMetadata: ReturnType<typeof parseMetadata> | null = null;

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const line = lines[i]!.trim();

    // Skip empty lines
    if (line === "") {
      pendingMetadata = null;
      continue;
    }

    // Comment line — check for metadata annotations
    if (line.startsWith("#")) {
      if (line.includes("@")) {
        pendingMetadata = parseMetadata(line);
      } else {
        // Freeform comment — reset pending metadata
        pendingMetadata = null;
      }
      continue;
    }

    // Strip `export ` prefix
    let kvLine = line;
    if (kvLine.startsWith("export ")) {
      kvLine = kvLine.slice(7);
    }

    // Parse KEY=VALUE
    const eqIndex = kvLine.indexOf("=");
    if (eqIndex === -1) {
      pendingMetadata = null;
      continue; // Skip lines without =
    }

    const key = kvLine.slice(0, eqIndex).trim();
    const rawValue = kvLine.slice(eqIndex + 1);
    const value = unquote(rawValue.trim());

    validateKey(key, lineNumber);
    validateValue(value, key);

    // Track duplicates
    const prevLine = seenKeys.get(key);
    if (prevLine !== undefined) {
      duplicateWarnings.push(
        `Duplicate key found: ${key} (lines ${prevLine} and ${lineNumber})`
      );
    }
    seenKeys.set(key, lineNumber);

    // Apply metadata or defaults
    const hasMetadata = pendingMetadata !== null && Object.keys(pendingMetadata).length > 0;

    const variable: ParsedVariable = {
      key,
      value,
      visibility: pendingMetadata?.visibility ?? "private",
      type: pendingMetadata?.type ?? "string",
      required: pendingMetadata?.required ?? false,
      example: pendingMetadata?.example,
      metadataWasInjected: !hasMetadata,
    };

    // Remove any previous entry with the same key (last occurrence wins)
    if (prevLine !== undefined) {
      const idx = variables.findIndex((v) => v.key === key);
      if (idx !== -1) variables.splice(idx, 1);
    }

    variables.push(variable);
    pendingMetadata = null;
  }

  // Log duplicate warnings to stderr
  for (const warning of duplicateWarnings) {
    console.warn(`⚠  ${warning}`);
  }

  return variables;
}

/**
 * Build a metadata comment line for a variable.
 */
function buildMetadataComment(v: ParsedVariable): string {
  const meta: string[] = [];
  meta.push(`@visibility=${v.visibility}`);
  meta.push(`@type=${v.type}`);
  if (v.required) meta.push(`@required=true`);
  if (v.example) meta.push(`@example=${v.example}`);
  return `# ${meta.join(" ")}`;
}

/**
 * Inject metadata comments into the original .env content.
 * Preserves all existing comments, blank lines, and formatting.
 * Only adds a metadata comment above variables that don't already have one.
 */
export function serializeEnvFile(variables: ParsedVariable[], originalContent?: string): string {
  // If no original content, generate from scratch
  if (!originalContent) {
    const lines: string[] = [];
    for (const v of variables) {
      lines.push(buildMetadataComment(v));
      lines.push(`${v.key}=${v.value}`);
    }
    return lines.join("\n") + "\n";
  }

  // Build a map of variables that need metadata injected
  const needsMetadata = new Map<string, ParsedVariable>();
  for (const v of variables) {
    if (v.metadataWasInjected) {
      needsMetadata.set(v.key, v);
    }
  }

  const originalLines = originalContent.split("\n");
  const result: string[] = [];

  for (let i = 0; i < originalLines.length; i++) {
    const line = originalLines[i]!;
    const trimmed = line.trim();

    // Check if this line is a KEY=VALUE line
    let kvLine = trimmed;
    if (kvLine.startsWith("export ")) {
      kvLine = kvLine.slice(7);
    }

    const eqIndex = kvLine.indexOf("=");
    if (trimmed !== "" && !trimmed.startsWith("#") && eqIndex !== -1) {
      const key = kvLine.slice(0, eqIndex).trim();
      const varInfo = needsMetadata.get(key);

      if (varInfo) {
        // Insert metadata comment above this variable
        result.push(buildMetadataComment(varInfo));
        needsMetadata.delete(key);
      }
    }

    result.push(line);
  }

  // Ensure file ends with a newline
  const output = result.join("\n");
  return output.endsWith("\n") ? output : output + "\n";
}
