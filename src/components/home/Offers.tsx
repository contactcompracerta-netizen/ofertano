"use client";

import { useEffect, useState } from "react";
import ProductCard from "@/components/products/ProductCard";


export default function Offers(){

const [products,setProducts] = useState<any[]>([]);


useEffect(()=>{

fetch("/api/products")
.then(res=>res.json())
.then(data=>setProducts(data));

},[]);



return (

<section className="bg-gray-100 py-16">

<div className="mx-auto max-w-7xl px-6">


<h2 className="text-3xl font-bold">
🔥 Ofertas do Dia
</h2>


<div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">


{
products.map((product)=>(

<ProductCard

key={product.id}

id={product.id}

name={product.name}

image={product.image}

store={product.store}

oldPrice={
product.oldPrice
?
`R$ ${product.oldPrice}`
:
""
}

price={
`R$ ${product.price}`
}

discount={
product.discount + "% OFF"
}

link={product.affiliateLink}

/>

))

}


</div>


</div>

</section>

)

}