/**
 * CATALOG_WAVE 1 - FIXTURES SINTÉTICAS (FASE G).
 *
 * Pequenas, sem dados secretos, sem dump real de feed.
 * Cobrem os 4 merchants e os casos da missão:
 *   GTIN válido | GTIN ausente | brand+model | brand+MPN | preço BR |
 *   preço internacional | imagem válida | URL válida | URL inválida |
 *   externalId duplicado | produto igual em duas lojas | produto semelhante
 *   mas diferente | mesma marca/modelo | modelos próximos | cross-brand
 *   falso positivo | GTIN conflitante | produto sem identidade forte.
 *
 * GTINs são EANs sintéticos com checksum válido (uso livre em teste).
 * URLs de afiliado usam o TLD reservado ".test" (nunca resolvível).
 */
import type { RawAwinFeedItem } from "../feed/awinAdapter";
import type { MerchantSlug } from "./types";

export interface Wave1FixtureSet {
  merchant: MerchantSlug;
  advertiserName: string;
  /** ID sintético do anunciante (não é credencial). */
  advertiserId: string;
  rows: RawAwinFeedItem[];
}

function affUrl(destination: string): string {
  return `https://example-awin.test/cread.php?awinmid=1&awinaffid=0000000&ued=${encodeURIComponent(
    destination,
  )}`;
}

function img(path: string): string {
  return `https://cdn.example-img.test/${path}`;
}

