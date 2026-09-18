-- =====================================================================
-- RLS SECURITY HARDENING — Ofertano / Supabase Postgres
-- Projeto: ujskptfrbbaslvqrqzxa (banco de catálogo usado via Prisma)
--
-- Objetivo: eliminar a exposição pública indevida causada pelos grants
-- padrão do Supabase (anon e authenticated recebem CRUD completo em toda
-- tabela do schema public) combinados com RLS desligado.
--
-- Princípios seguidos:
--   * NÃO destrutivo: não apaga tabelas/colunas/linhas; políticas são
--     recriadas com DROP IF EXISTS apenas quando este script re-executa.
--   * Menor privilégio: anon/authenticated só mantêm o estritamente
--     necessário; service_role e postgres (backend Prisma) intactos.
--   * Preserva as tabelas legadas `price_alerts` e `notifications`, que
--     já possuíam RLS e políticas de ownership corretas — NÃO são tocadas.
--   * Idempotente e reproduzível via `prisma migrate`.
--
-- Risco registrado (não bloqueia): /produto/[id] usa o critério de
-- navegação `active = true OR publicationStatus = 'DRAFT'` antes da checagem
-- final de multi-loja. A policy de leitura pública de Product adota o
-- predicado das superfícies canônicas (Home, ofertas, categorias, busca,
-- sitemap): active + não DRAFT/ARCHIVED + multi-loja. Ver relatório.
-- =====================================================================

--------------------------------------------------------------------------------
-- 1) HABILITAR ROW LEVEL SECURITY EM TODAS AS TABELAS GERENCIADAS
--    (configuração idempotente; re-executar não causa erro).
--------------------------------------------------------------------------------
ALTER TABLE "Product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BlogPost" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketplaceOffer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketplaceConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RawMarketplaceListing" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductOpportunity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ImportQueue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SearchRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PriceHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PriceAlert" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PriceAlertEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Favorite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AnalyticsEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AnalyticsDailyAgg" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AnalyticsSessionDay" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SocialPost" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdminPushSubscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdminPushDispatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;

--------------------------------------------------------------------------------
-- 2) POLICIES — PUBLIC READ (anon e authenticated)
--    Só estes dois modelos são conteúdos públicos do Ofertano.
--------------------------------------------------------------------------------

-- Produto: somente produtos que aparecem nas superfícies públicas
-- (mesmo predicado da Home / sitemap / catálogo / busca):
--   * ativo
--   * status de publicação não DRAFT nem ARCHIVED
--   * com ao menos DUAS ofertas válidas em marketplaces DISTINTOS
-- A subquery usa a policy de "MarketplaceOffer" abaixo (RLS de
-- MarketplaceOffer também se aplica durante a avaliação desta policy).
DROP POLICY IF EXISTS "product_public_read" ON "Product";
CREATE POLICY "product_public_read" ON "Product"
  FOR SELECT
  TO anon, authenticated
  USING (
    "active" = true
    AND "publicationStatus" NOT IN ('DRAFT', 'ARCHIVED')
    AND "price" > 0
    AND "image" IS NOT NULL
    AND "image" <> ''
    AND EXISTS (
      SELECT 1
      FROM "MarketplaceOffer" o
      WHERE o."productId" = "Product"."id"
      GROUP BY o."marketplace"
      HAVING count(DISTINCT o."marketplace") >= 2
    )
  );

-- BlogPost: apenas posts efetivamente publicados (campo real de
-- publicação = status PUBLISHED + publishedAt no passado). Mesmo filtro
-- usado por src/services/blog/public.ts.
DROP POLICY IF EXISTS "blog_post_public_read" ON "BlogPost";
CREATE POLICY "blog_post_public_read" ON "BlogPost"
  FOR SELECT
  TO anon, authenticated
  USING (
    "status" = 'PUBLISHED'
    AND "publishedAt" <= now()
  );

-- MarketplaceOffer: ofertas "usáveis" publicamente (mesmo critério de
-- isUsablePublicOffer em multiStoreVisibility.ts). Necessária para a
-- policy de Product enxergar as ofertas válidas via RLS. Apenas SELECT.
DROP POLICY IF EXISTS "marketplace_offer_public_read" ON "MarketplaceOffer";
CREATE POLICY "marketplace_offer_public_read" ON "MarketplaceOffer"
  FOR SELECT
  TO anon, authenticated
  USING (
    "active" = true
    AND "available" = true
    AND "matchStatus" = 'EXACT'
    AND "status" NOT IN ('UNAVAILABLE', 'ERROR')
    AND "price" > 0
  );

