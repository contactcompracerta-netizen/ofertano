/**
 * Feed Ingestion Engine V1 - URL Safety Helper.
 *
 * Pure function:
 * - no network request
 * - no DNS lookup
 * - deterministic
 *
 * CATALOG REMAINS FROZEN.
 */

export type SafeUrlResult =
  | { status: 'ABSENT' }
  | { status: 'VALID'; value: string }
  | { status: 'INVALID' };

/**
 * Validates an external URL without performing network access.
 */
export function toSafeExternalUrl(
  value: string | undefined | null
): SafeUrlResult {
  if (value === undefined || value === null) {
    return { status: 'ABSENT' };
  }

  const normalized = value.trim();

  if (!normalized) {
    return { status: 'ABSENT' };
  }

  try {
    const url = new URL(normalized);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { status: 'INVALID' };
    }

    if (url.username !== '' || url.password !== '') {
      return { status: 'INVALID' };
    }

    return {
      status: 'VALID',
      value: url.toString(),
    };
  } catch {
    return { status: 'INVALID' };
  }
}

/**
 * Returns true only for safe absolute HTTP(S) URLs.
 */
export function isSafeExternalUrl(
  value: string | undefined | null
): boolean {
  return toSafeExternalUrl(value).status === 'VALID';
}