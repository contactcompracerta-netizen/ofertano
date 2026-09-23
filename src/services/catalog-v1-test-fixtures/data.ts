/**
 * Catálogo V1 — Test Fixtures
 *
 * Fixtures estáticas para validação do pipeline real do Ofertano.
 * Os dados NÃO substituem o banco de produção.
 * São usados APENAS para provar que os módulos reais funcionam:
 *   - Identity Matching (identity/)
 *   - Multistore Grouping (multistore-v2/)
 *   - Best Offer (cálculo de menor preço)
 *   - Search (lógica de busca)
 *   - Product Page Contract (contrato de dados)
 *
 * NENHUM fallback de runtime. NENHUMA substituição de Prisma.
 * NENHUMA alteração em prisma/schema.prisma ou src/lib/prisma.ts.
 */

import type { ProductImport } from "@/services/importers/core/types";

// ─── Marketplace codes ───
const ML = "MERCADO_LIVRE";
const AZ = "AMAZON";
const SH = "SHOPEE";
const MLU = "MAGAZINE_LUIZA";
const CB = "CASAS_BAHIA";
const KB = "KABUM";
const CR = "CARREFOUR";

// ─── Helper ───
function makeImport(
  id: string,
  title: string,
  brand: string,
  category: string,
  canonicalKey: string,
  price: number,
  oldPrice: number | null,
  marketplace: string,
  options?: {
    model?: string;
    color?: string;
    voltage?: string;
    discount?: number | null;
    affiliateLink?: string | null;
    rating?: number | null;
    reviews?: number | null;
    stock?: number | null;
  }
): ProductImport {
  return {
    marketplace: marketplace as ProductImport["marketplace"],
    externalId: id,
    url: `https://example.com/${id}`,
    affiliateLink: options?.affiliateLink ?? null,
    title,
    description: null,
    brand,
    category,
    image: `/produtos/${canonicalKey}.jpg`,
    images: [`/produtos/${canonicalKey}.jpg`],
    price,
    oldPrice,
    discount: options?.discount ?? null,
    installments: null,
    rating: options?.rating ?? null,
    reviews: options?.reviews ?? null,
    sales: null,
    stock: options?.stock ?? null,
    seller: null,
    attributes: {
      MARCA: brand,
      MODELO: options?.model ?? "",
      ...(options?.color ? { COR: options.color } : {}),
      ...(options?.voltage ? { VOLTAJEM: options.voltage } : {}),
    },
  };
}

