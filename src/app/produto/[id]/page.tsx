import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import FavoriteButton from "@/components/FavoriteButton";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import ProductGallery from "@/components/ProductGallery";
import ShareProductButton from "@/components/ShareProductButton";
import prisma from "@/lib/prisma";

type ProdutoPageProps = {
  params: Promise<{
    id: string;
  }>;
};

type IconProps = {
  className?: string;
};

function formatarPreco(valor: number) {
  return valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatarQuantidade(valor: number) {
  return new Intl.NumberFormat("pt-BR").format(valor);
}

function formatarMarketplace(marketplace: string) {
  const nomes: Record<string, string> = {
    MERCADO_LIVRE: "Mercado Livre",
    AMAZON: "Amazon",
    SHOPEE: "Shopee",
    MAGAZINE_LUIZA: "Magazine Luiza",
    CASAS_BAHIA: "Casas Bahia",
    TERABYTE: "Terabyte",
    ALIEXPRESS: "AliExpress",
    CARREFOUR: "Carrefour",
  };

  return (
    nomes[marketplace] ||
    marketplace
      .replaceAll("_", " ")
      .toLowerCase()
      .replace(/\b\w/g, (letra) => letra.toUpperCase())
  );
}

function limparMarca(marca: string | null | undefined) {
  const valor = marca?.trim();

  if (!valor) return null;

  return valor
    .replace(/^visite\s+a\s+loja\s+/i, "")
    .replace(/^marca:\s*/i, "")
    .trim() || null;
}

function obterTextoOfertaPendente(status: string, available: boolean) {
  if (!available || status === "UNAVAILABLE") {
    return "Oferta indisponível";
  }

  if (status === "ERROR") {
    return "Oferta em verificação";
  }

  return "Link em revisão";
}

function formatarValorEspecificacao(valor: unknown) {
  if (valor === null || valor === undefined) {
    return "Não informado";
  }

  if (typeof valor === "boolean") {
    return valor ? "Sim" : "Não";
  }

  if (typeof valor === "string" || typeof valor === "number") {
    return String(valor);
  }

  if (Array.isArray(valor)) {
    return valor.map((item) => String(item)).join(", ");
  }

  try {
    return JSON.stringify(valor);
  } catch {
    return String(valor);
  }
}

function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
    >
      <path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StarIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <path d="m12 2.75 2.78 5.63 6.22.91-4.5 4.38 1.06 6.19L12 16.94l-5.56 2.92 1.06-6.19L3 9.29l6.22-.91L12 2.75Z" />
    </svg>
  );
}

function ExternalLinkIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
    >
      <path d="M14 5h5v5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m19 5-8 8" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ShieldIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className={className}
    >
      <path
        d="M12 3 5.5 5.8v5.1c0 4.2 2.7 8 6.5 10.1 3.8-2.1 6.5-5.9 6.5-10.1V5.8L12 3Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="m9.2 12 1.8 1.8 3.8-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CardIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className={className}
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18" />
      <path d="M7 15h4" strokeLinecap="round" />
    </svg>
  );
}

function TruckIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className={className}
    >
      <path d="M3 6h11v11H3z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 9h4l3 3v5h-7V9Z" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="7" cy="18" r="2" />
      <circle cx="18" cy="18" r="2" />
    </svg>
  );
}

function CheckIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
    >
      <path d="m5 12 4 4L19 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://ofertano.vercel.app").replace(/\/$/, "");

function normalizarUrlAbsoluta(url: string) {
  const valor = url.trim();

  if (!valor) return null;

  if (/^https?:\/\//i.test(valor)) {
    return valor;
  }

  return `${SITE_URL}${valor.startsWith("/") ? "" : "/"}${valor}`;
}

