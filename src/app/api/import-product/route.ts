import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getMercadoLivreAccessToken } from "@/services/mercadolivre/auth";

type MercadoLivrePicture = {
  id?: string;
  url?: string;
  secure_url?: string;
};

type MercadoLivreAttribute = {
  id?: string;
  name?: string;
  value_name?: string | null;
};

type MercadoLivreItem = {
  id?: string;
  title?: string;
  price?: number;
  original_price?: number | null;
  currency_id?: string;
  available_quantity?: number;
  sold_quantity?: number;
  condition?: string;
  permalink?: string;
  thumbnail?: string;
  secure_thumbnail?: string;
  pictures?: MercadoLivrePicture[];
  attributes?: MercadoLivreAttribute[];
  warranty?: string | null;
  catalog_product_id?: string | null;
  category_id?: string;
  status?: string;
};

type MercadoLivreDescription = {
  plain_text?: string;
  text?: string;
};

type MercadoLivreCategory = {
  id?: string;
  name?: string;
};

type MercadoLivreReviews = {
  rating_average?: number;
  total?: number;
};

type ProdutoImportado = {
  mlId: string;
  name: string;
  slug: string;
  image: string;
  images: string[];
  video: string | null;
  brand: string | null;
  description: string | null;
  specifications: Record<string, string>;
  category: string;
  store: string;
  affiliateLink: string;
  price: number;
  oldPrice: number | null;
  installments: string | null;
  discount: number | null;
  rating: number | null;
  reviews: number | null;
  sales: number | null;
  stock: number | null;
};

function dominioPermitido(hostname: string): boolean {
  const dominio = hostname.toLowerCase();

  return (
    dominio === "mercadolivre.com.br" ||
    dominio.endsWith(".mercadolivre.com.br") ||
    dominio === "mercadolivre.com" ||
    dominio.endsWith(".mercadolivre.com") ||
    dominio === "meli.la" ||
    dominio.endsWith(".meli.la")
  );
}

function criarSlug(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function calcularDesconto(
  preco: number,
  precoAntigo: number | null,
): number | null {
  if (!precoAntigo || precoAntigo <= preco) {
    return null;
  }

  return Math.round(((precoAntigo - preco) / precoAntigo) * 100);
}

function normalizarMlId(valor: string): string | null {
  const resultado = valor.match(/MLB-?(\d+)/i);

  if (!resultado?.[1]) {
    return null;
  }

  return `MLB${resultado[1]}`;
}

function extrairMlIdDoLink(link: string): string | null {
  /*
   * Prioriza o parâmetro wid.
   *
   * Exemplo:
   * &wid=MLB6622295590
   */
  const wid = link.match(/[?&#]wid=(MLB-?\d+)/i);

  if (wid?.[1]) {
    return normalizarMlId(wid[1]);
  }

  /*
   * Procura códigos de anúncio:
   *
   * MLB6622295590
   * MLB-6622295590
   *
   * Ignora MLBU, que é código de catálogo.
   */
  const resultados = [...link.matchAll(/MLB-?(\d+)/gi)];

  for (const resultado of resultados) {
    const posicao = resultado.index ?? 0;
    const caractereAnterior = link
      .charAt(Math.max(0, posicao - 1))
      .toUpperCase();

    if (caractereAnterior !== "U") {
      return `MLB${resultado[1]}`;
    }
  }

  return null;
}

function extrairMlbuDoLink(link: string): string | null {
  const resultado = link.match(/MLBU-?(\d+)/i);

  if (!resultado?.[1]) {
    return null;
  }

  return `MLBU${resultado[1]}`;
}

async function buscarJson<T>(
  endereco: string,
  obrigatorio = true,
): Promise<T | null> {
  const token = await getMercadoLivreAccessToken();

  const resposta = await fetch(endereco, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Accept-Language": "pt-BR,pt;q=0.9",
     // Authorization: `Bearer ${token}`,
      "User-Agent": "Ofertano/1.0",
    },
    cache: "no-store",
  });

  if (!resposta.ok) {
    let detalhe = "";

    try {
      detalhe = await resposta.text();
    } catch {
      detalhe = "";
    }

    console.error("Erro da API do Mercado Livre:", {
      endereco,
      status: resposta.status,
      detalhe,
    });

    if (!obrigatorio) {
      return null;
    }

    if (resposta.status === 401) {
      throw new Error(
        "O access token do Mercado Livre é inválido ou expirou.",
      );
    }

    if (resposta.status === 403) {
      throw new Error(
        "O Mercado Livre recusou o acesso. Verifique se o access token é válido e se a aplicação possui permissão.",
      );
    }

    if (resposta.status === 404) {
      throw new Error(
        "O anúncio não foi encontrado na API do Mercado Livre.",
      );
    }

    if (resposta.status === 429) {
      throw new Error(
        "O limite de consultas da API do Mercado Livre foi atingido. Aguarde alguns minutos.",
      );
    }

    throw new Error(
      `A API do Mercado Livre retornou o código ${resposta.status}.`,
    );
  }

  return (await resposta.json()) as T;
}

async function resolverLinkEncurtado(link: string): Promise<string> {
  const url = new URL(link);

  if (
    url.hostname !== "meli.la" &&
    !url.hostname.endsWith(".meli.la")
  ) {
    return link;
  }

  const resposta = await fetch(link, {
    method: "GET",
    redirect: "follow",
    cache: "no-store",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "pt-BR,pt;q=0.9",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/150.0.0.0 Safari/537.36",
    },
  });

  return resposta.url || link;
}