// ─── 6 Produtos Canônicos × 3-4 Lojas = 21 entradas ───
export const catalogV1Fixtures: ProductImport[] = [
  // ─── 1. Smart TV 50" 4K Samsung QE50T530 ───
  makeImport("ML-TV-001", "Smart TV 50\" 4K UHD LED Tizen QE50T530", "Samsung", "Eletrônicos", "samsung-qe50t530", 1899.00, 2399.00, ML, {
    model: "QE50T530", voltage: "Bivolt", discount: 21, rating: 4.5, reviews: 128, stock: 23,
    affiliateLink: "https://meli.la/tv50-ml",
  }),
  makeImport("AMZ-TV-001", "Smart TV 50\" 4K LED Tizen Samsung QE50T530", "Samsung", "Eletrônicos", "samsung-qe50t530", 1799.00, 2299.00, AZ, {
    model: "QE50T530", voltage: "Bivolt", rating: 4.5, reviews: 128, stock: 23,
    affiliateLink: "https://amzn.to/tv50-az",
  }),
  makeImport("SHP-TV-001", "Smart TV 50 Polegadas 4K Samsung QE50T530", "Samsung", "Eletrônicos", "samsung-qe50t530", 1949.00, null, SH, {
    model: "QE50T530", voltage: "Bivolt", rating: 4.5, reviews: 128,
    affiliateLink: null,
  }),

  // ─── 2. Notebook Dell Inspiron 15 5510 ───
  makeImport("ML-NB-001", "Notebook Dell Inspiron 15 5510 Intel i5 8GB 256GB", "Dell", "Informática", "dell-inspiron-15-5510", 3499.00, 4299.00, ML, {
    model: "Inspiron 15 5510", color: "Prata", voltage: "Bivolt", discount: 19, rating: 4.3, reviews: 89, stock: 15,
    affiliateLink: "https://meli.la/nb-ml",
  }),
  makeImport("AMZ-NB-001", "Notebook Dell Inspiron 15 Intel Core i5 8GB SSD", "Dell", "Informática", "dell-inspiron-15-5510", 3299.00, 3999.00, AZ, {
    model: "Inspiron 15 5510", color: "Prata", voltage: "Bivolt", rating: 4.3, reviews: 89, stock: 15,
    affiliateLink: "https://amzn.to/nb-az",
  }),
  makeImport("KAB-NB-001", "Notebook Dell Inspiron 15 Intel Core i5 8GB 256GB SSD", "Dell", "Informática", "dell-inspiron-15-5510", 3599.00, null, KB, {
    model: "Inspiron 15 5510", color: "Prata", voltage: "Bivolt", rating: 4.3, reviews: 89, stock: 15,
    affiliateLink: null,
  }),
  makeImport("MLU-NB-001", "Notebook Dell Inspiron 15 5510 Intel i5 8GB 256GB", "Dell", "Informática", "dell-inspiron-15-5510", 3399.00, 4199.00, MLU, {
    model: "Inspiron 15 5510", color: "Prata", voltage: "Bivolt", rating: 4.3, reviews: 89, stock: 15,
    affiliateLink: null,
  }),

  // ─── 3. Air Fryer Philips HD9252/90 ───
  makeImport("ML-AF-001", "Air Fryer Premium Philips HD9252/90 5.5L 1400W", "Philips", "Casa", "philips-hd9252-90", 399.00, 599.00, ML, {
    model: "HD9252/90", color: "Preto", voltage: "Bivolt", discount: 33, rating: 4.7, reviews: 256, stock: 45,
    affiliateLink: "https://meli.la/af-ml",
  }),
  makeImport("AMZ-AF-001", "Air Fryer Philips HD9252/90 5.5L 1400W Premium", "Philips", "Casa", "philips-hd9252-90", 379.00, 549.00, AZ, {
    model: "HD9252/90", color: "Preto", voltage: "Bivolt", rating: 4.7, reviews: 256, stock: 45,
    affiliateLink: "https://amzn.to/af-az",
  }),
  makeImport("CB-AF-001", "Air Fryer Premium Philips 5.5L 1400W HD9252", "Philips", "Casa", "philips-hd9252-90", 429.00, null, CB, {
    model: "HD9252/90", color: "Preto", voltage: "Bivolt", rating: 4.7, reviews: 256, stock: 45,
    affiliateLink: null,
  }),

  // ─── 4. Furadeira Bosch GSB 13 RE ───
  makeImport("ML-FD-001", "Furadeira Parafusadeira Profissional Bosch GSB 13 RE 550W", "Bosch", "Ferramentas", "bosch-gsb-13-re", 249.00, 349.00, ML, {
    model: "GSB 13 RE", color: "Azul", voltage: "110V", discount: 29, rating: 4.4, reviews: 67, stock: 32,
    affiliateLink: "https://meli.la/fd-ml",
  }),
  makeImport("AMZ-FD-001", "Furadeira Bosch GSB 13 RE 550W Profissional", "Bosch", "Ferramentas", "bosch-gsb-13-re", 269.00, 369.00, AZ, {
    model: "GSB 13 RE", color: "Azul", voltage: "110V", rating: 4.4, reviews: 67, stock: 32,
    affiliateLink: "https://amzn.to/fd-az",
  }),
  makeImport("MLU-FD-001", "Furadeira Profissional Bosch GSB 13 RE 550W", "Bosch", "Ferramentas", "bosch-gsb-13-re", 259.00, null, MLU, {
    model: "GSB 13 RE", color: "Azul", voltage: "110V", rating: 4.4, reviews: 67, stock: 32,
    affiliateLink: null,
  }),

  // ─── 5. Fone JBL Tune 520BT ───
  makeImport("ML-FONE-001", "Fone JBL Tune 520BT Bluetooth Over-ear 60h", "JBL", "Áudio", "jbl-tune-520bt", 299.00, 399.00, ML, {
    model: "Tune 520BT", color: "Preto", voltage: "USB-C", discount: 25, rating: 4.6, reviews: 340, stock: 78,
    affiliateLink: "https://meli.la/fone-ml",
  }),
  makeImport("AMZ-FONE-001", "Fone JBL Tune 520BT Bluetooth Over-ear 60H", "JBL", "Áudio", "jbl-tune-520bt", 279.00, 379.00, AZ, {
    model: "Tune 520BT", color: "Preto", voltage: "USB-C", rating: 4.6, reviews: 340, stock: 78,
    affiliateLink: "https://amzn.to/fone-az",
  }),
  makeImport("SHP-FONE-001", "Fone JBL Tune 520BT Bluetooth Over-ear 60 horas", "JBL", "Áudio", "jbl-tune-520bt", 319.00, null, SH, {
    model: "Tune 520BT", color: "Preto", voltage: "USB-C", rating: 4.6, reviews: 340,
    affiliateLink: null,
  }),
  makeImport("CB-FONE-001", "Fone JBL Tune 520BT Bluetooth Over-ear 60H Preto", "JBL", "Áudio", "jbl-tune-520bt", 309.00, null, CB, {
    model: "Tune 520BT", color: "Preto", voltage: "USB-C", rating: 4.6, reviews: 340,
    affiliateLink: null,
  }),

  // ─── 6. Smartphone Samsung Galaxy A54 5G ───
  makeImport("ML-CEL-001", "Smartphone Samsung Galaxy A54 5G 128GB 6GB RAM", "Samsung", "Celulares", "samsung-galaxy-a54-5g", 1299.00, 1599.00, ML, {
    model: "Galaxy A54 5G", color: "Preto", voltage: "Bivolt", discount: 19, rating: 4.4, reviews: 560, stock: 65,
    affiliateLink: "https://meli.la/cel-ml",
  }),
  makeImport("AMZ-CEL-001", "Samsung Galaxy A54 5G 128GB 6GB RAM", "Samsung", "Celulares", "samsung-galaxy-a54-5g", 1199.00, 1499.00, AZ, {
    model: "Galaxy A54 5G", color: "Preto", voltage: "Bivolt", rating: 4.4, reviews: 560, stock: 65,
    affiliateLink: "https://amzn.to/cel-az",
  }),
  makeImport("KAB-CEL-001", "Smartphone Samsung Galaxy A54 5G 128GB 6GB", "Samsung", "Celulares", "samsung-galaxy-a54-5g", 1349.00, null, KB, {
    model: "Galaxy A54 5G", color: "Preto", voltage: "Bivolt", rating: 4.4, reviews: 560, stock: 65,
    affiliateLink: null,
  }),
  makeImport("CR-CEL-001", "Smartphone Samsung Galaxy A54 5G 128GB", "Samsung", "Celulares", "samsung-galaxy-a54-5g", 1249.00, null, CR, {
    model: "Galaxy A54 5G", color: "Preto", voltage: "Bivolt", rating: 4.4, reviews: 560, stock: 65,
    affiliateLink: null,
  }),
];

