import Link from "next/link";

type LogoProps = {
  mostrarSlogan?: boolean;
  temaEscuro?: boolean;
  className?: string;
};

export default function Logo({
  mostrarSlogan = true,
  temaEscuro = false,
  className = "",
}: LogoProps) {
  const corTexto = temaEscuro ? "text-white" : "text-gray-950";
  const corSlogan = temaEscuro ? "text-gray-400" : "text-gray-500";

  return (
    <Link
      href="/"
      aria-label="Ofertano — Página inicial"
      className={`inline-flex shrink-0 items-center gap-3 ${className}`}
    >
      <svg
        viewBox="0 0 64 64"
        aria-hidden="true"
        className="h-11 w-11 shrink-0"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect
          x="4"
          y="4"
          width="56"
          height="56"
          rx="18"
          fill="#16A34A"
        />

        <path
          d="M18 22.5C18 20.0147 20.0147 18 22.5 18H36.4C37.4617 18 38.4803 18.4218 39.231 19.1725L46.8275 26.769C48.3896 28.3311 48.3896 30.8637 46.8275 32.4258L32.4258 46.8275C30.8637 48.3896 28.3311 48.3896 26.769 46.8275L19.1725 39.231C18.4218 38.4803 18 37.4617 18 36.4V22.5Z"
          fill="white"
        />

        <circle cx="27" cy="27" r="3.5" fill="#16A34A" />

        <path
          d="M27 38L31 42L40 32"
          stroke="#16A34A"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      <span className="flex flex-col">
        <span
          className={`text-2xl font-black tracking-[-0.04em] ${corTexto}`}
        >
          Oferta<span className="text-green-600">no</span>
        </span>

        {mostrarSlogan && (
          <span
            className={`hidden text-[11px] font-medium tracking-wide sm:block ${corSlogan}`}
          >
            Compare preços antes de comprar.
          </span>
        )}
      </span>
    </Link>
  );
}