"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import type {
  BlogAdminPost,
  BlogStatus,
  BlogTheme,
} from "@/services/blog/types";

type EditorSection = {
  title: string;
  paragraphsText: string;
  bulletsText: string;
};

type EditorState = {
  title: string;
  slug: string;
  excerpt: string;
  category: string;
  author: string;
  readingTime: string;
  theme: BlogTheme;
  coverImage: string;
  status: BlogStatus;
  featured: boolean;
  seoTitle: string;
  seoDescription: string;
  socialCaption: string;
  scheduledAt: string;
  publishedAt: string;
  sections: EditorSection[];
};

type Summary = {
  total: number;
  drafts: number;
  scheduled: number;
  published: number;
  archived: number;
};

const EMPTY_SECTION: EditorSection = {
  title: "",
  paragraphsText: "",
  bulletsText: "",
};

const EMPTY_EDITOR: EditorState = {
  title: "",
  slug: "",
  excerpt: "",
  category: "Guia de compra",
  author: "Ofertano",
  readingTime: "5 min de leitura",
  theme: "emerald",
  coverImage: "",
  status: "DRAFT",
  featured: false,
  seoTitle: "",
  seoDescription: "",
  socialCaption: "",
  scheduledAt: "",
  publishedAt: "",
  sections: [
    {
      ...EMPTY_SECTION,
    },
  ],
};

const STATUS_LABELS: Record<
  BlogStatus,
  string
> = {
  DRAFT: "Rascunho",
  SCHEDULED: "Agendado",
  PUBLISHED: "Publicado",
  ARCHIVED: "Arquivado",
};

const STATUS_CLASSES: Record<
  BlogStatus,
  string
> = {
  DRAFT: "bg-slate-100 text-slate-700",
  SCHEDULED: "bg-amber-100 text-amber-800",
  PUBLISHED: "bg-emerald-100 text-emerald-800",
  ARCHIVED: "bg-rose-100 text-rose-800",
};

const THEME_OPTIONS: Array<{
  value: BlogTheme;
  label: string;
}> = [
  { value: "emerald", label: "Verde Ofertano" },
  { value: "blue", label: "Azul" },
  { value: "amber", label: "Âmbar" },
  { value: "violet", label: "Violeta" },
  { value: "rose", label: "Rosa" },
  { value: "cyan", label: "Ciano" },
];

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function toDateTimeLocal(
  value: string | null,
): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const offset =
    date.getTimezoneOffset() * 60_000;

  return new Date(date.getTime() - offset)
    .toISOString()
    .slice(0, 16);
}

