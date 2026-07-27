import prisma from "@/lib/prisma";
import Image from "next/image";
import { notFound } from "next/navigation";


type Props = {
  params: Promise<{
    id: string;
  }>;
};


export default async function ProdutoPage({ params }: Props) {


  const { id } = await params;


  const product = await prisma.product.findUnique({
    where: {
      id,
    },
  });



  if (!product) {
    notFound();
  }



  return (

    <main className="min-h-screen bg-gray-100 p-8">


      <div className="mx-auto max-w-6xl rounded-3xl bg-white p-8 shadow-lg">


        <div className="grid gap-10 md:grid-cols-2">



          {/* Imagem */}

          <div className="flex items-center justify-center">

            <Image
              src={product.image}
              alt={product.name}
              width={700}
              height={700}
              className="h-[500px] w-full object-contain"
            />

          </div>




          {/* Informações */}

          <div>


            <span className="rounded-full bg-green-100 px-4 py-2 text-sm font-bold text-green-700">

              🛒 Vendido pelo Mercado Livre

            </span>



            <h1 className="mt-6 text-4xl font-extrabold text-gray-800">

              {product.name}

            </h1>



            <div className="mt-4 flex gap-4">


              {product.rating && (

                <span className="rounded-lg bg-yellow-100 px-3 py-2 text-yellow-700">

                  ⭐ {product.rating}

                </span>

              )}



              {product.sales && (

                <span className="rounded-lg bg-gray-100 px-3 py-2 text-gray-600">

                  🔥 {product.sales} vendidos

                </span>

              )}


            </div>




            {product.oldPrice && (

              <p className="mt-8 text-xl text-gray-400 line-through">

                R$ {product.oldPrice.toFixed(2).replace(".", ",")}

              </p>

            )}



            <p className="text-5xl font-black text-green-600">

              R$ {product.price.toFixed(2).replace(".", ",")}

            </p>




            {product.discount && (

              <div className="mt-4 inline-block rounded-full bg-red-600 px-5 py-2 font-bold text-white">

                🔥 {product.discount}% OFF

              </div>

            )}





            <a
              href={product.affiliateLink}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-8 block rounded-2xl bg-green-600 py-5 text-center text-xl font-bold text-white hover:bg-green-700 transition"
            >

              Comprar agora no Mercado Livre

            </a>




            <div className="mt-6 rounded-xl bg-gray-100 p-4 text-sm text-gray-600">

              ✅ Compra segura  
              <br />
              ✅ Pagamento protegido pelo Mercado Livre
              <br />
              ✅ Você será redirecionado para finalizar a compra

            </div>



          </div>


        </div>


      </div>


    </main>

  );
}