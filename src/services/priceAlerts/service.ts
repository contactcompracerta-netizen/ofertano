import {
  PRICE_ALERT_ERROR_CODES,
  PriceAlertError,
  isUniqueConstraintError,
} from "./errors";
import { normalizarId } from "./ids";
import { selecionarMenorPrecoExact } from "./menorPrecoExact";
import { normalizarPreco, precoEhMenor, precoEhMenorOuIgual } from "./money";
import type {
  AlertEvaluationResult,
  CreatePriceAlertInput,
  CreatePriceAlertResult,
  EvaluateActivePriceAlertsResult,
  PriceAlertEventInput,
  PriceAlertRecord,
  PriceAlertStore,
  PriceAlertType,
  PriceAlertWithDetails,
  UpdatePriceAlertInput,
} from "./types";
import { PRICE_ALERT_TYPES } from "./types";

function exigirUserId(userId: string): string {
  const id = normalizarId(userId);

  if (!id) {
    throw new PriceAlertError(
      PRICE_ALERT_ERROR_CODES.INVALID_USER,
      "Usuário inválido."
    );
  }

  return id;
}

function exigirProductId(productId: unknown): string {
  const id = normalizarId(productId);

  if (!id) {
    throw new PriceAlertError(
      PRICE_ALERT_ERROR_CODES.INVALID_PRODUCT_ID,
      "Produto inválido."
    );
  }

  return id;
}

function exigirAlertId(alertId: unknown): string {
  const id = normalizarId(alertId);

  if (!id) {
    throw new PriceAlertError(
      PRICE_ALERT_ERROR_CODES.INVALID_ALERT_ID,
      "Alerta inválido."
    );
  }

  return id;
}

function exigirTipo(type: unknown): PriceAlertType {
  if (
    type === PRICE_ALERT_TYPES.ANY_DROP ||
    type === PRICE_ALERT_TYPES.TARGET_PRICE
  ) {
    return type;
  }

  throw new PriceAlertError(
    PRICE_ALERT_ERROR_CODES.INVALID_TYPE,
    "Tipo de alerta inválido."
  );
}

function exigirPrecoAlvo(valor: unknown): number {
  const preco = normalizarPreco(valor);

  if (preco === null) {
    throw new PriceAlertError(
      PRICE_ALERT_ERROR_CODES.INVALID_TARGET_PRICE,
      "Informe um preço-alvo válido maior que zero."
    );
  }

  return preco;
}

function temChave(body: object, chave: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, chave);
}

async function montarDetalhes(
  store: PriceAlertStore,
  alerta: PriceAlertRecord
): Promise<PriceAlertWithDetails> {
  const [product, triggerCount] = await Promise.all([
    store.findProduct(alerta.productId),
    store.countEventsByAlert(alerta.id),
  ]);

  return {
    ...alerta,
    product,
    triggerCount,
    lastTrigger:
      alerta.lastTriggeredAt && alerta.lastTriggeredPrice !== null
        ? {
            price: alerta.lastTriggeredPrice,
            at: alerta.lastTriggeredAt,
          }
        : null,
  };
}

