/**
 * INVENTÁRIO DE AFILIADO MERCADO LIVRE — READ ONLY.
 *
 * Por que um script e não uma query ad-hoc: "tem link de afiliado" não é
 * `affiliateLink IS NOT NULL`. A definição de válido já existe em
 * `publicPurchase.ts` e rejeitaThings que uma coluna não sabe rejeitar:
 * fallback genérico meli.la/1i7Te2C, URL comum do ML usada como se fosse
 * afiliada, e link de sister offer. Contar com `IS NOT NULL` inflaria o
 * número e esconderia exatamente o que esta missão quer eliminar.
 *
 * Nenhuma escrita. Somente SELECT.
 */
import prismaMod from "../lib/prisma";
import {
  confirmarAffiliateLinkMercadoLivre,
  ehFallbackGenericoMeliLa,
  ehLinkAfiliadoConfirmadoMercadoLivre,
} from "../lib/affiliates/publicPurchase";

const prisma = ((prismaMod as any)?.default ?? prismaMod) as any;

type Row = {
  id: string;
  productId: string;
  externalId: string | null;
  sourceUrl: string | null;
  affiliateLink: string | null;
  status: string;
  matchStatus: string;
  active: boolean;
  available: boolean;
  price: number;
  createdAt: Date;
  updatedAt: Date;
};

async function main() {
  const rows: Row[] = await prisma.marketplaceOffer.findMany({
    where: { marketplace: "MERCADO_LIVRE" },
    select: {
      id: true,
      productId: true,
      externalId: true,
      sourceUrl: true,
      affiliateLink: true,
      status: true,
      matchStatus: true,
      active: true,
      available: true,
      price: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  let comValido = 0;
  let semValido = 0;
  let comFallbackGenerico = 0;
  let comSourceUrlComoAfiliado = 0;
  let comColunaPrenchadaMasInvalida = 0;
  const invalidas: Array<{ id: string; motivo: string; link: string }> = [];
  const porStatus: Record<string, number> = {};

  for (const r of rows) {
    porStatus[r.status] = (porStatus[r.status] ?? 0) + 1;

    const valido = confirmarAffiliateLinkMercadoLivre({
      affiliateLink: r.affiliateLink,
      sourceUrl: r.sourceUrl,
    });

    if (valido) {
      comValido += 1;
      continue;
    }

    semValido += 1;

    // Diagnostico de por que a coluna nao conta como valida.
    const link = r.affiliateLink?.trim() ?? "";
    if (!link) continue;

    if (ehFallbackGenericoMeliLa(link)) {
      comFallbackGenerico += 1;
      invalidas.push({ id: r.id, motivo: "FALLBACK_GENERICO", link: hostOf(link) });
      continue;
    }

    // sourceUrl comum repetido na coluna de afiliado = o erro que a missao proibe.
    if (r.sourceUrl && link === r.sourceUrl.trim()) {
      comSourceUrlComoAfiliado += 1;
      invalidas.push({ id: r.id, motivo: "SOURCE_URL_COMO_AFILIADO", link: hostOf(link) });
      continue;
    }

    comColunaPrenchadaMasInvalida += 1;
    invalidas.push({
      id: r.id,
      motivo: ehLinkAfiliadoConfirmadoMercadoLivre(link)
        ? "MESMO_ITEM_ID_NAO_CONFIRMADO"
        : "FORMA_NAO_CONFIRMADA",
      link: hostOf(link),
    });
  }

  // Oferta elegivel = publicavel e sem link valido. E o universe do sweep.
  const elegiveisSemLink = rows.filter(
    (r) =>
      r.active &&
      r.available &&
      r.status !== "UNAVAILABLE" &&
      r.status !== "ERROR" &&
      !confirmarAffiliateLinkMercadoLivre({
        affiliateLink: r.affiliateLink,
        sourceUrl: r.sourceUrl,
      }),
  );

  // Pendencias que a fila ATUAL enxerga (ProductOpportunity).
  const pendenciasAtuais = await prisma.productOpportunity.findMany({
    where: {
      marketplace: "MERCADO_LIVRE",
      status: "WAITING_AFFILIATE",
      affiliateLink: null,
      productId: { not: null },
    },
    select: { id: true, productId: true, externalId: true },
  });
  const productsComPendencia = new Set<string>(
    pendenciasAtuais.map((p: { productId: string | null }) => p.productId as string),
  );

  // Quantas ofertas elegiveis NAO tem pendencia hoje = o gap de entrada automatica.
  const elegiveisForaDaFila = elegiveisSemLink.filter(
    (r) => !productsComPendencia.has(r.productId),
  );

  const rel = {
    gerado_em: new Date().toISOString(),

    ML_OFFERS_TOTAL: rows.length,
    ML_OFFERS_PUBLIC: rows.filter(
      (r) => r.active && r.available && r.status !== "UNAVAILABLE" && r.status !== "ERROR",
    ).length,
    ML_WITH_VALID_AFFILIATE: comValido,
    ML_WITHOUT_VALID_AFFILIATE: semValido,
    ML_PENDING_AFFILIATE: pendenciasAtuais.length,

    // Quantas das ofertas sem link valido sao elegiveis (universo do sweep).
    ML_ELIGIVEIS_SEM_LINK: elegiveisSemLink.length,
    // E quantas delas a fila atual NAO enxerga -> precisa da correcao.
    ML_ELEGIVEIS_SEM_LINK_FORA_DA_FILA: elegiveisForaDaFila.length,
    ML_NAO_ELEGIVEIS_SEM_LINK: semValido - elegiveisSemLink.length,

    // Decomposicao do que impede a coluna de contar como valida.
    FALLBACK_GENERICO_MELI_LA: comFallbackGenerico,
    SOURCE_URL_USADO_COMO_AFILIADO: comSourceUrlComoAfiliado,
    COLUNA_PREENCHADA_MAS_INVALIDA: comColunaPrenchadaMasInvalida,

    por_status: porStatus,
    // Hosts das URLs rejeitadas, nunca o valor completo (podem carregar token).
    invalidas_por_motivo: invalidas.reduce<Record<string, number>>((acc, i) => {
      acc[i.motivo] = (acc[i.motivo] ?? 0) + 1;
      return acc;
    }, {}),
  };

  console.log(JSON.stringify(rel, null, 2));
  await prisma.$disconnect();
}

function hostOf(u: string) {
  try {
    return new URL(u).hostname;
  } catch {
    return "<nao-parseia>";
  }
}

main().catch((e) => {
  console.error("FALHOU:", e instanceof Error ? e.message : e);
  process.exit(1);
});
