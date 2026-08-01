export interface MercadoLivreAttribute {
  id?: string;
  name?: string;
  value_name?: string | null;
  value_struct?: {
    number?: number;
    unit?: string;
  } | null;
}

export interface MercadoLivrePicture {
  id?: string;
  url?: string;
  secure_url?: string;
}

export interface MercadoLivreItem {
  id?: string;
  title?: string;
  price?: number;
  original_price?: number | null;
  category_id?: string;
  seller_id?: number;
  available_quantity?: number;
  sold_quantity?: number;
  condition?: string;
  warranty?: string | null;
  permalink?: string;
  thumbnail?: string;
  secure_thumbnail?: string;
  pictures?: MercadoLivrePicture[];
  attributes?: MercadoLivreAttribute[];
  catalog_product_id?: string | null;
  status?: string;
}

export interface MercadoLivreCatalogProduct {
  id?: string;
  name?: string;
  family_name?: string;
  status?: string;
  pictures?: MercadoLivrePicture[];
  attributes?: MercadoLivreAttribute[];
  buy_box_winner?: {
    item_id?: string;
  } | null;
}

export interface MercadoLivreCatalogOffer {
  item_id?: string;
  price?: number;
  original_price?: number | null;
  category_id?: string;
  seller_id?: number;
  available_quantity?: number;
  sold_quantity?: number;
  condition?: string;
  warranty?: string | null;
  status?: string;
}

export interface MercadoLivreCatalogItems {
  results?: MercadoLivreCatalogOffer[];
}

export interface MercadoLivreCategory {
  id?: string;
  name?: string;
}

export interface MercadoLivreDescription {
  plain_text?: string;
  text?: string;
}

export interface MercadoLivreReviews {
  rating_average?: number;
  total?: number;
  paging?: {
    total?: number;
  };
}

export interface MercadoLivreResolvedProduct {
  itemId: string;
  title: string;
  price: number;
  originalPrice: number | null;
  categoryName: string;
  sellerId: number | null;
  availableQuantity: number | null;
  soldQuantity: number | null;
  condition: string | null;
  warranty: string | null;
  pictures: MercadoLivrePicture[];
  attributes: MercadoLivreAttribute[];
  description: string | null;
  rating: number | null;
  reviews: number | null;
}
