import { importarAmazon } from "../amazon";
import { importarMercadoLivre } from "../mercadolivre";

import type { MarketplaceKey } from "./detector";
import type { ProductImport } from "./types";

export type MarketplaceImporter = (
  url: string,
) => Promise<ProductImport>;

export type MarketplaceAdapter = {
  key: MarketplaceKey;
  name: string;
  importer: MarketplaceImporter | null;
};

const marketplaceAdapters: Record<
  MarketplaceKey,
  MarketplaceAdapter
> = {
  mercadolivre: {
    key: "mercadolivre",
    name: "Mercado Livre",
    importer: importarMercadoLivre,
  },

  amazon: {
    key: "amazon",
    name: "Amazon",
    importer: importarAmazon,
  },

  shopee: {
    key: "shopee",
    name: "Shopee",
    importer: null,
  },

  magazineluiza: {
    key: "magazineluiza",
    name: "Magazine Luiza",
    importer: null,
  },

  casasbahia: {
    key: "casasbahia",
    name: "Casas Bahia",
    importer: null,
  },

  kabum: {
    key: "kabum",
    name: "KaBuM!",
    importer: null,
  },

  terabyte: {
    key: "terabyte",
    name: "Terabyte",
    importer: null,
  },

  aliexpress: {
    key: "aliexpress",
    name: "AliExpress",
    importer: null,
  },

  carrefour: {
    key: "carrefour",
    name: "Carrefour",
    importer: null,
  },
};

export function obterMarketplaceAdapter(
  marketplace: MarketplaceKey,
): MarketplaceAdapter {
  return marketplaceAdapters[marketplace];
}

export function listarMarketplaceAdapters(): MarketplaceAdapter[] {
  return Object.values(marketplaceAdapters);
}

export function marketplacePossuiImportador(
  marketplace: MarketplaceKey,
): boolean {
  return marketplaceAdapters[marketplace].importer !== null;
}