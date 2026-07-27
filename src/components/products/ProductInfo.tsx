type ProductInfoProps = {
    name: string;
    store: string;
    oldPrice: string;
    price: string;
    discount: string;
    link: string;
  };
  
  export default function ProductInfo({
    name,
    store,
    oldPrice,
    price,
    discount,
    link,
  }: ProductInfoProps) {
  
    return (
      <div className="rounded-2xl bg-white p-8 shadow">
  
        <p className="text-sm text-gray-500">
          Loja: {store}
        </p>
  
        <h1 className="mt-3 text-4xl font-bold text-gray-900">
          {name}
        </h1>
  
        <div className="mt-4 text-xl text-yellow-500">
          ⭐⭐⭐⭐⭐
        </div>
  
        <p className="mt-6 text-lg text-gray-400 line-through">
          {oldPrice}
        </p>
  
        <p className="text-4xl font-extrabold text-green-600">
          {price}
        </p>
  
        <span className="mt-4 inline-block rounded-full bg-red-500 px-4 py-2 font-bold text-white">
          {discount}
        </span>
  
        <div className="mt-6 rounded-xl bg-green-50 p-4 text-green-700">
          ✅ Oferta verificada
          <br />
          ✅ Compra segura pela loja parceira
          <br />
          ✅ Aproveite enquanto durar a promoção
        </div>
  
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-8 block rounded-xl bg-green-600 py-4 text-center text-lg font-bold text-white transition hover:bg-green-700"
        >
          Comprar agora
        </a>
  
      </div>
    );
  }