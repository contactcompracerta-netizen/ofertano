-- =====================================================================
-- FIX — Product public read policy (multi-loja)
--
-- A migration 20260915194500 usava:
--   EXISTS (SELECT 1 ... GROUP BY o."marketplace" HAVING count(*) >= 2)
-- onde count(*) conta linhas DENTRO de cada grupo (1 por marketplace),
-- tornando o predicado sempre falso. Corrige para agregar sobre TODAS
-- as ofertas do produto sem GROUP BY:
--   EXISTS (SELECT 1 ... HAVING count(DISTINCT o."marketplace") >= 2)
-- que conta marketplaces distintos entre as ofertas válidas visíveis
-- (abaixo do RLS de "MarketplaceOffer"), equivalente ao
-- hasPublicMultiStore do app.
--
-- Resultado verificado: 4 produtos públicos (Cabo, Samsung A57,
-- Moto G17, Samsung A07). "Fone Dapon" está inativo no catálogo e,
-- por isso, continua oculto (correto).
-- =====================================================================

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
      HAVING count(DISTINCT o."marketplace") >= 2
    )
  );