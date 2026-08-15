import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import Footer from "@/components/Footer";
import Header from "@/components/Header";

import {
  blogPosts,
  encontrarPostPorSlug,
  type BlogPost,
} from "../posts";

type BlogArticlePageProps = {
  params: Promise<{
    slug: string;
  }>;
};

const themeClasses: Record<
  BlogPost["theme"],
  {
    hero: string;
    badge: string;
    accent: string;
  }
> = {
  emerald: {
    hero: "from-emerald-950 via-emerald-800 to-teal-600",
    badge: "bg-emerald-100 text-emerald-800",
    accent: "text-emerald-700",
  },
  blue: {
    hero: "from-slate-950 via-blue-900 to-blue-600",
    badge: "bg-blue-100 text-blue-800",
    accent: "text-blue-700",
  },
  amber: {
    hero: "from-amber-950 via-orange-800 to-amber-500",
    badge: "bg-amber-100 text-amber-900",
    accent: "text-amber-700",
  },
  violet: {
    hero: "from-slate-950 via-violet-900 to-violet-600",
    badge: "bg-violet-100 text-violet-800",
    accent: "text-violet-700",
  },
  rose: {
    hero: "from-rose-950 via-rose-800 to-orange-500",
    badge: "bg-rose-100 text-rose-800",
    accent: "text-rose-700",
  },
  cyan: {
    hero: "from-slate-950 via-cyan-900 to-cyan-600",
    badge: "bg-cyan-100 text-cyan-900",
    accent: "text-cyan-700",
  },
};

function ArrowIcon({
  direction = "right",
}: {
  direction?: "left" | "right";
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="h-4 w-4"
      aria-hidden="true"
    >
      {direction === "left" ? (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M19 12H5m6 6-6-6 6-6"
        />
      ) : (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M5 12h14m-6-6 6 6-6 6"
        />
      )}
    </svg>
  );
}

function CheckIcon() {
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
        d="m5 12 4 4L19 7"
      />
    </svg>
  );
}

export function generateStaticParams() {
  return blogPosts.map((post) => ({
    slug: post.slug,
  }));
}

