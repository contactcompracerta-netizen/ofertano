export const FAVORITE_ERROR_CODES = {
  INVALID_USER: "INVALID_USER",
  INVALID_PRODUCT_ID: "INVALID_PRODUCT_ID",
  PRODUCT_NOT_FOUND: "PRODUCT_NOT_FOUND",
} as const;

export type FavoriteErrorCode =
  (typeof FAVORITE_ERROR_CODES)[keyof typeof FAVORITE_ERROR_CODES];

export class FavoriteError extends Error {
  readonly code: FavoriteErrorCode;

  constructor(code: FavoriteErrorCode, message: string) {
    super(message);
    this.name = "FavoriteError";
    this.code = code;
  }
}

export function isFavoriteError(
  error: unknown
): error is FavoriteError {
  return error instanceof FavoriteError;
}

export function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "UniqueConstraintError" ||
      error.message === "UNIQUE_CONSTRAINT")
  );
}

export function criarErroDuplicado() {
  const error = new Error("UNIQUE_CONSTRAINT");
  error.name = "UniqueConstraintError";
  return error;
}