function encontrarAtributo(
  atributos: MercadoLivreAttribute[] | undefined,
  nomes: string[],
): string | null {
  if (!atributos?.length) {
    return null;
  }

  const nomesNormalizados = nomes.map((nome) =>
    nome.toUpperCase(),
  );

  const atributo = atributos.find((item) => {
    const id = item.id?.toUpperCase() || "";
    const nome = item.name?.toUpperCase() || "";

    return nomesNormalizados.some(
      (procurado) =>
        id === procurado ||
        nome === procurado,
    );
  });

  return atributo?.value_name?.trim() || null;
}

function criarEspecificacoes(
  atributos: MercadoLivreAttribute[] | undefined,
): Record<string, string> {
  const especificacoes: Record<string, string> = {};

  if (!atributos?.length) {
    return especificacoes;
  }

  for (const atributo of atributos) {
    const nome = atributo.name?.trim();
    const valor = atributo.value_name?.trim();

    if (nome && valor) {
      especificacoes[nome] = valor;
    }
  }

  return especificacoes;
}

function extrairImagens(item: MercadoLivreItem): string[] {
  const imagens = new Set<string>();

  for (const foto of item.pictures || []) {
    const endereco = foto.secure_url || foto.url;

    if (endereco?.startsWith("http")) {
      imagens.add(endereco.replace(/^http:/, "https:"));
    }
  }

  if (item.secure_thumbnail?.startsWith("http")) {
    imagens.add(
      item.secure_thumbnail.replace(/^http:/, "https:"),
    );
  }

  if (item.thumbnail?.startsWith("http")) {
    imagens.add(
      item.thumbnail.replace(/^http:/, "https:"),
    );
  }

  return [...imagens];
}

function criarParcelamento(preco: number): string | null {
  if (!Number.isFinite(preco) || preco <= 0) {
    return null;
  }

  const quantidadeParcelas = 12;
  const valorParcela = preco / quantidadeParcelas;

  const formatador = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  return `${quantidadeParcelas}x de ${formatador.format(
    valorParcela,
  )}`;
}

async function montarProduto(
  itemId: string,
  linkOriginal: string,
): Promise<ProdutoImportado> {
  const item = await buscarJson<MercadoLivreItem>(
    `https://api.mercadolibre.com/items/${itemId}`,
  );

  if (!item) {
    throw new Error("O produto não foi encontrado.");
  }

  if (!item.id) {
    throw new Error(
      "A API não retornou o código do anúncio.",
    );
  }

  if (!item.title?.trim()) {
    throw new Error(
      "A API não retornou o nome do produto.",
    );
  }

  if (
    typeof item.price !== "number" ||
    !Number.isFinite(item.price) ||
    item.price <= 0
  ) {
    throw new Error(
      "A API não retornou um preço válido.",
    );
  }

  const imagens = extrairImagens(item);

  if (imagens.length === 0) {
    throw new Error(
      "A API não retornou imagens para esse produto.",
    );
  }

  const descricaoPromise =
    buscarJson<MercadoLivreDescription>(
      `https://api.mercadolibre.com/items/${item.id}/description`,
      false,
    );

  const categoriaPromise = item.category_id
    ? buscarJson<MercadoLivreCategory>(
        `https://api.mercadolibre.com/categories/${item.category_id}`,
        false,
      )
    : Promise.resolve(null);

  const avaliacoesPromise =
    buscarJson<MercadoLivreReviews>(
      `https://api.mercadolibre.com/reviews/item/${item.id}`,
      false,
    );

  const [descricao, categoria, avaliacoes] =
    await Promise.all([
      descricaoPromise,
      categoriaPromise,
      avaliacoesPromise,
    ]);

  const descricaoProduto =
    descricao?.plain_text?.trim() ||
    descricao?.text?.trim() ||
    null;

  const precoAntigo =
    typeof item.original_price === "number" &&
    item.original_price > item.price
      ? item.original_price
      : null;

  const marca = encontrarAtributo(
    item.attributes,
    ["BRAND", "MARCA"],
  );

  const especificacoes =
    criarEspecificacoes(item.attributes);

  if (item.condition) {
    especificacoes.Condição =
      item.condition === "new"
        ? "Novo"
        : item.condition;
  }

  if (item.warranty) {
    especificacoes.Garantia = item.warranty;
  }

  const slugBase = criarSlug(item.title);

  const slug = `${slugBase}-${item.id.toLowerCase()}`;

  return {
    mlId: item.id,
    name: item.title.trim(),
    slug,
    image: imagens[0],
    images: imagens,
    video: null,
    brand: marca,
    description: descricaoProduto,
    specifications: especificacoes,
    category:
      categoria?.name?.trim() || "Ofertas",
    store: "Mercado Livre",

    /*
     * Mantém o link original porque ele pode
     * conter sua identificação de afiliado.
     */
    affiliateLink: linkOriginal,

    price: item.price,
    oldPrice: precoAntigo,
    installments: criarParcelamento(item.price),
    discount: calcularDesconto(
      item.price,
      precoAntigo,
    ),

    rating:
      typeof avaliacoes?.rating_average === "number"
        ? avaliacoes.rating_average
        : null,

    reviews:
      typeof avaliacoes?.total === "number"
        ? Math.round(avaliacoes.total)
        : null,

    sales:
      typeof item.sold_quantity === "number"
        ? Math.round(item.sold_quantity)
        : null,

    stock:
      typeof item.available_quantity === "number"
        ? Math.round(item.available_quantity)
        : null,
  };
}

