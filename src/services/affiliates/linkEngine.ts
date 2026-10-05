import { toSafeExternalUrl } from "@/services/architecture/v1/security/safeUrl";

export const AFFILIATE_PROVIDER_FLAG_NAMES = {
  awin: "AFFILIATE_AWIN_ENABLED",
  shopee: "AFFILIATE_SHOPEE_ENABLED",
  amazon: "AFFILIATE_AMAZON_ENABLED",
  aliexpress: "AFFILIATE_ALIEXPRESS_ENABLED",
} as const;

export type AffiliateProviderId = keyof typeof AFFILIATE_PROVIDER_FLAG_NAMES;

export type AffiliateLinkInput = {
  marketplace: string;
  originalUrl: string;
  affiliateNetwork?: string | null;
  offerId?: string;
  productId?: string;
};

export type AffiliateProviderBuildResult = {
  url: unknown;
  monetized?: boolean;
};

export interface AffiliateProvider {
  readonly id: AffiliateProviderId;
  supports(input: AffiliateLinkInput): boolean;
  isConfigured(): boolean;
  buildLink(input: AffiliateLinkInput): Promise<AffiliateProviderBuildResult>;
}

export type AffiliateProviderFlags = Record<AffiliateProviderId, boolean>;

export type AffiliateLinkResult = {
  url: string | null;
  provider: AffiliateProviderId | "passthrough";
  monetized: boolean;
  fallbackUsed: boolean;
  reason?: string;
};

export const DEFAULT_AFFILIATE_PROVIDER_FLAGS: Readonly<AffiliateProviderFlags> = {
  awin: false,
  shopee: false,
  amazon: false,
  aliexpress: false,
};

export function readAffiliateProviderFlags(
  env: Record<string, string | undefined> = process.env,
): AffiliateProviderFlags {
  return Object.fromEntries(
    Object.entries(AFFILIATE_PROVIDER_FLAG_NAMES).map(([provider, envName]) => [
      provider,
      env[envName]?.trim().toLowerCase() === "true",
    ]),
  ) as AffiliateProviderFlags;
}

export const PASSTHROUGH_PROVIDER = {
  id: "passthrough" as const,
  async buildLink(input: AffiliateLinkInput): Promise<AffiliateLinkResult> {
    const safe = toSafeExternalUrl(input.originalUrl);
    return {
      url: safe.ok ? safe.url : null,
      provider: "passthrough",
      monetized: false,
      fallbackUsed: true,
      ...(safe.ok ? {} : { reason: "ORIGINAL_URL_INVALID" }),
    };
  },
};

function passthrough(
  input: AffiliateLinkInput,
  reason: string,
): Promise<AffiliateLinkResult> {
  return PASSTHROUGH_PROVIDER.buildLink(input).then((result) => ({
    ...result,
    reason,
  }));
}

export async function resolveAffiliateLink(
  input: AffiliateLinkInput,
  options: {
    providers?: readonly AffiliateProvider[];
    flags?: AffiliateProviderFlags;
  } = {},
): Promise<AffiliateLinkResult> {
  const original = toSafeExternalUrl(input.originalUrl);
  if (!original.ok || !original.url) {
    return {
      url: null,
      provider: "passthrough",
      monetized: false,
      fallbackUsed: true,
      reason: "ORIGINAL_URL_INVALID",
    };
  }

  const safeInput = { ...input, originalUrl: original.url };
  const providers = options.providers ?? [];
  const flags = options.flags ?? DEFAULT_AFFILIATE_PROVIDER_FLAGS;
  let provider: AffiliateProvider | undefined;
  try {
    provider = providers.find((candidate) => candidate.supports(safeInput));
  } catch {
    return passthrough(safeInput, "PROVIDER_FAILED");
  }

  if (!provider) return passthrough(safeInput, "NO_PROVIDER");
  if (!flags[provider.id]) return passthrough(safeInput, "PROVIDER_DISABLED");
  try {
    if (!provider.isConfigured()) {
      return passthrough(safeInput, "PROVIDER_NOT_CONFIGURED");
    }
  } catch {
    return passthrough(safeInput, "PROVIDER_FAILED");
  }

  try {
    const built = await provider.buildLink(safeInput);
    const affiliateUrl = toSafeExternalUrl(built.url);

    if (!affiliateUrl.ok || !affiliateUrl.url) {
      return passthrough(safeInput, "PROVIDER_URL_INVALID");
    }
    if (affiliateUrl.url === original.url || built.monetized === false) {
      return passthrough(safeInput, "PROVIDER_NOT_MONETIZED");
    }

    return {
      url: affiliateUrl.url,
      provider: provider.id,
      monetized: true,
      fallbackUsed: false,
    };
  } catch {
    return passthrough(safeInput, "PROVIDER_FAILED");
  }
}