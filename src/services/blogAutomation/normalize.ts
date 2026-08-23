import {
  EDITORIAL_OBJECTIVES,
  EDITORIAL_TRIGGER_SOURCES,
  type EditorialObjective,
  type EditorialTriggerSource,
  type GenerateEditorialPackageInput,
  type NormalizedEditorialInput,
} from "./types";
import { EditorialError } from "./errors";
import { sanitizarProdutosEditoriais } from "./products";

const STOPWORDS = new Set([
  "a",
  "as",
  "o",
  "os",
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "em",
  "um",
  "uma",
  "para",
  "com",
  "sem",
  "por",
  "na",
  "no",
  "nas",
  "nos",
  "ao",
  "aos",
  "que",
  "qual",
  "quais",
  "ou",
]);

export function normalizarTextoPauta(
  value: string,
): string {
  return value
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizarTituloPauta(
  value: string,
): string {
  return normalizarTextoPauta(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function tokensDaPauta(
  value: string,
): string[] {
  return normalizarTituloPauta(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(
      (token) =>
        token.length >= 3 &&
        !STOPWORDS.has(token),
    );
}

export function inferirObjetivoEditorial(
  topic: string,
  explicit?: string,
): EditorialObjective {
  if (
    explicit &&
    EDITORIAL_OBJECTIVES.includes(
      explicit as EditorialObjective,
    )
  ) {
    return explicit as EditorialObjective;
  }

  const texto = normalizarTituloPauta(topic);

  if (
    /\bvs\b/.test(texto) ||
    texto.includes(" versus ") ||
    texto.includes(" ou ") ||
    texto.includes("diferenca") ||
    texto.includes("diferencas")
  ) {
    return texto.includes("diferenca")
      ? "diferencas"
      : "comparativo";
  }

  if (
    texto.includes("melhor") ||
    texto.includes("melhores") ||
    texto.includes("ranking") ||
    texto.includes("top ")
  ) {
    return "melhores";
  }

  if (
    texto.includes("custo beneficio") ||
    texto.includes("custo-beneficio") ||
    texto.includes("vale a pena")
  ) {
    return "custo_beneficio";
  }

  if (
    texto.includes("como escolher") ||
    texto.includes("como comprar") ||
    texto.startsWith("como ")
  ) {
    return "como_escolher";
  }

  if (
    texto.includes("duvida") ||
    texto.includes("faq") ||
    texto.includes("perguntas frequentes")
  ) {
    return "faq";
  }

  if (
    texto.includes("economia") ||
    texto.includes("mais barato") ||
    texto.includes("quando esperar")
  ) {
    return "economia";
  }

  if (
    texto.includes("tendencia") ||
    texto.includes("em 2026") ||
    texto.includes("novidade")
  ) {
    return "tendencia";
  }

  if (
    texto.startsWith("lista") ||
    texto.includes("checklist")
  ) {
    return "lista";
  }

  return "guia_compra";
}

export function categoriaPadraoDoObjetivo(
  objective: EditorialObjective,
): string {
  switch (objective) {
    case "comparativo":
    case "diferencas":
      return "Comparativos";
    case "economia":
    case "custo_beneficio":
      return "Economia";
    case "melhores":
    case "lista":
      return "Listas úteis";
    case "tendencia":
      return "Tendências";
    case "faq":
      return "Dúvidas frequentes";
    default:
      return "Guia de compra";
  }
}

export function normalizarPautaEditorial(
  input: GenerateEditorialPackageInput,
): NormalizedEditorialInput {
  if (!input || typeof input !== "object") {
    throw new EditorialError(
      "INVALID_INPUT",
      "Informe os dados da pauta editorial.",
    );
  }

  const topic = normalizarTextoPauta(
    input.topic ?? "",
  );

  if (topic.length < 8) {
    throw new EditorialError(
      "INVALID_INPUT",
      "Informe um assunto com pelo menos 8 caracteres.",
    );
  }

  const objective = inferirObjetivoEditorial(
    topic,
    input.objective,
  );
  const category = normalizarTextoPauta(
    input.category ?? "",
  );
  const extraContext = normalizarTextoPauta(
    input.extraContext ?? "",
  );
  const year =
    typeof input.year === "number" &&
    Number.isInteger(input.year) &&
    input.year >= 2024 &&
    input.year <= 2035
      ? input.year
      : new Date().getFullYear();
  const source =
    input.source &&
    EDITORIAL_TRIGGER_SOURCES.includes(
      input.source,
    )
      ? input.source
      : "manual";

  return {
    topic,
    category:
      category ||
      categoriaPadraoDoObjetivo(objective),
    objective,
    extraContext,
    year,
    source,
    products: sanitizarProdutosEditoriais(
      input.products,
    ),
  };
}
