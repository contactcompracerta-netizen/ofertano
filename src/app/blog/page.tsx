import type { Metadata } from "next";
import Link from "next/link";

import Footer from "@/components/Footer";
import Header from "@/components/Header";
import { listarPostsPublicados } from "@/services/blog/public";
import type { BlogPost } from "@/services/blog/types";

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

const themeClasses: Record<
  BlogPost["theme"],
  {
    surface: string;
    badge: string;
    icon: string;
    line: string;
  }
> = {
  emerald: {
    surface:
      "from-emerald-950 via-emerald-800 to-teal-600",
    badge: "bg-emerald-50 text-emerald-700",
    icon: "bg-emerald-400/20 text-emerald-50",
    line: "bg-emerald-400",
  },
  blue: {
    surface:
      "from-slate-950 via-blue-900 to-blue-600",
    badge: "bg-blue-50 text-blue-700",
    icon: "bg-blue-400/20 text-blue-50",
    line: "bg-blue-400",
  },
  amber: {
    surface:
      "from-amber-950 via-orange-800 to-amber-500",
    badge: "bg-amber-50 text-amber-800",
    icon: "bg-amber-300/20 text-amber-50",
    line: "bg-amber-400",
  },
  violet: {
    surface:
      "from-slate-950 via-violet-900 to-violet-600",
    badge: "bg-violet-50 text-violet-700",
    icon: "bg-violet-400/20 text-violet-50",
    line: "bg-violet-400",
  },
  rose: {
    surface:
      "from-rose-950 via-rose-800 to-orange-500",
    badge: "bg-rose-50 text-rose-700",
    icon: "bg-rose-300/20 text-rose-50",
    line: "bg-rose-400",
  },
  cyan: {
    surface:
      "from-slate-950 via-cyan-900 to-cyan-600",
    badge: "bg-cyan-50 text-cyan-800",
    icon: "bg-cyan-300/20 text-cyan-50",
    line: "bg-cyan-400",
  },
};

function ArrowIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 12h14m-6-6 6 6-6 6"
      />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 7v5l3 2"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-7 w-7"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="6.5" />
      <path
        strokeLinecap="round"
        d="m16 16 4 4"
      />
      <path
        strokeLinecap="round"
        d="M8 11h6M11 8v6"
      />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-7 w-7"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3 5.5 5.6v5.7c0 4.3 2.6 7.7 6.5 9.7 3.9-2 6.5-5.4 6.5-9.7V5.6L12 3Z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m9 12 2 2 4-4"
      />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-7 w-7"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 19V5m0 14h16M7 15l4-4 3 2 5-6"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16 7h3v3"
      />
    </svg>
  );
}

