/*
 * Rotas públicas estáticas e rotas privadas excluídas do índice.
 *
 * Mantidas num módulo sem dependência de banco para que a política de
 * roteamento do sitemap possa ser testada isoladamente (sem conectar ao
 * banco nem instanciar instabilidades externas).
 */

export const ROTAS_ESTATICAS_PUBLICAS = [
  "/",
  "/categorias",
  "/ofertas",
  "/blog",
  "/sobre",
  "/contato",
  "/termos",
  "/politica-de-privacidade",
] as const;

/*
 * Prefixos de rota que nunca devem aparecer no sitemap (nem ser indexados).
 * A rota /seguranca está aqui por renderizar conteúdo de produto legado sem
 * parâmetro [id]; é noindex até ganhar conteúdo próprio.
 */
export const ROTAS_PRIVADAS_EXCLUIDAS = [
  "/admin",
  "/api",
  "/login",
  "/favoritos",
  "/recuperar-senha",
  "/seguranca",
] as const;

export function rotaPrivadaExcluidaDoSitemap(caminho: string): boolean {
  return ROTAS_PRIVADAS_EXCLUIDAS.some(
    (rota) => caminho === rota || caminho.startsWith(`${rota}/`),
  );
}