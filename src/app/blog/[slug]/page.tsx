import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ArticleCard } from "@/components/blog/ArticleCard";
import {
  ArrowIcon,
  CheckIcon,
  ClockIcon,
} from "@/components/blog/icons";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import {
  buscarPostPublicadoPorSlug,
  listarPostsPublicados,
} from "@/services/blog/public";

export const revalidate = 60;

type BlogArticlePageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export async function generateMetadata({
  params,
}: BlogArticlePageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await buscarPostPublicadoPorSlug(slug);

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
    title: post.seoTitle ?? post.title,
    description: post.seoDescription ?? post.excerpt,
    alternates: {
      canonical: `/blog/${post.slug}`,
    },
    openGraph: {
      type: "article",
      url: `/blog/${post.slug}`,
      title: post.title,
      description: post.seoDescription ?? post.excerpt,
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt ?? post.publishedAt,
      authors: [post.author ?? "Ofertano"],
      section: post.category,
      ...(post.coverImage
        ? {
            images: [post.coverImage],
          }
        : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.seoDescription ?? post.excerpt,
      ...(post.coverImage
        ? {
            images: [post.coverImage],
          }
        : {}),
    },
  };
}

export default async function BlogArticlePage({
  params,
}: BlogArticlePageProps) {
  const { slug } = await params;
  const post = await buscarPostPublicadoPorSlug(slug);

  if (!post) {
    notFound();
  }

  const blogPosts = await listarPostsPublicados();

  const relatedPosts = blogPosts
    .filter((item) => item.slug !== post.slug)
    .sort((first, second) => {
      const firstSameCategory =
        first.category === post.category ? 1 : 0;
      const secondSameCategory =
        second.category === post.category ? 1 : 0;

      return secondSameCategory - firstSameCategory;
    })
    .slice(0, 3);

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.excerpt,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt ?? post.publishedAt,
    author: {
      "@type": "Organization",
      name: post.author ?? "Ofertano",
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
    ...(post.coverImage
      ? {
          image: post.coverImage,
        }
      : {}),
  };

  return (
    <main className="min-h-screen overflow-x-clip bg-slate-50 text-slate-950">
      <Header />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(
            /</g,
            "\\u003c",
          ),
        }}
      />

      <article>
        <div className="ofertano-container">
          <header className="mx-auto max-w-[960px] pt-8 pb-2 sm:pt-10">
            <nav
              aria-label="Navegação estrutural"
              className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium text-slate-500"
            >
              <Link
                href="/"
                className="transition hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              >
                Início
              </Link>
              <span aria-hidden="true">/</span>
              <Link
                href="/blog"
                className="transition hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              >
                Blog
              </Link>
              <span aria-hidden="true">/</span>
              <span className="text-slate-700">
                {post.category}
              </span>
            </nav>

            <span className="mt-5 inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-emerald-700">
              {post.category}
            </span>

            <h1 className="mt-4 text-[2rem] font-black leading-[1.15] tracking-tight text-slate-950 sm:text-[2.5rem] lg:text-[2.75rem] lg:leading-[1.12]">
              {post.title}
            </h1>

            <p className="mt-4 text-[1.125rem] leading-8 text-slate-600 lg:text-[1.25rem] lg:leading-8">
              {post.excerpt}
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] font-medium text-slate-500">
              <span>Por {post.author ?? "Ofertano"}</span>
              <span
                className="h-1 w-1 rounded-full bg-slate-300"
                aria-hidden="true"
              />
              <time dateTime={post.publishedAt}>
                {post.publishedLabel}
              </time>
              <span
                className="h-1 w-1 rounded-full bg-slate-300"
                aria-hidden="true"
              />
              <span className="inline-flex items-center gap-1.5">
                <ClockIcon className="h-4 w-4" />
                {post.readingTime}
              </span>
            </div>

            {post.coverImage ? (
              <div className="mt-7 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={post.coverImage.replace(/"/g, "%22")}
                  alt={post.title}
                  className="aspect-[16/9] w-full object-cover"
                />
              </div>
            ) : null}
          </header>

          <div className="mx-auto max-w-[760px] py-8 sm:py-10">
            <div className="blog-article">
              {post.sections.map((section, sectionIndex) => (
                <section
                  key={section.title}
                  aria-labelledby={`section-${sectionIndex}`}
                  className={sectionIndex === 0 ? "" : "mt-10"}
                >
                  <div className="flex gap-3">
                    <span
                      className="mt-1.5 w-7 shrink-0 text-xs font-bold text-emerald-700"
                      aria-hidden="true"
                    >
                      {String(sectionIndex + 1).padStart(2, "0")}
                    </span>

                    <div className="min-w-0 flex-1">
                      <h2 id={`section-${sectionIndex}`}>
                        {section.title}
                      </h2>

                      {section.paragraphs.map((paragraph) => (
                        <p key={paragraph}>{paragraph}</p>
                      ))}

                      {section.bullets ? (
                        <ul className="mt-5 list-none space-y-2.5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                          {section.bullets.map((bullet) => (
                            <li
                              key={bullet}
                              className="m-0 flex gap-2.5 p-0 text-[15px] font-medium leading-6 text-slate-700"
                            >
                              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                                <CheckIcon />
                              </span>
                              <span>{bullet}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </div>
                </section>
              ))}
            </div>

            <aside className="mt-10 rounded-xl border border-slate-200 border-l-4 border-l-emerald-500 bg-white px-5 py-4">
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                Lembrete importante
              </p>
              <p className="mt-1.5 text-[15px] leading-7 text-slate-600">
                Preços e condições podem mudar a qualquer momento.
                Confira todos os detalhes na loja parceira antes de
                concluir o pagamento.
              </p>
            </aside>

            <div className="mt-8 flex flex-col gap-4 rounded-2xl bg-slate-950 p-6 text-white sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-400">
                  Compare no Ofertano
                </p>
                <p className="mt-1.5 text-[15px] font-semibold leading-6 text-slate-300">
                  Confira ofertas equivalentes e compre direto na
                  loja parceira.
                </p>
              </div>

              <Link
                href="/ofertas"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-5 py-3 text-[15px] font-bold text-white transition hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
              >
                Comparar preços
                <ArrowIcon />
              </Link>
            </div>

            <div className="mt-6">
              <Link
                href="/blog"
                className="inline-flex items-center gap-2 text-[15px] font-bold text-slate-700 transition hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              >
                <ArrowIcon direction="left" />
                Voltar para o blog
              </Link>
            </div>
          </div>
        </div>
      </article>

      {relatedPosts.length > 0 ? (
        <section className="border-t border-slate-200 bg-white">
          <div className="ofertano-container py-10 lg:py-12">
            <div className="mb-6">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">
                Continue aprendendo
              </p>
              <h2 className="mt-1.5 text-[1.65rem] font-black tracking-tight text-slate-950 lg:text-[1.85rem]">
                Outros guias para você
              </h2>
            </div>

            <div className="blog-card-grid">
              {relatedPosts.map((item) => (
                <ArticleCard key={item.slug} post={item} />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <Footer />
    </main>
  );
}