--------------------------------------------------------------------------------
-- 3) POLICIES — USER PRIVATE (authenticated apenas; anon NUNCA)
--------------------------------------------------------------------------------

-- Favorite: usuário só vê/insere/remove os PRÓPRIOS favoritos.
-- Proprietário real da linha = "userId" (text com uuid do auth.users).
DROP POLICY IF EXISTS "favorite_select_own" ON "Favorite";
CREATE POLICY "favorite_select_own" ON "Favorite"
  FOR SELECT
  TO authenticated
  USING (auth.uid()::text = "userId");

DROP POLICY IF EXISTS "favorite_insert_own" ON "Favorite";
CREATE POLICY "favorite_insert_own" ON "Favorite"
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid()::text = "userId");

DROP POLICY IF EXISTS "favorite_delete_own" ON "Favorite";
CREATE POLICY "favorite_delete_own" ON "Favorite"
  FOR DELETE
  TO authenticated
  USING (auth.uid()::text = "userId");

-- PriceAlert (tabela canônica via Prisma): usuário só opera os próprios
-- alertas. O caminho real do app é a API canônica /api/price-alerts
-- (backend/postgres, que ignora RLS). Estas policies garantem que um
-- acesso direto via REST authenticated ainda fique isolado ao dono.
DROP POLICY IF EXISTS "price_alert_select_own" ON "PriceAlert";
CREATE POLICY "price_alert_select_own" ON "PriceAlert"
  FOR SELECT
  TO authenticated
  USING (auth.uid()::text = "userId");

DROP POLICY IF EXISTS "price_alert_insert_own" ON "PriceAlert";
CREATE POLICY "price_alert_insert_own" ON "PriceAlert"
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid()::text = "userId");

DROP POLICY IF EXISTS "price_alert_update_own" ON "PriceAlert";
CREATE POLICY "price_alert_update_own" ON "PriceAlert"
  FOR UPDATE
  TO authenticated
  USING (auth.uid()::text = "userId")
  WITH CHECK (auth.uid()::text = "userId");

DROP POLICY IF EXISTS "price_alert_delete_own" ON "PriceAlert";
CREATE POLICY "price_alert_delete_own" ON "PriceAlert"
  FOR DELETE
  TO authenticated
  USING (auth.uid()::text = "userId");

--------------------------------------------------------------------------------
-- 4) GRANTS — PRINCÍPIO DO MENOR PRIVILÉGIO
--    Remover o CRUD completo que o Supabase concede por padrão a
--    anon/authenticated em TODAS as tabelas gerenciadas. As tabelas
--    legadas `price_alerts` e `notifications` NÃO são incluídas aqui e
--    permanecem exatamente como estão (já restritas e com RLS).
--------------------------------------------------------------------------------
REVOKE ALL PRIVILEGES ON TABLE
  "Product",
  "BlogPost",
  "MarketplaceOffer",
  "MarketplaceConnection",
  "RawMarketplaceListing",
  "ProductOpportunity",
  "ImportQueue",
  "SearchRequest",
  "PriceHistory",
  "PriceAlert",
  "PriceAlertEvent",
  "Favorite",
  "AnalyticsEvent",
  "AnalyticsDailyAgg",
  "AnalyticsSessionDay",
  "SocialPost",
  "AdminPushSubscription",
  "AdminPushDispatch",
  "_prisma_migrations"
FROM anon, authenticated;

-- Restaurar somente o necessário:
--   * anon e authenticated: leitura pública de catálogo/blog/ofertas.
--   * authenticated: CRUD escopado por RLS nos próprios dados.
GRANT SELECT ON
  "Product",
  "BlogPost",
  "MarketplaceOffer"
TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON "Favorite" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON "PriceAlert" TO authenticated;

--------------------------------------------------------------------------------
-- 5) DEFAULT PRIVILEGES — FUTURAS TABELAS (via Prisma/postgres)
--    Evita que tabelas/sequências/funções/tipos criados futuramente por
--    postgres voltem a expor anon/authenticated automaticamente.
--------------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TYPES FROM anon, authenticated;

--------------------------------------------------------------------------------
-- 6) PERFORMANCE — policy de ownership
--    Favorite não possuía índice por "userId"; a policy
--    favorite_select_own/delete_own filtra por essa coluna.
--    PriceAlert já possui o índice único ("userId","productId"),
--    então não recebe índice novo (evita duplicidade).
--------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "Favorite_userId_idx" ON "Favorite"("userId");