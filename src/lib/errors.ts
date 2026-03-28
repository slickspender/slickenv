export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export class AuthError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

export class ParseError extends Error {
  line?: number;

  constructor(message: string, line?: number) {
    super(message);
    this.name = "ParseError";
    this.line = line;
  }
}

export class ApiRequestError extends Error {
  code: string;
  data?: Record<string, unknown>;

  constructor(code: string, message: string, data?: Record<string, unknown>) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
    this.data = data;
  }
}
