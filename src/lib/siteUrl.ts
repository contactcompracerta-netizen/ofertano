const ORIGEM_PADRAO = "https://ofertano.vercel.app";

export function siteOrigin(): string {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  return (
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    ORIGEM_PADRAO
  ).replace(/\/$/, "");
}

export function siteUrl(caminho: string): string {
  const origem = siteOrigin();

  if (/^https?:\/\//i.test(caminho)) {
    return caminho;
  }

  return `${origem}${caminho.startsWith("/") ? "" : "/"}${caminho}`;
}