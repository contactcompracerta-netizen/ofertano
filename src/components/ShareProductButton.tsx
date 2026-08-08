"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

type ShareProductButtonProps = {
  title: string;
  text?: string;
  variant?: "label" | "icon";
  platform?: "native" | "whatsapp";
};

type IconProps = {
  className?: string;
};

function ShareIcon({
  className,
}: IconProps) {
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

      <path
        d="m8.7 10.7 6.6-4.2"
        strokeLinecap="round"
      />

      <path
        d="m8.7 13.3 6.6 4.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon({
  className,
}: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      className={className}
    >
      <path
        d="m5 12 4 4L19 6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WhatsappIcon({
  className,
}: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <path d="M12.04 2C6.53 2 2.06 6.47 2.06 11.98c0 1.94.55 3.82 1.6 5.45L2 22l4.72-1.58a9.9 9.9 0 0 0 5.3 1.54H12c5.5 0 9.98-4.48 9.98-9.98S17.54 2 12.04 2Zm0 18.14h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.17-2.8.94.92-2.73-.2-.31a8.14 8.14 0 0 1-1.26-4.35c0-4.49 3.65-8.14 8.14-8.14 2.18 0 4.22.85 5.76 2.39a8.08 8.08 0 0 1 2.37 5.77c0 4.49-3.65 8.14-8.13 8.14Zm4.47-6.1c-.24-.12-1.4-.7-1.62-.78-.22-.08-.38-.12-.54.12s-.62.78-.76.94c-.14.16-.28.18-.52.06a6.64 6.64 0 0 1-1.95-1.2 7.36 7.36 0 0 1-1.35-1.68c-.14-.24-.02-.37.1-.49.1-.1.24-.26.36-.39.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.54-1.3-.74-1.79-.2-.46-.4-.4-.54-.4h-.46c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.7 2.6 4.11 3.65.57.24 1.02.38 1.37.48.58.18 1.1.16 1.52.1.46-.06 1.4-.58 1.6-1.14.2-.56.2-1.04.14-1.14-.06-.1-.22-.16-.46-.28Z" />
    </svg>
  );
}

function copiarLinkFallback(
  url: string,
) {
  const textarea =
    document.createElement(
      "textarea",
    );

  textarea.value = url;

  textarea.setAttribute(
    "readonly",
    "",
  );

  textarea.style.position =
    "fixed";

  textarea.style.opacity = "0";

  textarea.style.pointerEvents =
    "none";

  document.body.appendChild(
    textarea,
  );

  textarea.select();

  document.execCommand("copy");

  document.body.removeChild(
    textarea,
  );
}

function obterUrlCompartilhamento() {
  const urlAtual =
    window.location.href;

  const match =
    window.location.pathname.match(
      /^\/produto\/([0-9a-f-]{36})\/?$/i,
    );

  const productId =
    match?.[1];

  if (!productId) {
    return urlAtual;
  }

  /*
   * Exemplo:
   *
   * 24b34afb-8143-4328-a53e-0706873ea6c1
   *
   * vira:
   *
   * 24b34afb8143
   */
  const codigo =
    productId
      .replace(/-/g, "")
      .slice(0, 12)
      .toLowerCase();

  if (
    !/^[0-9a-f]{12}$/.test(
      codigo,
    )
  ) {
    return urlAtual;
  }

  return (
    `${window.location.origin}` +
    `/o/${codigo}`
  );
}

export default function ShareProductButton({
  title,
  text,
  variant = "label",
  platform = "native",
}: ShareProductButtonProps) {
  const [
    copiado,
    setCopiado,
  ] = useState(false);

  useEffect(() => {
    if (!copiado) {
      return;
    }

    const timer =
      window.setTimeout(
        () => {
          setCopiado(false);
        },
        1800,
      );

    return () =>
      window.clearTimeout(
        timer,
      );
  }, [copiado]);

  const mensagemCompartilhamento =
    useMemo(() => {
      const textoRecebido =
        text?.trim();

      const formatoAntigo =
        `Confira esta oferta no Ofertano: ${title}`;

      /*
       * A página atual envia o nome inteiro
       * do produto no texto.
       *
       * Quando detectar esse formato,
       * substituímos por uma mensagem curta.
       */
      if (
        !textoRecebido ||
        textoRecebido ===
          formatoAntigo
      ) {
        return "Confira esta oferta no Ofertano 👇";
      }

      return textoRecebido;
    }, [text, title]);

  async function compartilharNativo() {
    const url =
      obterUrlCompartilhamento();

    try {
      if (navigator.share) {
        await navigator.share({
          title,
          text:
            mensagemCompartilhamento,
          url,
        });

        return;
      }

      if (
        navigator.clipboard
          ?.writeText
      ) {
        await navigator.clipboard.writeText(
          url,
        );
      } else {
        copiarLinkFallback(
          url,
        );
      }

      setCopiado(true);
    } catch (error) {
      if (
        error instanceof
          DOMException &&
        error.name ===
          "AbortError"
      ) {
        return;
      }

      try {
        copiarLinkFallback(
          url,
        );

        setCopiado(true);
      } catch {
        // Mantém a página funcionando
        // caso o navegador bloqueie a cópia.
      }
    }
  }

  function compartilharWhatsapp() {
    const url =
      obterUrlCompartilhamento();

    const mensagem =
      `${mensagemCompartilhamento}\n${url}`;

    const whatsappUrl =
      `https://wa.me/?text=${encodeURIComponent(
        mensagem,
      )}`;

    window.open(
      whatsappUrl,
      "_blank",
      "noopener,noreferrer",
    );
  }

  function handleClick() {
    if (
      platform ===
      "whatsapp"
    ) {
      compartilharWhatsapp();
      return;
    }

    void compartilharNativo();
  }

  if (variant === "icon") {
    if (
      platform ===
      "whatsapp"
    ) {
      return (
        <button
          type="button"
          onClick={
            handleClick
          }
          aria-label="Compartilhar no WhatsApp"
          title="Compartilhar no WhatsApp"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white shadow-md transition hover:bg-emerald-600 active:scale-[0.98]"
        >
          <WhatsappIcon className="h-5 w-5" />
        </button>
      );
    }

    return (
      <button
        type="button"
        onClick={
          handleClick
        }
        aria-label={
          copiado
            ? "Link copiado"
            : "Compartilhar produto"
        }
        title={
          copiado
            ? "Link copiado"
            : "Compartilhar produto"
        }
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-700 shadow-md transition hover:bg-slate-300 active:scale-[0.98]"
      >
        {copiado ? (
          <CheckIcon className="h-5 w-5 text-emerald-700" />
        ) : (
          <ShareIcon className="h-5 w-5" />
        )}
      </button>
    );
  }

  if (
    platform ===
    "whatsapp"
  ) {
    return (
      <button
        type="button"
        onClick={
          handleClick
        }
        className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-3 text-sm font-black text-white transition hover:bg-emerald-600 active:scale-[0.98]"
      >
        <WhatsappIcon className="h-4 w-4" />

        <span>
          WhatsApp
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={
        handleClick
      }
      className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-black text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 active:scale-[0.98]"
    >
      {copiado ? (
        <>
          <CheckIcon className="h-4 w-4 text-emerald-700" />

          <span>
            Link copiado
          </span>
        </>
      ) : (
        <>
          <ShareIcon className="h-4 w-4" />

          <span>
            Compartilhar
          </span>
        </>
      )}
    </button>
  );
}