export async function POST(request: Request) {
  try {
    /*
     * Verifica o token antes de iniciar a importação.
     */
    await getMercadoLivreAccessToken();

    const body = await request.json();

    const linkRecebido =
      typeof body.url === "string"
        ? body.url.trim()
        : typeof body.link === "string"
          ? body.link.trim()
          : "";

    if (!linkRecebido) {
      return NextResponse.json(
        {
          error:
            "Cole o link do produto do Mercado Livre.",
        },
        {
          status: 400,
        },
      );
    }

    let url: URL;

    try {
      url = new URL(linkRecebido);
    } catch {
      return NextResponse.json(
        {
          error:
            "O endereço informado não é um link válido.",
        },
        {
          status: 400,
        },
      );
    }

    if (!dominioPermitido(url.hostname)) {
      return NextResponse.json(
        {
          error:
            "Informe um link válido do Mercado Livre.",
        },
        {
          status: 400,
        },
      );
    }

    let linkResolvido = linkRecebido;

    if (
      url.hostname === "meli.la" ||
      url.hostname.endsWith(".meli.la")
    ) {
      linkResolvido =
        await resolverLinkEncurtado(linkRecebido);
    }

    /*
     * Não removemos a parte após # antes de
     * capturar o parâmetro wid.
     */
    const itemId =
      extrairMlIdDoLink(linkRecebido) ||
      extrairMlIdDoLink(linkResolvido);

    if (!itemId) {
      const catalogoId =
        extrairMlbuDoLink(linkRecebido) ||
        extrairMlbuDoLink(linkResolvido);

      return NextResponse.json(
        {
          error: catalogoId
            ? `O link possui o catálogo ${catalogoId}, mas não possui o código MLB do anúncio. Copie o link completo que contenha "wid=MLB...".`
            : "Não foi possível encontrar o código MLB do anúncio.",
        },
        {
          status: 400,
        },
      );
    }

    const dados = await montarProduto(
      itemId,
      linkRecebido,
    );

    const produto = await prisma.product.upsert({
      where: {
        mlId: dados.mlId,
      },

      update: {
        name: dados.name,
        slug: dados.slug,
        image: dados.image,
        images: dados.images,
        video: dados.video,
        brand: dados.brand,
        description: dados.description,
        specifications: dados.specifications,
        category: dados.category,
        store: dados.store,
        affiliateLink: dados.affiliateLink,
        price: dados.price,
        oldPrice: dados.oldPrice,
        installments: dados.installments,
        discount: dados.discount,
        rating: dados.rating,
        reviews: dados.reviews,
        sales: dados.sales,
        stock: dados.stock,
        active: true,
      },

      create: {
        mlId: dados.mlId,
        name: dados.name,
        slug: dados.slug,
        image: dados.image,
        images: dados.images,
        video: dados.video,
        brand: dados.brand,
        description: dados.description,
        specifications: dados.specifications,
        category: dados.category,
        store: dados.store,
        affiliateLink: dados.affiliateLink,
        price: dados.price,
        oldPrice: dados.oldPrice,
        installments: dados.installments,
        discount: dados.discount,
        rating: dados.rating,
        reviews: dados.reviews,
        sales: dados.sales,
        stock: dados.stock,
        active: true,
        featured: false,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Produto importado com sucesso!",
      product: {
        id: produto.id,
        mlId: produto.mlId,
        name: produto.name,
        image: produto.image,
        price: produto.price,
        oldPrice: produto.oldPrice,
        discount: produto.discount,
        category: produto.category,
      },
    });
  } catch (error) {
    console.error(
      "Erro ao importar produto:",
      error,
    );

    const mensagem =
      error instanceof Error
        ? error.message
        : "Ocorreu um erro interno ao importar o produto.";

    return NextResponse.json(
      {
        error: mensagem,
      },
      {
        status: 500,
      },
    );
  }
}