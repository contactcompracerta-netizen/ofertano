import assert from "node:assert/strict";

import type {
  DiscoveryAdapter,
  DiscoveryCandidate,
  MarketplaceDiscoveryResult,
} from "../discovery/core/types";
import { searchMultistoreV2 } from "./search";
import { extractSanitizedIdentity } from "./sanitizedIdentity";
import { detectDistinctiveConflict } from "./distinctiveAnchors";

function fakeAdapter(
  marketplace: DiscoveryAdapter["marketplace"],
  marketplaceName: string,
  fn: NonNullable<DiscoveryAdapter["searcher"]>,
): DiscoveryAdapter {
  return {
    marketplace,
    marketplaceName,
    enabled: true,
    searcher: fn,
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
    brand: extras.brand ?? null,
    category: extras.category ?? null,
    seller: extras.seller ?? null,
    attributes: extras.attributes ?? {},
    ...extras,
  };
}

async function runRealGate(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`${name}=PASS`);
  } catch (error) {
    console.log(`${name}=FAIL`);
    console.error(error);
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  await runRealGate("REAL_SANITIZER_PIPELINE", async () => {
    const raw =
      "Aramóveis 4,5 de 5 estrelas (5) Armário de Cozinha Completa Aramóveis Kit Mega 9 Portas 2 Gavetas";
    const calls: string[] = [];

    const result = await searchMultistoreV2(raw, {
      persist: false,
      adapters: [
        fakeAdapter("AMAZON", "Amazon", async (request) => {
          calls.push(request.query);
          return {
            marketplace: "AMAZON",
            query: request.query,
            success: true,
            scanned: 1,
            candidates: [
              foundCandidate({
                marketplace: "AMAZON",
                marketplaceName: "Amazon",
                externalId: "amz-aramoves",
                title: "Armário de Cozinha Completa Aramóveis Kit Mega 9 Portas 2 Gavetas",
                price: 899,
                brand: "Aramóveis",
              }),
            ],
            error: null,
          } satisfies MarketplaceDiscoveryResult;
        }),
      ],
    });

    assert.ok(calls.length >= 1, "o adapter deve receber ao menos uma query");
    const query = calls[0];
    assert.ok(!query.includes("4,5"), "query nao deve manter rating em 4,5");
    assert.ok(!query.includes("de 5 estrelas"), "query nao deve manter label de estrelas");
    assert.ok(!query.includes("(5)"), "query nao deve manter token de avaliação");
    assert.match(query, /Aramóveis/i);
    assert.match(query, /Kit Mega/i);
    assert.match(query, /9 Portas/i);
    assert.match(query, /2 Gavetas/i);
    assert.equal(result.rawQuery, raw);
  });

  await runRealGate("REAL_LUBECK_HARD_GATE", async () => {
    const result = await searchMultistoreV2(
      "Sofá 2 Lugares Retrátil Lubeck Linho Cru",
      {
        persist: false,
        adapters: [
          fakeAdapter("AMAZON", "Amazon", async () => ({
            marketplace: "AMAZON",
            query: "Sofá 2 Lugares Retrátil Lubeck Linho Cru",
            success: true,
            scanned: 1,
            candidates: [
              foundCandidate({
                marketplace: "AMAZON",
                marketplaceName: "Amazon",
                externalId: "beegees-1",
                title: "Sofá 2 Lugares Beegees Linho Cru",
                price: 449,
                brand: "Beegees",
              }),
            ],
            error: null,
          } satisfies MarketplaceDiscoveryResult)),
        ],
      },
    );

    assert.equal(result.relevantCandidates.length, 0, "Beegees deve ser rejeitado");
  });

  await runRealGate("REAL_PS4_VARIANT_FALLBACK", async () => {
    const calls: string[] = [];
    const returnedTitles: string[] = [];
    const ps4Query =
      "Console Playstation 4 Ps4 Slim 1 Tb 2controles + Jogos (Recondicionado)";
    const ps4Identity = extractSanitizedIdentity(ps4Query);
    const result = await searchMultistoreV2(
      ps4Query,
      {
        persist: false,
        adapters: [
          fakeAdapter("MERCADO_LIVRE", "Mercado Livre", async (request) => {
            const callIndex = calls.length;
            calls.push(request.query);
            if (callIndex === 0) {
              const title = "PlayStation 4 PS4 Slim 500GB";
              returnedTitles.push(title);
              return {
                marketplace: "MERCADO_LIVRE",
                query: request.query,
                success: true,
                scanned: 1,
                candidates: [
                  foundCandidate({
                    marketplace: "MERCADO_LIVRE",
                    marketplaceName: "Mercado Livre",
                    externalId: "ml-500gb",
                    title,
                    price: 1299,
                    brand: "Sony",
                  }),
                ],
                error: null,
              } satisfies MarketplaceDiscoveryResult;
            }

            const title =
              "PlayStation 4 PS4 Slim 1TB 2 Controles + Jogos Recondicionado";
            returnedTitles.push(title);
            return {
              marketplace: "MERCADO_LIVRE",
              query: request.query,
              success: true,
              scanned: 1,
              candidates: [
                foundCandidate({
                  marketplace: "MERCADO_LIVRE",
                  marketplaceName: "Mercado Livre",
                  externalId: "ml-1tb",
                  title,
                  price: 1599,
                  brand: "Sony",
                }),
              ],
              error: null,
            } satisfies MarketplaceDiscoveryResult;
          }),
        ],
      },
    );

    assert.ok(calls.length > 1, "deve tentar fallback apos 500GB incompatível");
    assert.match(returnedTitles[0] ?? "", /500GB/i);
    assert.equal(
      detectDistinctiveConflict(ps4Identity, returnedTitles[0] ?? "").conflict,
      true,
      "500GB deve ser incompatível com a identidade 1TB",
    );
    assert.match(returnedTitles[1] ?? "", /1TB/i);
    assert.equal(
      detectDistinctiveConflict(ps4Identity, returnedTitles[1] ?? "").conflict,
      false,
      "1TB deve ser compatível com a identidade da query",
    );
    const relevantTitles = result.relevantCandidates.map((item) => item.normalized.raw.title);
    assert.ok(
      relevantTitles.some((title) => /1tb/i.test(title) || /1 tb/i.test(title)),
      "1TB deve ser relevante",
    );
    assert.ok(
      !relevantTitles.some((title) => /500gb/i.test(title) || /500 gb/i.test(title)),
      "500GB deve sumir do relevante",
    );
  });

  await runRealGate("REAL_PS4_ZERO_BETTER_THAN_WRONG", async () => {
    const result = await searchMultistoreV2(
      "Console Playstation 4 Ps4 Slim 1 Tb 2controles + Jogos (Recondicionado)",
      {
        persist: false,
        adapters: [
          fakeAdapter("MERCADO_LIVRE", "Mercado Livre", async () => ({
            marketplace: "MERCADO_LIVRE",
            query: "Console Playstation 4 Ps4 Slim 1 Tb 2controles + Jogos (Recondicionado)",
            success: true,
            scanned: 1,
            candidates: [
              foundCandidate({
                marketplace: "MERCADO_LIVRE",
                marketplaceName: "Mercado Livre",
                externalId: "ml-500gb-only",
                title: "PlayStation 4 PS4 Slim 500GB",
                price: 1200,
                brand: "Sony",
              }),
            ],
            error: null,
          } satisfies MarketplaceDiscoveryResult)),
        ],
      },
    );

    assert.equal(result.relevantCandidates.length, 0, "500GB so deve ser rejeitado");
  });

  await runRealGate("REAL_SHARED_BUDGET", async () => {
    const started = Date.now();
    const query =
      "Console Playstation 4 Ps4 Slim 1 Tb 2controles + Jogos (Recondicionado)";

    const result = await searchMultistoreV2(query, {
      persist: false,
      budget: {
        globalMs: 1200,
        marketplaceMs: 800,
        fetchMs: 300,
        persistReserveMs: 100,
        hangGraceMs: 50,
      },
      adapters: [
        fakeAdapter("MERCADO_LIVRE", "Mercado Livre", async () => {
          await new Promise((resolve) => setTimeout(resolve, 220));
          return {
            marketplace: "MERCADO_LIVRE",
            query,
            success: true,
            scanned: 1,
            candidates: [
              foundCandidate({
                marketplace: "MERCADO_LIVRE",
                marketplaceName: "Mercado Livre",
                externalId: "ml-budget-late",
                title: "PlayStation 4 PS4 Slim 1TB 2 Controles + Jogos Recondicionado",
                price: 1500,
              }),
            ],
            error: null,
          } satisfies MarketplaceDiscoveryResult;
        }),
      ],
    });

    const elapsed = Date.now() - started;
    assert.ok(elapsed <= 2200, "deadline compartilhada nao deve multiplicar por varias variants");
    assert.equal(result.relevantCandidates.length > 0, true, "resultado relevante deve sobreviver");
  });

  await runRealGate("REAL_SOURCE_PRESERVATION", async () => {
    const sourceUrl = "https://example.com/item/ALI-REAL-GATE-1";
    const result = await searchMultistoreV2("Cabo USB-C 100W Baseus 2m", {
      persist: false,
      adapters: [
        fakeAdapter("ALIEXPRESS", "AliExpress", async () => ({
          marketplace: "ALIEXPRESS",
          query: "Cabo USB-C 100W Baseus 2m",
          success: true,
          scanned: 1,
          candidates: [
            foundCandidate({
              marketplace: "ALIEXPRESS",
              marketplaceName: "AliExpress",
              externalId: "ALI-REAL-GATE-1",
              sourceUrl,
              title: "Cabo USB-C 100W Baseus 2m",
              price: 99,
              brand: "Baseus",
            }),
          ],
          error: null,
        } satisfies MarketplaceDiscoveryResult)),
      ],
    });

    const acquiredCandidate = result.acquisitions[0]?.candidates[0];
    assert.ok(acquiredCandidate, "deve preservar candidato na aquisição");
    assert.equal(acquiredCandidate.marketplace, "ALIEXPRESS");
    assert.equal(acquiredCandidate.externalId, "ALI-REAL-GATE-1");
    assert.equal(acquiredCandidate.url, sourceUrl);

    const firstCandidate = result.relevantCandidates[0]?.normalized.raw;
    assert.ok(firstCandidate, "deve haver candidato relevante");
    assert.equal(firstCandidate.marketplace, "ALIEXPRESS");
    assert.equal(firstCandidate.externalId, "ALI-REAL-GATE-1");
    assert.equal(firstCandidate.url, sourceUrl);

    const clusteredCandidate = result.clusters[0]?.members[0]?.candidate.normalized.raw;
    assert.ok(clusteredCandidate, "candidato relevante deve alcançar o cluster");
    assert.equal(clusteredCandidate.marketplace, "ALIEXPRESS");
    assert.equal(clusteredCandidate.externalId, "ALI-REAL-GATE-1");
    assert.equal(clusteredCandidate.url, sourceUrl);

    const finalOffer = result.products[0]?.offers[0];
    assert.ok(finalOffer, "cluster deve gerar resultado canônico");
    assert.equal(finalOffer.marketplace, "ALIEXPRESS");
    assert.equal(finalOffer.externalId, "ALI-REAL-GATE-1");
    assert.equal(finalOffer.url, sourceUrl);
  });
}

void main();
