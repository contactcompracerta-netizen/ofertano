import type {
  EditorialProductInput,
  SanitizedEditorialProduct,
} from "./types";

function textoOpcional(
  value: unknown,
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized || undefined;
}

function precoInformado(
  value: unknown,
): number | undefined {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return undefined;
  }

  return Math.round(value * 100) / 100;
}

function lojasInformadas(
  value: unknown,
): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const stores = value
    .filter(
      (item): item is string =>
        typeof item === "string",
    )
    .map((item) => item.trim())
    .filter(Boolean);

  return stores.length > 0 ? stores : undefined;
}

function urlInternaDoProduto(
  id: string,
  rawUrl: unknown,
): string {
  const fallback = `/produto/${id}`;

  if (typeof rawUrl !== "string") {
    return fallback;
  }

  const href = rawUrl.trim();

  if (!href.startsWith("/produto/")) {
    return fallback;
  }

  const path = href.split("?")[0] ?? href;
  const productId = path
    .slice("/produto/".length)
    .replace(/\/+$/, "");

  return productId === id ? path : fallback;
}

export function sanitizarProdutosEditoriais(
  value: unknown,
): SanitizedEditorialProduct[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const products: SanitizedEditorialProduct[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record = item as EditorialProductInput;
    const id = textoOpcional(record.id);

    if (!id || seen.has(id)) {
      continue;
    }

    const title =
      textoOpcional(record.title) ??
      textoOpcional(record.name);

    if (!title) {
      continue;
    }

    seen.add(id);

    const product: SanitizedEditorialProduct = {
      id,
      title,
      internalUrl: urlInternaDoProduto(
        id,
        record.internalUrl,
      ),
    };

    const category = textoOpcional(record.category);
    if (category) {
      product.category = category;
    }

    const image = textoOpcional(record.image);
    if (image) {
      product.image = image;
    }

    const lowestPrice = precoInformado(
      record.lowestPrice,
    );
    if (lowestPrice !== undefined) {
      product.lowestPrice = lowestPrice;
    }

    const stores = lojasInformadas(record.stores);
    if (stores) {
      product.stores = stores;
    }

    products.push(product);
  }

  return products;
}

export function formatarPrecoEditorial(
  value: number,
): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

export function descreverProdutoEditorial(
  product: SanitizedEditorialProduct,
): string {
  const partes = [product.title];

  if (product.lowestPrice !== undefined) {
    partes.push(
      `a partir de ${formatarPrecoEditorial(product.lowestPrice)}`,
    );
  }

  if (product.stores && product.stores.length > 0) {
    partes.push(
      `disponível em ${product.stores.join(", ")}`,
    );
  }

  return partes.join(" — ");
}

export function reconciliarProdutosDoPacote(
  claimed: unknown,
  allowed: SanitizedEditorialProduct[],
): SanitizedEditorialProduct[] {
  const byId = new Map(
    allowed.map((product) => [product.id, product]),
  );

  if (!Array.isArray(claimed) || claimed.length === 0) {
    return allowed;
  }

  const reconciled: SanitizedEditorialProduct[] = [];
  const seen = new Set<string>();

  for (const item of claimed) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record = item as Record<string, unknown>;
    const id = textoOpcional(record.id);

    if (!id || seen.has(id) || !byId.has(id)) {
      continue;
    }

    seen.add(id);
    reconciled.push(byId.get(id)!);
  }

  return reconciled.length > 0 ? reconciled : allowed;
}
