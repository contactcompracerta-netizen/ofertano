"use client";

import Image from "next/image";
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

export default function ProductGallery({
  images,
  productName,
  discountPercent = 0,
  featured = false,
}: ProductGalleryProps) {
  const validImages = useMemo(
    () => Array.from(new Set(images.filter((image) => image.trim().length > 0))),
    [images],
  );

  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex(0);
  }, [productName, validImages.length]);

  if (validImages.length === 0) {
    return (
      <div className="flex min-h-[320px] items-center justify-center p-6 text-center text-sm font-semibold text-slate-500 sm:min-h-[500px]">
        Imagem indisponível
      </div>
    );
  }

  const selectedImage = validImages[selectedIndex] ?? validImages[0];
  const hasMultipleImages = validImages.length > 1;

  function showPreviousImage() {
    setSelectedIndex((currentIndex) =>
      currentIndex === 0 ? validImages.length - 1 : currentIndex - 1,
    );
  }

  function showNextImage() {
    setSelectedIndex((currentIndex) =>
      currentIndex === validImages.length - 1 ? 0 : currentIndex + 1,
    );
  }

  return (
    <>
      <div className="relative flex min-h-[320px] items-center justify-center p-4 sm:min-h-[500px] sm:p-8 lg:min-h-[560px]">
        <div className="absolute left-4 top-4 z-10 flex flex-wrap gap-2 sm:left-6 sm:top-6">
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

        <Image
          key={selectedImage}
          src={selectedImage}
          alt={`${productName} - imagem ${selectedIndex + 1}`}
          width={900}
          height={900}
          priority={selectedIndex === 0}
          sizes="(max-width: 1024px) 100vw, 58vw"
          className="max-h-[430px] w-full object-contain sm:max-h-[500px]"
        />

        {hasMultipleImages && (
          <>
            <button
              type="button"
              onClick={showPreviousImage}
              aria-label="Mostrar imagem anterior"
              className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-800 shadow-md transition hover:bg-white hover:text-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-100 sm:left-5"
            >
              <ArrowIcon direction="left" />
            </button>

            <button
              type="button"
              onClick={showNextImage}
              aria-label="Mostrar próxima imagem"
              className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-800 shadow-md transition hover:bg-white hover:text-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-100 sm:right-5"
            >
              <ArrowIcon direction="right" />
            </button>
          </>
        )}

        {hasMultipleImages && (
          <span className="absolute bottom-3 right-3 rounded-full bg-slate-950/75 px-3 py-1 text-xs font-bold text-white sm:bottom-5 sm:right-5">
            {selectedIndex + 1} / {validImages.length}
          </span>
        )}
      </div>

      {hasMultipleImages && (
        <div className="border-t border-slate-200 px-4 py-4 sm:px-6">
          <div className="flex gap-3 overflow-x-auto pb-2">
            {validImages.map((image, index) => {
              const isSelected = selectedIndex === index;

              return (
                <button
                  key={`${image}-${index}`}
                  type="button"
                  onClick={() => setSelectedIndex(index)}
                  aria-label={`Mostrar imagem ${index + 1} de ${validImages.length}`}
                  aria-pressed={isSelected}
                  className={`flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-white p-2 transition focus:outline-none focus:ring-4 focus:ring-emerald-100 sm:h-24 sm:w-24 ${
                    isSelected
                      ? "border-emerald-500 ring-2 ring-emerald-100"
                      : "border-slate-200 hover:border-emerald-300"
                  }`}
                >
                  <Image
                    src={image}
                    alt={`${productName} - miniatura ${index + 1}`}
                    width={120}
                    height={120}
                    sizes="96px"
                    className="h-full w-full object-contain"
                  />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}