"use client";

import { useEffect, useMemo, useState } from "react";

type ProductGalleryProps = {
  images: string[];
  productName: string;
  discountPercent?: number;
  featured?: boolean;
};

type ArrowIconProps = {
  direction: "left" | "right";
};

function ArrowIcon({ direction }: ArrowIconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="h-4 w-4"
    >
      {direction === "left" ? (
        <path
          d="m15 18-6-6 6-6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="m9 6 6 6-6 6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

function normalizarUrlImagem(url: string) {
  const limpa = url.trim();

  if (!limpa) return "";
  if (limpa.startsWith("//")) return `https:${limpa}`;
  if (limpa.startsWith("http://")) return `https://${limpa.slice(7)}`;

  return limpa;
}

export default function ProductGallery({
  images,
  productName,
  discountPercent = 0,
  featured = false,
}: ProductGalleryProps) {
  const imagensOriginais = useMemo(
    () =>
      Array.from(
        new Set(
          images
            .map(normalizarUrlImagem)
            .filter((imagem) => imagem.length > 0),
        ),
      ),
    [images],
  );

  const [imagensComErro, setImagensComErro] = useState<string[]>([]);
  const [imagensCarregadas, setImagensCarregadas] = useState<string[]>([]);
  const [preloadFinalizado, setPreloadFinalizado] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const imagensValidas = useMemo(() => {
    if (!preloadFinalizado) {
      return imagensOriginais.filter(
        (imagem) => !imagensComErro.includes(imagem),
      );
    }

    return imagensOriginais.filter(
      (imagem) =>
        imagensCarregadas.includes(imagem) &&
        !imagensComErro.includes(imagem),
    );
  }, [
    imagensOriginais,
    imagensCarregadas,
    imagensComErro,
    preloadFinalizado,
  ]);

  useEffect(() => {
    setSelectedIndex(0);
    setImagensComErro([]);
    setImagensCarregadas([]);
    setPreloadFinalizado(false);
  }, [productName, imagensOriginais]);

  useEffect(() => {
    if (imagensOriginais.length === 0) {
      setPreloadFinalizado(true);
      return;
    }

    let cancelado = false;
    let pendentes = imagensOriginais.length;

    function finalizarUmaImagem() {
      pendentes -= 1;

      if (!cancelado && pendentes <= 0) {
        setPreloadFinalizado(true);
      }
    }

    const preloads = imagensOriginais.map((imagem) => {
      const teste = new Image();

      teste.referrerPolicy = "no-referrer";

      teste.onload = () => {
        if (!cancelado) {
          const tamanhoValido =
            teste.naturalWidth >= 80 &&
            teste.naturalHeight >= 80;

          if (tamanhoValido) {
            setImagensCarregadas((atuais) =>
              atuais.includes(imagem)
                ? atuais
                : [...atuais, imagem],
            );
          } else {
            setImagensComErro((atuais) =>
              atuais.includes(imagem)
                ? atuais
                : [...atuais, imagem],
            );
          }
        }

        finalizarUmaImagem();
      };

      teste.onerror = () => {
        if (!cancelado) {
          setImagensComErro((atuais) =>
            atuais.includes(imagem)
              ? atuais
              : [...atuais, imagem],
          );
        }

        finalizarUmaImagem();
      };

      teste.src = imagem;

      return teste;
    });

    return () => {
      cancelado = true;

      for (const preload of preloads) {
        preload.onload = null;
        preload.onerror = null;
      }
    };
  }, [imagensOriginais]);

  useEffect(() => {
    if (selectedIndex > imagensValidas.length - 1) {
      setSelectedIndex(Math.max(imagensValidas.length - 1, 0));
    }
  }, [imagensValidas.length, selectedIndex]);

  function registrarErro(imagem: string) {
    setImagensComErro((atuais) =>
      atuais.includes(imagem) ? atuais : [...atuais, imagem],
    );

    setImagensCarregadas((atuais) =>
      atuais.filter((item) => item !== imagem),
    );
  }

  if (imagensValidas.length === 0) {
    return (
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex h-[250px] items-center justify-center bg-slate-50 sm:h-[320px] lg:h-[390px]">
          <span className="text-sm font-semibold text-slate-400">
            Imagem indisponível
          </span>
        </div>
      </section>
    );
  }

  const imagemSelecionada =
    imagensValidas[selectedIndex] ?? imagensValidas[0];
  const possuiVariasImagens = imagensValidas.length > 1;

  function mostrarAnterior() {
    setSelectedIndex((indiceAtual) =>
      indiceAtual === 0
        ? imagensValidas.length - 1
        : indiceAtual - 1,
    );
  }

  function mostrarProxima() {
    setSelectedIndex((indiceAtual) =>
      indiceAtual === imagensValidas.length - 1
        ? 0
        : indiceAtual + 1,
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:rounded-none lg:border-0 lg:shadow-none">
      <div className="relative flex h-[260px] items-center justify-center overflow-hidden bg-white p-2.5 sm:h-[330px] sm:p-3 lg:h-[390px] lg:p-4 xl:h-[410px]">
        <div className="absolute left-2.5 top-2.5 z-20 flex flex-wrap gap-1.5 sm:left-3 sm:top-3">
          {discountPercent > 0 && (
            <span className="rounded-full bg-rose-600 px-2.5 py-1 text-[10px] font-black text-white shadow-sm sm:text-[11px]">
              {discountPercent}% OFF
            </span>
          )}

          {featured && (
            <span className="rounded-full bg-amber-400 px-2.5 py-1 text-[10px] font-black text-amber-950 shadow-sm sm:text-[11px]">
              Destaque
            </span>
          )}
        </div>

        <img
          key={imagemSelecionada}
          src={imagemSelecionada}
          alt={`${productName} - imagem ${selectedIndex + 1}`}
          referrerPolicy="no-referrer"
          decoding="async"
          fetchPriority={selectedIndex === 0 ? "high" : "auto"}
          onError={() => registrarErro(imagemSelecionada)}
          className="pointer-events-none h-full w-full select-none object-contain"
        />

        {possuiVariasImagens && (
          <>
            <button
              type="button"
              onClick={mostrarAnterior}
              aria-label="Mostrar imagem anterior"
              className="absolute left-2 top-1/2 z-30 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-95 sm:left-2.5"
            >
              <ArrowIcon direction="left" />
            </button>

            <button
              type="button"
              onClick={mostrarProxima}
              aria-label="Mostrar próxima imagem"
              className="absolute right-2 top-1/2 z-30 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-95 sm:right-2.5"
            >
              <ArrowIcon direction="right" />
            </button>

            <span className="absolute bottom-2.5 right-2.5 z-20 rounded-full bg-slate-950/75 px-2 py-1 text-[10px] font-bold text-white sm:bottom-3 sm:right-3 sm:text-[11px]">
              {selectedIndex + 1} / {imagensValidas.length}
            </span>
          </>
        )}
      </div>

      {possuiVariasImagens && (
        <div className="border-t border-slate-200 bg-slate-50/50 px-2 py-2 sm:px-2.5">
          <div className="flex gap-2 overflow-x-auto overscroll-x-contain pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {imagensValidas.map((imagem, indice) => {
              const selecionada = selectedIndex === indice;

              return (
                <button
                  key={`${imagem}-${indice}`}
                  type="button"
                  onClick={() => setSelectedIndex(indice)}
                  aria-label={`Mostrar imagem ${indice + 1} de ${imagensValidas.length}`}
                  aria-pressed={selecionada}
                  className={`relative z-10 flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-md border bg-white p-1 transition active:scale-95 sm:h-14 sm:w-14 ${
                    selecionada
                      ? "border-emerald-500 ring-2 ring-emerald-100"
                      : "border-slate-200 hover:border-emerald-300"
                  }`}
                >
                  <img
                    src={imagem}
                    alt={`${productName} - miniatura ${indice + 1}`}
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    decoding="async"
                    onError={() => registrarErro(imagem)}
                    className="pointer-events-none h-full w-full select-none object-contain"
                  />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}