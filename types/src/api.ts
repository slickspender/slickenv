import type { VariableVisibility, VariableType } from "./variable.js";

// ── Error Codes ──────────────────────────────────────────────────────

export type ApiErrorCode =
  | "SLUG_TAKEN"
  | "INVALID_SLUG"
  | "PROJECT_LIMIT_REACHED"
  | "CONFLICT_DETECTED"
  | "PROJECT_NOT_FOUND"
  | "UNAUTHORIZED"
  | "USER_NOT_FOUND"
  | "VAR_LIMIT_REACHED"
  | "VERSION_NOT_FOUND"
  | "ALREADY_ACTIVE"
  | "INVALID_KEY"
  | "PARSE_ERROR";

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  data?: Record<string, unknown>;
}

// ── Push ─────────────────────────────────────────────────────────────

export interface PushVariableInput {
  key: string;
  value: string;
  isEncrypted: boolean;
  iv?: string;
  visibility: VariableVisibility;
  type: VariableType;
  required: boolean;
  example?: string;
}

export interface PushInput {
  projectId: string;
  label: string;
  variables: PushVariableInput[];
  changeSummary?: string;
  baseVersion: number;
}

export interface PushOutput {
  newVersion: number;
  environmentId: string;
}

// ── Pull ─────────────────────────────────────────────────────────────

export interface PullInput {
  projectId: string;
  label: string;
  version?: number;
}

export interface PullVariableOutput {
  key: string;
  value: string;
  isEncrypted: boolean;
  iv?: string;
  visibility: VariableVisibility;
  type: VariableType;
  required: boolean;
  example?: string;
}

export interface PullOutput {
  version: number;
  environmentId: string;
  createdAt: number;
  createdBy: string;
  changeSummary?: string;
  variables: PullVariableOutput[];
}

// ── List Versions ────────────────────────────────────────────────────

export interface ListVersionsInput {
  projectId: string;
  label: string;
  limit?: number;
  cursor?: string;
}

export interface ListVersionsOutput {
  versions: Array<{
    version: number;
    createdAt: number;
    createdBy: string;
    changeSummary?: string;
    variableCount: number;
    isActive: boolean;
  }>;
  nextCursor?: string;
}

// ── Rollback ─────────────────────────────────────────────────────────

export interface RollbackInput {
  projectId: string;
  label: string;
  targetVersion: number;
}

export interface RollbackOutput {
  newVersion: number;
}
