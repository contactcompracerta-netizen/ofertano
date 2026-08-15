"use client";

import { useEffect, useState } from "react";

export default function SearchNavigationLoading() {
  const [visivel, setVisivel] = useState(false);
  const [consulta, setConsulta] = useState("");

  useEffect(() => {
    function aoEnviarFormulario(event: SubmitEvent) {
      const alvo = event.target;

      if (!(alvo instanceof HTMLFormElement)) {
        return;
      }

      const metodo = (
        alvo.getAttribute("method") || "GET"
      ).toUpperCase();

      if (metodo !== "GET") {
        return;
      }

      const action =
        alvo.getAttribute("action") || "/";

      let urlAction: URL;

      try {
        urlAction = new URL(
          action,
          window.location.href,
        );
      } catch {
        return;
      }

      /*
       * Intercepta somente a pesquisa pública
       * do Ofertano.
       *
       * Outros formulários do site continuam
       * funcionando normalmente.
       */
      if (
        urlAction.origin !==
          window.location.origin ||
        urlAction.pathname !== "/"
      ) {
        return;
      }

      const dados =
        new FormData(alvo);

      const valor =
        dados.get("q");

      if (typeof valor !== "string") {
        return;
      }

      const query =
        valor
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 160);

      if (!query) {
        return;
      }

      event.preventDefault();

      const destino =
        new URL(
          "/",
          window.location.origin,
        );

      destino.searchParams.set(
        "q",
        query,
      );

      setConsulta(query);
      setVisivel(true);

      /*
       * Espera o navegador desenhar o overlay
       * antes de iniciar a navegação.
       *
       * Assim ele aparece imediatamente mesmo
       * quando o Discovery leva vários segundos.
       */
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          window.location.assign(
            destino.toString(),
          );
        });
      });
    }

    /*
     * Caso o navegador restaure a página pelo
     * histórico/BFCache, garante que o overlay
     * não permaneça aberto.
     */
    function aoRestaurarPagina() {
      setVisivel(false);
      setConsulta("");
    }

    document.addEventListener(
      "submit",
      aoEnviarFormulario,
      true,
    );

    window.addEventListener(
      "pageshow",
      aoRestaurarPagina,
    );

    return () => {
      document.removeEventListener(
        "submit",
        aoEnviarFormulario,
        true,
      );

      window.removeEventListener(
        "pageshow",
        aoRestaurarPagina,
      );
    };
  }, []);

  if (!visivel) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-sm"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="w-full max-w-md overflow-hidden rounded-[28px] border border-white/70 bg-white shadow-2xl">
        <div className="p-6 text-center sm:p-8">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-100 border-t-emerald-600" />
          </div>

          <p className="mt-5 text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700 sm:text-xs">
            Comparador Ofertano
          </p>

          <h2 className="mt-2 text-xl font-black tracking-tight text-slate-950 sm:text-2xl">
            Buscando as melhores ofertas...
          </h2>

          <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-600">
            Estamos consultando os marketplaces,
            comparando preços e validando as
            melhores opções para você.
          </p>

          {consulta && (
            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">
                Pesquisando por
              </p>

              <p className="mt-1 line-clamp-2 text-sm font-bold text-slate-800">
                {consulta}
              </p>
            </div>
          )}

          <div className="mt-5 grid grid-cols-5 gap-1.5">
            {[
              "Mercado Livre",
              "Amazon",
              "Shopee",
              "Magalu",
              "AliExpress",
            ].map((loja) => (
              <div
                key={loja}
                className="flex min-h-12 items-center justify-center rounded-xl border border-slate-200 bg-white px-1 text-center text-[8px] font-extrabold leading-3 text-slate-500 sm:text-[9px]"
              >
                {loja}
              </div>
            ))}
          </div>

          <div className="mt-5 flex items-center justify-center gap-2 text-xs font-semibold text-slate-500">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-600" />
            </span>

            Isso pode levar alguns segundos
          </div>
        </div>

        <div className="h-1.5 w-full overflow-hidden bg-emerald-100">
          <div className="h-full w-2/3 animate-pulse rounded-r-full bg-emerald-600" />
        </div>
      </div>
    </div>
  );
}
