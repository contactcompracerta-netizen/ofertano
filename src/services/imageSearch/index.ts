export {
  IMAGE_SEARCH_ACCEPT_ATTR,
  IMAGE_SEARCH_ACCEPTED_MIME,
  IMAGE_SEARCH_MAX_BYTES,
  IMAGE_SEARCH_MAX_QUERY_LENGTH,
  IMAGE_SEARCH_PUBLIC_PATH,
  IMAGE_SEARCH_QUERY_PARAM,
} from "./types";
export type {
  ImageFileMeta,
  ImageSearchConfidence,
  ImageSearchQueryResult,
  ImageSearchSignals,
  ImageValidationResult,
} from "./types";

export {
  sniffImageMime,
  validateImageFile,
  validateImageFileMeta,
  validateImageMagic,
} from "./fileValidation";

export {
  cleanOcrText,
  isValidGtin,
  pickBestGtin,
} from "./cleanOcrText";

export {
  buildPublicSearchHandoffUrl,
  buildQueryFromOcr,
  queryReachesExistingPlan,
} from "./buildQueryFromOcr";
