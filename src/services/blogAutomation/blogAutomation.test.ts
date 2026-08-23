import assert from "node:assert/strict";

import { criarCatalogoEmMemoria } from "./duplicates";
import { criarProviderDeterministico } from "./deterministicProvider";
import { isEditorialError } from "./errors";
import { gerarPacoteEditorial } from "./generateEditorialPackage";
import { mapearPacoteParaRascunho } from "./mapToDraft";
import { normalizarPautaEditorial } from "./normalize";
import { sanitizarProdutosEditoriais } from "./products";
import {
  criarSlugEditorial,
  slugEditorialValido,
} from "./slug";
import { facebookEInstagramSaoDistintos } from "./social";
import { validarPacoteEditorial } from "./validatePackage";
import type { EditorialAiProvider } from "./provider";
import type { GenerateEditorialPackageInput } from "./types";

async function deveNormalizarPauta() {
  const normalized = normalizarPautaEditorial({
    topic: "  Air fryer de 4L ou 5L: qual escolher?  ",
    extraContext: "foco em família pequena",
  });

  assert.equal(
    normalized.topic,
    "Air fryer de 4L ou 5L: qual escolher?",
  );
  assert.equal(normalized.objective, "comparativo");
  assert.equal(normalized.category, "Comparativos");
  assert.equal(normalized.extraContext, "foco em família pequena");
  assert.ok(normalized.year >= 2024);
}

async function deveRejeitarPautaCurta() {
  try {
    normalizarPautaEditorial({ topic: "air" });
    assert.fail("deveria rejeitar pauta curta");
  } catch (error) {
    assert.equal(isEditorialError(error), true);
    if (isEditorialError(error)) {
      assert.equal(error.code, "INVALID_INPUT");
    }
  }
}

async function deveCriarEValidarSlug() {
  const slug = criarSlugEditorial(
    "Melhores parafusadeiras custo-benefício em 2026",
  );

  assert.equal(
    slug,
    "melhores-parafusadeiras-custo-beneficio-em-2026",
  );
  assert.equal(slugEditorialValido(slug), true);
  assert.equal(slugEditorialValido("ABC"), false);
  assert.equal(slugEditorialValido("curto"), false);
  assert.equal(slugEditorialValido("titulo com espaço"), false);
}

async function deveDetectarDuplicataIdentica() {
  const pacote = await gerarPacoteEditorial(
    {
      topic: "Como escolher um celular intermediário sem gastar demais",
    },
    {
      provider: criarProviderDeterministico(),
      catalog: criarCatalogoEmMemoria([
        {
          slug: "como-escolher-um-celular-intermediario-sem-gastar-demais",
          title:
            "Como escolher um celular intermediário sem gastar demais",
          createdAt: new Date(),
        },
      ]),
      now: new Date("2026-08-23T12:00:00-03:00"),
    },
  );

  assert.equal(
    pacote.metadata.duplicateCheck.verdict,
    "DUPLICATE",
  );
}

async function deveMarcarPautaParecidaRecente() {
  const pacote = await gerarPacoteEditorial(
    {
      topic: "Melhores parafusadeiras custo-benefício em 2026",
    },
    {
      provider: criarProviderDeterministico(),
      catalog: criarCatalogoEmMemoria([
        {
          slug: "melhores-parafusadeiras-custo-beneficio-2026",
          title:
            "Melhores parafusadeiras custo benefício 2026",
          createdAt: new Date("2026-08-10T12:00:00-03:00"),
        },
      ]),
      now: new Date("2026-08-23T12:00:00-03:00"),
    },
  );

  assert.equal(
    pacote.metadata.duplicateCheck.verdict,
    "POSSIBLE_DUPLICATE",
  );
}

async function naoDeveBloquearPautasLegitimas() {
  const pacote = await gerarPacoteEditorial(
    {
      topic: "Air fryer de 4L ou 5L: qual escolher?",
    },
    {
      provider: criarProviderDeterministico(),
      catalog: criarCatalogoEmMemoria([
        {
          slug: "melhores-air-fryers-custo-beneficio-em-2026",
          title: "Melhores air fryers custo-benefício em 2026",
          createdAt: new Date("2026-08-20T12:00:00-03:00"),
        },
      ]),
      now: new Date("2026-08-23T12:00:00-03:00"),
    },
  );

  assert.equal(pacote.metadata.duplicateCheck.verdict, "OK");
}

async function deveValidarPacoteCompleto() {
  const pacote = await gerarPacoteEditorial(
    {
      topic: "Como escolher um celular intermediário sem gastar demais",
      category: "Guia de compra",
    },
    {
      provider: criarProviderDeterministico(),
    },
  );

  assert.ok(pacote.blog.title.length >= 5);
  assert.equal(slugEditorialValido(pacote.blog.slug), true);
  assert.ok(pacote.blog.excerpt.length >= 40);
  assert.ok(pacote.blog.sections.length >= 3);
  assert.ok(pacote.seo.title);
  assert.ok(pacote.seo.description);
  assert.ok(pacote.seo.searchIntent);
}

