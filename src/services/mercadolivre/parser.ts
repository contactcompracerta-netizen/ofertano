interface MercadoLivreItem {
    id: string;
    title: string;
    thumbnail: string;
    price: number;
    original_price: number | null;
    permalink: string;
    category_id: string;
    sold_quantity: number;
  }
  
  interface MercadoLivreCategory {
    name: string;
  }
  
  interface MercadoLivreReviews {
    rating_average?: number;
  }
  
  export function parseMercadoLivreProduct(
    item: MercadoLivreItem,
    category: MercadoLivreCategory,
    reviews?: MercadoLivreReviews
  ) {
    const oldPrice = item.original_price ?? item.price;
  
    const discount =
      item.original_price && item.original_price > item.price
        ? Math.round(
            ((item.original_price - item.price) /
              item.original_price) *
              100
          )
        : 0;
  
    return {
      mlId: item.id,
      name: item.title,
      image: item.thumbnail.replace("-I.jpg", "-O.jpg"),
      price: item.price,
      oldPrice,
      discount,
      category: category.name,
      store: "Mercado Livre",
      affiliateLink: item.permalink,
      rating: reviews?.rating_average ?? 0,
      sales: item.sold_quantity,
    };
  }