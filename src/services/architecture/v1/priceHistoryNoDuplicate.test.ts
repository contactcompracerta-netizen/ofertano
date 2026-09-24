/**
 * CATALOG_ARCHITECTURE_V1 — PRICE HISTORY NO DUPLICATE TEST (FASE M).
 *
 * PRICE_HISTORY_NO_DUPLICATE:
 * - historicoPrecisaNovaEntrada (entidade legada reutilizada) decide quando
 *   gravar: preço igual/estável NÃO gera nova linha de histórico;
 * - o FAST OFFER PATH só aciona escrita de histórico quando o offerHash mudar;
 * - uma mudança de preço gera EXATAMENTE uma nova entrada (nunca duplicata).
 */
import assert from "node:assert/strict";
import { historicoPrecisaNovaEntrada, TOLERANCIA_PRECO } from "../../priceHistory/priceHistoryService";
import { processNormalizedListing } from "./ingestion/pipeline";
import { InMemoryRawListingRepository } from "./fake/inMemoryRepositories";
import { CatalogMetrics } from "./observability/metrics";
import { buildFakeListing } from "./fake/fakeConnectors";

async function main() {
  // --- historicoPrecisaNovaEntrada: nunca uma linha por verificação ------------
  {
    assert.equal(historicoPrecisaNovaEntrada({ precoAnterior: 1999.9, precoNovo: 1999.9 }), false, "mesmo preço => sem nova linha");
    assert.equal(historicoPrecisaNovaEntrada({ precoAnterior: 1999.9, precoNovo: 1999.904 }), false, "variação dentro da tolerância => sem nova linha");
    assert.equal(historicoPrecisaNovaEntrada({ precoAnterior: 1999.9, precoNovo: 1899.9 }), true, "baixa real => nova linha");
    assert.equal(historicoPrecisaNovaEntrada({ precoAnterior: null, precoNovo: 1999.9 }), true, "primeira observação => nova linha");
    assert.equal(historicoPrecisaNovaEntrada({ precoAnterior: 1999.9, precoNovo: 0 }), false, "preço inválido nunca grava");
  }

  // --- FAST OFFER PATH: histórico gravado só quando o preço muda ----------------
  const writes: number[] = [];
  const repository = new InMemoryRawListingRepository();
  const metrics = new CatalogMetrics();

  const makeListing = (price: number) =>
    buildFakeListing({
      marketplaceId: "MARKET_A",
      externalListingId: "hist-1",
      identity: { gtin: ["7891234567890"], brand: "Nova", model: "Nova X" },
      catalog: { title: "Smartphone Nova X 256GB", category: "Celulares" },
      commerce: { price, stock: 42 },
    });

  // 1ª ingestão STRUCTURAL; preço inicial 1999.9.
  {
    const ctx = {
      repository,
      metrics,
      onStructural: async () => {
        writes.push(1999.9); // preço inicial entra no histórico
      },
    };
    await processNormalizedListing(ctx, { listing: makeListing(1999.9), rawPayload: {} });
  }

  // Preço idêntico => NOOP => NENHUMA nova entrada.
  {
    const ctx = {
      repository,
      metrics,
      onOfferOnly: async () => {
        throw new Error("onOfferOnly NÃO deve ser invocado quando o offerHash não muda");
      },
    };
    const r = await processNormalizedListing(ctx, { listing: makeListing(1999.9), rawPayload: {} });
    assert.equal(r.path, "NOOP");
    assert.equal(writes.length, 1, "preço estável NUNCA duplica linha de histórico");
  }

  // Baixa real => OFFER_ONLY => exatamente +1 entrada.
  {
    const ctx = {
      repository,
      metrics,
      onOfferOnly: async () => {
        writes.push(1799.9);
      },
    };
    const r = await processNormalizedListing(ctx, { listing: makeListing(1799.9), rawPayload: {} });
    assert.equal(r.path, "OFFER_ONLY", "mudança de preço => FAST OFFER PATH");
    assert.equal(writes.length, 2, "uma mudança => exatamente uma nova entrada");
    assert.deepEqual(writes, [1999.9, 1799.9]);
    assert.ok(TOLERANCIA_PRECO > 0, "tolerância documentada é positiva");
  }

  console.log("priceHistoryNoDuplicate.test.ts PASS");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});