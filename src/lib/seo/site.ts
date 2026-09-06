export const SITE_URL = "https://ofertano.vercel.app";

export function siteUrl(caminho: string): string {
  if (/^https?:\/\//i.test(caminho)) {
    return caminho;
  }

  return `${SITE_URL}${caminho.startsWith("/") ? "" : "/"}${caminho}`;
}