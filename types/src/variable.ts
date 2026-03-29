export type VariableVisibility = "public" | "private";

export type VariableType = "string" | "number" | "boolean";

/** Output of the .env parser — before encryption */
export interface ParsedVariable {
  key: string;
  value: string;
  visibility: VariableVisibility;
  type: VariableType;
  required: boolean;
  example?: string;
  /** True if defaults were applied (no metadata comment found) */
  metadataWasInjected: boolean;
}

/** Variable as stored in the backend / sent over the wire */
export interface Variable {
  key: string;
  /** Ciphertext (base64) for private vars, plaintext for public vars */
  value: string;
  isEncrypted: boolean;
  /** Base64-encoded 12-byte IV, required if isEncrypted */
  iv?: string;
  visibility: VariableVisibility;
  type: VariableType;
  required: boolean;
  example?: string;
  updatedAt: number;
}

export type DiffStatus = "added" | "removed" | "modified" | "unchanged";

export interface VariableDiff {
  key: string;
  status: DiffStatus;
  local?: {
    value: string;
    visibility: VariableVisibility;
    type: VariableType;
  };
  remote?: {
    value: string;
    visibility: VariableVisibility;
    type: VariableType;
    modifiedBy: string;
    modifiedAt: number;
  };
}
