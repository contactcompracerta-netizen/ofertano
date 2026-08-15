import { buscarAmazon } from "../amazon";
import { buscarMercadoLivre } from "../mercadolivre";
import { buscarShopee } from "../shopee";

import type {
  DiscoveryAdapter,
  DiscoveryMarketplace,
} from "./types";

const discoveryAdapters: Record<
  DiscoveryMarketplace,
  DiscoveryAdapter
> = {
  MERCADO_LIVRE: {
    marketplace: "MERCADO_LIVRE",
    marketplaceName: "Mercado Livre",
    enabled: true,
    searcher: buscarMercadoLivre,
  },

  AMAZON: {
    marketplace: "AMAZON",
    marketplaceName: "Amazon",
    enabled: true,
    searcher: buscarAmazon,
  },

  SHOPEE: {
    marketplace: "SHOPEE",
    marketplaceName: "Shopee",
    enabled: true,
    searcher: buscarShopee,
  },

  MAGAZINE_LUIZA: {
    marketplace: "MAGAZINE_LUIZA",
    marketplaceName: "Magazine Luiza",
    enabled: false,
    searcher: null,
  },

  ALIEXPRESS: {
    marketplace: "ALIEXPRESS",
    marketplaceName: "AliExpress",
    enabled: false,
    searcher: null,
  },
};

export function obterDiscoveryAdapter(
  marketplace: DiscoveryMarketplace,
): DiscoveryAdapter {
  return discoveryAdapters[marketplace];
}

export function listarDiscoveryAdapters(): DiscoveryAdapter[] {
  return Object.values(discoveryAdapters);
}

export function listarDiscoveryAdaptersAtivos(): DiscoveryAdapter[] {
  return listarDiscoveryAdapters().filter(
    (adapter) =>
      adapter.enabled &&
      adapter.searcher !== null,
  );
}

export function marketplacePossuiBuscaAutomatica(
  marketplace: DiscoveryMarketplace,
): boolean {
  const adapter = discoveryAdapters[marketplace];

  return (
    adapter.enabled &&
    adapter.searcher !== null
  );
}