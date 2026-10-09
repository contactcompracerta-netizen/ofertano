/**
 * CATALOG_WAVE 1 - configuração multi-advertiser AWIN (FASE B).
 *
 * KaBuM NÃO é regra global: cada loja é uma instância explícita de
 * AwinAdvertiserConfig. advertiserId/feedId ficam null até os feeds
 * reais chegarem (nenhum secret em código).
 */
import type { AffiliateNetwork, MerchantSlug } from "./types";
import { AWIN_AFFILIATE_NETWORK } from "./types";

export interface AwinAdvertiserConfig {
  /** Slug estável da loja (identidade de merchant). */
  slug: MerchantSlug;
  /** Nome exibido ao usuário. */
  displayName: string;
  /** ID do anunciante AWIN (null até dados reais). */
  advertiserId: string | null;
  /** ID do feed AWIN (null até dados reais). */
  feedId: string | null;
  /** Identificador canônico do merchant (igual ao slug hoje). */
  merchantIdentifier: string;
  affiliateNetwork: AffiliateNetwork;
  country: "BR";
  currency: "BRL";
  /** Escrita no catálogo real habilitada? Default OFF (fail-closed). */
  catalogWriteEnabled: boolean;
  /** Feed real já configurado? false até haver input real. */
  feedConfigured: boolean;
}

export const WAVE1_AWIN_ADVERTISERS: readonly AwinAdvertiserConfig[] = Object.freeze([
  {
    slug: "kabum",
    displayName: "KaBuM",
    advertiserId: null,
    feedId: null,
    merchantIdentifier: "kabum",
    affiliateNetwork: AWIN_AFFILIATE_NETWORK,
    country: "BR",
    currency: "BRL",
    catalogWriteEnabled: false,
    feedConfigured: false,
  },
  {
    slug: "cama-in-box",
    displayName: "Cama In Box",
    advertiserId: null,
    feedId: null,
    merchantIdentifier: "cama-in-box",
    affiliateNetwork: AWIN_AFFILIATE_NETWORK,
    country: "BR",
    currency: "BRL",
    catalogWriteEnabled: false,
    feedConfigured: false,
  },
  {
    slug: "olympikus",
    displayName: "Olympikus",
    advertiserId: null,
    feedId: null,
    merchantIdentifier: "olympikus",
    affiliateNetwork: AWIN_AFFILIATE_NETWORK,
    country: "BR",
    currency: "BRL",
    catalogWriteEnabled: false,
    feedConfigured: false,
  },
  {
    slug: "leveros",
    displayName: "Leveros",
    advertiserId: null,
    feedId: null,
    merchantIdentifier: "leveros",
    affiliateNetwork: AWIN_AFFILIATE_NETWORK,
    country: "BR",
    currency: "BRL",
    catalogWriteEnabled: false,
    feedConfigured: false,
  },
]);

export const WAVE1_MERCHANT_SLUGS: readonly MerchantSlug[] = Object.freeze(
  WAVE1_AWIN_ADVERTISERS.map((a) => a.slug),
);

export function getAdvertiser(
  slug: string,
): AwinAdvertiserConfig | undefined {
  return WAVE1_AWIN_ADVERTISERS.find((a) => a.slug === slug);
}

export function isApprovedMerchant(
  slug: string,
): slug is MerchantSlug {
  return (WAVE1_MERCHANT_SLUGS as readonly string[]).includes(slug);
}
