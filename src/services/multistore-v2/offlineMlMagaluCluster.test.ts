import assert from "node:assert/strict";

import type {
  DiscoveryAdapter,
  DiscoveryCandidate,
  MarketplaceDiscoveryResult,
} from "../discovery/core/types";
import { searchMultistoreV2 } from "./search";
import { DEFAULT_SEARCH_BUDGET } from "./timeBudget";

const QUERY =
  "Aspirador de Pó e Água Wap GTW Inox 12 1400W com Bocal de Sopro - 220V";

function fakeAdapter(
  marketplace: DiscoveryAdapter["marketplace"],
  marketplaceName: string,
  searcher: NonNullable<DiscoveryAdapter["searcher"]>,
): DiscoveryAdapter {
  return {
    marketplace,
    marketplaceName,
    enabled: true,
    searcher,
  };
}

function foundCandidate(
  extras: Partial<DiscoveryCandidate> &
    Pick<DiscoveryCandidate, "marketplace" | "externalId" | "title">,
): DiscoveryCandidate {
  return {
    marketplaceName: extras.marketplaceName ?? extras.marketplace,
    sourceUrl: extras.sourceUrl ?? `https://loja.example/${extras.externalId}`,
    affiliateLink: extras.affiliateLink ?? null,
    image: extras.image ?? "https://loja.example/img.jpg",
    price: extras.price ?? 199,
    oldPrice: extras.oldPrice ?? null,
    brand: extras.brand ?? "WAP",
    category: extras.category ?? null,
    seller: extras.seller ?? null,
    attributes: extras.attributes ?? {},
    ...extras,
  };
}

function hangForever(signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal?.addEventListener(
      "abort",
      () => reject(new Error("aborted")),
      { once: true },
    );
  });
}

async function runOfflineMlMagaluClusterCase(): Promise<void> {
  const budget = {
    ...DEFAULT_SEARCH_BUDGET,
    globalMs: 20_000,
    marketplaceMs: 10_000,
    persistReserveMs: 2_000,
    hangGraceMs: 0,
  };

  let magaluReturnedAt = 0;
  let mlReturnedAt = 0;
  const started = Date.now();
  let postReturnMutation = false;

  const result = await searchMultistoreV2(QUERY, {
    persist: false,
    budget,
    adapters: [
      fakeAdapter("MAGAZINE_LUIZA", "Magazine Luiza", async (request) => {
        await new Promise((resolve) => setTimeout(resolve, 4_000));
        magaluReturnedAt = Date.now() - started;
        return {
          marketplace: "MAGAZINE_LUIZA",
          query: request.query,
          success: true,
          scanned: 1,
          candidates: [
            foundCandidate({
              marketplace: "MAGAZINE_LUIZA",
              marketplaceName: "Magazine Luiza",
              externalId: "magalu-fixture-220v",
              title:
                "Aspirador Pó e Água WAP GTW Inox 12 1400W 12L Bocal de Sopro - 220V",
              price: 418.41,
              sourceUrl: "https://www.magazineluiza.com.br/fixture-220v",
              brand: "WAP",
              status: "FOUND",
              attributes: { Voltagem: "220V" },
            }),
          ],
          error: null,
        } satisfies MarketplaceDiscoveryResult;
      }),
      fakeAdapter("MERCADO_LIVRE", "Mercado Livre", async (request) => {
        await new Promise((resolve) => setTimeout(resolve, 5_500));
        mlReturnedAt = Date.now() - started;
        return {
          marketplace: "MERCADO_LIVRE",
          query: request.query,
          success: true,
          scanned: 1,
          candidates: [
            foundCandidate({
              marketplace: "MERCADO_LIVRE",
              marketplaceName: "Mercado Livre",
              externalId: "MLB-FIXTURE-220V",
              title:
                "Aspirador De Po E Agua Wap Gtw Inox 12 1400w Bocal Sopro 220v",
              price: 399.9,
              sourceUrl: "https://produto.mercadolivre.com.br/MLB-FIXTURE-220V",
              brand: "Wap",
              status: "FOUND",
              attributes: { VOLTAGE: "220V" },
            }),
          ],
          error: null,
        } satisfies MarketplaceDiscoveryResult;
      }),
      fakeAdapter("SHOPEE", "Shopee", async (request) => {
        await hangForever(request.signal);
        return {
          marketplace: "SHOPEE",
          query: request.query,
          success: false,
          scanned: 0,
          candidates: [],
          error: "pendurado",
        } satisfies MarketplaceDiscoveryResult;
      }),
      fakeAdapter("AMAZON", "Amazon", async (request) => {
        await hangForever(request.signal);
        return {
          marketplace: "AMAZON",
          query: request.query,
          success: false,
          scanned: 0,
          candidates: [],
          error: "pendurado",
        } satisfies MarketplaceDiscoveryResult;
      }),
      fakeAdapter("ALIEXPRESS", "AliExpress", async (request) => {
        await hangForever(request.signal);
        return {
          marketplace: "ALIEXPRESS",
          query: request.query,
          success: false,
          scanned: 0,
          candidates: [],
          error: "pendurado",
        } satisfies MarketplaceDiscoveryResult;
      }),
    ],
  });

  const elapsed = Date.now() - started;
  const acquisitionsSnapshot = result.acquisitions.map((item) => ({
    ...item,
    candidates: [...item.candidates],
  }));
  const productSnapshot = result.products.map((item) => ({ ...item }));

  setTimeout(() => {
    postReturnMutation =
      acquisitionsSnapshot[0]?.candidates.length !==
        result.acquisitions[0]?.candidates.length ||
      productSnapshot.length !== result.products.length;
  }, 50);

  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.ok(elapsed <= budget.globalMs + 500, `V2 retornou em ${elapsed}ms`);
  assert.ok(magaluReturnedAt >= 3_500 && magaluReturnedAt <= 5_500);
  assert.ok(mlReturnedAt >= 5_000 && mlReturnedAt <= 7_500);

  const publishable = result.products.filter((item) => item.publishable);
  assert.equal(publishable.length, 1, "cluster publicavel unico");
  assert.ok(publishable[0]!.marketplaces.length >= 2, "cluster multiloja");
  assert.equal(result.views.length, 1, "singleton incompleto permanece invisivel");
  assert.ok(
    publishable[0]!.offers.some(
      (offer) => offer.marketplace === "MERCADO_LIVRE",
    ),
  );
  assert.ok(
    publishable[0]!.offers.some(
      (offer) => offer.marketplace === "MAGAZINE_LUIZA",
    ),
  );
  assert.equal(postReturnMutation, false, "nenhuma mutacao apos retorno");

  console.log("OFFLINE_ML_MAGALU_CLUSTER=PASS");
}

void runOfflineMlMagaluClusterCase()
  .then(() => {
    console.log("offlineMlMagaluCluster.test.ts: todos os casos passaram");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
