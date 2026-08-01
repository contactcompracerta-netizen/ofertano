import type { ProductImport } from "../core/types";

import type {
  MercadoLivreAttribute,
  MercadoLivrePicture,
  MercadoLivreResolvedProduct,
} from "./types";

function normalizarImagem(
  imagem: MercadoLivrePicture
): string | null {
  const endereco = imagem.secure_url || imagem.url;

  if (!endereco?.startsWith("http")) {
    return null;
  }

  return endereco.replace(/^http:/, "https:");
}

function extrairImagens(
  pictures: MercadoLivrePicture[]
): string[] {
  return [
    ...new Set(
      pictures
        .map(normalizarImagem)
        .filter(
          (imagem): imagem is string =>
            typeof imagem === "string"
        )
    ),
  ];
}

function valorDoAtributo(
  atributo: MercadoLivreAttribute
): string | null {
  const texto = atributo.value_name?.trim();

  if (texto) {
    return texto;
  }

  const numero = atributo.value_struct?.number;
  const unidade = atributo.value_struct?.unit;

  if (typeof numero === "number") {
    return unidade
      ? `${numero} ${unidade}`
      : String(numero);
  }

  return null;
}

function criarEspecificacoes(
  atributos: MercadoLivreAttribute[],
  condition: string | null,
  warranty: string | null
): Record<string, string> {
  const specifications: Record<string, string> = {};

  for (const atributo of atributos) {
    const nome = atributo.name?.trim();
    const valor = valorDoAtributo(atributo);

    if (nome && valor) {
      specifications[nome] = valor;
    }
  }

  if (condition) {
    specifications.Condição =
      condition === "new"
        ? "Novo"
        : condition;
  }

  if (warranty) {
    specifications.Garantia = warranty;
  }

  return specifications;
}

function encontrarMarca(
  atributos: MercadoLivreAttribute[]
): string | null {
  const marca = atributos.find((atributo) => {
    const id = atributo.id?.toUpperCase();
    const nome = atributo.name?.toUpperCase();

    return (
      id === "BRAND" ||
      nome === "MARCA"
    );
  });

  return marca ? valorDoAtributo(marca) : null;
}

function calcularDesconto(
  preco: number,
  precoAntigo: number | null
): number | null {
  if (
    !precoAntigo ||
    precoAntigo <= preco
  ) {
    return null;
  }

  return Math.round(
    ((precoAntigo - preco) / precoAntigo) * 100
  );
}

export function parseMercadoLivre(
  source: MercadoLivreResolvedProduct,
  originalUrl: string
): ProductImport {
  if (!source.title.trim()) {
    throw new Error(
      "O Mercado Livre não retornou o nome do produto."
    );
  }

  if (
    !Number.isFinite(source.price) ||
    source.price <= 0
  ) {
    throw new Error(
      "O Mercado Livre não retornou um preço válido."
    );
  }

  const images = extrairImagens(source.pictures);

  if (images.length === 0) {
    throw new Error(
      "O Mercado Livre não retornou imagens do produto."
    );
  }

  return {
    marketplace: "Mercado Livre",
    externalId: source.itemId,
    url: originalUrl,
    title: source.title.trim(),
    description: source.description,
    brand: encontrarMarca(source.attributes),
    category: source.categoryName || "Ofertas",
    image: images[0],
    images,
    price: source.price,
    oldPrice: source.originalPrice,
    discount: calcularDesconto(
      source.price,
      source.originalPrice
    ),
    installments: null,
    rating: source.rating,
    reviews: source.reviews,
    sales: source.soldQuantity,
    stock: source.availableQuantity,
    seller:
      source.sellerId !== null
        ? String(source.sellerId)
        : null,
    attributes: criarEspecificacoes(
      source.attributes,
      source.condition,
      source.warranty
    ),
  };
}