async function deveDiferenciarFacebookEInstagram() {
  const pacote = await gerarPacoteEditorial(
    {
      topic: "Melhores parafusadeiras custo-benefício em 2026",
    },
    {
      provider: criarProviderDeterministico(),
    },
  );

  assert.equal(
    facebookEInstagramSaoDistintos(
      pacote.social.facebook,
      pacote.social.instagram,
    ),
    true,
  );
  assert.notEqual(
    pacote.social.facebook.caption,
    pacote.social.instagram.caption,
  );
  assert.ok(pacote.social.instagram.hashtags.length >= 3);
  assert.equal(pacote.social.instagram.linkStrategy, "bio");
  assert.match(
    pacote.social.facebook.caption,
    /\/blog\//,
  );
  assert.doesNotMatch(
    pacote.social.instagram.caption,
    /https?:\/\//,
  );
}

async function deveRejeitarConteudoIncompleto() {
  const input = normalizarPautaEditorial({
    topic: "Guia de compra de notebook intermediário",
  });

  try {
    validarPacoteEditorial(
      {
        blog: {
          title: "Oi",
          excerpt: "curto",
          sections: [],
        },
      },
      input,
    );
    assert.fail("deveria rejeitar conteúdo incompleto");
  } catch (error) {
    assert.equal(isEditorialError(error), true);
    if (isEditorialError(error)) {
      assert.equal(error.code, "INCOMPLETE_CONTENT");
    }
  }
}

async function naoDeveInventarDadosDeProduto() {
  const providerMentiroso: EditorialAiProvider = {
    kind: "injected",
    async gerar() {
      const base = await criarProviderDeterministico().gerar(
        normalizarPautaEditorial({
          topic: "Como escolher um celular intermediário",
          products: [
            {
              id: "prod-1",
              title: "Celular Aurora Pulse",
            },
          ],
        }),
      );
      const record = base as Record<string, unknown>;
      const metadata =
        (record.metadata as Record<string, unknown>) ?? {};

      return {
        ...record,
        metadata: {
          ...metadata,
          relatedProducts: [
            {
              id: "prod-1",
              title: "Celular Aurora Pulse",
              lowestPrice: 1999,
              stores: ["Loja Inventada"],
            },
            {
              id: "prod-fake",
              title: "Modelo que não existe",
              lowestPrice: 899,
            },
          ],
        },
      };
    },
  };

  const pacote = await gerarPacoteEditorial(
    {
      topic: "Como escolher um celular intermediário",
      products: [
        {
          id: "prod-1",
          title: "Celular Aurora Pulse",
        },
      ],
    },
    { provider: providerMentiroso },
  );

  assert.equal(pacote.metadata.relatedProducts.length, 1);
  assert.equal(pacote.metadata.relatedProducts[0]?.id, "prod-1");
  assert.equal(
    pacote.metadata.relatedProducts[0]?.lowestPrice,
    undefined,
  );
  assert.equal(
    pacote.metadata.relatedProducts[0]?.stores,
    undefined,
  );
}

async function deveSanitizarProdutosSemInventar() {
  const products = sanitizarProdutosEditoriais([
    {
      id: "a1",
      title: "Parafusadeira X",
      lowestPrice: 349.9,
      stores: ["Amazon"],
    },
    {
      id: "b2",
      name: "Sem preço",
    },
    {
      id: "c3",
    },
    {
      id: "a1",
      title: "duplicado",
    },
  ]);

  assert.equal(products.length, 2);
  assert.equal(products[0]?.lowestPrice, 349.9);
  assert.deepEqual(products[0]?.stores, ["Amazon"]);
  assert.equal(products[0]?.internalUrl, "/produto/a1");
  assert.equal(products[1]?.lowestPrice, undefined);
  assert.equal(products[1]?.stores, undefined);
}

async function deveMapearRascunhoSemPublicar() {
  const pacote = await gerarPacoteEditorial(
    {
      topic: "Air fryer de 4L ou 5L: qual escolher?",
    },
    {
      provider: criarProviderDeterministico(),
    },
  );
  const draft = mapearPacoteParaRascunho(pacote);

  assert.equal(draft.status, "DRAFT");
  assert.equal(draft.publishedAt, null);
  assert.equal(
    draft.socialCaption,
    pacote.social.facebook.caption,
  );
  assert.ok(Array.isArray(draft.sections));
}

async function deveUsarSomenteLinksInternosReais() {
  const pacote = await gerarPacoteEditorial(
    {
      topic: "Como escolher um celular intermediário sem gastar demais",
      products: [
        {
          id: "cel-1",
          title: "Celular Aurora Pulse",
        },
      ],
    },
    {
      provider: criarProviderDeterministico(),
    },
  );

  for (const link of pacote.seo.internalLinks) {
    assert.equal(link.href.startsWith("/"), true);
    assert.equal(link.href.startsWith("//"), false);
    assert.match(
      link.href,
      /^\/(ofertas|categorias|blog|produto\/|favoritos|sobre|contato|\?q=)/,
    );
  }

  assert.ok(
    pacote.seo.internalLinks.some(
      (link) => link.href === "/produto/cel-1",
    ),
  );
}

async function executar() {
  await deveNormalizarPauta();
  await deveRejeitarPautaCurta();
  await deveCriarEValidarSlug();
  await deveDetectarDuplicataIdentica();
  await deveMarcarPautaParecidaRecente();
  await naoDeveBloquearPautasLegitimas();
  await deveValidarPacoteCompleto();
  await deveDiferenciarFacebookEInstagram();
  await deveRejeitarConteudoIncompleto();
  await naoDeveInventarDadosDeProduto();
  await deveSanitizarProdutosSemInventar();
  await deveMapearRascunhoSemPublicar();
  await deveUsarSomenteLinksInternosReais();

  console.log(
    "blogAutomation.test.ts: todos os testes passaram.",
  );
}

void executar().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
