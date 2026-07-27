import Link from "next/link";

type ProductCardProps = {
  id: string;
  name: string;
  image: string;
  store: string;
  oldPrice?: string;
  price: string;
  discount?: string;
  rating?: number;
  sales?: number;
};

export default function ProductCard({
  id,
  name,
  image,
  store,
  oldPrice,
  price,
  discount,
  rating,
  sales,
}: ProductCardProps) {
  return (
    <div className="group overflow-hidden rounded-2xl border bg-white shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-2xl">

      <Link href={`/produto/${id}`}>

        <div className="relative bg-white">

          {discount && (
            <span className="absolute left-4 top-4 z-10 rounded-full bg-red-600 px-3 py-1 text-xs font-bold text-white">
              {discount}
            </span>
          )}

          <img
            src={image}
            alt={name}
            className="h-64 w-full object-contain p-6 transition duration-300 group-hover:scale-105"
          />

        </div>

      </Link>

      <div className="p-5">

        <span className="rounded bg-green-100 px-2 py-1 text-xs font-bold text-green-700">
          {store}
        </span>

        <Link href={`/produto/${id}`}>

          <h3 className="mt-4 line-clamp-2 h-14 text-lg font-bold text-gray-900 hover:text-green-600">
            {name}
          </h3>

        </Link>

        <div className="mt-3 flex items-center justify-between">

          {rating && (
            <span className="text-sm text-yellow-500">
              ⭐ {rating}
            </span>
          )}

          {sales && (
            <span className="text-sm text-gray-500">
              🔥 {sales} vendidos
            </span>
          )}

        </div>

        {oldPrice && (
          <p className="mt-4 text-sm text-gray-400 line-through">
            {oldPrice}
          </p>
        )}

        <p className="text-3xl font-extrabold text-green-600">
          {price}
        </p>

        <p className="mt-2 text-sm text-gray-500">
          🛒 Compra segura pelo Mercado Livre
        </p>

        <a
          href={`/produto/${id}`}
          className="mt-5 block rounded-xl bg-green-600 py-3 text-center font-bold text-white transition hover:bg-green-700"
        >
          Ver Oferta
        </a>

      </div>

    </div>
  );
}