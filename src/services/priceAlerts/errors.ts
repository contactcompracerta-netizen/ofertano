export const PRICE_ALERT_ERROR_CODES = {
  INVALID_USER: "INVALID_USER",
  INVALID_PRODUCT_ID: "INVALID_PRODUCT_ID",
  PRODUCT_NOT_FOUND: "PRODUCT_NOT_FOUND",
  INVALID_ALERT_ID: "INVALID_ALERT_ID",
  ALERT_NOT_FOUND: "ALERT_NOT_FOUND",
  INVALID_TYPE: "INVALID_TYPE",
  INVALID_TARGET_PRICE: "INVALID_TARGET_PRICE",
  TARGET_PRICE_REQUIRED: "TARGET_PRICE_REQUIRED",
  TARGET_PRICE_NOT_ALLOWED: "TARGET_PRICE_NOT_ALLOWED",
  INVALID_UPDATE: "INVALID_UPDATE",
} as const;

export type PriceAlertErrorCode =
  (typeof PRICE_ALERT_ERROR_CODES)[keyof typeof PRICE_ALERT_ERROR_CODES];

export class PriceAlertError extends Error {
  readonly code: PriceAlertErrorCode;

  constructor(code: PriceAlertErrorCode, message: string) {
    super(message);
    this.name = "PriceAlertError";
    this.code = code;
  }
}

export function isPriceAlertError(
  error: unknown
): error is PriceAlertError {
  return error instanceof PriceAlertError;
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
