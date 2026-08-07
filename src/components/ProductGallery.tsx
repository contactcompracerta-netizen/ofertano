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
      strokeWidth="2.2"
      className="h-5 w-5"
    >
      {direction === "left" ? (
        <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
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
  const [selectedIndex, setSelectedIndex] = useState(0);

  const imagensValidas = useMemo(
    () => imagensOriginais.filter((imagem) => !imagensComErro.includes(imagem)),
    [imagensOriginais, imagensComErro],
  );

  useEffect(() => {
    setSelectedIndex(0);
    setImagensComErro([]);
  }, [productName]);

  useEffect(() => {
    if (selectedIndex > imagensValidas.length - 1) {
      setSelectedIndex(Math.max(imagensValidas.length - 1, 0));
    }
  }, [imagensValidas.length, selectedIndex]);

  function registrarErro(imagem: string) {
    setImagensComErro((atuais) =>
      atuais.includes(imagem) ? atuais : [...atuais, imagem],
    );
  }

  if (imagensValidas.length === 0) {
    return (
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:rounded-3xl">
        <div className="flex h-[300px] items-center justify-center px-6 text-center text-sm font-semibold text-slate-500 sm:h-[430px]">
          Imagem indisponível
        </div>
      </section>
    );
  }

  const imagemSelecionada = imagensValidas[selectedIndex] ?? imagensValidas[0];
  const possuiVariasImagens = imagensValidas.length > 1;

  function mostrarAnterior() {
    setSelectedIndex((indiceAtual) =>
      indiceAtual === 0 ? imagensValidas.length - 1 : indiceAtual - 1,
    );
  }

  function mostrarProxima() {
    setSelectedIndex((indiceAtual) =>
      indiceAtual === imagensValidas.length - 1 ? 0 : indiceAtual + 1,
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:rounded-3xl">
      <div className="relative flex h-[320px] items-center justify-center bg-white p-3 sm:h-[430px] sm:p-6 lg:h-[520px]">
        <div className="absolute left-3 top-3 z-20 flex flex-wrap gap-2 sm:left-5 sm:top-5">
          {discountPercent > 0 && (
            <span className="rounded-full bg-rose-600 px-3 py-1.5 text-xs font-black text-white shadow-sm sm:text-sm">
              {discountPercent}% OFF
            </span>
          )}

          {featured && (
            <span className="rounded-full bg-amber-400 px-3 py-1.5 text-xs font-black text-amber-950 shadow-sm sm:text-sm">
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
              className="absolute left-2 top-1/2 z-30 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-800 shadow-md transition active:scale-95 sm:left-4"
            >
              <ArrowIcon direction="left" />
            </button>

            <button
              type="button"
              onClick={mostrarProxima}
              aria-label="Mostrar próxima imagem"
              className="absolute right-2 top-1/2 z-30 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-800 shadow-md transition active:scale-95 sm:right-4"
            >
              <ArrowIcon direction="right" />
            </button>

            <span className="absolute bottom-3 right-3 z-20 rounded-full bg-slate-950/75 px-2.5 py-1 text-xs font-bold text-white sm:bottom-4 sm:right-4">
              {selectedIndex + 1} / {imagensValidas.length}
            </span>
          </>
        )}
      </div>

      {possuiVariasImagens && (
        <div className="border-t border-slate-200 bg-slate-50/60 px-3 py-3 sm:px-5 sm:py-4">
          <div className="flex gap-2.5 overflow-x-auto overscroll-x-contain pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {imagensValidas.map((imagem, indice) => {
              const selecionada = selectedIndex === indice;

              return (
                <button
                  key={`${imagem}-${indice}`}
                  type="button"
                  onClick={() => setSelectedIndex(indice)}
                  aria-label={`Mostrar imagem ${indice + 1} de ${imagensValidas.length}`}
                  aria-pressed={selecionada}
                  className={`relative z-10 flex h-[72px] w-[72px] shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-xl border bg-white p-1.5 transition active:scale-95 sm:h-20 sm:w-20 ${
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