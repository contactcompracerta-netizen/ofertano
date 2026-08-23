import type { Metadata } from "next";
import Link from "next/link";

import {
  ArticleCard,
  FeaturedArticle,
} from "@/components/blog/ArticleCard";
import { ArrowIcon, SearchIcon } from "@/components/blog/icons";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import { listarPostsPublicados } from "@/services/blog/public";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Blog | Guias para comprar melhor",
  description:
    "Guias de compra, comparativos, segurança e dicas para economizar nas compras online com o Ofertano.",
  alternates: {
    canonical: "/blog",
  },
  openGraph: {
    type: "website",
    url: "/blog",
    title: "Blog do Ofertano | Informação para comprar melhor",
    description:
      "Conteúdo direto e confiável para comparar preços, reconhecer boas ofertas e comprar online com mais segurança.",
  },
};

const categories = [
  "Guias de compra",
  "Comparativos",
  "Economia",
  "Compra segura",
];

export default async function BlogPage() {
  const blogPosts = await listarPostsPublicados();

  const featuredPost =
    blogPosts.find((post) => post.featured) ?? blogPosts[0];

  if (!featuredPost) {
    return (
      <main className="min-h-screen overflow-x-clip bg-slate-50 text-slate-950">
        <Header />

        <section className="ofertano-container py-12 text-center lg:py-16">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
            Blog do Ofertano
          </p>

          <h1 className="mt-3 text-[2rem] font-black tracking-tight lg:text-[2.5rem]">
            Novos conteúdos em preparação
          </h1>

          <p className="mx-auto mt-3 max-w-2xl text-base leading-7 text-slate-600">
            Estamos preparando novos guias para ajudar você a
            comparar preços e comprar melhor.
          </p>

          <Link
            href="/ofertas"
            className="mt-6 inline-flex rounded-xl bg-emerald-600 px-5 py-3 text-[15px] font-bold text-white transition hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
          >
            Ver ofertas verificadas
          </Link>
        </section>

        <Footer />
      </main>
    );
  }

  const latestPosts = blogPosts.filter(
    (post) => post.slug !== featuredPost.slug,
  );

  return (
    <main className="min-h-screen overflow-x-clip bg-slate-50 text-slate-950">
      <Header />

      <section className="relative overflow-hidden border-b border-slate-800 bg-slate-950 text-white">
        <div className="pointer-events-none absolute inset-0 opacity-60 [background-image:radial-gradient(circle_at_12%_18%,rgba(16,185,129,0.18),transparent_32%),radial-gradient(circle_at_88%_20%,rgba(59,130,246,0.12),transparent_28%)]" />

        <div className="ofertano-container relative grid items-center gap-8 py-10 lg:grid-cols-[minmax(0,1.38fr)_minmax(0,1fr)] lg:gap-12 lg:py-12">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.16em] text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Conteúdo Ofertano
            </span>

            <h1 className="mt-5 text-[2rem] font-black leading-[1.12] tracking-tight sm:text-[2.5rem] lg:text-[2.875rem] lg:leading-[1.1]">
              Decisões melhores começam com{" "}
              <span className="text-emerald-400">
                informação confiável.
              </span>
            </h1>

            <p className="mt-4 max-w-xl text-[16px] leading-7 text-slate-300 lg:text-[17px]">
              Guias diretos para comparar preços, reconhecer
              boas ofertas e comprar online com mais segurança.
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <a
                href="#artigos"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-5 py-3 text-[15px] font-bold text-white transition hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
              >
                Explorar os guias
                <ArrowIcon />
              </a>

              <Link
                href="/ofertas"
                className="inline-flex items-center justify-center rounded-lg border border-white/20 bg-white/5 px-5 py-3 text-[15px] font-bold text-white transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
              >
                Comparar preços agora
              </Link>
            </div>
          </div>

          <div className="w-full rounded-2xl border border-white/10 bg-white/[0.05] p-3">
            <div className="rounded-xl border border-white/10 bg-slate-900/85 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-400">
                    Radar do consumidor
                  </p>

                  <p className="mt-1.5 text-base font-bold text-white">
                    Antes de comprar, confira
                  </p>
                </div>

                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-400/10 text-emerald-300">
                  <SearchIcon className="h-5 w-5" />
                </span>
              </div>

              <div className="mt-4 space-y-2.5">
                {[
                  ["01", "Se é exatamente o mesmo modelo"],
                  ["02", "O preço final com frete e juros"],
                  ["03", "A reputação da loja e do vendedor"],
                ].map(([number, label]) => (
                  <div
                    key={number}
                    className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3"
                  >
                    <span className="text-xs font-bold text-emerald-400">
                      {number}
                    </span>

                    <span className="text-[14px] font-medium text-slate-200">
                      {label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-slate-200 bg-white">
        <div className="ofertano-container flex gap-2.5 overflow-x-auto py-3.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <span className="mr-1 hidden shrink-0 items-center text-[13px] font-bold uppercase tracking-wider text-slate-400 sm:flex">
            Navegue por:
          </span>

          {categories.map((category) => (
            <a
              key={category}
              href="#artigos"
              className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-bold text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              {category}
            </a>
          ))}
        </div>
      </section>

      <section className="ofertano-container py-10 lg:py-12">
        <div className="mb-5">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">
            Leitura recomendada
          </p>

          <h2 className="mt-1.5 text-[1.65rem] font-black tracking-tight text-slate-950 lg:text-[1.85rem]">
            Comece por aqui
          </h2>
        </div>

        <FeaturedArticle post={featuredPost} />
      </section>

      <section
        id="artigos"
        className="scroll-mt-20 border-y border-slate-200 bg-white"
      >
        <div className="ofertano-container py-10 lg:py-12">
          <div className="mb-6 max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">
              Conteúdos recentes
            </p>

            <h2 className="mt-1.5 text-[1.65rem] font-black tracking-tight text-slate-950 lg:text-[1.85rem]">
              Informação útil, sem enrolação
            </h2>

            <p className="mt-2.5 text-[15px] leading-7 text-slate-600 lg:text-base">
              Escolha um tema e veja os pontos que realmente
              fazem diferença antes de fechar uma compra.
            </p>
          </div>

          {latestPosts.length > 0 ? (
            <div className="blog-card-grid">
              {latestPosts.map((post) => (
                <ArticleCard key={post.slug} post={post} />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center">
              <p className="text-base font-bold text-slate-700">
                Novos artigos serão publicados em breve.
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="ofertano-container py-10 lg:py-12">
        <div className="grid min-h-[8.5rem] overflow-hidden rounded-2xl bg-slate-950 text-white lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="px-6 py-7 sm:px-8 sm:py-8">
            <span className="inline-flex rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-emerald-300">
              Transparência Ofertano
            </span>

            <h2 className="mt-3 max-w-3xl text-[1.5rem] font-black tracking-tight lg:text-[1.7rem]">
              Compare com calma. Compre diretamente na loja.
            </h2>

            <p className="mt-2.5 max-w-3xl text-[15px] leading-7 text-slate-300 lg:text-base">
              O Ofertano compara informações e pode receber
              comissão pelos links de afiliado, sem aumentar o
              preço para você. A venda, o pagamento e a entrega
              são realizados pela loja parceira.
            </p>
          </div>

          <div className="flex items-center border-t border-white/10 px-6 py-6 sm:px-8 lg:min-w-[280px] lg:border-l lg:border-t-0 lg:py-8">
            <Link
              href="/ofertas"
              className="inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-emerald-500 px-6 py-3 text-[15px] font-bold text-white transition hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
            >
              Ver ofertas verificadas
              <ArrowIcon />
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
