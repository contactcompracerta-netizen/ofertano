export const EDITORIAL_ERROR_CODES = {
  INVALID_INPUT: "INVALID_INPUT",
  INVALID_JSON: "INVALID_JSON",
  INVALID_PACKAGE: "INVALID_PACKAGE",
  INCOMPLETE_CONTENT: "INCOMPLETE_CONTENT",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
} as const;

export type EditorialErrorCode =
  (typeof EDITORIAL_ERROR_CODES)[keyof typeof EDITORIAL_ERROR_CODES];

export class EditorialError extends Error {
  readonly code: EditorialErrorCode;
  readonly details?: string[];

  constructor(
    code: EditorialErrorCode,
    message: string,
    details?: string[],
  ) {
    super(message);
    this.name = "EditorialError";
    this.code = code;
    this.details = details;
  }
}

export function isEditorialError(
  error: unknown,
): error is EditorialError {
  return error instanceof EditorialError;
}
