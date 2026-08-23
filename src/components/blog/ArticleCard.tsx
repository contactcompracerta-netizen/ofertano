import Link from "next/link";

import type { BlogPost } from "@/services/blog/types";

import { ArrowIcon, ClockIcon, SearchIcon } from "./icons";

function coverSrc(image: string) {
  return image.replace(/"/g, "%22");
}

export function ArticleCover({
  post,
  className = "",
  priority = false,
  featured = false,
}: {
  post: BlogPost;
  className?: string;
  priority?: boolean;
  featured?: boolean;
}) {
  const hasImage = Boolean(post.coverImage);

  return (
    <div
      className={`relative overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 ${className}`}
    >
      {hasImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={coverSrc(post.coverImage as string)}
          alt=""
          className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
          loading={priority ? "eager" : "lazy"}
        />
      ) : null}

      <div
        className={`absolute inset-0 ${
          hasImage
            ? "bg-slate-950/30"
            : "bg-[radial-gradient(circle_at_82%_18%,rgba(16,185,129,0.28),transparent_38%),radial-gradient(circle_at_12%_88%,rgba(15,23,42,0.35),transparent_42%)]"
        }`}
      />

      {!hasImage ? (
        <>
          <div className="absolute -right-10 -top-10 h-36 w-36 rounded-full border border-emerald-400/15" />
          <div className="absolute -bottom-12 -left-8 h-28 w-28 rounded-full bg-emerald-400/10" />

          <div
            className={`relative flex h-full flex-col justify-between ${
              featured ? "p-5 sm:p-6" : "p-4"
            }`}
          >
            <span className="w-fit rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-200">
              {post.category}
            </span>

            <div className="flex items-end justify-between gap-3">
              <p
                className={`max-w-[14rem] font-bold leading-snug text-white/90 ${
                  featured ? "text-sm" : "text-xs"
                }`}
              >
                Guia Ofertano
              </p>

              <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
                <SearchIcon className="h-4 w-4" />
              </span>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function ArticleCard({ post }: { post: BlogPost }) {
  return (
    <article className="group flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition duration-200 hover:border-emerald-200 hover:shadow-[0_10px_28px_rgba(15,23,42,0.07)]">
      <Link
        href={`/blog/${post.slug}`}
        aria-label={`Ler: ${post.title}`}
        className="flex min-h-0 min-w-0 flex-1 flex-col rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
      >
        <ArticleCover
          post={post}
          className="h-[11.5rem] w-full shrink-0 sm:h-48 lg:h-[12.5rem]"
        />

        <div className="flex min-h-0 flex-1 flex-col px-5 py-5">
          <div className="flex min-h-0 flex-1 flex-col">
            <span className="w-fit rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-emerald-700">
              {post.category}
            </span>

            <h3 className="mt-3 line-clamp-2 text-[1.125rem] font-extrabold leading-snug tracking-tight text-slate-950 group-hover:text-emerald-800 lg:text-[1.2rem]">
              {post.title}
            </h3>

            <p className="mt-2.5 line-clamp-2 text-[15px] leading-6 text-slate-600">
              {post.excerpt}
            </p>
          </div>

          <div className="mt-auto flex shrink-0 items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <span className="flex items-center gap-1.5 text-[13px] font-medium text-slate-500">
              <ClockIcon className="h-4 w-4" />
              {post.readingTime}
            </span>

            <span className="flex items-center gap-1 text-[14px] font-bold text-emerald-700">
              Ler artigo
              <ArrowIcon />
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}

export function FeaturedArticle({ post }: { post: BlogPost }) {
  return (
    <article className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition duration-200 hover:border-emerald-200 hover:shadow-[0_10px_28px_rgba(15,23,42,0.07)]">
      <Link
        href={`/blog/${post.slug}`}
        aria-label={`Ler: ${post.title}`}
        className="grid min-h-0 rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:min-h-[280px]"
      >
        <ArticleCover
          post={post}
          priority
          featured
          className="h-52 w-full sm:h-56 lg:h-auto lg:min-h-[280px]"
        />

        <div className="flex flex-col justify-center px-5 py-5 sm:px-7 sm:py-6 lg:px-8">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-emerald-700">
              {post.category}
            </span>

            <time
              dateTime={post.publishedAt}
              className="text-[13px] font-medium text-slate-500"
            >
              {post.publishedLabel}
            </time>
          </div>

          <h3 className="mt-3 text-[1.5rem] font-extrabold leading-snug tracking-tight text-slate-950 group-hover:text-emerald-800 lg:text-[1.7rem]">
            {post.title}
          </h3>

          <p className="mt-3 text-[15px] leading-7 text-slate-600 lg:text-base">
            {post.excerpt}
          </p>

          <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-center gap-1.5 text-[13px] font-medium text-slate-500">
              <ClockIcon className="h-4 w-4" />
              {post.readingTime}
            </span>

            <span className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-950 px-5 py-2.5 text-[14px] font-bold text-white transition group-hover:bg-emerald-700">
              Ler artigo
              <ArrowIcon />
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}