function ArticleVisual({
  post,
  compact = false,
}: {
  post: BlogPost;
  compact?: boolean;
}) {
  const theme =
    themeClasses[post.theme];

  return (
    <div
      className={`relative overflow-hidden bg-gradient-to-br ${theme.surface} ${
        compact
          ? "h-48"
          : "min-h-[320px] lg:min-h-full"
      }`}
    >
      {post.coverImage && (
        <>
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage: `url("${post.coverImage.replace(/"/g, "%22")}")`,
            }}
          />
          <div className="absolute inset-0 bg-slate-950/55" />
        </>
      )}
      <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full border border-white/15" />
      <div className="absolute -bottom-20 -left-10 h-56 w-56 rounded-full bg-white/10 blur-2xl" />

      <div className="relative flex h-full min-h-[inherit] flex-col justify-between p-6 sm:p-8">
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-2xl ${theme.icon}`}
        >
          {post.category ===
          "Compra segura" ? (
            <ShieldIcon />
          ) : post.category ===
            "Economia" ? (
            <ChartIcon />
          ) : (
            <SearchIcon />
          )}
        </div>

        <div className="mt-12">
          <div
            className={`mb-4 h-1 w-12 rounded-full ${theme.line}`}
          />
          <p className="max-w-sm text-sm font-bold leading-6 text-white/80">
            Informação clara para comparar,
            economizar e comprar com segurança.
          </p>
        </div>
      </div>
    </div>
  );
}

function ArticleCard({
  post,
}: {
  post: BlogPost;
}) {
  const theme =
    themeClasses[post.theme];

  return (
    <article className="group overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition duration-300 hover:-translate-y-1 hover:border-emerald-200 hover:shadow-xl hover:shadow-slate-200/60">
      <Link
        href={`/blog/${post.slug}`}
        aria-label={`Ler: ${post.title}`}
        className="block"
      >
        <ArticleVisual
          post={post}
          compact
        />

        <div className="p-6 sm:p-7">
          <span
            className={`inline-flex rounded-full px-3 py-1 text-xs font-black uppercase tracking-wider ${theme.badge}`}
          >
            {post.category}
          </span>

          <h3 className="mt-4 text-xl font-black leading-7 tracking-tight text-slate-950 transition group-hover:text-emerald-700">
            {post.title}
          </h3>

          <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">
            {post.excerpt}
          </p>

          <div className="mt-6 flex items-center justify-between gap-4 border-t border-slate-100 pt-5">
            <span className="flex items-center gap-2 text-xs font-semibold text-slate-500">
              <ClockIcon />
              {post.readingTime}
            </span>

            <span className="flex items-center gap-2 text-sm font-black text-emerald-700">
              Ler artigo
              <ArrowIcon />
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}

export default async function BlogPage() {
  const blogPosts =
    await listarPostsPublicados();

  const featuredPost =
    blogPosts.find(
      (post) => post.featured,
    ) ?? blogPosts[0];

  const categories = [
    "Guias de compra",
    "Comparativos",
    "Economia",
    "Compra segura",
  ];

  if (!featuredPost) {
    return (
      <main className="min-h-screen bg-slate-50 text-slate-950">
        <Header />
        <section className="mx-auto max-w-4xl px-4 py-20 text-center sm:px-6 lg:px-8">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
            Blog do Ofertano
          </p>
          <h1 className="mt-3 text-4xl font-black tracking-tight">
            Novos conteúdos em preparação
          </h1>
          <p className="mx-auto mt-5 max-w-2xl leading-7 text-slate-600">
            Estamos preparando novos guias para ajudar você a comparar preços e comprar melhor.
          </p>
          <Link
            href="/ofertas"
            className="mt-8 inline-flex rounded-xl bg-emerald-600 px-6 py-4 font-black text-white hover:bg-emerald-700"
          >
            Ver ofertas verificadas
          </Link>
        </section>
        <Footer />
      </main>
    );
  }

  const latestPosts =
    blogPosts.filter(
      (post) =>
        post.slug !== featuredPost.slug,
    );

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <Header />

      <section className="relative overflow-hidden border-b border-slate-800 bg-slate-950 text-white">
        <div className="absolute inset-0 opacity-50 [background-image:radial-gradient(circle_at_15%_15%,rgba(16,185,129,0.22),transparent_34%),radial-gradient(circle_at_85%_25%,rgba(59,130,246,0.16),transparent_30%)]" />

        <div className="relative mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:px-8 lg:py-24">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-emerald-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Conteúdo Ofertano
            </span>

            <h1 className="mt-7 max-w-4xl text-4xl font-black leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
              Decisões melhores começam com
              <span className="text-emerald-400">
                {" "}informação confiável.
              </span>
            </h1>

            <p className="mt-6 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">
              Guias diretos para comparar preços,
              reconhecer boas ofertas e comprar
              online com mais segurança.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <a
                href="#artigos"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-6 py-3.5 text-sm font-black text-white transition hover:bg-emerald-400"
              >
                Explorar os guias
                <ArrowIcon />
              </a>

              <Link
                href="/ofertas"
                className="inline-flex items-center justify-center rounded-xl border border-white/20 bg-white/5 px-6 py-3.5 text-sm font-black text-white transition hover:border-white/30 hover:bg-white/10"
              >
                Comparar preços agora
              </Link>
            </div>
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-4 shadow-2xl backdrop-blur sm:p-6">
            <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-5 sm:p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-400">
                    Radar do consumidor
                  </p>
                  <p className="mt-2 text-lg font-black text-white">
                    Antes de comprar, confira
                  </p>
                </div>

                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-400/10 text-emerald-300">
                  <SearchIcon />
                </span>
              </div>

              <div className="mt-6 space-y-3">
                {[
                  [
                    "01",
                    "Se é exatamente o mesmo modelo",
                  ],
                  [
                    "02",
                    "O preço final com frete e juros",
                  ],
                  [
                    "03",
                    "A reputação da loja e do vendedor",
                  ],
                ].map(([number, label]) => (
                  <div
                    key={number}
                    className="flex items-center gap-4 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3.5"
                  >
                    <span className="text-xs font-black text-emerald-400">
                      {number}
                    </span>
                    <span className="text-sm font-semibold text-slate-200">
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
        <div className="mx-auto flex max-w-7xl gap-2 overflow-x-auto px-4 py-4 sm:px-6 lg:px-8">
          <span className="mr-2 hidden shrink-0 items-center text-xs font-black uppercase tracking-wider text-slate-400 sm:flex">
            Navegue por:
          </span>

          {categories.map((category) => (
            <a
              key={category}
              href="#artigos"
              className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-bold text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700"
            >
              {category}
            </a>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-18 lg:px-8 lg:py-20">
        <div className="mb-8 flex items-end justify-between gap-6">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
              Leitura recomendada
            </p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
              Comece por aqui
            </h2>
          </div>
        </div>

        <article className="group overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm transition hover:shadow-xl hover:shadow-slate-200/60">
          <div className="grid lg:grid-cols-[0.9fr_1.1fr]">
            <ArticleVisual
              post={featuredPost}
            />

            <div className="flex flex-col justify-center p-7 sm:p-10 lg:p-12">
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black uppercase tracking-wider text-emerald-700">
                  {featuredPost.category}
                </span>
                <time
                  dateTime={featuredPost.publishedAt}
                  className="text-xs font-semibold text-slate-500"
                >
                  {featuredPost.publishedLabel}
                </time>
              </div>

              <h3 className="mt-5 max-w-2xl text-3xl font-black leading-tight tracking-tight text-slate-950 sm:text-4xl">
                {featuredPost.title}
              </h3>

              <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600">
                {featuredPost.excerpt}
              </p>

              <div className="mt-8 flex flex-col gap-5 border-t border-slate-100 pt-6 sm:flex-row sm:items-center sm:justify-between">
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-500">
                  <ClockIcon />
                  {featuredPost.readingTime}
                </span>

                <Link
                  href={`/blog/${featuredPost.slug}`}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white transition hover:bg-emerald-700"
                >
                  Ler guia completo
                  <ArrowIcon />
                </Link>
              </div>
            </div>
          </div>
        </article>
      </section>

      <section
        id="artigos"
        className="border-y border-slate-200 bg-white"
      >
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-18 lg:px-8 lg:py-20">
          <div className="mb-9 max-w-2xl">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
              Conteúdos recentes
            </p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
              Informação útil, sem enrolação
            </h2>
            <p className="mt-4 leading-7 text-slate-600">
              Escolha um tema e veja os pontos que
              realmente fazem diferença antes de
              fechar uma compra.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {latestPosts.map((post) => (
              <ArticleCard
                key={post.slug}
                post={post}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-18 lg:px-8 lg:py-20">
        <div className="grid overflow-hidden rounded-[2rem] bg-slate-950 text-white lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="p-8 sm:p-10 lg:p-12">
            <span className="inline-flex rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-emerald-300">
              Transparência Ofertano
            </span>

            <h2 className="mt-5 max-w-2xl text-3xl font-black tracking-tight sm:text-4xl">
              Compare com calma. Compre diretamente na loja.
            </h2>

            <p className="mt-4 max-w-2xl leading-7 text-slate-300">
              O Ofertano compara informações e pode
              receber comissão pelos links de afiliado,
              sem aumentar o preço para você. A venda,
              o pagamento e a entrega são realizados
              pela loja parceira.
            </p>
          </div>

          <div className="border-t border-white/10 p-8 lg:border-l lg:border-t-0 lg:p-12">
            <Link
              href="/ofertas"
              className="inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-emerald-500 px-6 py-4 text-sm font-black text-white transition hover:bg-emerald-400"
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
