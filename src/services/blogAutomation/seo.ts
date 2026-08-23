import type { BlogTheme } from "@/services/blog/types";

import type {
  EditorialFaqItem,
  EditorialObjective,
} from "./types";

export function temaEditorialDaCategoria(
  category: string,
): BlogTheme {
  const texto = category.toLocaleLowerCase("pt-BR");

  if (
    texto.includes("compar") ||
    texto.includes("diferen")
  ) {
    return "violet";
  }

  if (
    texto.includes("econom") ||
    texto.includes("custo")
  ) {
    return "blue";
  }

  if (
    texto.includes("segura") ||
    texto.includes("checklist")
  ) {
    return "amber";
  }

  if (
    texto.includes("tend") ||
    texto.includes("lista")
  ) {
    return "cyan";
  }

  if (texto.includes("dúvida") || texto.includes("duvida")) {
    return "rose";
  }

  return "emerald";
}

export function intencaoDeBuscaDoObjetivo(
  objective: EditorialObjective,
): string {
  switch (objective) {
    case "melhores":
    case "lista":
    case "custo_beneficio":
      return "investigação comercial: o leitor quer um recorte confiável antes de comparar ofertas";
    case "comparativo":
    case "diferencas":
      return "comparação: o leitor quer entender diferenças práticas para escolher entre opções";
    case "economia":
      return "decisão de compra: o leitor quer saber se espera, compra agora ou muda de modelo";
    case "faq":
      return "informacional: o leitor busca respostas diretas para dúvidas recorrentes";
    case "tendencia":
      return "informacional com viés comercial: o leitor quer contexto atual antes de gastar";
    default:
      return "informacional com intenção de compra: o leitor quer um critério claro para escolher";
  }
}

export function limitarMetaDescription(
  value: string,
): string {
  const texto = value.replace(/\s+/g, " ").trim();

  if (texto.length <= 158) {
    return texto;
  }

  return `${texto.slice(0, 155).trim()}...`;
}

export function limitarSeoTitle(
  value: string,
): string {
  const texto = value.replace(/\s+/g, " ").trim();

  if (texto.length <= 62) {
    return texto;
  }

  return texto.slice(0, 60).trim();
}

export function normalizarFaq(
  value: unknown,
): EditorialFaqItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const items: EditorialFaqItem[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record = item as Record<string, unknown>;
    const question =
      typeof record.question === "string"
        ? record.question.trim()
        : "";
    const answer =
      typeof record.answer === "string"
        ? record.answer.trim()
        : "";

    if (question.length < 8 || answer.length < 24) {
      continue;
    }

    items.push({ question, answer });
  }

  return items.slice(0, 6);
}

export function termosRelacionados(
  topic: string,
  category: string,
  extra: unknown,
): string[] {
  const collected = new Set<string>();

  if (Array.isArray(extra)) {
    for (const item of extra) {
      if (typeof item === "string" && item.trim()) {
        collected.add(item.trim());
      }
    }
  }

  for (const term of [
    category,
    "comparar preços",
    "custo-benefício",
    "guia de compra",
    "ofertas",
    topic,
  ]) {
    if (term.trim()) {
      collected.add(term.trim());
    }
  }

  return Array.from(collected).slice(0, 12);
}
