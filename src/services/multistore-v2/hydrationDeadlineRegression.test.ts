import assert from "node:assert/strict";

import type { DiscoveryAdapter, DiscoveryCandidate, MarketplaceDiscoveryResult } from "../discovery/core/types";
import { searchMultistoreV2 } from "./search";
import { DEFAULT_SEARCH_BUDGET } from "./timeBudget";

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
  extras: Partial<DiscoveryCandidate> & Pick<DiscoveryCandidate, "marketplace" | "externalId" | "title">,
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

function hangUntilAbort(signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal?.addEventListener(
      "abort",
      () => reject(new Error("aborted")),
      { once: true },
    );
  });
}

async function runHydrationDeadlineRegressionCase(): Promise<void> {
  const lateRejections: unknown[] = [];
  const onLateRejection = (reason: unknown) => lateRejections.push(reason);
  process.on("unhandledRejection", onLateRejection);

  let slowHydrationAborted = false;
  let postReturnMutation = false;
  let batchStillActive = false;

  const startedAt = Date.now();
  const result = await searchMultistoreV2(
    "Aspirador de Pó e Água Wap GTW Inox 12 1400W com Bocal de Sopro - 220V",
    {
      persist: false,
      budget: {
        ...DEFAULT_SEARCH_BUDGET,
        globalMs: 8_000,
        marketplaceMs: 4_500,
        fetchMs: 900,
        persistReserveMs: 200,
        hangGraceMs: 0,
      },
      adapters: [
        fakeAdapter("MAGAZINE_LUIZA", "Magazine Luiza", async () => ({
          marketplace: "MAGAZINE_LUIZA",
          query: "Aspirador de Pó e Água Wap GTW Inox 12 1400W com Bocal de Sopro - 220V",
          success: true,
          scanned: 1,
          candidates: [
            foundCandidate({
              marketplace: "MAGAZINE_LUIZA",
              marketplaceName: "Magazine Luiza",
              externalId: "magalu-fixture-220v",
              title: "Aspirador Pó e Água WAP GTW Inox 12 1400W 12L Bocal de Sopro - 220V",
              price: 418.41,
              sourceUrl: "https://www.magazineluiza.com.br/fixture-220v",
              attributes: { Voltagem: "220V" },
            }),
          ],
          error: null,
        } satisfies MarketplaceDiscoveryResult)),
        fakeAdapter("MERCADO_LIVRE", "Mercado Livre", async () => ({
          marketplace: "MERCADO_LIVRE",
          query: "Aspirador de Pó e Água Wap GTW Inox 12 1400W com Bocal de Sopro - 220V",
          success: true,
          scanned: 2,
          candidates: [
            foundCandidate({
              marketplace: "MERCADO_LIVRE",
              marketplaceName: "Mercado Livre",
              externalId: "MLB-REAL-220V",
              title: "Aspirador de Pó e Água Wap GTW Inox 12 1400W Bocal de Sopro 220v",
              price: 299,
              sourceUrl: "https://produto.mercadolivre.com.br/MLB-REAL-220V",
              attributes: { VOLTAGE: "220V" },
            }),
          ],
          error: null,
        } satisfies MarketplaceDiscoveryResult)),
        fakeAdapter("AMAZON", "Amazon", async (request) => {
          const pending = hangUntilAbort(request.signal);
          void pending.catch(() => {
            slowHydrationAborted = true;
          });
          await pending;
          return {
            marketplace: "AMAZON",
            query: request.query,
            success: false,
            candidates: [],
            scanned: 0,
            error: "pendurado",
          } satisfies MarketplaceDiscoveryResult;
        }),
      ],
    },
  );

  const elapsedMs = Date.now() - startedAt;
  const snapshot = JSON.stringify(result.products.map((product) => ({
    market: product.primaryMarketplace,
    marketplaces: product.marketplaces,
    publishable: product.publishable,
    price: product.price,
  })));

  setTimeout(() => {
    postReturnMutation = snapshot !== JSON.stringify(result.products.map((product) => ({
      market: product.primaryMarketplace,
      marketplaces: product.marketplaces,
      publishable: product.publishable,
      price: product.price,
    })));
    batchStillActive = slowHydrationAborted === false;
  }, 120);

  await new Promise((resolve) => setTimeout(resolve, 180));

  assert.ok(elapsedMs < 6_000, `resultado saiu do limite nominal (${elapsedMs}ms)`);
  assert.ok(result.products.some((product) => product.publishable), "cluster com duas lojas deve ser publicável");
  assert.equal(postReturnMutation, false, "nenhuma mutação após retorno");
  assert.equal(batchStillActive, false, "nenhuma tarefa pendente persistiu após a resposta");
  assert.equal(lateRejections.length, 0, "nenhuma unhandledRejection após o retorno");

  process.off("unhandledRejection", onLateRejection);
  console.log("HYDRATION_DEADLINE_REGRESSION=PASS");
}

void runHydrationDeadlineRegressionCase().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
