import { importarProduto } from "@/services/importers";

import type {
  ProductImport,
} from "@/services/importers/core/types";

import type {
  DiscoveryCandidate,
  ImportedDiscoveryCandidate,
} from "@/services/discovery/core/types";

/*
 * O Discovery serve apenas para LOCALIZAR candidatos.
 *
 * Antes de qualquer decisao de identidade/EXACT,
 * o candidato precisa passar pelo importador oficial
 * da propria marketplace.
 *
 * Assim o matcher recebe:
 * - atributos reais;
 * - marca;
 * - modelo;
 * - variantes;
 * - descricao;
 * - imagens;
 * - preco atualizado;
 * - URL canonica.
 */
export async function importarCandidatoDiscovery(
  candidate: DiscoveryCandidate,
): Promise<ImportedDiscoveryCandidate> {
  if (candidate.status !== "FOUND") {
    throw new Error(
      `Candidato Discovery nao esta disponivel: ${candidate.status}.`,
    );
  }

  const sourceUrl =
    candidate.sourceUrl?.trim();

  if (!sourceUrl) {
    throw new Error(
      "Candidato Discovery sem URL de origem.",
    );
  }

  const product: ProductImport =
    await importarProduto(
      sourceUrl,
    );

  /*
   * Protecao importante:
   * um redirect nunca pode fazer um candidato de uma
   * marketplace ser interpretado como produto de outra.
   */
  if (
    product.marketplace !==
    candidate.marketplaceName
  ) {
    throw new Error(
      `Marketplace divergente apos importacao: ` +
      `${candidate.marketplaceName} -> ${product.marketplace}.`,
    );
  }

  if (!product.externalId?.trim()) {
    throw new Error(
      "Produto importado sem identificador externo.",
    );
  }

  if (!product.title?.trim()) {
    throw new Error(
      "Produto importado sem titulo.",
    );
  }

  if (
    !Number.isFinite(product.price) ||
    product.price <= 0
  ) {
    throw new Error(
      "Produto importado sem preco valido.",
    );
  }

  /*
   * O link de afiliado descoberto pelo adapter tem
   * prioridade, porque pode ter sido gerado especificamente
   * durante a busca.
   *
   * Os dados comerciais/tecnicos continuam vindo
   * integralmente do importador.
   */
  const affiliateLink =
    candidate.affiliateLink?.trim() ||
    product.affiliateLink?.trim() ||
    null;

  return {
    candidate,

    product: {
      ...product,
      affiliateLink,
    },
  };
}
