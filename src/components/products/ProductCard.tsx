import Image from "next/image";
import Link from "next/link";

type ProductCardProps = {
  id: string;
  name: string;
  image: string;
  store: string;
  oldPrice?: string | null;
  price: string;
  discount?: string | null;
  link: string;
};

export default function ProductCard({
  id,
  name,
  image,
  store,
  oldPrice,
  price,
  discount,
  link,
}: ProductCardProps) {
  return (
    <article className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition duration-200 hover:-translate-y-1 hover:shadow-lg">
      <Link href={`/produto/${id}`} className="block">
        <div className="relative aspect-square w-full bg-gray-50">
          <Image
            src={image}
            alt={name}
            fill
            className="object-contain p-4"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
          />

          {discount && (
            <span className="absolute left-3 top-3 rounded-full bg-red-600 px-3 py-1 text-sm font-bold text-white">
              {discount}
            </span>
          )}
        </div>
      </Link>

      <div className="p-5">
        <p className="mb-2 text-sm font-medium text-gray-500">
          {store}
        </p>

        <Link href={`/produto/${id}`} className="block">
          <h2 className="line-clamp-2 min-h-12 text-base font-semibold text-gray-900 transition hover:text-green-700">
            {name}
          </h2>
        </Link>

        <div className="mt-4">
          {oldPrice && (
            <p className="text-sm text-gray-400 line-through">
              {oldPrice}
            </p>
          )}

          <p className="text-2xl font-bold text-gray-900">
            {price}
          </p>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <Link
            href={`/produto/${id}`}
            className="rounded-lg border border-gray-300 px-4 py-3 text-center text-sm font-semibold text-gray-700 transition hover:border-green-600 hover:text-green-700"
          >
            Ver detalhes
          </Link>

          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer sponsored"
            className="rounded-lg bg-green-600 px-4 py-3 text-center text-sm font-semibold text-white transition hover:bg-green-700"
          >
            Ver oferta
          </a>
        </div>
      </div>
    </article>
  );
}