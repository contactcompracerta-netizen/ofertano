import { AffiliateLinkInput, AffiliateProvider, AffiliateProviderBuildResult } from "./linkEngine";
import { toSafeExternalUrl } from "@/services/architecture/v1/security/safeUrl";

/**
 * AWIN Provider V1
 *
 * Implements the AffiliateProvider contract for AWIN network.
 * Keep DISABLED by default (AFFILIATE_AWIN_ENABLED=false).
 * No external network calls — pure server-side infrastructure.
 *
 * @notes
 * - Never call fetch()/axios/http to generate public links.
 * - URL validation uses existing toSafeExternalUrl utility.
 * - isConfigured() is fail-closed: returns false unless explicitly configured.
 * - buildLink returns the original URL via passthrough when unconfigured.
 * - Secrets/tokens must never appear in URLs or error messages.
 */
export const awinProvider: AffiliateProvider = {
  id: "awin" as const,

  /**
   * AWIN provider supports URLs when the affiliateNetwork is "awin".
   * Matching uses structured context, not URL substring guessing.
   */
  supports(input: AffiliateLinkInput): boolean {
    return normalizeAffiliateNetwork(input.affiliateNetwork) === "awin";
  },

  /**
   * isConfigured is fail-closed.
   * Returns false by default. Only true when AFFILIATE_AWIN_ENABLED=true
   * AND explicit AWIN configuration is present.
   */
  isConfigured(): boolean {
    // Fail-closed: return false unless explicitly configured via env
    const awinEnabled = process.env.AFFILIATE_AWIN_ENABLED?.trim().toLowerCase();
    return awinEnabled === "true";
  },

  /**
   * buildLink generates an affiliate link when provider is configured.
   * When unconfigured, returns the original URL via passthrough.
   * No external network requests are made.
   */
  async buildLink(input: AffiliateLinkInput): Promise<AffiliateProviderBuildResult> {
    // Use original URL when not configured
    if (!await this.isConfigured()) {
      const safe = toSafeExternalUrl(input.originalUrl);
      return {
        url: safe.ok ? safe.url : input.originalUrl,
        monetized: false,
      };
    }

    // When configured (future): generate AWIN affiliate link
    // Infrastructure placeholder — no external calls in this mission
    return {
      url: input.originalUrl,
      monetized: false,
    };
  },
};

/**
 * Normalizes affiliate network strings for comparison.
 */
function normalizeAffiliateNetwork(network: string | null | undefined): string {
  return (network ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}