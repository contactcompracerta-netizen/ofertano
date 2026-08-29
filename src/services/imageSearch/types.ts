export type ImageSearchConfidence = "HIGH" | "MEDIUM" | "LOW" | "NONE";

export type ImageSearchSignals = {
  category: string | null;
  brand: string | null;
  model: string | null;
  codes: string[];
  gtin: string | null;
  packagingText: string | null;
};

export type ImageSearchQueryResult = {
  query: string;
  displayQuery: string;
  confidence: ImageSearchConfidence;
  needsUserCorrection: boolean;
  reason: string;
  signals: ImageSearchSignals;
};

export type ImageFileMeta = {
  name: string;
  type: string;
  size: number;
};

export type ImageValidationOk = {
  ok: true;
};

export type ImageValidationError = {
  ok: false;
  error: string;
};

export type ImageValidationResult = ImageValidationOk | ImageValidationError;

export const IMAGE_SEARCH_MAX_BYTES = 8 * 1024 * 1024;
export const IMAGE_SEARCH_MAX_QUERY_LENGTH = 160;
export const IMAGE_SEARCH_PUBLIC_PATH = "/";
export const IMAGE_SEARCH_QUERY_PARAM = "q";

export const IMAGE_SEARCH_ACCEPTED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export const IMAGE_SEARCH_ACCEPT_ATTR =
  "image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp";
