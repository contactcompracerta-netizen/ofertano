import type { NextConfig } from "next";

/*
 * HOSTS DE IMAGEM AUTORIZADOS PELO OTIMIZADOR
 *
 * `next/image` só otimiza (e só serve) imagens de host listado aqui. Fora da
 * lista, o otimizador responde HTTP 400 (`"url" parameter is not allowed`) e
 * o `<img>` fica QUEBRADO na tela.
 *
 * A lista precisa cobrir os CDNs REAIS que os marketplaces entregam. Ela
 * ficava só com `http2.mlstatic.com`/`http.mlstatic.com`, mas o catálogo
 * entrega imagens em `a-static.mlcdn.com.br` (Mercado Livre) e
 * `cf.shopee.com.br` (Shopee) — o único produto público do catálogo publicava
 * justamente com a imagem do `a-static.mlcdn.com.br`, ou seja, a vitrine
 * abria com imagem quebrada.
 *
 * Só HTTPS, e só domínios de CDN de marketplace, sem host arbitrário.
 */
const HOSTS_DE_IMAGEM_DE_MARKETPLACE = [
  "http2.mlstatic.com",
  "http.mlstatic.com",
  "a-static.mlcdn.com.br",
  "static.mercadolivre.com.br",
  "cf.shopee.com.br",
  "down-sg.v2.sgotic-company.com",
  "m.media-amazon.com",
  "images-na.ssl-images-amazon.com",
  "m.media-amazon.com.br",
  "http2.ssl-images-amazon.com",
  "s3-sa-east-1.wl-media.net",
  "www.magazinevoce.com.br",
  "www.magazineluiza.com.br",
  "d26lpennugtm8s.cloudfront.net",
  "http2.mlstatic.com.br",
  "img.magazineluiza.com.br",
] as const;

const nextConfig: NextConfig = {
  images: {
    remotePatterns: HOSTS_DE_IMAGEM_DE_MARKETPLACE.map((hostname) => ({
      protocol: "https" as const,
      hostname,
    })),
  },
  async headers() {
    return [
      {
        source: "/admin/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