export async function generateMetadata({
  params,
}: BlogArticlePageProps): Promise<Metadata> {
  const { slug } =
    await params;

  const post =
    encontrarPostPorSlug(slug);

  if (!post) {
    return {
      title: "Artigo não encontrado",
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  return {
    title: post.title,
    description: post.excerpt,
    alternates: {
      canonical: `/blog/${post.slug}`,
    },
    openGraph: {
      type: "article",
      url: `/blog/${post.slug}`,
      title: post.title,
      description: post.excerpt,
      publishedTime: post.publishedAt,
      authors: ["Ofertano"],
      section: post.category,
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.excerpt,
    },
  };
}

export default async function BlogArticlePage({
  params,
}: BlogArticlePageProps) {
  const { slug } =
    await params;

  const post =
    encontrarPostPorSlug(slug);

  if (!post) {
    notFound();
  }

  const theme =
    themeClasses[post.theme];

  const relatedPosts =
    blogPosts
      .filter(
        (item) =>
          item.slug !== post.slug,
      )
      .sort((first, second) => {
        const firstSameCategory =
          first.category === post.category
            ? 1
            : 0;

        const secondSameCategory =
          second.category === post.category
            ? 1
            : 0;

        return (
          secondSameCategory -
          firstSameCategory
        );
      })
      .slice(0, 3);

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.excerpt,
    datePublished: post.publishedAt,
    dateModified: post.publishedAt,
    author: {
      "@type": "Organization",
      name: "Ofertano",
      url: "https://ofertano.vercel.app",
    },
    publisher: {
      "@type": "Organization",
      name: "Ofertano",
      url: "https://ofertano.vercel.app",
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `https://ofertano.vercel.app/blog/${post.slug}`,
    },
  };

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <Header />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html:
            JSON.stringify(
              structuredData,
            ).replace(/</g, "\\u003c"),
        }}
      />

      <section
        className={`relative overflow-hidden bg-gradient-to-br text-white ${theme.hero}`}
      >
        <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full border border-white/10" />
        <div className="absolute -bottom-40 -left-20 h-96 w-96 rounded-full bg-white/10 blur-3xl" />

        <div className="relative mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8 lg:py-20">
          <nav
            aria-label="Navegação estrutural"
            className="flex flex-wrap items-center gap-2 text-sm font-semibold text-white/70"
          >
            <Link
              href="/"
              className="transition hover:text-white"
            >
              Início
            </Link>
            <span aria-hidden="true">/</span>
            <Link
              href="/blog"
              className="transition hover:text-white"
            >
              Blog
            </Link>
            <span aria-hidden="true">/</span>
            <span className="text-white">
              {post.category}
            </span>
          </nav>

          <div className="mt-10 max-w-4xl">
            <span className="inline-flex rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-white backdrop-blur">
              {post.category}
            </span>

            <h1 className="mt-6 text-4xl font-black leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
              {post.title}
            </h1>

            <p className="mt-6 max-w-3xl text-base leading-8 text-white/80 sm:text-lg">
              {post.excerpt}
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm font-semibold text-white/70">
              <span>Por Ofertano</span>
              <span
                className="h-1 w-1 rounded-full bg-white/50"
                aria-hidden="true"
              />
              <time dateTime={post.publishedAt}>
                {post.publishedLabel}
              </time>
              <span
                className="h-1 w-1 rounded-full bg-white/50"
                aria-hidden="true"
              />
              <span>{post.readingTime}</span>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[minmax(0,1fr)_300px] lg:px-8 lg:py-20">
        <article className="min-w-0 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-10 lg:p-12">
          <div className="border-b border-slate-200 pb-8">
            <p className="text-lg font-semibold leading-8 text-slate-700 sm:text-xl">
              {post.excerpt}
            </p>
          </div>

          <div className="mt-10 space-y-12">
            {post.sections.map(
              (section, sectionIndex) => (
                <section
                  key={section.title}
                  aria-labelledby={`section-${sectionIndex}`}
                >
                  <div className="flex gap-4">
                    <span
                      className={`mt-1 text-xs font-black ${theme.accent}`}
                      aria-hidden="true"
                    >
                      {String(
                        sectionIndex + 1,
                      ).padStart(2, "0")}
                    </span>

                    <div className="min-w-0 flex-1">
                      <h2
                        id={`section-${sectionIndex}`}
                        className="text-2xl font-black leading-tight tracking-tight text-slate-950 sm:text-3xl"
                      >
                        {section.title}
                      </h2>

                      <div className="mt-5 space-y-5">
                        {section.paragraphs.map(
                          (paragraph) => (
                            <p
                              key={paragraph}
                              className="text-base leading-8 text-slate-700"
                            >
                              {paragraph}
                            </p>
                          ),
                        )}
                      </div>

                      {section.bullets && (
                        <ul className="mt-7 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-5 sm:p-6">
                          {section.bullets.map(
                            (bullet) => (
                              <li
                                key={bullet}
                                className="flex gap-3 text-sm font-semibold leading-6 text-slate-700"
                              >
                                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                                  <CheckIcon />
                                </span>
                                <span>{bullet}</span>
                              </li>
                            ),
                          )}
                        </ul>
                      )}
                    </div>
                  </div>
                </section>
              ),
            )}
          </div>

          <aside className="mt-12 rounded-2xl border border-amber-200 bg-amber-50 p-5 sm:p-6">
            <p className="text-sm font-black uppercase tracking-wider text-amber-900">
              Lembrete importante
            </p>
            <p className="mt-2 text-sm leading-6 text-amber-950/80">
              Preços e condições podem mudar a qualquer
              momento. Confira todos os detalhes na loja
              parceira antes de concluir o pagamento.
            </p>
          </aside>

          <div className="mt-10 flex flex-col gap-4 border-t border-slate-200 pt-8 sm:flex-row sm:items-center sm:justify-between">
            <Link
              href="/blog"
              className="inline-flex items-center gap-2 text-sm font-black text-slate-700 transition hover:text-emerald-700"
            >
              <ArrowIcon direction="left" />
              Voltar para o blog
            </Link>

            <Link
              href="/ofertas"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-black text-white transition hover:bg-emerald-700"
            >
              Comparar preços
              <ArrowIcon />
            </Link>
          </div>
        </article>

        <aside className="space-y-5 lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">
              Sobre o Ofertano
            </p>
            <h2 className="mt-3 text-xl font-black tracking-tight text-slate-950">
              Compare antes de comprar
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Reunimos informações de lojas parceiras
              para ajudar você a encontrar ofertas e
              tomar decisões mais seguras.
            </p>
            <Link
              href="/sobre"
              className="mt-5 inline-flex items-center gap-2 text-sm font-black text-emerald-700"
            >
              Conheça o Ofertano
              <ArrowIcon />
            </Link>
          </div>

          <div className="rounded-3xl bg-slate-950 p-6 text-white shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-400">
              Compra segura
            </p>
            <p className="mt-3 text-sm font-semibold leading-6 text-slate-300">
              O Ofertano não vende produtos. Você é
              direcionado para concluir a compra no site
              da loja parceira.
            </p>
          </div>
        </aside>
      </div>

      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8 lg:py-18">
          <div className="mb-8">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
              Continue aprendendo
            </p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950">
              Outros guias para você
            </h2>
          </div>

          <div className="grid gap-5 md:grid-cols-3">
            {relatedPosts.map((item) => {
              const itemTheme =
                themeClasses[item.theme];

              return (
                <article
                  key={item.slug}
                  className="group rounded-3xl border border-slate-200 bg-slate-50 p-6 transition hover:-translate-y-1 hover:border-emerald-200 hover:bg-white hover:shadow-lg"
                >
                  <span
                    className={`inline-flex rounded-full px-3 py-1 text-xs font-black uppercase tracking-wider ${itemTheme.badge}`}
                  >
                    {item.category}
                  </span>

                  <h3 className="mt-4 text-lg font-black leading-6 tracking-tight text-slate-950 group-hover:text-emerald-700">
                    {item.title}
                  </h3>

                  <Link
                    href={`/blog/${item.slug}`}
                    className="mt-6 inline-flex items-center gap-2 text-sm font-black text-emerald-700"
                  >
                    Ler artigo
                    <ArrowIcon />
                  </Link>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
