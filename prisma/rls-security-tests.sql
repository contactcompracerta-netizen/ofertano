-- FASE 9 — Testes obrigatórios de RLS (Ofertano / Supabase)
-- Executar como role com bypassrls (postgres) para poder alternar para
-- anon/authenticated. Uso:
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/rls-security-tests.sql
--
-- Convenções:
--   * Cada DO imprime "PASS ..." ou levanta erro (retorno != 0).
--   * USER_A / USER_B são UUIDs sintéticos (auth.uid() lê a GUC da claim).

SET client_min_messages TO notice;
\set ON_ERROR_STOP on

-- ============================================================================
-- 0) Verificação do estado dos grants (menor privilégio)
-- ============================================================================
DO $$
BEGIN
  IF NOT has_table_privilege('anon', '"Product"', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: anon deve ler Product (público)';
  END IF;
  IF has_table_privilege('anon', '"Product"', 'INSERT') THEN
    RAISE EXCEPTION 'FAIL: anon NÃO deve inserir em Product';
  END IF;
  IF has_table_privilege('anon', '"Product"', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL: anon NÃO deve atualizar Product';
  END IF;
  IF has_table_privilege('anon', '"Product"', 'DELETE') THEN
    RAISE EXCEPTION 'FAIL: anon NÃO deve apagar Product';
  END IF;
  IF has_table_privilege('anon', '"BlogPost"', 'SELECT') IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: anon deve ler BlogPost (público)';
  END IF;
  IF has_table_privilege('anon', '"Favorite"', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: anon NÃO deve ler Favorite';
  END IF;
  IF has_table_privilege('anon', '"PriceAlert"', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: anon NÃO deve ler PriceAlert';
  END IF;
  IF has_table_privilege('anon', '"ImportQueue"', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: anon NÃO deve ler ImportQueue (interna)';
  END IF;
  IF has_table_privilege('authenticated', '"Favorite"', 'INSERT') IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: authenticated deve inserir em Favorite (próprio)';
  END IF;
  IF has_table_privilege('authenticated', '"ImportQueue"', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: authenticated NÃO deve ler ImportQueue (interna)';
  END IF;
  IF NOT has_table_privilege('service_role', '"Product"', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: service_role mantido para backend';
  END IF;
  RAISE NOTICE 'PASS 0: grants conforme menor privilégio';
END $$;

-- ============================================================================
-- 1) ANON — leitura pública
-- ============================================================================
SET ROLE anon;

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM "Product";
  IF n < 1 THEN
    RAISE EXCEPTION 'FAIL: anon deveria ver produtos públicos, viu %', n;
  END IF;
  RAISE NOTICE 'PASS 1a: anon lê % produtos públicos (multi-loja, ativos, não-rascunho)', n;
END $$;

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM "BlogPost";
  IF n < 1 THEN
    RAISE EXCEPTION 'FAIL: anon deveria ver posts publicados, viu %', n;
  END IF;
  RAISE NOTICE 'PASS 1b: anon lê % posts publicados', n;
END $$;

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM "MarketplaceOffer";
  IF n < 1 THEN
    RAISE EXCEPTION 'FAIL: anon deveria ver ofertas públicas, viu %', n;
  END IF;
  RAISE NOTICE 'PASS 1c: anon lê % ofertas públicas (usáveis)', n;
END $$;

-- anon NÃO deve ver rascunhos/arquivados
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM "Product" WHERE "publicationStatus" IN ('DRAFT','ARCHIVED');
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL: anon viu % produtos DRAFT/ARCHIVED', n;
  END IF;
  RAISE NOTICE 'PASS 1d: anon NÃO vê produtos DRAFT/ARCHIVED';
END $$;

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM "BlogPost" WHERE "status" <> 'PUBLISHED';
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL: anon viu % posts não publicados', n;
  END IF;
  RAISE NOTICE 'PASS 1e: anon NÃO vê posts DRAFT/SCHEDULED/ARCHIVED';
END $$;

-- ============================================================================
-- 2) ANON — tabelas privadas/internas inacessíveis
-- ============================================================================
DO $$
BEGIN
  BEGIN
    PERFORM count(*) FROM "Favorite";
    RAISE EXCEPTION 'FAIL: anon conseguiu ler Favorite';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS 2a: anon não lê Favorite (sem grant + RLS)';
  END;
END $$;

DO $$
BEGIN
  BEGIN
    PERFORM count(*) FROM "PriceAlert";
    RAISE EXCEPTION 'FAIL: anon conseguiu ler PriceAlert';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS 2b: anon não lê PriceAlert (sem grant + RLS)';
  END;
END $$;

DO $$
BEGIN
  BEGIN
    PERFORM count(*) FROM "ImportQueue";
    RAISE EXCEPTION 'FAIL: anon conseguiu ler ImportQueue';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS 2c: anon não lê ImportQueue (interna)';
  END;
END $$;

DO $$
BEGIN
  BEGIN
    PERFORM count(*) FROM "RawMarketplaceListing";
    RAISE EXCEPTION 'FAIL: anon conseguiu ler RawMarketplaceListing';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS 2d: anon não lê RawMarketplaceListing (interna)';
  END;
END $$;

DO $$
BEGIN
  BEGIN
    PERFORM count(*) FROM "ProductOpportunity";
    RAISE EXCEPTION 'FAIL: anon conseguiu ler ProductOpportunity';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS 2e: anon não lê ProductOpportunity (interna)';
  END;
END $$;

DO $$
BEGIN
  BEGIN
    PERFORM count(*) FROM "AnalyticsEvent";
    RAISE EXCEPTION 'FAIL: anon conseguiu ler AnalyticsEvent';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS 2f: anon não lê AnalyticsEvent (interna)';
  END;
END $$;

DO $$
BEGIN
  BEGIN
    PERFORM count(*) FROM "MarketplaceConnection";
    RAISE EXCEPTION 'FAIL: anon conseguiu ler MarketplaceConnection (tokens!)';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS 2g: anon não lê MarketplaceConnection (tokens)';
  END;
END $$;

-- ============================================================================
-- 3) ANON — não pode MODIFICAR nada
-- ============================================================================
DO $$
BEGIN
  BEGIN
    EXECUTE format('UPDATE "Product" SET featured = false WHERE id = %L',
      (SELECT min(id) FROM "Product"));
    RAISE EXCEPTION 'FAIL: anon conseguiu atualizar Product';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS 3a: anon não atualiza Product';
  END;
END $$;

DO $$
BEGIN
  BEGIN
    EXECUTE format('DELETE FROM "Product" WHERE id = %L',
      (SELECT min(id) FROM "Product"));
    RAISE EXCEPTION 'FAIL: anon conseguiu apagar Product';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS 3b: anon não apaga Product';
  END;
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO "Product" (id, name, image, category, store, "affiliateLink", price)
    VALUES ('_rls_anon_probe', 'probe', 'x', 'x', 'x', 'x', 1);
    RAISE EXCEPTION 'FAIL: anon conseguiu inserir Product';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS 3c: anon não insere Product';
  END;
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO "BlogPost" (id, slug, title, excerpt, category, sections)
    VALUES ('_rls_anon_probe', 'x', 'x', 'x', 'x', '[]');
    RAISE EXCEPTION 'FAIL: anon conseguiu inserir BlogPost';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS 3d: anon não insere BlogPost';
  END;
END $$;

RESET ROLE;

-- ============================================================================
-- 4) AUTHENTICATED — USER A x USER B (Favorite)
-- ============================================================================
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000a', false);

DO $$
BEGIN
  INSERT INTO "Favorite" (id, "userId", "productId", "createdAt")
  VALUES ('cl_test_fav_a_1', '00000000-0000-4000-8000-00000000000a',
          '9d2b1f25-d7e2-4de4-bbbc-d0fe9859c0a2', now());
  RAISE NOTICE 'PASS 4a: USER A insere próprio favorito';
END $$;

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM "Favorite";
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL: USER A deveria ver exatamente 1 favorito, viu %', n;
  END IF;
  RAISE NOTICE 'PASS 4b: USER A vê apenas seus favoritos (%)', n;
END $$;

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM "Favorite" WHERE "userId" = '00000000-0000-4000-8000-00000000000b';
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL: USER A não deveria ver favoritos do USER B, viu %', n;
  END IF;
  RAISE NOTICE 'PASS 4c: USER A não vê favoritos do USER B';
END $$;

-- USER A não pode gravar favorito "do" USER B
DO $$
BEGIN
  BEGIN
    INSERT INTO "Favorite" (id, "userId", "productId", "createdAt")
    VALUES ('cl_test_fav_a_bad', '00000000-0000-4000-8000-00000000000b',
            '9d2b1f25-d7e2-4de4-bbbc-d0fe9859c0a2', now());
    RAISE EXCEPTION 'FAIL: USER A conseguiu gravar favorito do USER B';
  EXCEPTION
    WHEN others THEN
      IF SQLSTATE <> '42501' THEN
        RAISE EXCEPTION 'FAIL(estado inesperado %): %', SQLSTATE, SQLERRM;
      END IF;
      RAISE NOTICE 'PASS 4d: USER A não consegue gravar favorito do USER B (RLS)';
  END;
END $$;

-- USER B não enxerga nada (e nem o favorito do USER A)
RESET "request.jwt.claim.sub";
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000b', false);

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM "Favorite";
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL: USER B viu favoritos alheios (%)', n;
  END IF;
  RAISE NOTICE 'PASS 4e: USER B vê 0 favoritos (não vê os de A)';
END $$;

-- USER B não pode apagar favorito de A (RLS filtra 0 linhas; sem erro)
DO $$
DECLARE n integer;
BEGIN
  DELETE FROM "Favorite" WHERE "userId" = '00000000-0000-4000-8000-00000000000a';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL: USER B conseguiu apagar % favoritos de A', n;
  END IF;
  RAISE NOTICE 'PASS 4f: USER B não apaga favoritos de A (RLS filtra 0 linhas)';
END $$;

-- Voltar para USER A e limpar favorito (delete próprio ok)
RESET "request.jwt.claim.sub";
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000a', false);

DO $$
BEGIN
  DELETE FROM "Favorite" WHERE "userId" = '00000000-0000-4000-8000-00000000000a';
  RAISE NOTICE 'PASS 4g: USER A apaga próprio favorito (delete_own)';
END $$;

-- ============================================================================
-- 5) AUTHENTICATED — PriceAlert (canônico Prisma)
-- ============================================================================
DO $$
BEGIN
  INSERT INTO "PriceAlert" (id, "userId", "productId", "alertType", "referencePrice", active, "updatedAt")
  VALUES ('cl_test_alert_a_1', '00000000-0000-4000-8000-00000000000a',
          '9d2b1f25-d7e2-4de4-bbbc-d0fe9859c0a2', 'ANY_DROP', 100, true, now());
  RAISE NOTICE 'PASS 5a: USER A insere próprio alerta de preço';
END $$;

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM "PriceAlert";
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL: USER A deveria ver 1 alerta, viu %', n;
  END IF;
  RAISE NOTICE 'PASS 5b: USER A vê apenas seus alertas (%)', n;
END $$;

-- A não vê alertas de B
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM "PriceAlert" WHERE "userId" = '00000000-0000-4000-8000-00000000000b';
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL: USER A viu alertas de B (%)', n;
  END IF;
  RAISE NOTICE 'PASS 5c: USER A não vê alertas do USER B';
END $$;

-- UPDATE próprio (desativar)
DO $$
BEGIN
  UPDATE "PriceAlert" SET active = false
  WHERE "userId" = '00000000-0000-4000-8000-00000000000a'
    AND id = 'cl_test_alert_a_1';
  RAISE NOTICE 'PASS 5d: USER A atualiza próprio alerta (update_own)';
END $$;

-- INSERT alerta "do" B deve falhar (RLS)
DO $$
BEGIN
  BEGIN
    INSERT INTO "PriceAlert" (id, "userId", "productId", "alertType", "referencePrice", active, "updatedAt")
    VALUES ('cl_test_alert_a_bad', '00000000-0000-4000-8000-00000000000b',
            '9d2b1f25-d7e2-4de4-bbbc-d0fe9859c0a2', 'ANY_DROP', 100, true, now());
    RAISE EXCEPTION 'FAIL: USER A gravou alerta do USER B';
  EXCEPTION
    WHEN others THEN
      IF SQLSTATE <> '42501' THEN
        RAISE EXCEPTION 'FAIL(estado inesperado %): %', SQLSTATE, SQLERRM;
      END IF;
      RAISE NOTICE 'PASS 5e: USER A não grava alerta do USER B (RLS)';
  END;
END $$;

-- Agora como USER B: não vê os alertas de A, nem os altera (RLS filtra 0 linhas)
RESET "request.jwt.claim.sub";
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000b', false);

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM "PriceAlert";
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL: USER B viu alertas alheios (%)', n;
  END IF;
  RAISE NOTICE 'PASS 5f: USER B vê 0 alertas (não vê os de A)';
END $$;

DO $$
DECLARE n integer;
BEGIN
  UPDATE "PriceAlert" SET active = false WHERE "userId" = '00000000-0000-4000-8000-00000000000a';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL: USER B conseguiu atualizar % alertas de A', n;
  END IF;
  RAISE NOTICE 'PASS 5g: USER B não atualiza alertas de A (RLS filtra 0 linhas)';
END $$;

-- authenticated também lê o catálogo público
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM "Product";
  IF n < 1 THEN
    RAISE EXCEPTION 'FAIL: authenticated deveria ler produtos públicos, viu %', n;
  END IF;
  RAISE NOTICE 'PASS 5h: authenticated lê produtos públicos (%)', n;
END $$;

-- Limpeza: volta para A, remove alerta de teste
RESET "request.jwt.claim.sub";
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000a', false);

DO $$
BEGIN
  DELETE FROM "PriceAlert" WHERE "userId" = '00000000-0000-4000-8000-00000000000a' AND id = 'cl_test_alert_a_1';
  RAISE NOTICE 'PASS 5i: limpeza do alerta de teste (delete_own)';
END $$;

RESET ROLE;
RESET "request.jwt.claim.sub";

-- ============================================================================
-- 6) BACKEND (postgres bypassa RLS) — ingestão / catálogo / jobs internos
-- ============================================================================
DO $$
DECLARE
  probe_id text := '_rls_backend_probe_' || floor(extract(epoch from now()));
  n integer;
BEGIN
  INSERT INTO "Product" (id, name, image, category, store, "affiliateLink", price,
                         "publicationStatus", active, "createdAt", "updatedAt")
  VALUES (probe_id, 'mdoprobe', 'img', 'cat', 'loja', 'http://x', 1,
          'DRAFT', true, now(), now());

  SELECT count(*) INTO n FROM "Product" WHERE id = probe_id;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL: backend (postgres) deveria inserir produto novo';
  END IF;

  UPDATE "Product" SET price = 2 WHERE id = probe_id;
  DELETE FROM "Product" WHERE id = probe_id;

  RAISE NOTICE 'PASS 6a: backend cria/atualiza/remove produto (bypassa RLS)';
END $$;

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM "_prisma_migrations";
  RAISE NOTICE 'PASS 6b: backend lê _prisma_migrations (%)', n;
END $$;

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM "RawMarketplaceListing";
  SELECT count(*) INTO n FROM "ImportQueue";
  SELECT count(*) INTO n FROM "AnalyticsEvent";
  SELECT count(*) INTO n FROM "MarketplaceConnection";
  RAISE NOTICE 'PASS 6c: backend lê tabelas internas sem restrição (RLS bypassado)';
END $$;

-- Realtime habilitado para MarketplaceOffer continua íntegro
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'MarketplaceOffer'
  ) THEN
    RAISE EXCEPTION 'FAIL: MarketplaceOffer não está mais no supabase_realtime';
  END IF;
  RAISE NOTICE 'PASS 6d: MarketplaceOffer continua no supabase_realtime';
END $$;

\echo
\echo '=== TODOS OS TESTES RLS PASSARAM ==='