/**
 * Retorna os produtos agregados por canonicalKey.
 * Agrupa as entradas de loja em produtos canônicos com todas as ofertas.
 */
export function getAggregatedFixtures() {
  const groups = new Map<string, typeof catalogV1Fixtures>();
  for (const product of catalogV1Fixtures) {
    const key = (product.attributes?.MARCA && product.attributes?.MODELO)
      ? `${product.brand?.toLowerCase()}-${product.attributes.MODELO.toLowerCase().replace(/[^a-z0-9]/g, "")}`
      : product.externalId;
    const group = groups.get(key) ?? [];
    group.push(product);
    groups.set(key, group);
  }

  const result: Array<{
    canonicalKey: string;
    name: string;
    brand: string;
    category: string;
    offers: typeof catalogV1Fixtures;
    bestPrice: number;
    marketplaces: string[];
    offerCount: number;
  }> = [];

  for (const [key, products] of groups) {
    const allOffers = products;
    const bestPrice = Math.min(...allOffers.filter(o => o.price > 0).map(o => o.price));
    const marketplaces = [...new Set(allOffers.map(o => o.marketplace))];
    result.push({
      canonicalKey: key,
      name: products[0].title,
      brand: products[0].brand ?? "",
      category: products[0].category ?? "",
      offers: allOffers,
      bestPrice,
      marketplaces,
      offerCount: allOffers.length,
    });
  }

  return result;
}

/**
 * Busca fixtures por texto (nome, marca, modelo, categoria).
 */
export function searchFixtures(query: string): typeof catalogV1Fixtures {
  const normalized = query.toLowerCase().trim();
  if (!normalized || normalized.length < 2) return [];
  return catalogV1Fixtures.filter((p) => {
    const searchFields = [
      p.title, p.brand, p.attributes?.MODELO, p.category,
      JSON.stringify(p.attributes),
    ].filter(Boolean) as string[];
    return searchFields.some((field) => field.toLowerCase().includes(normalized));
  });
}