function criarDescricaoCompartilhamento(
  nome: string,
  descricao: string | null | undefined,
) {
  const descricaoLimpa = descricao
    ?.replace(/\s+/g, " ")
    .trim();

  if (descricaoLimpa) {
    return descricaoLimpa.length > 180
      ? `${descricaoLimpa.slice(0, 177).trimEnd()}...`
      : descricaoLimpa;
  }

  return `Compare o preço de ${nome} no Ofertano e compre diretamente na loja parceira.`;
}

export async function generateMetadata({
  params,
}: ProdutoPageProps): Promise<Metadata> {
  const { id } = await params;

  const produto = await prisma.product.findFirst({
    where: {
      id,
      active: true,
    },
    select: {
      name: true,
      description: true,
      image: true,
      images: true,
    },
  });

  if (!produto) {
    return {
      title: "Produto não encontrado | Ofertano",
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  const urlProduto = `${SITE_URL}/produto/${id}`;
  const imagemPrincipal = [produto.image, ...produto.images]
    .filter((imagem): imagem is string => Boolean(imagem?.trim()))
    .map(normalizarUrlAbsoluta)
    .find((imagem): imagem is string => Boolean(imagem));
  const descricao = criarDescricaoCompartilhamento(
    produto.name,
    produto.description,
  );

  return {
    title: `${produto.name} | Ofertano`,
    description: descricao,
    alternates: {
      canonical: urlProduto,
    },
    openGraph: {
      title: produto.name,
      description: descricao,
      url: urlProduto,
      siteName: "Ofertano",
      locale: "pt_BR",
      type: "website",
      images: imagemPrincipal
        ? [
            {
              url: imagemPrincipal,
              alt: produto.name,
            },
          ]
        : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: produto.name,
      description: descricao,
      images: imagemPrincipal ? [imagemPrincipal] : undefined,
    },
  };
}

export default async function ProdutoPage({ params }: ProdutoPageProps) {
  const { id } = await params;

  const produto = await prisma.product.findFirst({
    where: {
      id,
      active: true,
    },
    include: {
      offers: {
        where: {
          active: true,
        },
        orderBy: {
          price: "asc",
        },
      },
    },
  });

  if (!produto) {
    notFound();
  }

  const filtrosSemelhantes = [
    { category: produto.category },
    ...(produto.brand?.trim() ? [{ brand: produto.brand }] : []),
  ];

  const selectRecomendado = {
    id: true,
    name: true,
    image: true,
    price: true,
    oldPrice: true,
    discount: true,
    store: true,
    brand: true,
    rating: true,
    reviews: true,
  } as const;

  const produtosSemelhantesDiretos = await prisma.product.findMany({
    where: {
      id: { not: produto.id },
      active: true,
      price: { gt: 0 },
      image: { not: "" },
      OR: filtrosSemelhantes,
    },
    select: selectRecomendado,
    orderBy: [
      { featured: "desc" },
      { updatedAt: "desc" },
    ],
    take: 8,
  });

  const idsJaSelecionados = produtosSemelhantesDiretos.map((item) => item.id);

  const produtosComplementares =
    produtosSemelhantesDiretos.length < 8
      ? await prisma.product.findMany({
          where: {
            id: {
              notIn: [produto.id, ...idsJaSelecionados],
            },
            active: true,
            price: { gt: 0 },
            image: { not: "" },
          },
          select: selectRecomendado,
          orderBy: [
            { featured: "desc" },
            { updatedAt: "desc" },
          ],
          take: 8 - produtosSemelhantesDiretos.length,
        })
      : [];

  const produtosRecomendados = [
    ...produtosSemelhantesDiretos,
    ...produtosComplementares,
  ];

  const temSemelhantesDiretos = produtosSemelhantesDiretos.length > 0;

  const imagens = Array.from(
    new Set([produto.image, ...produto.images].filter(Boolean)),
  ).slice(0, 6);

  const possuiPrecoAnterior =
    produto.oldPrice !== null && produto.oldPrice > produto.price;

  const percentualDesconto =
    produto.discount !== null && produto.discount > 0
      ? Math.round(produto.discount)
      : possuiPrecoAnterior && produto.oldPrice !== null
        ? Math.round(((produto.oldPrice - produto.price) / produto.oldPrice) * 100)
        : 0;

  const possuiDesconto = percentualDesconto > 0;
  const possuiAvaliacao = produto.rating !== null && produto.rating > 0;
  const possuiAvaliacoes = produto.reviews !== null && produto.reviews > 0;
  const possuiVendas = produto.sales !== null && produto.sales > 0;
  const possuiEstoque = produto.stock !== null && produto.stock > 0;

  const linkLegadoPrincipal = produto.affiliateLink?.trim() ?? "";

  const ofertaPrincipalComLink = produto.offers.find((oferta) => {
    const link = oferta.affiliateLink?.trim();

    return Boolean(link) && oferta.status === "ACTIVE" && oferta.available;
  });

  const linkPrincipal =
    linkLegadoPrincipal || ofertaPrincipalComLink?.affiliateLink?.trim() || "";

  const marketplacePrincipal = linkLegadoPrincipal
    ? produto.store?.trim() || "Loja parceira"
    : ofertaPrincipalComLink
      ? formatarMarketplace(ofertaPrincipalComLink.marketplace)
      : produto.store?.trim() || "Loja parceira";

  const possuiLinkPrincipal = linkPrincipal.length > 0;
  const usarBarraMobileEmDuasLinhas =
    marketplacePrincipal.toLowerCase().includes("amazon") ||
    formatarPreco(produto.price).length >= 11;
  const marcaExibicao = limparMarca(produto.brand);

  const especificacoes =
    produto.specifications &&
    typeof produto.specifications === "object" &&
    !Array.isArray(produto.specifications)
      ? Object.entries(produto.specifications as Record<string, unknown>)
      : [];

  return (
    <div className="min-h-screen bg-slate-50 pb-20 text-slate-950 lg:pb-0">
      <Header />

      <main className="bg-slate-50/70">
        <div className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-[1440px] px-4 py-3 sm:px-6 lg:px-8">
            <nav
              aria-label="Navegação estrutural"
              className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-slate-500 sm:text-sm"
            >
              <Link href="/" className="shrink-0 transition hover:text-emerald-700">
                Início
              </Link>

              <ChevronRightIcon className="h-4 w-4 shrink-0 text-slate-300" />

              <Link
                href="/ofertas"
                className="shrink-0 transition hover:text-emerald-700"
              >
                Ofertas
              </Link>

              <ChevronRightIcon className="h-4 w-4 shrink-0 text-slate-300" />

              <span className="min-w-0 truncate font-semibold text-slate-700">
                {produto.name}
              </span>
            </nav>
          </div>
        </div>

        <section className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_470px] lg:gap-0 lg:overflow-visible lg:rounded-[2rem] lg:border lg:border-slate-200 lg:bg-white lg:p-6 lg:shadow-sm xl:grid-cols-[minmax(0,1fr)_510px] xl:p-8">
            <ProductGallery
              images={imagens}
              productName={produto.name}
              discountPercent={percentualDesconto}
              featured={produto.featured}
            />

            <aside className="lg:sticky lg:top-24 lg:border-l lg:border-slate-200 lg:pl-7 xl:pl-9">
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:rounded-3xl sm:p-7 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-700 ring-1 ring-inset ring-emerald-200">
                      <CheckIcon className="h-4 w-4" />
                      Oferta em {marketplacePrincipal}
                    </span>

                    {marcaExibicao && (
                      <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600">
                        {marcaExibicao}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    <FavoriteButton productId={produto.id} variant="icon" />

                    <ShareProductButton
                      title={produto.name}
                      text={`Confira esta oferta no Ofertano: ${produto.name}`}
                      platform="whatsapp"
                      variant="icon"
                    />

                    <ShareProductButton
                      title={produto.name}
                      text={`Confira esta oferta no Ofertano: ${produto.name}`}
                      variant="icon"
                    />
                  </div>
                </div>

                <h1 className="mt-4 text-2xl font-black leading-[1.12] tracking-tight text-slate-950 sm:text-3xl lg:text-[1.75rem]">
                  {produto.name}
                </h1>

                {(possuiAvaliacao || possuiVendas || (possuiEstoque && produto.stock! <= 5)) && (
                  <div className="mt-4 flex flex-wrap items-center gap-2 text-xs sm:text-sm">
                    {possuiAvaliacao && (
                      <div className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 font-bold text-amber-800">
                        <StarIcon className="h-4 w-4 text-amber-500" />
                        <span>{produto.rating?.toFixed(1)}</span>
                        {possuiAvaliacoes && (
                          <span className="font-medium text-amber-700">
                            ({formatarQuantidade(produto.reviews!)} avaliações)
                          </span>
                        )}
                      </div>
                    )}

                    {possuiVendas && (
                      <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 font-semibold text-slate-600">
                        {formatarQuantidade(produto.sales!)} vendidos
                      </span>
                    )}

                    {possuiEstoque && produto.stock! <= 5 && (
                      <span className="rounded-lg bg-orange-50 px-2.5 py-1.5 font-black text-orange-700">
                        Últimas {produto.stock} unidades
                      </span>
                    )}
                  </div>
                )}

                <div className="my-6 h-px bg-slate-200" />

                <div>
                  {possuiPrecoAnterior && produto.oldPrice !== null && (
                    <p className="text-sm font-semibold text-slate-400 line-through sm:text-base">
                      {formatarPreco(produto.oldPrice)}
                    </p>
                  )}

                  <div className="mt-1 flex flex-wrap items-end gap-3">
                    <p className="text-4xl font-black tracking-tight text-emerald-700 sm:text-5xl">
                      {formatarPreco(produto.price)}
                    </p>

                    {possuiDesconto && (
                      <span className="mb-1 rounded-md bg-emerald-100 px-2 py-1 text-xs font-black text-emerald-800">
                        Economize {percentualDesconto}%
                      </span>
                    )}
                  </div>

                  {produto.installments && (
                    <p className="mt-2 text-sm font-semibold text-slate-700 sm:text-base">
                      {produto.installments}
                    </p>
                  )}

                  <p className="mt-2 text-xs leading-5 text-slate-500 sm:text-sm">
                    Preço e condições podem mudar na loja parceira.
                  </p>
                </div>

                {possuiLinkPrincipal ? (
                  <a
                    href={linkPrincipal}
                    target="_blank"
                    rel="noopener noreferrer sponsored"
                    className="mt-6 flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 text-center text-base font-black text-white shadow-lg shadow-emerald-600/20 transition hover:-translate-y-0.5 hover:bg-emerald-700 hover:shadow-xl focus:outline-none focus:ring-4 focus:ring-emerald-200 sm:min-h-16 sm:rounded-2xl sm:text-lg"
                  >
                    Ver oferta em {marketplacePrincipal}
                    <ExternalLinkIcon className="h-5 w-5" />
                  </a>
                ) : (
                  <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-center sm:rounded-2xl">
                    <p className="font-black text-amber-950">Link em revisão</p>
                    <p className="mt-1.5 text-sm leading-5 text-amber-800">
                      A oferta já foi encontrada, mas o link individual ainda está sendo validado.
                    </p>
                  </div>
                )}

                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:rounded-2xl">
                  <div className="flex gap-3">
                    <ShieldIcon className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                    <div>
                      <p className="text-sm font-black text-slate-900">
                        Compra realizada na loja parceira
                      </p>
                      <p className="mt-1 text-xs leading-5 text-slate-600 sm:text-sm">
                        O Ofertano compara preços. Pagamento, entrega e garantia são confirmados diretamente na loja.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2">
                  <div className="rounded-xl border border-slate-200 p-3 text-center">
                    <CardIcon className="mx-auto h-5 w-5 text-slate-700" />
                    <p className="mt-2 text-xs font-black text-slate-900">Pagamento</p>
                    <p className="mt-0.5 text-[11px] leading-4 text-slate-500">Na loja</p>
                  </div>

                  <div className="rounded-xl border border-slate-200 p-3 text-center">
                    <TruckIcon className="mx-auto h-5 w-5 text-slate-700" />
                    <p className="mt-2 text-xs font-black text-slate-900">Entrega</p>
                    <p className="mt-0.5 text-[11px] leading-4 text-slate-500">Pela loja</p>
                  </div>

                  <div className="rounded-xl border border-slate-200 p-3 text-center">
                    <ShieldIcon className="mx-auto h-5 w-5 text-slate-700" />
                    <p className="mt-2 text-xs font-black text-slate-900">Garantia</p>
                    <p className="mt-0.5 text-[11px] leading-4 text-slate-500">Da oferta</p>
                  </div>
                </div>
              </section>
            </aside>
          </div>

          {produto.offers.length > 0 && (
            <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:mt-8 sm:rounded-3xl sm:p-7 lg:p-8">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
                    Comparador Ofertano
                  </p>
                  <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">
                    Compare preços em outras lojas
                  </h2>
                </div>

                <p className="max-w-xl text-sm leading-6 text-slate-600">
                  Confira preço, parcelamento e disponibilidade antes de concluir a compra.
                </p>
              </div>

              <div className="mt-6 grid gap-3 lg:grid-cols-2">
                {produto.offers.map((oferta) => {
                  const link = oferta.affiliateLink?.trim();
                  const linkAtivo =
                    Boolean(link) && oferta.status === "ACTIVE" && oferta.available;
                  const marketplace = formatarMarketplace(oferta.marketplace);

                  const conteudoOferta = (
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-black text-slate-950">{marketplace}</p>

                          {oferta.isBest && (
                            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-black text-emerald-800">
                              Melhor preço
                            </span>
                          )}
                        </div>

                        {oferta.installments && (
                          <p className="mt-1 text-xs leading-5 text-slate-500">
                            {oferta.installments}
                          </p>
                        )}

                        {!linkAtivo && (
                          <span className="mt-2 inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-black text-amber-800">
                            {obterTextoOfertaPendente(oferta.status, oferta.available)}
                          </span>
                        )}
                      </div>

                      <div className="shrink-0 text-right">
                        <p className="text-lg font-black text-emerald-700 sm:text-xl">
                          {formatarPreco(oferta.price)}
                        </p>

                        {linkAtivo && (
                          <p className="mt-1 inline-flex items-center gap-1 text-xs font-black text-emerald-700">
                            Ver oferta
                            <ExternalLinkIcon className="h-3.5 w-3.5" />
                          </p>
                        )}
                      </div>
                    </div>
                  );

                  if (linkAtivo && link) {
                    return (
                      <a
                        key={oferta.id}
                        href={link}
                        target="_blank"
                        rel="noopener noreferrer sponsored"
                        className="rounded-xl border border-slate-200 p-4 transition hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-emerald-50/60 hover:shadow-sm sm:rounded-2xl sm:p-5"
                      >
                        {conteudoOferta}
                      </a>
                    );
                  }

                  return (
                    <div
                      key={oferta.id}
                      className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 sm:rounded-2xl sm:p-5"
                    >
                      {conteudoOferta}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {(produto.description || especificacoes.length > 0) && (
            <div className="mt-6 grid gap-6 sm:mt-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
              {produto.description && (
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:rounded-3xl sm:p-7 lg:p-8">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
                    Detalhes
                  </p>
                  <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-950">
                    Sobre o produto
                  </h2>

                  <p className="mt-5 whitespace-pre-line text-sm leading-7 text-slate-600 sm:text-base">
                    {produto.description}
                  </p>
                </section>
              )}

              {especificacoes.length > 0 && (
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:rounded-3xl sm:p-7 lg:p-8">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
                    Ficha técnica
                  </p>
                  <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-950">
                    Especificações
                  </h2>

                  <dl className="mt-5 divide-y divide-slate-200">
                    {especificacoes.map(([chave, valor]) => (
                      <div key={chave} className="grid gap-1 py-3 sm:grid-cols-[0.8fr_1.2fr] sm:gap-4">
                        <dt className="text-sm font-black text-slate-800">{chave}</dt>
                        <dd className="text-sm leading-6 text-slate-600 sm:text-right">
                          {formatarValorEspecificacao(valor)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}
            </div>
          )}

          {produtosRecomendados.length > 0 && (
            <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:mt-8 sm:rounded-3xl sm:p-7 lg:p-8">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
                    Você também pode gostar
                  </p>
                  <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">
                    {temSemelhantesDiretos ? "Produtos semelhantes" : "Ofertas recomendadas"}
                  </h2>
                </div>
                <p className="max-w-xl text-sm leading-6 text-slate-600">
                  {temSemelhantesDiretos
                    ? "Produtos da mesma categoria ou marca para você comparar antes de comprar."
                    : "Outras ofertas ativas do Ofertano selecionadas para você continuar comparando."}
                </p>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-4">
                {produtosRecomendados.map((item) => {
                  const temPrecoAnterior = item.oldPrice !== null && item.oldPrice > item.price;
                  const desconto =
                    item.discount !== null && item.discount > 0
                      ? Math.round(item.discount)
                      : temPrecoAnterior && item.oldPrice !== null
                        ? Math.round(((item.oldPrice - item.price) / item.oldPrice) * 100)
                        : 0;

                  return (
                    <Link
                      key={item.id}
                      href={`/produto/${item.id}`}
                      className="group overflow-hidden rounded-2xl border border-slate-200 bg-white transition hover:-translate-y-1 hover:border-emerald-300 hover:shadow-lg"
                    >
                      <div className="relative flex aspect-square items-center justify-center overflow-hidden bg-slate-50 p-4">
                        {desconto > 0 && (
                          <span className="absolute left-3 top-3 z-10 rounded-full bg-rose-600 px-2.5 py-1 text-[10px] font-black text-white shadow-sm">
                            {desconto}% OFF
                          </span>
                        )}
                        <img
                          src={item.image}
                          alt={item.name}
                          loading="lazy"
                          className="h-full w-full object-contain transition duration-300 group-hover:scale-[1.03]"
                        />
                      </div>
                      <div className="p-3 sm:p-4">
                        <p className="text-[11px] font-black uppercase tracking-wide text-emerald-700">
                          {item.store}
                        </p>
                        <h3 className="mt-1 line-clamp-2 min-h-10 text-sm font-black leading-5 text-slate-900 sm:text-[15px]">
                          {item.name}
                        </h3>
                        <div className="mt-3">
                          {temPrecoAnterior && item.oldPrice !== null && (
                            <p className="text-xs font-semibold text-slate-400 line-through">
                              {formatarPreco(item.oldPrice)}
                            </p>
                          )}
                          <p className="text-lg font-black text-emerald-700 sm:text-xl">
                            {formatarPreco(item.price)}
                          </p>
                        </div>
                        <span className="mt-3 flex min-h-10 items-center justify-center rounded-xl bg-slate-900 px-3 text-xs font-black text-white transition group-hover:bg-emerald-700">
                          Ver produto
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:mt-8 sm:rounded-3xl sm:p-7 lg:p-8">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                  <ShieldIcon className="h-6 w-6" />
                </div>

                <div>
                  <h2 className="text-lg font-black text-slate-950 sm:text-xl">
                    Compre com segurança
                  </h2>
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
                    O Ofertano não recebe pagamentos e não vende produtos diretamente. Sempre confira o endereço da loja, o preço final e as condições da oferta.
                  </p>
                </div>
              </div>

              <Link
                href="/seguranca"
                className="inline-flex shrink-0 items-center justify-center gap-1 rounded-xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-800 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800"
              >
                Orientações de segurança
                <ChevronRightIcon className="h-4 w-4" />
              </Link>
            </div>
          </section>
        </section>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-[100] border-t border-slate-200 bg-white/95 px-3 py-2.5 shadow-[0_-8px_30px_rgba(15,23,42,0.10)] backdrop-blur lg:hidden [padding-bottom:calc(0.65rem+env(safe-area-inset-bottom))]">
        {usarBarraMobileEmDuasLinhas ? (
          <div className="mx-auto max-w-2xl">
            <div className="flex min-w-0 items-center gap-2">
              <div className="min-w-0 flex-1">
                {possuiPrecoAnterior && produto.oldPrice !== null && (
                  <p className="truncate text-[10px] font-semibold text-slate-400 line-through">
                    {formatarPreco(produto.oldPrice)}
                  </p>
                )}
                <p className="truncate text-lg font-black leading-none text-emerald-700">
                  {formatarPreco(produto.price)}
                </p>
              </div>

              <div className="[&_button]:h-11 [&_button]:w-11">
                <ShareProductButton
                  title={produto.name}
                  text={`Confira esta oferta no Ofertano: ${produto.name}`}
                  platform="whatsapp"
                  variant="icon"
                />
              </div>

              <div className="[&_button]:h-11 [&_button]:w-11">
                <ShareProductButton
                  title={produto.name}
                  text={`Confira esta oferta no Ofertano: ${produto.name}`}
                  variant="icon"
                />
              </div>
            </div>

            <div className="mt-2">
              {possuiLinkPrincipal ? (
                <a
                  href={linkPrincipal}
                  target="_blank"
                  rel="noopener noreferrer sponsored"
                  className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-center text-sm font-black text-white shadow-lg shadow-emerald-600/20 active:scale-[0.99]"
                >
                  Ver oferta em {marketplacePrincipal}
                  <ExternalLinkIcon className="h-4 w-4 shrink-0" />
                </a>
              ) : (
                <div className="flex min-h-11 w-full items-center justify-center rounded-xl border border-amber-200 bg-amber-50 px-4 text-center text-sm font-black text-amber-800">
                  Link em revisão
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="mx-auto grid max-w-2xl grid-cols-[minmax(72px,auto)_44px_44px_minmax(96px,1fr)] items-center gap-2">
            <div className="min-w-0">
              {possuiPrecoAnterior && produto.oldPrice !== null && (
                <p className="truncate text-[10px] font-semibold text-slate-400 line-through">
                  {formatarPreco(produto.oldPrice)}
                </p>
              )}
              <p className="truncate text-[16px] font-black leading-none text-emerald-700">
                {formatarPreco(produto.price)}
              </p>
            </div>

            <div className="[&_button]:h-11 [&_button]:w-11">
              <ShareProductButton
                title={produto.name}
                text={`Confira esta oferta no Ofertano: ${produto.name}`}
                platform="whatsapp"
                variant="icon"
              />
            </div>

            <div className="[&_button]:h-11 [&_button]:w-11">
              <ShareProductButton
                title={produto.name}
                text={`Confira esta oferta no Ofertano: ${produto.name}`}
                variant="icon"
              />
            </div>

            {possuiLinkPrincipal ? (
              <a
                href={linkPrincipal}
                target="_blank"
                rel="noopener noreferrer sponsored"
                className="flex min-h-11 min-w-0 items-center justify-center gap-1 rounded-xl bg-emerald-600 px-2 text-center text-[13px] font-black text-white shadow-lg shadow-emerald-600/20 active:scale-[0.99]"
              >
                <span className="truncate">Ver oferta</span>
                <ExternalLinkIcon className="h-3.5 w-3.5 shrink-0" />
              </a>
            ) : (
              <div className="flex min-h-11 min-w-0 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 px-2 text-center text-[12px] font-black text-amber-800">
                Link em revisão
              </div>
            )}
          </div>
        )}
      </div>

      <Footer />
    </div>
  );
}