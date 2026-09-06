import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/seo/site";
import {
  ROTAS_ESTATICAS_PUBLICAS,
} from "@/lib/seo/sitemapRoutes";
import prisma from "@/lib/prisma";
import {
  hasPublicMultiStore,
  multiStorePublicWhere,
  PUBLIC_OFFER_SELECT,
} from "@/services/publicVisibility/multiStoreVisibility";
import { legacyBlogPosts } from "@/app/blog/posts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/*
 * Produtos indexáveis seguem a mesma regra pública da UI (Multi Loja):
 * somente produtos com ofertas válidas em pelo menos DOIS marketplaces
 * distintos, ativos e não-rascunho. Consulta 100% read-only.
 *
 * O filtro é reutilizado de src/services/publicVisibility e não cria
 * regra paralela. A checagem em memória repete multiStorePublicWhere()
 * para garantir que nenhum produto que a UI esconderia entre aqui.
 */
async function produtosPublicosIndexaveis(): Promise<
  Array<{ id: string; updatedAt: Date }>
> {
  const produtos = await prisma.product.findMany({
    where: {
      active: true,
      publicationStatus: {
        not: "DRAFT",
      },
      price: {
        gt: 0,
      },
      image: {
        not: "",
      },
      AND: multiStorePublicWhere().AND,
    },
    select: {
      id: true,
      updatedAt: true,
      offers: {
        where: {
          active: true,
          matchStatus: "EXACT",
        },
        ...PUBLIC_OFFER_SELECT,
      },
    },
  });

  return produtos
    .filter(hasPublicMultiStore)
    .map((produto) => ({
      id: produto.id,
      updatedAt: produto.updatedAt,
    }));
}

/*
 * Posts publicados em modo somente-leitura.
 *
 * Não reutiliza listarPostsPublicados aqui porque ele publica posts
 * agendados vencidos (escrita). O sitemap deve ser read-only.
 * Reproduz a mesma decisão de conteúdo: usa o banco quando existem
 * posts publicados; caso contrário, cai para os posts legados.
 */
async function postsPublicadosIndexaveis(): Promise<
  Array<{ slug: string; updatedAt: Date | null }>
> {
  try {
    const agora = new Date();

    const posts = await prisma.blogPost.findMany({
      where: {
        status: "PUBLISHED",
        publishedAt: {
          lte: agora,
        },
      },
      select: {
        slug: true,
        updatedAt: true,
      },
      orderBy: {
        publishedAt: "desc",
      },
    });

    if (posts.length > 0) {
      return posts;
    }

    const total = await prisma.blogPost.count();

    if (total > 0) {
      return [];
    }

    return legacyBlogPosts.map((post) => ({
      slug: post.slug,
      updatedAt: null,
    }));
  } catch {
    // Banco indisponível: mantém o sitemap read-only e entrega os posts
    // legados para que /sitemap.xml não caia por falha temporária de leitura.
    return legacyBlogPosts.map((post) => ({
      slug: post.slug,
      updatedAt: null,
    }));
  }
}

/*
 * Sitemap único hoje (volume pequeno). Separado em blocos estáticos,
 * posts e produtos para evoluir depois para sitemaps segmentados sem
 * mudar a lógica de seleção.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const estaticas = ROTAS_ESTATICAS_PUBLICAS.map((rota) => ({
    url: siteUrl(rota),
  }));

  const posts = await postsPublicadosIndexaveis();
  const entradasPosts = posts.map((post) => ({
    url: siteUrl(`/blog/${post.slug}`),
    ...(post.updatedAt ? { lastModified: post.updatedAt } : {}),
  }));

  const produtos = await produtosPublicosIndexaveis();
  const entradasProdutos = produtos.map((produto) => ({
    url: siteUrl(`/produto/${produto.id}`),
    lastModified: produto.updatedAt,
  }));

  return [...estaticas, ...entradasPosts, ...entradasProdutos];
}