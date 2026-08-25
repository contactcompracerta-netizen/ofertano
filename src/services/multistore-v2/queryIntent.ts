import { buildQueryCore, queryIntentFromCore } from "./queryCore";
import type { QueryIntent } from "./types";

export function buildQueryIntent(query: string): QueryIntent {
  return queryIntentFromCore(buildQueryCore(query));
}