export const WAVE1_FIXTURES: readonly Wave1FixtureSet[] = Object.freeze([
  {
    merchant: "kabum",
    advertiserName: "KaBuM",
    advertiserId: "900001",
    rows: [
      // 1) GTIN válido + brand+model + preço BR + URL/imagem válidas.
      {
        productId: "KBM-1001",
        advertiserId: "900001",
        advertiserName: "KaBuM",
        title: "Mouse Gamer Logitech G305 Lightspeed Sem Fio Preto",
        description: "Mouse gamer sem fio com sensor HERO",
        brand: "Logitech",
        model: "G305",
        gtin: "4006381333931",
        price: "249,90",
        currency: "BRL",
        productUrl: "https://www.kabum.com.br/produto/1001/mouse-logitech-g305",
        affiliateUrl: affUrl(
          "https://www.kabum.com.br/produto/1001/mouse-logitech-g305",
        ),
        imageUrls: img("kabum/g305-1.jpg"),
        category: "Perifericos",
      },
      // 2) GTIN ausente: identidade B via brand+model.
      {
        productId: "KBM-1002",
        advertiserId: "900001",
        advertiserName: "KaBuM",
        title: "Teclado Mecanico Redragon Kumara RGB ABNT2",
        brand: "Redragon",
        model: "K552",
        price: "189,90",
        currency: "BRL",
        productUrl: "https://www.kabum.com.br/produto/1002/teclado-redragon-k552",
        affiliateUrl: affUrl(
          "https://www.kabum.com.br/produto/1002/teclado-redragon-k552",
        ),
        imageUrls: img("kabum/k552-1.jpg"),
        category: "Perifericos",
      },
      // 3) brand + MPN (sem model).
      {
        productId: "KBM-1003",
        advertiserId: "900001",
        advertiserName: "KaBuM",
        title: "Webcam Logitech C920 Full HD Pro",
        brand: "Logitech",
        mpn: "C920",
        price: "399,99",
        currency: "BRL",
        productUrl: "https://www.kabum.com.br/produto/1003/webcam-logitech-c920",
        affiliateUrl: affUrl(
          "https://www.kabum.com.br/produto/1003/webcam-logitech-c920",
        ),
        imageUrls: img("kabum/c920-1.jpg"),
        category: "Perifericos",
      },
      // 4) externalId duplicado (mesmo productId do KBM-1001).
      {
        productId: "KBM-1001",
        advertiserId: "900001",
        advertiserName: "KaBuM",
        title: "Mouse Gamer Logitech G305 Reenvio Duplicado",
        price: "249,90",
        currency: "BRL",
        productUrl: "https://www.kabum.com.br/produto/1001/mouse-logitech-g305",
        imageUrls: img("kabum/g305-1.jpg"),
      },
      // 5) Preço internacional (USD) -> INVALID_CURRENCY.
      {
        productId: "KBM-1005",
        advertiserId: "900001",
        advertiserName: "KaBuM",
        title: "Monitor Dell 24 polegadas Full HD IPS",
        brand: "Dell",
        model: "SE2422H",
        price: "299.99",
        currency: "USD",
        productUrl: "https://www.kabum.com.br/produto/1005/monitor-dell-24",
        affiliateUrl: affUrl("https://www.kabum.com.br/produto/1005/monitor-dell-24"),
        imageUrls: img("kabum/dell24-1.jpg"),
        category: "Monitores",
      },
      // 6) URL inválida (javascript:) -> descartada pelo adapter -> INVALID_DESTINATION_URL.
      {
        productId: "KBM-1006",
        advertiserId: "900001",
        advertiserName: "KaBuM",
        title: "Headset Gamer HyperX Cloud Stinger 2",
        brand: "HyperX",
        model: "Cloud Stinger 2",
        price: "279,90",
        currency: "BRL",
        productUrl: "javascript:alert(1)",
        imageUrls: img("kabum/cloudstinger-1.jpg"),
      },
      // 7) Produto igual em duas lojas (par com LEV-4001: mesmo GTIN).
      {
        productId: "KBM-1007",
        advertiserId: "900001",
        advertiserName: "KaBuM",
        title: "Fone Bluetooth JBL Tune 520BT",
        brand: "JBL",
        model: "Tune 520BT",
        gtin: "7899875432107",
        price: "249,90",
        currency: "BRL",
        productUrl: "https://www.kabum.com.br/produto/1007/fone-jbl-tune-520bt",
        affiliateUrl: affUrl(
          "https://www.kabum.com.br/produto/1007/fone-jbl-tune-520bt",
        ),
        imageUrls: img("kabum/jbl520-1.jpg"),
        category: "Audio",
      },
      // 8) Modelos próximos: "G305 Lightspeed" != "G305" (nunca casar por proximidade).
      {
        productId: "KBM-1008",
        advertiserId: "900001",
        advertiserName: "KaBuM",
        title: "Mouse Logitech G305 Lightspeed Preto Oferta",
        brand: "Logitech",
        model: "G305 Lightspeed",
        price: "269,90",
        currency: "BRL",
        productUrl: "https://www.kabum.com.br/produto/1008/mouse-g305-lightspeed",
        affiliateUrl: affUrl(
          "https://www.kabum.com.br/produto/1008/mouse-g305-lightspeed",
        ),
        imageUrls: img("kabum/g305-2.jpg"),
        category: "Perifericos",
      },
    ],
  },
  {
    merchant: "cama-in-box",
    advertiserName: "Cama In Box",
    advertiserId: "900002",
    rows: [
      // brand+model, preço BR, URL/imagem válidas.
      {
        productId: "CIB-2001",
        advertiserId: "900002",
        advertiserName: "Cama In Box",
        title: "Colchao Queen Isopor Densidade Alta 19cm",
        brand: "Cama In Box",
        model: "Queen 19",
        price: "899,00",
        currency: "BRL",
        productUrl: "https://www.cama-in-box.com.br/produto/2001/colchao-queen",
        affiliateUrl: affUrl(
          "https://www.cama-in-box.com.br/produto/2001/colchao-queen",
        ),
        imageUrls: img("camainbox/queen19-1.jpg"),
        category: "Colchoes",
      },
      // Sem imagem -> PARTIAL (MISSING_IMAGE) -> REVIEW.
      {
        productId: "CIB-2002",
        advertiserId: "900002",
        advertiserName: "Cama In Box",
        title: "Travesseiro Viscoelastico Memory Foam Casal",
        brand: "Cama In Box",
        model: "Memory Foam Casal",
        price: "149,90",
        currency: "BRL",
        productUrl: "https://www.cama-in-box.com.br/produto/2002/travesseiro-memory",
        imageUrls: "",
      },
      // Sem identidade forte (só título) -> nível D -> REVIEW.
      {
        productId: "CIB-2003",
        advertiserId: "900002",
        advertiserName: "Cama In Box",
        title: "Kit 2 Lencol 400 Fios Casal Bege",
        price: "129,90",
        currency: "BRL",
        productUrl: "https://www.cama-in-box.com.br/produto/2003/kit-lencol-400",
        affiliateUrl: affUrl(
          "https://www.cama-in-box.com.br/produto/2003/kit-lencol-400",
        ),
        imageUrls: img("camainbox/lencol400-1.jpg"),
        category: "Roupa de Cama",
      },
    ],
  },
  {
    merchant: "olympikus",
    advertiserName: "Olympikus",
    advertiserId: "900003",
    rows: [
      // GTIN válido + brand+model.
      {
        productId: "OLY-3001",
        advertiserId: "900003",
        advertiserName: "Olympikus",
        title: "Tenis Olympikus Corre 3 Masculino",
        brand: "Olympikus",
        model: "Corre 3",
        gtin: "7891234567895",
        price: "199,90",
        currency: "BRL",
        productUrl: "https://www.olympikus.com.br/produto/3001/corre-3",
        affiliateUrl: affUrl("https://www.olympikus.com.br/produto/3001/corre-3"),
        imageUrls: img("olympikus/corre3-1.jpg"),
        category: "Tenis",
      },
      // brand + MPN.
      {
        productId: "OLY-3002",
        advertiserId: "900003",
        advertiserName: "Olympikus",
        title: "Tenis Olympikus Zero Ef Feminino Corrida",
        brand: "Olympikus",
        mpn: "OZEF-100",
        price: "229,90",
        currency: "BRL",
        productUrl: "https://www.olympikus.com.br/produto/3002/zero-ef",
        affiliateUrl: affUrl("https://www.olympikus.com.br/produto/3002/zero-ef"),
        imageUrls: img("olympikus/zeroef-1.jpg"),
        category: "Tenis",
      },
      // Semelhante mas diferente: Corre 4 != Corre 3.
      {
        productId: "OLY-3003",
        advertiserId: "900003",
        advertiserName: "Olympikus",
        title: "Tenis Olympikus Corre 4 Masculino",
        brand: "Olympikus",
        model: "Corre 4",
        price: "219,90",
        currency: "BRL",
        productUrl: "https://www.olympikus.com.br/produto/3003/corre-4",
        affiliateUrl: affUrl("https://www.olympikus.com.br/produto/3003/corre-4"),
        imageUrls: img("olympikus/corre4-1.jpg"),
        category: "Tenis",
      },
    ],
  },
  {
    merchant: "leveros",
    advertiserName: "Leveros",
    advertiserId: "900004",
    rows: [
      // Produto igual em duas lojas (par com KBM-1007: mesmo GTIN).
      {
        productId: "LEV-4001",
        advertiserId: "900004",
        advertiserName: "Leveros",
        title: "Fone Bluetooth JBL Tune 520BT",
        brand: "JBL",
        model: "Tune 520BT",
        gtin: "7899875432107",
        price: "259,90",
        currency: "BRL",
        productUrl: "https://www.leveros.com.br/produto/4001/fone-jbl-tune-520bt",
        affiliateUrl: affUrl(
          "https://www.leveros.com.br/produto/4001/fone-jbl-tune-520bt",
        ),
        imageUrls: img("leveros/jbl520-1.jpg"),
        category: "Audio",
      },
      // Cross-brand falso positivo: mesmo modelo, marca diferente (vs Positivo).
      {
        productId: "LEV-4002",
        advertiserId: "900004",
        advertiserName: "Leveros",
        title: "Smart TV 50 polegadas 4K Ultra HD",
        brand: "Samsung",
        model: "50UT8800",
        price: "2199,00",
        currency: "BRL",
        productUrl: "https://www.leveros.com.br/produto/4002/smart-tv-50-4k",
        affiliateUrl: affUrl("https://www.leveros.com.br/produto/4002/smart-tv-50-4k"),
        imageUrls: img("leveros/tv50-1.jpg"),
        category: "TVs",
      },
      // GTIN conflitante: mesmo GTIN do KBM-1001, marca diferente.
      {
        productId: "LEV-4003",
        advertiserId: "900004",
        advertiserName: "Leveros",
        title: "Mouse Sem Fio Genius DX-120",
        brand: "Genius",
        model: "DX-120",
        gtin: "4006381333931",
        price: "59,90",
        currency: "BRL",
        productUrl: "https://www.leveros.com.br/produto/4003/mouse-genius-dx120",
        affiliateUrl: affUrl(
          "https://www.leveros.com.br/produto/4003/mouse-genius-dx120",
        ),
        imageUrls: img("leveros/dx120-1.jpg"),
        category: "Perifericos",
      },
      // Preço inválido (0) -> INVALID_PRICE.
      {
        productId: "LEV-4004",
        advertiserId: "900004",
        advertiserName: "Leveros",
        title: "Luminaria LED Mesa Flex 10W",
        brand: "Leveros",
        model: "Flex 10W",
        price: "0",
        currency: "BRL",
        productUrl: "https://www.leveros.com.br/produto/4004/luminaria-flex-10w",
        imageUrls: img("leveros/flex10-1.jpg"),
      },
      // Item válido genérico.
      {
        productId: "LEV-4005",
        advertiserId: "900004",
        advertiserName: "Leveros",
        title: "Kit Organizador de Geladeira 6 Potes Empilhavel",
        brand: "Leveros",
        model: "ORG-6",
        price: "89,90",
        currency: "BRL",
        productUrl: "https://www.leveros.com.br/produto/4005/organizador-6-potes",
        affiliateUrl: affUrl(
          "https://www.leveros.com.br/produto/4005/organizador-6-potes",
        ),
        imageUrls: img("leveros/org6-1.jpg"),
        category: "Casa",
      },
    ],
  },
]);

export function fixtureSetFor(merchant: MerchantSlug): Wave1FixtureSet {
  const found = WAVE1_FIXTURES.find((f) => f.merchant === merchant);
  if (!found) throw new Error(`FIXTURE_MISSING: ${merchant}`);
  return found;
}

export function totalFixtureRows(): number {
  return WAVE1_FIXTURES.reduce((acc, f) => acc + f.rows.length, 0);
}
