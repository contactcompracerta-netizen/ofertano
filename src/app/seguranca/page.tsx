import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import Footer from "@/components/Footer";
import Header from "@/components/Header";
import prisma from "@/lib/prisma";
import { sanitizeProductNameForDisplay } from "@/lib/product/productPresentation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/*
 * A rota /seguranca contém hoje uma página de produto legada (herdada de
 * uma versão anterior) que renderiza conteúdo de produto arbitrário sem
 * parâmetro [id]. Enquanto não houver um guia real de segurança, a página
 * fica fora do índice para não gerar conteúdo duplicado de produto.
 * BLOCKER documentado: precisa de conteúdo próprio "Orientações de
 * segurança" na FASE seguinte (fora do escopo desta missão).
 */
export const metadata: Metadata = {
  title: "Segurança",
  robots: {
    index: false,
    follow: false,
  },
};

type ProdutoPageProps = {
  params: Promise<{
    id: string;
  }>;
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
    KABUM: "KaBuM!",
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

function obterTextoOfertaPendente(
  status: string,
  available: boolean,
) {
  if (!available || status === "UNAVAILABLE") {
    return "Oferta indisponível";
  }

  if (status === "ERROR") {
    return "Oferta em verificação";
  }

  return "Link em revisão";
}

export default async function ProdutoPage({
  params,
}: ProdutoPageProps) {
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

  const possuiPrecoAnterior =
    produto.oldPrice !== null &&
    produto.oldPrice > produto.price;

  const possuiDesconto =
    produto.discount !== null &&
    produto.discount > 0;

  const possuiAvaliacao =
    produto.rating !== null &&
    produto.rating > 0;

  const possuiAvaliacoes =
    produto.reviews !== null &&
    produto.reviews > 0;

  const possuiVendas =
    produto.sales !== null &&
    produto.sales > 0;

  const possuiEstoque =
    produto.stock !== null &&
    produto.stock > 0;

  const displayName = sanitizeProductNameForDisplay(produto.name);

  const linkLegadoPrincipal = produto.affiliateLink.trim();

  const ofertaPrincipalComLink = produto.offers.find((oferta) => {
    const link = oferta.affiliateLink?.trim();

    return (
      Boolean(link) &&
      oferta.status === "ACTIVE" &&
      oferta.available
    );
  });

  const linkPrincipal =
    linkLegadoPrincipal ||
    ofertaPrincipalComLink?.affiliateLink?.trim() ||
    "";

  const marketplacePrincipal = linkLegadoPrincipal
    ? produto.store.trim() || "Loja parceira"
    : ofertaPrincipalComLink
      ? formatarMarketplace(ofertaPrincipalComLink.marketplace)
      : produto.store.trim() || "Loja parceira";

  const possuiLinkPrincipal = linkPrincipal.length > 0;

  return (
    <main className="min-h-screen bg-slate-50">
      <Header />

      <section className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-4">
          <nav
            aria-label="Navegação estrutural"
            className="flex flex-wrap items-center gap-2 text-sm text-gray-500"
          >
            <Link
              href="/"
              className="transition hover:text-green-700"
            >
              Início
            </Link>

            <span aria-hidden="true">/</span>

            <Link
              href="/ofertas"
              className="transition hover:text-green-700"
            >
              Ofertas
            </Link>

            <span aria-hidden="true">/</span>

            <span className="max-w-md truncate font-semibold text-gray-700">
              {displayName}
            </span>
          </nav>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-10 lg:py-14">
        <div className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
          <div className="grid lg:grid-cols-2">
            <div className="border-b border-gray-200 bg-white p-6 sm:p-10 lg:border-b-0 lg:border-r">
              <div className="relative flex min-h-[360px] items-center justify-center sm:min-h-[520px]">
                <div className="absolute left-0 top-0 z-10 flex flex-col items-start gap-2">
                  {possuiDesconto && (
                    <span className="rounded-full bg-red-600 px-4 py-2 text-sm font-black text-white shadow">
                      {produto.discount}% OFF
                    </span>
                  )}

                  {produto.featured && (
                    <span className="rounded-full bg-amber-400 px-4 py-2 text-sm font-black text-amber-950 shadow">
                      Produto em destaque
                    </span>
                  )}
                </div>

                <Image
                  src={produto.image}
                  alt={displayName}
                  width={800}
                  height={800}
                  priority
                  sizes="(max-width: 1024px) 100vw, 50vw"
                  className="max-h-[520px] w-full object-contain"
                />
              </div>

              {produto.images.length > 1 && (
                <div className="mt-6 grid grid-cols-4 gap-3 sm:grid-cols-5">
                  {produto.images
                    .slice(0, 5)
                    .map((imagem, indice) => (
                      <div
                        key={`${imagem}-${indice}`}
                        className="flex aspect-square items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-white p-2"
                      >
                        <Image
                          src={imagem}
                          alt={`${displayName} - imagem ${indice + 1}`}
                          width={140}
                          height={140}
                          className="h-full w-full object-contain"
                        />
                      </div>
                    ))}
                </div>
              )}
            </div>

            <div className="flex flex-col p-6 sm:p-10">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="rounded-full bg-green-100 px-4 py-2 text-sm font-black text-green-700">
                    Oferta em {marketplacePrincipal}
                  </span>

                  {produto.brand && (
                    <span className="rounded-full bg-gray-100 px-4 py-2 text-sm font-bold text-gray-600">
                      {produto.brand}
                    </span>
                  )}
                </div>

                <h1 className="mt-6 text-3xl font-black leading-tight tracking-tight text-gray-900 sm:text-4xl">
                  {displayName}
                </h1>

                <div className="mt-5 flex flex-wrap items-center gap-3 text-sm">
                  {possuiAvaliacao && (
                    <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-amber-800">
                      <span
                        aria-hidden="true"
                        className="text-amber-500"
                      >
                        ★
                      </span>

                      <span className="font-black">
                        {produto.rating?.toFixed(1)}
                      </span>

                      {possuiAvaliacoes && (
                        <span className="text-amber-700">
                          (
                          {formatarQuantidade(
                            produto.reviews!,
                          )}{" "}
                          avaliações)
                        </span>
                      )}
                    </div>
                  )}

                  {possuiVendas && (
                    <span className="rounded-xl bg-gray-100 px-3 py-2 font-semibold text-gray-600">
                      {formatarQuantidade(produto.sales!)}{" "}
                      vendidos
                    </span>
                  )}

                  {possuiEstoque && produto.stock! <= 5 && (
                    <span className="rounded-xl bg-orange-100 px-3 py-2 font-black text-orange-700">
                      Últimas {produto.stock} unidades
                    </span>
                  )}
                </div>

                <div className="mt-8 border-y border-gray-200 py-7">
                  {possuiPrecoAnterior &&
                    produto.oldPrice !== null && (
                      <p className="text-lg font-medium text-gray-400 line-through">
                        {formatarPreco(produto.oldPrice)}
                      </p>
                    )}

                  <p className="mt-1 text-4xl font-black tracking-tight text-green-700 sm:text-5xl">
                    {formatarPreco(produto.price)}
                  </p>

                  {produto.installments && (
                    <p className="mt-3 text-base font-semibold text-gray-600">
                      {produto.installments}
                    </p>
                  )}

                  <p className="mt-3 text-sm text-gray-500">
                    Preço e condições sujeitos a alteração na
                    loja parceira.
                  </p>
                </div>

                {possuiLinkPrincipal ? (
                  <a
                    href={linkPrincipal}
                    target="_blank"
                    rel="noopener noreferrer sponsored"
                    className="mt-8 flex min-h-16 w-full items-center justify-center rounded-2xl bg-green-600 px-6 text-center text-lg font-black text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-green-700 hover:shadow-xl focus:outline-none focus:ring-4 focus:ring-green-200"
                  >
                    Ver oferta em {marketplacePrincipal}
                  </a>
                ) : (
                  <div className="mt-8 rounded-2xl border border-amber-300 bg-amber-50 px-6 py-5 text-center">
                    <p className="font-black text-amber-900">
                      Link em revisão
                    </p>

                    <p className="mt-2 text-sm leading-6 text-amber-800">
                      Esta oferta já foi encontrada, mas o link
                      individual de afiliado ainda está sendo
                      conferido.
                    </p>
                  </div>
                )}

                <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-5">
                  <p className="font-black text-gray-900">
                    Compra realizada fora do Ofertano
                  </p>

                  <p className="mt-2 text-sm leading-6 text-gray-700">
                    Você será direcionado para a loja parceira,
                    onde deverá confirmar preço, estoque,
                    pagamento, entrega e garantia.
                  </p>
                </div>
              </div>

              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="font-black text-gray-900">
                    Pagamento
                  </p>

                  <p className="mt-1 text-sm leading-5 text-gray-600">
                    Processado pela loja
                  </p>
                </div>

                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="font-black text-gray-900">
                    Entrega
                  </p>

                  <p className="mt-1 text-sm leading-5 text-gray-600">
                    Responsabilidade da loja
                  </p>
                </div>

                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="font-black text-gray-900">
                    Garantia
                  </p>

                  <p className="mt-1 text-sm leading-5 text-gray-600">
                    Conforme a oferta
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {(produto.description ||
          produto.specifications ||
          produto.offers.length > 0) && (
          <div className="mt-8 grid gap-8 lg:grid-cols-[1.4fr_0.6fr]">
            <div className="space-y-8">
              {produto.description && (
                <section className="rounded-3xl border border-gray-200 bg-white p-7 shadow-sm sm:p-9">
                  <h2 className="text-2xl font-black text-gray-900">
                    Sobre o produto
                  </h2>

                  <p className="mt-5 whitespace-pre-line leading-7 text-gray-600">
                    {produto.description}
                  </p>
                </section>
              )}

              {produto.specifications &&
                typeof produto.specifications === "object" &&
                !Array.isArray(produto.specifications) && (
                  <section className="rounded-3xl border border-gray-200 bg-white p-7 shadow-sm sm:p-9">
                    <h2 className="text-2xl font-black text-gray-900">
                      Especificações
                    </h2>

                    <dl className="mt-6 divide-y divide-gray-200">
                      {Object.entries(
                        produto.specifications,
                      ).map(([chave, valor]) => (
                        <div
                          key={chave}
                          className="grid gap-2 py-4 sm:grid-cols-[0.8fr_1.2fr]"
                        >
                          <dt className="font-bold text-gray-800">
                            {chave}
                          </dt>

                          <dd className="text-gray-600">
                            {typeof valor === "string" ||
                            typeof valor === "number" ||
                            typeof valor === "boolean"
                              ? String(valor)
                              : JSON.stringify(valor)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                )}
            </div>

            <aside className="space-y-6">
              {produto.offers.length > 0 && (
                <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                  <h2 className="text-xl font-black text-gray-900">
                    Compare preços
                  </h2>

                  <p className="mt-2 text-sm leading-6 text-gray-600">
                    Veja as ofertas encontradas para este
                    produto.
                  </p>

                  <div className="mt-5 space-y-3">
                    {produto.offers.map((oferta) => {
                      const link =
                        oferta.affiliateLink?.trim();

                      const linkAtivo =
                        Boolean(link) &&
                        oferta.status === "ACTIVE" &&
                        oferta.available;

                      const marketplace =
                        formatarMarketplace(
                          oferta.marketplace,
                        );

                      if (linkAtivo && link) {
                        return (
                          <a
                            key={oferta.id}
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer sponsored"
                            className="block rounded-2xl border border-gray-200 p-4 transition hover:border-green-300 hover:bg-green-50"
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <p className="font-black text-gray-900">
                                  {marketplace}
                                </p>

                                {oferta.installments && (
                                  <p className="mt-1 text-xs text-gray-500">
                                    {
                                      oferta.installments
                                    }
                                  </p>
                                )}

                                {oferta.isBest && (
                                  <span className="mt-2 inline-flex rounded-full bg-green-100 px-2.5 py-1 text-xs font-black text-green-700">
                                    Melhor preço
                                  </span>
                                )}
                              </div>

                              <p className="shrink-0 font-black text-green-700">
                                {formatarPreco(
                                  oferta.price,
                                )}
                              </p>
                            </div>
                          </a>
                        );
                      }

                      return (
                        <div
                          key={oferta.id}
                          className="rounded-2xl border border-amber-200 bg-amber-50 p-4"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <p className="font-black text-gray-900">
                                {marketplace}
                              </p>

                              {oferta.installments && (
                                <p className="mt-1 text-xs text-gray-500">
                                  {oferta.installments}
                                </p>
                              )}

                              <span className="mt-2 inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-black text-amber-800">
                                {obterTextoOfertaPendente(
                                  oferta.status,
                                  oferta.available,
                                )}
                              </span>
                            </div>

                            <p className="shrink-0 font-black text-gray-700">
                              {formatarPreco(oferta.price)}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                <h2 className="text-xl font-black text-gray-900">
                  Comprar com segurança
                </h2>

                <p className="mt-3 text-sm leading-6 text-gray-600">
                  O Ofertano não recebe pagamentos e não realiza
                  vendas diretamente.
                </p>

                <Link
                  href="/seguranca"
                  className="mt-5 inline-flex font-black text-green-700 transition hover:text-green-900"
                >
                  Ver orientações de segurança →
                </Link>
              </section>
            </aside>
          </div>
        )}
      </section>

      <Footer />
    </main>
  );
}
