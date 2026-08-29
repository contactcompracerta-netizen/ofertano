"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  IMAGE_SEARCH_ACCEPT_ATTR,
  IMAGE_SEARCH_QUERY_PARAM,
  type ImageSearchQueryResult,
} from "@/services/imageSearch";
import { validateImageFile } from "@/services/imageSearch/fileValidation";
import { recognizeImageQuery } from "@/lib/imageSearch/recognizeInBrowser";

type PanelState =
  | { kind: "closed" }
  | { kind: "chooser" }
  | { kind: "working"; message: string }
  | { kind: "result"; result: ImageSearchQueryResult }
  | { kind: "error"; message: string };

function CameraIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-4 w-4 sm:h-5 sm:w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.2l1-1.5h6.6l1 1.5h1.2A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z" />
      <circle cx="12" cy="12.25" r="3.25" />
    </svg>
  );
}

export default function ImageSearchButton() {
  const cameraInputId = useId();
  const galleryInputId = useId();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [panel, setPanel] = useState<PanelState>({ kind: "closed" });
  const [draftQuery, setDraftQuery] = useState("");

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (panel.kind !== "chooser") {
        return;
      }

      if (
        rootRef.current &&
        event.target instanceof Node &&
        !rootRef.current.contains(event.target)
      ) {
        setPanel({ kind: "closed" });
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPanel({ kind: "closed" });
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [panel.kind]);

  function resetInputs() {
    if (cameraInputRef.current) {
      cameraInputRef.current.value = "";
    }

    if (galleryInputRef.current) {
      galleryInputRef.current.value = "";
    }
  }

  async function processFile(file: File | undefined) {
    resetInputs();

    if (!file) {
      setPanel({ kind: "closed" });
      return;
    }

    const validation = await validateImageFile(file);
    if (!validation.ok) {
      setPanel({ kind: "error", message: validation.error });
      return;
    }

    setPanel({ kind: "working", message: "Analisando a imagem..." });

    try {
      const result = await recognizeImageQuery(file, (message) => {
        setPanel({ kind: "working", message });
      });
      setDraftQuery(result.query);
      setPanel({ kind: "result", result });
    } catch {
      setPanel({
        kind: "error",
        message:
          "Não foi possível ler esta imagem neste navegador. Envie JPG ou PNG, ou digite o produto.",
      });
    }
  }

  function openChooser() {
    setPanel((current) =>
      current.kind === "chooser" ? { kind: "closed" } : { kind: "chooser" },
    );
  }

  const overlay =
    mounted &&
    (panel.kind === "working" ||
      panel.kind === "result" ||
      panel.kind === "error")
      ? createPortal(
          <div
            className="fixed inset-0 z-[9998] flex items-end justify-center bg-slate-950/45 px-3 py-4 backdrop-blur-sm sm:items-center"
            role="dialog"
            aria-modal="true"
            aria-labelledby="image-search-title"
          >
            <div className="w-full max-w-md overflow-hidden rounded-[28px] border border-white/70 bg-white shadow-2xl">
              {panel.kind === "working" && (
                <div className="p-6 text-center sm:p-8">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-100 border-t-emerald-600" />
                  </div>

                  <p
                    id="image-search-title"
                    className="mt-5 text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700"
                  >
                    Pesquisar por imagem
                  </p>

                  <h2 className="mt-2 text-xl font-black tracking-tight text-slate-950">
                    {panel.message}
                  </h2>

                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    A imagem não é enviada para criar produto. Só extraímos uma
                    busca textual para o fluxo público.
                  </p>
                </div>
              )}

              {panel.kind === "error" && (
                <div className="p-6 sm:p-8">
                  <p
                    id="image-search-title"
                    className="text-[10px] font-black uppercase tracking-[0.16em] text-rose-700"
                  >
                    Pesquisar por imagem
                  </p>

                  <h2 className="mt-2 text-xl font-black tracking-tight text-slate-950">
                    Não foi possível usar esta imagem
                  </h2>

                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    {panel.message}
                  </p>

                  <button
                    type="button"
                    onClick={() => setPanel({ kind: "closed" })}
                    className="mt-5 h-11 w-full rounded-xl bg-slate-900 text-sm font-black text-white"
                  >
                    Entendi
                  </button>
                </div>
              )}

              {panel.kind === "result" && (
                <div className="p-6 sm:p-8">
                  <p
                    id="image-search-title"
                    className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700"
                  >
                    Pesquisar por imagem
                  </p>

                  <h2 className="mt-2 text-xl font-black tracking-tight text-slate-950">
                    Identificamos:
                  </h2>

                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    {panel.result.reason}
                  </p>

                  <form action="/" method="GET" className="mt-4">
                    <label htmlFor="image-search-query" className="sr-only">
                      Consulta gerada pela imagem
                    </label>

                    <textarea
                      id="image-search-query"
                      name={IMAGE_SEARCH_QUERY_PARAM}
                      value={draftQuery}
                      onChange={(event) => setDraftQuery(event.target.value)}
                      rows={panel.result.needsUserCorrection ? 3 : 2}
                      maxLength={160}
                      className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base font-black leading-6 text-slate-950 outline-none focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/10"
                    />

                    {panel.result.needsUserCorrection && (
                      <p className="mt-2 text-xs font-semibold text-amber-700">
                        Confiança baixa. Corrija a busca antes de pesquisar.
                      </p>
                    )}

                    <div className="mt-4 flex gap-2">
                      <button
                        type="button"
                        onClick={() => setPanel({ kind: "closed" })}
                        className="h-11 flex-1 rounded-xl border border-slate-200 bg-white text-sm font-black text-slate-700"
                      >
                        Cancelar
                      </button>

                      <button
                        type="submit"
                        disabled={!draftQuery.trim()}
                        className="h-11 flex-[1.4] rounded-xl bg-[#087A55] text-sm font-black text-white shadow-md shadow-emerald-800/20 disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        Pesquisar este produto
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <input
        id={cameraInputId}
        ref={cameraInputRef}
        type="file"
        accept={IMAGE_SEARCH_ACCEPT_ATTR}
        capture="environment"
        className="sr-only"
        onChange={(event) => {
          void processFile(event.target.files?.[0]);
        }}
      />

      <input
        id={galleryInputId}
        ref={galleryInputRef}
        type="file"
        accept={IMAGE_SEARCH_ACCEPT_ATTR}
        className="sr-only"
        onChange={(event) => {
          void processFile(event.target.files?.[0]);
        }}
      />

      <button
        type="button"
        onClick={openChooser}
        aria-label="Pesquisar por imagem"
        title="Pesquisar por imagem"
        aria-expanded={panel.kind === "chooser"}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 sm:h-12 sm:w-12 lg:h-14 lg:w-14"
      >
        <CameraIcon />
      </button>

      {panel.kind === "chooser" && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-56 overflow-hidden rounded-2xl border border-slate-200 bg-white py-1 shadow-[0_16px_45px_rgba(15,23,42,0.16)]">
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-bold text-slate-800 hover:bg-emerald-50 hover:text-emerald-800"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
              <CameraIcon />
            </span>
            Tirar foto
          </button>

          <button
            type="button"
            onClick={() => galleryInputRef.current?.click()}
            className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-bold text-slate-800 hover:bg-emerald-50 hover:text-emerald-800"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50 text-slate-700">
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <circle cx="8.5" cy="10" r="1.5" />
                <path d="M21 16l-5-5-8 8" />
              </svg>
            </span>
            <span className="sm:hidden">Galeria</span>
            <span className="hidden sm:inline">Selecionar arquivo</span>
          </button>
        </div>
      )}

      {overlay}
    </div>
  );
}
