"use client";

import { useEffect, useState } from "react";

type ShareProductButtonProps = {
  title: string;
  text?: string;
  variant?: "label" | "icon";
};

type IconProps = {
  className?: string;
};

function ShareIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.7 10.7 6.6-4.2" strokeLinecap="round" />
      <path d="m8.7 13.3 6.6 4.2" strokeLinecap="round" />
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
      strokeWidth="2.2"
      className={className}
    >
      <path d="m5 12 4 4L19 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function copiarLinkFallback(url: string) {
  const textarea = document.createElement("textarea");
  textarea.value = url;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

export default function ShareProductButton({
  title,
  text,
  variant = "label",
}: ShareProductButtonProps) {
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    if (!copiado) return;

    const timer = window.setTimeout(() => {
      setCopiado(false);
    }, 1800);

    return () => window.clearTimeout(timer);
  }, [copiado]);

  async function compartilhar() {
    const url = window.location.href;

    try {
      if (navigator.share) {
        await navigator.share({
          title,
          text: text ?? `Confira esta oferta no Ofertano: ${title}`,
          url,
        });
        return;
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        copiarLinkFallback(url);
      }

      setCopiado(true);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      try {
        copiarLinkFallback(url);
        setCopiado(true);
      } catch {
        // Evita interromper a página caso o navegador bloqueie a cópia.
      }
    }
  }

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={compartilhar}
        aria-label={copiado ? "Link copiado" : "Compartilhar produto"}
        title={copiado ? "Link copiado" : "Compartilhar produto"}
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm transition active:scale-[0.98]"
      >
        {copiado ? (
          <CheckIcon className="h-5 w-5 text-emerald-700" />
        ) : (
          <ShareIcon className="h-5 w-5" />
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={compartilhar}
      className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 active:scale-[0.98] sm:h-10 sm:text-sm"
    >
      {copiado ? (
        <>
          <CheckIcon className="h-4 w-4 text-emerald-700" />
          <span className="hidden sm:inline">Link copiado</span>
        </>
      ) : (
        <>
          <ShareIcon className="h-4 w-4" />
          <span className="hidden sm:inline">Compartilhar</span>
        </>
      )}
    </button>
  );
}