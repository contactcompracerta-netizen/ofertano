-- Idempotente: habilita MarketplaceOffer no Supabase Realtime
-- para o CTA ao vivo da página de produto (postgres_changes).
-- Não executar automaticamente neste worktree.
--
-- ProductLivePurchase só precisa de INSERT/UPDATE e em seguida
-- refaz o fetch de /api/products/[id]/live-offers. Não usa
-- payload.old nem DELETE, portanto a identidade de réplica
-- permanece a padrão da tabela.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'MarketplaceOffer'
  ) THEN
    ALTER PUBLICATION supabase_realtime
    ADD TABLE "MarketplaceOffer";
  END IF;
END $$;