export function criarServicoPriceAlerts(store: PriceAlertStore) {
  async function obterMenorPrecoExactDoProduto(
    productId: string
  ): Promise<number | null> {
    const ofertas = await store.listOffersByProductIds([productId]);
    return selecionarMenorPrecoExact(ofertas);
  }

  /**
   * ANY_DROP:
   * a referência é o menor EXACT na criação (ou o primeiro EXACT
   * válido visto depois). Dispara só se o preço atual for
   * estritamente menor que a referência, comparado em centavos.
   * Depois do disparo, a referência passa a ser o novo preço.
   * Alta de preço não move a referência para cima, então
   * 480 → 490 → 470 gera um único novo evento em 470.
   *
   * TARGET_PRICE:
   * dispara quando menor EXACT <= alvo e o alerta está armado.
   * Depois do disparo, armed=false evita repetição. Rearme fica
   * disponível via PATCH { armed: true }.
   */
  async function avaliarAlertaComPreco(
    alerta: PriceAlertRecord,
    currentPrice: number | null
  ): Promise<AlertEvaluationResult> {
    const agora = new Date();
    const hadExact = currentPrice !== null;

    const base = {
      alertId: alerta.id,
      productId: alerta.productId,
      userId: alerta.userId,
      type: alerta.type,
      hadExact,
      currentPrice,
    };

    if (!alerta.active) {
      return {
        ...base,
        triggered: false,
        skippedReason: "INACTIVE" as const,
      };
    }

    if (!hadExact) {
      await store.commitEvaluation(alerta.id, {
        lastEvaluatedAt: agora,
        lastEvaluatedPrice: null,
        lastEvaluatedHadExact: false,
      });

      return {
        ...base,
        triggered: false,
        skippedReason: "NO_EXACT",
      };
    }

    const precoAtual = currentPrice;

    if (alerta.type === PRICE_ALERT_TYPES.ANY_DROP) {
      if (alerta.referencePrice === null) {
        await store.commitEvaluation(alerta.id, {
          lastEvaluatedAt: agora,
          lastEvaluatedPrice: precoAtual,
          lastEvaluatedHadExact: true,
          referencePrice: precoAtual,
        });

        return {
          ...base,
          triggered: false,
          skippedReason: "NO_DROP",
        };
      }

      if (!precoEhMenor(precoAtual, alerta.referencePrice)) {
        await store.commitEvaluation(alerta.id, {
          lastEvaluatedAt: agora,
          lastEvaluatedPrice: precoAtual,
          lastEvaluatedHadExact: true,
        });

        return {
          ...base,
          triggered: false,
          skippedReason: "NO_DROP",
        };
      }

      const event: PriceAlertEventInput = {
        type: alerta.type,
        price: precoAtual,
        previousReferencePrice: alerta.referencePrice,
        targetPrice: null,
      };

      await store.commitEvaluation(
        alerta.id,
        {
          lastEvaluatedAt: agora,
          lastEvaluatedPrice: precoAtual,
          lastEvaluatedHadExact: true,
          referencePrice: precoAtual,
          lastTriggeredAt: agora,
          lastTriggeredPrice: precoAtual,
        },
        event
      );

      return {
        ...base,
        triggered: true,
      };
    }

    const targetPrice = alerta.targetPrice;

    if (targetPrice === null) {
      await store.commitEvaluation(alerta.id, {
        lastEvaluatedAt: agora,
        lastEvaluatedPrice: precoAtual,
        lastEvaluatedHadExact: true,
      });

      return {
        ...base,
        triggered: false,
        skippedReason: "ABOVE_TARGET",
      };
    }

    if (!precoEhMenorOuIgual(precoAtual, targetPrice)) {
      await store.commitEvaluation(alerta.id, {
        lastEvaluatedAt: agora,
        lastEvaluatedPrice: precoAtual,
        lastEvaluatedHadExact: true,
      });

      return {
        ...base,
        triggered: false,
        skippedReason: "ABOVE_TARGET",
      };
    }

    if (!alerta.armed) {
      await store.commitEvaluation(alerta.id, {
        lastEvaluatedAt: agora,
        lastEvaluatedPrice: precoAtual,
        lastEvaluatedHadExact: true,
      });

      return {
        ...base,
        triggered: false,
        skippedReason: "ALREADY_TRIGGERED",
      };
    }

    const event: PriceAlertEventInput = {
      type: alerta.type,
      price: precoAtual,
      previousReferencePrice: alerta.referencePrice,
      targetPrice,
    };

    await store.commitEvaluation(
      alerta.id,
      {
        lastEvaluatedAt: agora,
        lastEvaluatedPrice: precoAtual,
        lastEvaluatedHadExact: true,
        lastTriggeredAt: agora,
        lastTriggeredPrice: precoAtual,
        armed: false,
      },
      event
    );

    return {
      ...base,
      triggered: true,
    };
  }

  async function criarAlerta(
    userId: string,
    input: CreatePriceAlertInput
  ): Promise<CreatePriceAlertResult> {
    const usuario = exigirUserId(userId);
    const produto = exigirProductId(input.productId);
    const tipo = exigirTipo(input.type);

    if (
      tipo === PRICE_ALERT_TYPES.ANY_DROP &&
      input.targetPrice !== undefined &&
      input.targetPrice !== null &&
      String(input.targetPrice).trim() !== ""
    ) {
      throw new PriceAlertError(
        PRICE_ALERT_ERROR_CODES.TARGET_PRICE_NOT_ALLOWED,
        "Alerta de qualquer queda não usa preço-alvo."
      );
    }

    let targetPrice: number | null = null;

    if (tipo === PRICE_ALERT_TYPES.TARGET_PRICE) {
      if (
        input.targetPrice === undefined ||
        input.targetPrice === null ||
        (typeof input.targetPrice === "string" &&
          input.targetPrice.trim() === "")
      ) {
        throw new PriceAlertError(
          PRICE_ALERT_ERROR_CODES.TARGET_PRICE_REQUIRED,
          "Alerta de preço-alvo exige um valor maior que zero."
        );
      }

      targetPrice = exigirPrecoAlvo(input.targetPrice);
    }

    const existe = await store.productExists(produto);

    if (!existe) {
      throw new PriceAlertError(
        PRICE_ALERT_ERROR_CODES.PRODUCT_NOT_FOUND,
        "Produto não encontrado."
      );
    }

    const existente = await store.findAlertByUserProductType(
      usuario,
      produto,
      tipo
    );

    if (existente) {
      return {
        alert: await montarDetalhes(store, existente),
        created: false,
      };
    }

    const menorPreco = await obterMenorPrecoExactDoProduto(produto);

    try {
      const criado = await store.createAlert({
        userId: usuario,
        productId: produto,
        type: tipo,
        targetPrice,
        referencePrice: menorPreco,
      });

      if (tipo === PRICE_ALERT_TYPES.TARGET_PRICE) {
        await avaliarAlertaComPreco(criado, menorPreco);
        const atualizado = await store.findAlertById(criado.id);

        return {
          alert: await montarDetalhes(store, atualizado ?? criado),
          created: true,
        };
      }

      await store.commitEvaluation(criado.id, {
        lastEvaluatedAt: new Date(),
        lastEvaluatedPrice: menorPreco,
        lastEvaluatedHadExact: menorPreco !== null,
        referencePrice: menorPreco,
      });

      const atualizado = await store.findAlertById(criado.id);

      return {
        alert: await montarDetalhes(store, atualizado ?? criado),
        created: true,
      };
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }

      const duplicado = await store.findAlertByUserProductType(
        usuario,
        produto,
        tipo
      );

      if (!duplicado) {
        throw error;
      }

      return {
        alert: await montarDetalhes(store, duplicado),
        created: false,
      };
    }
  }

  async function listarAlertas(
    userId: string,
    productId?: unknown
  ): Promise<PriceAlertWithDetails[]> {
    const usuario = exigirUserId(userId);
    const produtoFiltro = productId
      ? exigirProductId(productId)
      : null;
    const lista = await store.listAlertsByUser(usuario);
    const filtrada = produtoFiltro
      ? lista.filter((item) => item.productId === produtoFiltro)
      : lista;

    return Promise.all(
      filtrada.map((alerta) => montarDetalhes(store, alerta))
    );
  }

  async function atualizarAlerta(
    userId: string,
    alertId: unknown,
    input: UpdatePriceAlertInput
  ): Promise<PriceAlertWithDetails> {
    const usuario = exigirUserId(userId);
    const id = exigirAlertId(alertId);
    const atual = await store.findAlertById(id);

    if (!atual || atual.userId !== usuario) {
      throw new PriceAlertError(
        PRICE_ALERT_ERROR_CODES.ALERT_NOT_FOUND,
        "Alerta não encontrado."
      );
    }

    const dados: Parameters<PriceAlertStore["updateAlert"]>[1] = {};
    let recebeuCampo = false;

    if (temChave(input, "targetPrice")) {
      recebeuCampo = true;

      if (atual.type !== PRICE_ALERT_TYPES.TARGET_PRICE) {
        throw new PriceAlertError(
          PRICE_ALERT_ERROR_CODES.TARGET_PRICE_NOT_ALLOWED,
          "Alerta de qualquer queda não usa preço-alvo."
        );
      }

      dados.targetPrice = exigirPrecoAlvo(input.targetPrice);
    }

    if (temChave(input, "active")) {
      recebeuCampo = true;

      if (typeof input.active !== "boolean") {
        throw new PriceAlertError(
          PRICE_ALERT_ERROR_CODES.INVALID_UPDATE,
          "O campo active precisa ser verdadeiro ou falso."
        );
      }

      dados.active = input.active;
    }

    if (temChave(input, "armed")) {
      recebeuCampo = true;

      if (typeof input.armed !== "boolean") {
        throw new PriceAlertError(
          PRICE_ALERT_ERROR_CODES.INVALID_UPDATE,
          "O campo armed precisa ser verdadeiro ou falso."
        );
      }

      dados.armed = input.armed;
    }

    if (!recebeuCampo) {
      throw new PriceAlertError(
        PRICE_ALERT_ERROR_CODES.INVALID_UPDATE,
        "Informe ao menos um campo para atualizar."
      );
    }

    const atualizado = await store.updateAlert(id, dados);
    return montarDetalhes(store, atualizado);
  }

  async function removerAlerta(
    userId: string,
    alertId: unknown
  ): Promise<{ id: string; removed: boolean }> {
    const usuario = exigirUserId(userId);
    const id = exigirAlertId(alertId);
    const removed = await store.deleteAlertByUserAndId(usuario, id);

    return { id, removed };
  }

  async function avaliarAlerta(
    alertId: unknown
  ): Promise<AlertEvaluationResult> {
    const id = exigirAlertId(alertId);
    const alerta = await store.findAlertById(id);

    if (!alerta) {
      throw new PriceAlertError(
        PRICE_ALERT_ERROR_CODES.ALERT_NOT_FOUND,
        "Alerta não encontrado."
      );
    }

    const currentPrice = await obterMenorPrecoExactDoProduto(
      alerta.productId
    );

    return avaliarAlertaComPreco(alerta, currentPrice);
  }

  async function avaliarAlertasAtivos(): Promise<EvaluateActivePriceAlertsResult> {
    const ativos = await store.listActiveAlerts();
    const productIds = Array.from(
      new Set(ativos.map((item) => item.productId))
    );
    const ofertas = await store.listOffersByProductIds(productIds);
    const ofertasPorProduto = new Map<string, typeof ofertas>();

    for (const oferta of ofertas) {
      const lista = ofertasPorProduto.get(oferta.productId) ?? [];
      lista.push(oferta);
      ofertasPorProduto.set(oferta.productId, lista);
    }

    const precosPorProduto = new Map<string, number | null>();

    for (const productId of productIds) {
      precosPorProduto.set(
        productId,
        selecionarMenorPrecoExact(
          ofertasPorProduto.get(productId) ?? []
        )
      );
    }

    const results: AlertEvaluationResult[] = [];

    for (const alerta of ativos) {
      const currentPrice = precosPorProduto.get(alerta.productId) ?? null;
      results.push(await avaliarAlertaComPreco(alerta, currentPrice));
    }

    return {
      evaluated: results.length,
      triggered: results.filter((item) => item.triggered).length,
      withoutExact: results.filter((item) => !item.hadExact).length,
      results,
    };
  }

  return {
    criarAlerta,
    listarAlertas,
    atualizarAlerta,
    removerAlerta,
    obterMenorPrecoExactDoProduto,
    avaliarAlerta,
    avaliarAlertasAtivos,
  };
}

export type PriceAlertsService = ReturnType<typeof criarServicoPriceAlerts>;