function formatDate(
  value: string | null,
): string {
  if (!value) {
    return "Sem data";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function postToEditor(
  post: BlogAdminPost,
): EditorState {
  return {
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    category: post.category,
    author: post.author,
    readingTime: post.readingTime,
    theme: post.theme,
    coverImage: post.coverImage ?? "",
    status: post.status,
    featured: post.featured,
    seoTitle: post.seoTitle ?? "",
    seoDescription:
      post.seoDescription ?? "",
    socialCaption:
      post.socialCaption ?? "",
    scheduledAt: toDateTimeLocal(
      post.scheduledAt,
    ),
    publishedAt: toDateTimeLocal(
      post.publishedAt,
    ),
    sections: post.sections.map(
      (section) => ({
        title: section.title,
        paragraphsText:
          section.paragraphs.join("\n\n"),
        bulletsText:
          section.bullets?.join("\n") ?? "",
      }),
    ),
  };
}

function postToPayload(
  editor: EditorState,
) {
  return {
    ...editor,
    coverImage:
      editor.coverImage.trim() || null,
    seoTitle:
      editor.seoTitle.trim() || null,
    seoDescription:
      editor.seoDescription.trim() || null,
    socialCaption:
      editor.socialCaption.trim() || null,
    scheduledAt: editor.scheduledAt
      ? new Date(
          editor.scheduledAt,
        ).toISOString()
      : null,
    publishedAt: editor.publishedAt
      ? new Date(
          editor.publishedAt,
        ).toISOString()
      : null,
    sections: editor.sections.map(
      (section) => ({
        title: section.title.trim(),
        paragraphs: section.paragraphsText
          .split(/\n\s*\n/)
          .map((paragraph) =>
            paragraph.trim(),
          )
          .filter(Boolean),
        bullets: section.bulletsText
          .split("\n")
          .map((bullet) => bullet.trim())
          .filter(Boolean),
      }),
    ),
  };
}

async function parseResponse(
  response: Response,
) {
  const text = await response.text();

  let data: Record<string, unknown> = {};

  if (text) {
    try {
      data = JSON.parse(text) as Record<
        string,
        unknown
      >;
    } catch {
      data = {
        error:
          "O servidor respondeu em um formato inesperado.",
      };
    }
  }

  if (!response.ok) {
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : "Não foi possível concluir a operação.",
    );
  }

  return data;
}

export default function AdminBlogPage() {
  const [posts, setPosts] = useState<
    BlogAdminPost[]
  >([]);
  const [summary, setSummary] =
    useState<Summary>({
      total: 0,
      drafts: 0,
      scheduled: 0,
      published: 0,
      archived: 0,
    });
  const [filter, setFilter] = useState<
    "ALL" | BlogStatus
  >("ALL");
  const [editor, setEditor] =
    useState<EditorState>(EMPTY_EDITOR);
  const [editingId, setEditingId] =
    useState<string | null>(null);
  const [showEditor, setShowEditor] =
    useState(false);
  const [loading, setLoading] =
    useState(true);
  const [saving, setSaving] =
    useState(false);
  const [importing, setImporting] =
    useState(false);
  const [error, setError] =
    useState<string | null>(null);
  const [message, setMessage] =
    useState<string | null>(null);

  const loadPosts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(
        "/api/admin/blog",
        {
          cache: "no-store",
        },
      );

      const data = await parseResponse(
        response,
      );

      setPosts(
        Array.isArray(data.posts)
          ? (data.posts as BlogAdminPost[])
          : [],
      );

      if (
        data.summary &&
        typeof data.summary === "object"
      ) {
        setSummary(data.summary as Summary);
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Erro ao carregar os artigos.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPosts();
  }, [loadPosts]);

  const filteredPosts = useMemo(
    () =>
      filter === "ALL"
        ? posts
        : posts.filter(
            (post) => post.status === filter,
          ),
    [filter, posts],
  );

  function startNewPost() {
    setEditingId(null);
    setEditor({
      ...EMPTY_EDITOR,
      sections: [
        {
          ...EMPTY_SECTION,
        },
      ],
    });
    setMessage(null);
    setError(null);
    setShowEditor(true);

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  function startEditing(
    post: BlogAdminPost,
  ) {
    setEditingId(post.id);
    setEditor(postToEditor(post));
    setMessage(null);
    setError(null);
    setShowEditor(true);

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  function updateSection(
    index: number,
    field: keyof EditorSection,
    value: string,
  ) {
    setEditor((current) => ({
      ...current,
      sections: current.sections.map(
        (section, sectionIndex) =>
          sectionIndex === index
            ? {
                ...section,
                [field]: value,
              }
            : section,
      ),
    }));
  }

  function addSection() {
    setEditor((current) => ({
      ...current,
      sections: [
        ...current.sections,
        {
          ...EMPTY_SECTION,
        },
      ],
    }));
  }

  function removeSection(index: number) {
    setEditor((current) => ({
      ...current,
      sections:
        current.sections.length === 1
          ? current.sections
          : current.sections.filter(
              (_, sectionIndex) =>
                sectionIndex !== index,
            ),
    }));
  }

  async function savePost() {
    try {
      setSaving(true);
      setError(null);
      setMessage(null);

      const response = await fetch(
        editingId
          ? `/api/admin/blog/${editingId}`
          : "/api/admin/blog",
        {
          method: editingId ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            postToPayload(editor),
          ),
        },
      );

      const data = await parseResponse(
        response,
      );

      setMessage(
        typeof data.message === "string"
          ? data.message
          : "Artigo salvo com sucesso.",
      );
      setShowEditor(false);
      setEditingId(null);
      await loadPosts();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Erro ao salvar o artigo.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function archivePost(
    post: BlogAdminPost,
  ) {
    const confirmed = window.confirm(
      `Arquivar o artigo “${post.title}”? Ele deixará de aparecer no blog, mas poderá ser editado e publicado novamente.`,
    );

    if (!confirmed) {
      return;
    }

    try {
      setError(null);
      setMessage(null);

      const payload = postToPayload({
        ...postToEditor(post),
        status: "ARCHIVED",
      });

      const response = await fetch(
        `/api/admin/blog/${post.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );

      const data = await parseResponse(
        response,
      );

      setMessage(
        typeof data.message === "string"
          ? data.message
          : "Artigo arquivado.",
      );
      await loadPosts();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Erro ao arquivar o artigo.",
      );
    }
  }

  async function importCurrentPosts() {
    try {
      setImporting(true);
      setError(null);
      setMessage(null);

      const response = await fetch(
        "/api/admin/blog/import-legacy",
        {
          method: "POST",
        },
      );

      const data = await parseResponse(
        response,
      );

      setMessage(
        typeof data.message === "string"
          ? data.message
          : "Artigos atuais importados.",
      );
      await loadPosts();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Erro ao importar os artigos atuais.",
      );
    } finally {
      setImporting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link
              href="/admin"
              className="text-sm font-semibold text-emerald-700 transition hover:text-emerald-900"
            >
              ← Voltar ao painel
            </Link>
            <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
              Conteúdo Ofertano
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
              Administração do blog
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
              Crie, revise, agende e publique os artigos do blog sem alterar arquivos de código.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={importCurrentPosts}
              disabled={importing}
              className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 transition hover:border-emerald-300 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {importing
                ? "Importando..."
                : "Importar artigos atuais"}
            </button>
            <button
              type="button"
              onClick={startNewPost}
              className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
            >
              + Novo artigo
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold leading-6 text-rose-800">
            {error}
          </div>
        )}

        {message && (
          <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold leading-6 text-emerald-800">
            {message}
          </div>
        )}

        {showEditor && (
          <section className="mt-7 overflow-hidden rounded-3xl border border-emerald-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 bg-emerald-50 px-5 py-5 sm:px-7">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
                    {editingId
                      ? "Editando artigo"
                      : "Novo conteúdo"}
                  </p>
                  <h2 className="mt-1 text-2xl font-semibold">
                    {editingId
                      ? editor.title || "Artigo"
                      : "Criar artigo"}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowEditor(false);
                    setEditingId(null);
                  }}
                  className="self-start rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Fechar editor
                </button>
              </div>
            </div>

            <div className="space-y-8 p-5 sm:p-7 lg:p-9">
              <div className="grid gap-5 lg:grid-cols-2">
                <label className="lg:col-span-2">
                  <span className="mb-2 block text-sm font-semibold text-slate-800">
                    Título do artigo
                  </span>
                  <input
                    value={editor.title}
                    onChange={(event) => {
                      const title = event.target.value;
                      setEditor((current) => ({
                        ...current,
                        title,
                        slug: editingId
                          ? current.slug
                          : slugify(title),
                      }));
                    }}
                    placeholder="Ex.: Melhor celular até R$ 1.500"
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10"
                  />
                </label>

                <label>
                  <span className="mb-2 block text-sm font-semibold text-slate-800">
                    Endereço do artigo (slug)
                  </span>
                  <input
                    value={editor.slug}
                    onChange={(event) =>
                      setEditor((current) => ({
                        ...current,
                        slug: slugify(
                          event.target.value,
                        ),
                      }))
                    }
                    placeholder="melhor-celular-ate-1500"
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10"
                  />
                </label>

                <label>
                  <span className="mb-2 block text-sm font-semibold text-slate-800">
                    Categoria
                  </span>
                  <input
                    value={editor.category}
                    onChange={(event) =>
                      setEditor((current) => ({
                        ...current,
                        category: event.target.value,
                      }))
                    }
                    list="blog-categories"
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10"
                  />
                  <datalist id="blog-categories">
                    <option value="Guia de compra" />
                    <option value="Comparativos" />
                    <option value="Compra segura" />
                    <option value="Economia" />
                    <option value="Tecnologia" />
                    <option value="Casa" />
                  </datalist>
                </label>

                <label className="lg:col-span-2">
                  <span className="mb-2 block text-sm font-semibold text-slate-800">
                    Resumo
                  </span>
                  <textarea
                    value={editor.excerpt}
                    onChange={(event) =>
                      setEditor((current) => ({
                        ...current,
                        excerpt: event.target.value,
                      }))
                    }
                    rows={3}
                    placeholder="Explique em poucas linhas o que o leitor encontrará no artigo."
                    className="w-full resize-y rounded-xl border border-slate-300 px-4 py-3 leading-6 outline-none transition focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10"
                  />
                </label>

                <label>
                  <span className="mb-2 block text-sm font-semibold text-slate-800">
                    Autor
                  </span>
                  <input
                    value={editor.author}
                    onChange={(event) =>
                      setEditor((current) => ({
                        ...current,
                        author: event.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10"
                  />
                </label>

                <label>
                  <span className="mb-2 block text-sm font-semibold text-slate-800">
                    Tempo de leitura
                  </span>
                  <input
                    value={editor.readingTime}
                    onChange={(event) =>
                      setEditor((current) => ({
                        ...current,
                        readingTime: event.target.value,
                      }))
                    }
                    placeholder="5 min de leitura"
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10"
                  />
                </label>

                <label>
                  <span className="mb-2 block text-sm font-semibold text-slate-800">
                    Cor do artigo
                  </span>
                  <select
                    value={editor.theme}
                    onChange={(event) =>
                      setEditor((current) => ({
                        ...current,
                        theme: event.target
                          .value as BlogTheme,
                      }))
                    }
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10"
                  >
                    {THEME_OPTIONS.map((option) => (
                      <option
                        key={option.value}
                        value={option.value}
                      >
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span className="mb-2 block text-sm font-semibold text-slate-800">
                    Imagem de capa (URL)
                  </span>
                  <input
                    type="url"
                    value={editor.coverImage}
                    onChange={(event) =>
                      setEditor((current) => ({
                        ...current,
                        coverImage: event.target.value,
                      }))
                    }
                    placeholder="https://..."
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10"
                  />
                </label>
              </div>

              <div className="border-t border-slate-200 pt-8">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
                      Conteúdo principal
                    </p>
                    <h3 className="mt-1 text-2xl font-semibold">
                      Seções do artigo
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      Separe parágrafos com uma linha vazia. Na lista, coloque um item por linha.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={addSection}
                    className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
                  >
                    + Adicionar seção
                  </button>
                </div>

                <div className="mt-6 space-y-5">
                  {editor.sections.map(
                    (section, index) => (
                      <div
                        key={index}
                        className="rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-6"
                      >
                        <div className="flex items-center justify-between gap-4">
                          <p className="text-sm font-semibold text-slate-700">
                            Seção {index + 1}
                          </p>
                          {editor.sections.length > 1 && (
                            <button
                              type="button"
                              onClick={() =>
                                removeSection(index)
                              }
                              className="text-xs font-semibold text-rose-700 hover:text-rose-900"
                            >
                              Remover seção
                            </button>
                          )}
                        </div>

                        <div className="mt-4 grid gap-4 lg:grid-cols-2">
                          <label className="lg:col-span-2">
                            <span className="mb-2 block text-sm font-bold text-slate-700">
                              Título da seção
                            </span>
                            <input
                              value={section.title}
                              onChange={(event) =>
                                updateSection(
                                  index,
                                  "title",
                                  event.target.value,
                                )
                              }
                              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10"
                            />
                          </label>

                          <label>
                            <span className="mb-2 block text-sm font-bold text-slate-700">
                              Parágrafos
                            </span>
                            <textarea
                              value={
                                section.paragraphsText
                              }
                              onChange={(event) =>
                                updateSection(
                                  index,
                                  "paragraphsText",
                                  event.target.value,
                                )
                              }
                              rows={8}
                              className="w-full resize-y rounded-xl border border-slate-300 bg-white px-4 py-3 leading-6 outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10"
                            />
                          </label>

                          <label>
                            <span className="mb-2 block text-sm font-bold text-slate-700">
                              Lista opcional
                            </span>
                            <textarea
                              value={
                                section.bulletsText
                              }
                              onChange={(event) =>
                                updateSection(
                                  index,
                                  "bulletsText",
                                  event.target.value,
                                )
                              }
                              rows={8}
                              placeholder={
                                "Primeiro item\nSegundo item\nTerceiro item"
                              }
                              className="w-full resize-y rounded-xl border border-slate-300 bg-white px-4 py-3 leading-6 outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10"
                            />
                          </label>
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </div>

              <details className="rounded-2xl border border-slate-200 bg-slate-50 p-5 sm:p-6">
                <summary className="cursor-pointer text-base font-semibold text-slate-900">
                  SEO e preparação para redes sociais
                </summary>

                <div className="mt-5 grid gap-5 lg:grid-cols-2">
                  <label>
                    <span className="mb-2 block text-sm font-bold text-slate-700">
                      Título para o Google
                    </span>
                    <input
                      value={editor.seoTitle}
                      onChange={(event) =>
                        setEditor((current) => ({
                          ...current,
                          seoTitle: event.target.value,
                        }))
                      }
                      placeholder="Se ficar vazio, usaremos o título do artigo."
                      className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10"
                    />
                  </label>

                  <label>
                    <span className="mb-2 block text-sm font-bold text-slate-700">
                      Descrição para o Google
                    </span>
                    <textarea
                      value={editor.seoDescription}
                      onChange={(event) =>
                        setEditor((current) => ({
                          ...current,
                          seoDescription:
                            event.target.value,
                        }))
                      }
                      rows={3}
                      placeholder="Se ficar vazia, usaremos o resumo."
                      className="w-full resize-y rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10"
                    />
                  </label>

                  <label className="lg:col-span-2">
                    <span className="mb-2 block text-sm font-bold text-slate-700">
                      Legenda para Instagram e Facebook
                    </span>
                    <textarea
                      value={editor.socialCaption}
                      onChange={(event) =>
                        setEditor((current) => ({
                          ...current,
                          socialCaption:
                            event.target.value,
                        }))
                      }
                      rows={5}
                      placeholder="Este campo será utilizado na próxima etapa da automação das redes sociais."
                      className="w-full resize-y rounded-xl border border-slate-300 bg-white px-4 py-3 leading-6 outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10"
                    />
                  </label>
                </div>
              </details>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                <div className="grid gap-5 lg:grid-cols-3">
                  <label>
                    <span className="mb-2 block text-sm font-semibold text-slate-800">
                      Situação
                    </span>
                    <select
                      value={editor.status}
                      onChange={(event) =>
                        setEditor((current) => ({
                          ...current,
                          status: event.target
                            .value as BlogStatus,
                        }))
                      }
                      className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10"
                    >
                      <option value="DRAFT">
                        Salvar como rascunho
                      </option>
                      <option value="SCHEDULED">
                        Agendar publicação
                      </option>
                      <option value="PUBLISHED">
                        Publicar agora
                      </option>
                      <option value="ARCHIVED">
                        Arquivar
                      </option>
                    </select>
                  </label>

                  {editor.status === "SCHEDULED" && (
                    <label>
                      <span className="mb-2 block text-sm font-semibold text-slate-800">
                        Data e horário
                      </span>
                      <input
                        type="datetime-local"
                        value={editor.scheduledAt}
                        onChange={(event) =>
                          setEditor((current) => ({
                            ...current,
                            scheduledAt:
                              event.target.value,
                          }))
                        }
                        className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10"
                      />
                    </label>
                  )}

                  {editor.status === "PUBLISHED" &&
                    editor.publishedAt && (
                      <label>
                        <span className="mb-2 block text-sm font-semibold text-slate-800">
                          Data de publicação
                        </span>
                        <input
                          type="datetime-local"
                          value={editor.publishedAt}
                          onChange={(event) =>
                            setEditor((current) => ({
                              ...current,
                              publishedAt:
                                event.target.value,
                            }))
                          }
                          className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10"
                        />
                      </label>
                    )}

                  <label className="flex items-center gap-3 self-end rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={editor.featured}
                      onChange={(event) =>
                        setEditor((current) => ({
                          ...current,
                          featured:
                            event.target.checked,
                        }))
                      }
                      className="h-5 w-5 accent-emerald-600"
                    />
                    <span className="text-sm font-semibold text-slate-800">
                      Artigo principal do blog
                    </span>
                  </label>
                </div>

                <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setShowEditor(false);
                      setEditingId(null);
                    }}
                    disabled={saving}
                    className="rounded-xl border border-slate-300 bg-white px-6 py-3 font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={savePost}
                    disabled={saving}
                    className="rounded-xl bg-emerald-600 px-7 py-3 font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saving
                      ? "Salvando..."
                      : editor.status === "PUBLISHED"
                        ? "Salvar e publicar"
                        : editor.status === "SCHEDULED"
                          ? "Salvar agendamento"
                          : "Salvar artigo"}
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {[
            {
              key: "ALL" as const,
              label: "Total",
              value: summary.total,
            },
            {
              key: "DRAFT" as const,
              label: "Rascunhos",
              value: summary.drafts,
            },
            {
              key: "SCHEDULED" as const,
              label: "Agendados",
              value: summary.scheduled,
            },
            {
              key: "PUBLISHED" as const,
              label: "Publicados",
              value: summary.published,
            },
            {
              key: "ARCHIVED" as const,
              label: "Arquivados",
              value: summary.archived,
            },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setFilter(item.key)}
              className={`rounded-2xl border p-5 text-left transition ${
                filter === item.key
                  ? "border-emerald-400 bg-emerald-50 shadow-sm"
                  : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <span className="text-sm font-bold text-slate-600">
                {item.label}
              </span>
              <strong className="mt-2 block text-3xl font-semibold text-slate-950">
                {item.value}
              </strong>
            </button>
          ))}
        </section>

        <section className="mt-8">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
                Biblioteca editorial
              </p>
              <h2 className="mt-1 text-2xl font-semibold">
                Artigos
              </h2>
            </div>
            <button
              type="button"
              onClick={() => void loadPosts()}
              disabled={loading}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Atualizar
            </button>
          </div>

          {loading ? (
            <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center font-bold text-slate-500">
              Carregando artigos...
            </div>
          ) : filteredPosts.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center sm:p-12">
              <h3 className="text-xl font-semibold">
                Nenhum artigo nesta situação
              </h3>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-600">
                Na primeira utilização, clique em “Importar artigos atuais” para trazer os seis conteúdos que já aparecem no blog.
              </p>
            </div>
          ) : (
            <div className="grid gap-5 lg:grid-cols-2">
              {filteredPosts.map((post) => (
                <article
                  key={post.id}
                  className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${STATUS_CLASSES[post.status]}`}
                    >
                      {STATUS_LABELS[post.status]}
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                      {post.category}
                    </span>
                    {post.featured && (
                      <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-800">
                        Principal
                      </span>
                    )}
                  </div>

                  <h3 className="mt-4 text-xl font-semibold leading-7 tracking-tight">
                    {post.title}
                  </h3>
                  <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-600">
                    {post.excerpt}
                  </p>

                  <div className="mt-5 grid gap-2 rounded-xl bg-slate-50 p-4 text-xs font-semibold text-slate-600 sm:grid-cols-2">
                    <span>
                      Atualizado: {formatDate(post.updatedAt)}
                    </span>
                    <span>
                      {post.status === "SCHEDULED"
                        ? `Agendado: ${formatDate(post.scheduledAt)}`
                        : `Publicado: ${formatDate(post.publishedAt)}`}
                    </span>
                  </div>

                  <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                    <button
                      type="button"
                      onClick={() => startEditing(post)}
                      className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700"
                    >
                      Editar artigo
                    </button>

                    {post.status === "PUBLISHED" && (
                      <Link
                        href={`/blog/${post.slug}`}
                        target="_blank"
                        className="rounded-xl border border-emerald-300 bg-emerald-50 px-5 py-3 text-center text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
                      >
                        Ver publicado
                      </Link>
                    )}

                    {post.status !== "ARCHIVED" && (
                      <button
                        type="button"
                        onClick={() =>
                          void archivePost(post)
                        }
                        className="rounded-xl border border-rose-200 bg-white px-5 py-3 text-sm font-semibold text-rose-700 hover:bg-rose-50"
                      >
                        Arquivar
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
