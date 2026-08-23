import { precoEmCentavos } from "./money";
import type { ExactOfferSnapshot } from "./types";

/**
 * Seleciona o menor preço EXACT válido de um Product.
 *
 * A regra replica a seleção de `melhorOfertaEncontrada` em
 * `sincronizarMelhorOfertaDoProduto` (`src/services/database/saveProduct.ts`):
 * - somente `matchStatus = EXACT`;
 * - `active = true`;
 * - `available = true`;
 * - status diferente de UNAVAILABLE e ERROR;
 * - preço finito e maior que zero.
 *
 * Não usa HIGH/REVIEW/REJECTED, acessório, candidato aproximado
 * nem exige link afiliado. Sem EXACT válido, retorna null.
 */
export function ofertaExactValidaParaAlerta(
  oferta: ExactOfferSnapshot
): boolean {
  return (
    oferta.matchStatus === "EXACT" &&
    oferta.active === true &&
    oferta.available === true &&
    oferta.status !== "UNAVAILABLE" &&
    oferta.status !== "ERROR" &&
    Number.isFinite(oferta.price) &&
    oferta.price > 0
  );
}

export function selecionarMenorPrecoExact(
  ofertas: ExactOfferSnapshot[]
): number | null {
  let menor: ExactOfferSnapshot | null = null;

  for (const oferta of ofertas) {
    if (!ofertaExactValidaParaAlerta(oferta)) {
      continue;
    }

    if (
      !menor ||
      precoEmCentavos(oferta.price) < precoEmCentavos(menor.price)
    ) {
      menor = oferta;
    }
  }

  return menor ? menor.price : null;
}
