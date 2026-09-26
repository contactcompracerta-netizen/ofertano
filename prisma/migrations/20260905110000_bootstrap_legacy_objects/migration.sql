-- BOOTSTRAP_DATABASE_RECONCILIATION — RETROACTIVE FORWARD (pending em produção)
--
-- PROBLEMA: `prisma migrate deploy` em PostgreSQL VAZIO falha. Migrations
-- posteriores referenciam objetos/roles/schemas/funções que NENHUMA migration
-- cria. Eles só existiam em bancos construídos fora da cadeia versionada.
--
-- CLASSIFICAÇÃO: esta migration é RETROACTIVE. Ela precisa ocupar uma posição
-- ANTES de 20260905120000_price_alerts (que faz ALTER TYPE sobre o enum), mas
-- em produção as migrations posteriores JÁ RODARAM. Logo ela precisa aceitar
-- com segurança tanto o PRE-SHAPE (banco vazio) quanto o POST-SHAPE (produção).
--
-- INVENTÁRIO COMPLETO dos gaps (reprodução iterativa em banco descartável;
-- cada forma lida da PRÓPRIA produção, read-only):
--   1. PriceAlertType  (enum)    5. Favorite        (tabela fantasma)
--   2. PriceAlert      (tabela)  6. roles anon/authenticated
--   3. SocialPost_dayKey_key     7. schema auth
--   4. PriceAlertEvent (tabela)  8. auth.uid()/auth.role()
--   PriceAlertEvent e Favorite não existem em NENHUM artefato versionado
--   (nem migration, nem initial-schema.sql, nem schema.prisma).
--
-- SEGURANÇA: fail-closed. Nunca "IF EXISTS genérico": enum/tabela/coluna/
-- constraint com shape inesperado aborta com RAISE EXCEPTION.
--
-- POST-SHAPE de PriceAlert e as FKs de Favorite/PriceAlertEvent foram lidos de
-- produção (read-only) e conferidos contra scripts/bootstrap/local-legacy-tables.sql.

-- 1) PriceAlertType — aceita os dois estados COMPREENHÍDOS:
--    PRE : ANY_DROP, TARGET_PRICE
--    POST: ANY_DROP, TARGET_PRICE, TARGET   (TARGET é adicionado por 20260905120000)
--    Qualquer label fora desse conjunto é inesperado -> fail-closed.
DO $$
DECLARE unexpected text; required_missing text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PriceAlertType') THEN
    CREATE TYPE "PriceAlertType" AS ENUM ('ANY_DROP', 'TARGET_PRICE');
  ELSE
    SELECT string_agg(v.enumlabel, ',') INTO unexpected
      FROM pg_type t JOIN pg_enum v ON v.enumtypid = t.oid
     WHERE t.typname = 'PriceAlertType'
       AND v.enumlabel NOT IN ('ANY_DROP', 'TARGET', 'TARGET_PRICE');
    IF unexpected IS NOT NULL THEN
      RAISE EXCEPTION
        'BOOTSTRAP_FAIL_CLOSED: PriceAlertType existe com valores inesperados: %', unexpected;
    END IF;
    -- Ambos os shapes exigem estes dois rótulos.
    SELECT string_agg(r.l, ',') INTO required_missing
      FROM unnest(ARRAY['ANY_DROP','TARGET_PRICE']) AS r(l)
     WHERE NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum v ON v.enumtypid = t.oid
                        WHERE t.typname = 'PriceAlertType' AND v.enumlabel = r.l);
    IF required_missing IS NOT NULL THEN
      RAISE EXCEPTION
        'BOOTSTRAP_FAIL_CLOSED: PriceAlertType sem rotulos requeridos: %', required_missing;
    END IF;
  END IF;
END $$;

-- 2) PriceAlert — DUAL-SHAPE. Exatamente UM destes estados e valido:
--      PRE : coluna "type"     presente, "alertType" ausente
--      POST: coluna "alertType" presente, "type"     ausente
--    As DUAS -> fail-closed.  NENHUMA -> fail-closed.  Shape incompativel -> fail-closed.
--    PRE  -> valida e NAO faz nada (20260905120000 faz o RENAME).
--    POST -> valida e no-op estrutural.
DO $$
DECLARE has_type boolean; has_alert boolean; missing_cols text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='PriceAlert') THEN
    -- Ausente: criar o PRE-SHAPE. 20260905120000 fará RENAME "type"->"alertType".
    CREATE TABLE "PriceAlert" (
      "id" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "productId" TEXT NOT NULL,
      "type" "PriceAlertType" NOT NULL DEFAULT 'ANY_DROP',
      "referencePrice" DOUBLE PRECISION NOT NULL,
      "active" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "PriceAlert_pkey" PRIMARY KEY ("id")
    );
    -- INDICE e não CONSTRAINT: 20260905120000 faz
    -- DROP INDEX IF EXISTS "PriceAlert_userId_productId_type_key";
    -- um UNIQUE como constraint não é removível por DROP INDEX.
    CREATE UNIQUE INDEX "PriceAlert_userId_productId_type_key"
      ON "PriceAlert"("userId", "productId", "type");
  ELSE
    SELECT
      EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='PriceAlert' AND column_name='type'),
      EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='PriceAlert' AND column_name='alertType')
      INTO has_type, has_alert;

    IF has_type AND has_alert THEN
      RAISE EXCEPTION
        'BOOTSTRAP_FAIL_CLOSED: PriceAlert tem "type" E "alertType" simultaneamente (shape incompativel)';
    ELSIF NOT has_type AND NOT has_alert THEN
      RAISE EXCEPTION
        'BOOTSTRAP_FAIL_CLOSED: PriceAlert nao tem "type" nem "alertType" (shape incompativel)';
    ELSIF has_type THEN
      -- PRE-SHAPE: validar e nao tocar.
      SELECT string_agg(c, ',') INTO missing_cols
        FROM unnest(ARRAY['userId','productId','type','referencePrice','createdAt','updatedAt']) AS c
       WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema='public' AND table_name='PriceAlert' AND column_name=c);
      IF missing_cols IS NOT NULL THEN
        RAISE EXCEPTION
          'BOOTSTRAP_FAIL_CLOSED: PriceAlert PRE-SHAPE sem colunas esperadas: %', missing_cols;
      END IF;
    ELSE
      -- POST-SHAPE (producao): validar e nao tocar.
      SELECT string_agg(c, ',') INTO missing_cols
        FROM unnest(ARRAY['userId','productId','alertType','referencePrice','active','createdAt','updatedAt']) AS c
       WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema='public' AND table_name='PriceAlert' AND column_name=c);
      IF missing_cols IS NOT NULL THEN
        RAISE EXCEPTION
          'BOOTSTRAP_FAIL_CLOSED: PriceAlert POST-SHAPE sem colunas esperadas: %', missing_cols;
      END IF;
    END IF;
  END IF;
END $$;

-- 3) SocialPost_dayKey_key — existe para que o DROP (sem IF EXISTS) de
--    20260907220000 encontre o que espera. Em banco legado o IF EXISTS evita recriar.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='SocialPost') THEN
    RETURN;  -- SocialPost ainda nao existe; a migration seguinte o cria.
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE tablename='SocialPost' AND indexname='SocialPost_dayKey_key') THEN
    CREATE INDEX "SocialPost_dayKey_key" ON "SocialPost"("dayKey");
  END IF;
END $$;

-- 4) PriceAlertEvent — tabela fantasma. Forma lida de producao e conferida
--    contra scripts/bootstrap/local-legacy-tables.sql.
DO $$
DECLARE missing_cols text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='PriceAlertEvent') THEN
    CREATE TABLE "PriceAlertEvent" (
      "id" TEXT NOT NULL,
      "alertId" TEXT NOT NULL,
      "type" "PriceAlertType" NOT NULL,
      "price" DOUBLE PRECISION NOT NULL,
      "previousReferencePrice" DOUBLE PRECISION,
      "targetPrice" DOUBLE PRECISION,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "PriceAlertEvent_pkey" PRIMARY KEY ("id")
    );
    CREATE INDEX "PriceAlertEvent_alertId_createdAt_idx"
      ON "PriceAlertEvent"("alertId", "createdAt");
  ELSE
    SELECT string_agg(c, ',') INTO missing_cols
      FROM unnest(ARRAY['alertId','type','price','createdAt']) AS c
     WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema='public' AND table_name='PriceAlertEvent' AND column_name=c);
    IF missing_cols IS NOT NULL THEN
      RAISE EXCEPTION
        'BOOTSTRAP_FAIL_CLOSED: PriceAlertEvent existe sem colunas esperadas: %', missing_cols;
    END IF;
  END IF;
END $$;

-- 5) Favorite — tabela fantasma. Forma lida de producao e conferida contra
--    scripts/bootstrap/local-legacy-tables.sql.
DO $$
DECLARE missing_cols text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='Favorite') THEN
    CREATE TABLE "Favorite" (
      "id" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "productId" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
    );
    CREATE INDEX "Favorite_userId_createdAt_idx" ON "Favorite"("userId","createdAt");
    CREATE INDEX "Favorite_userId_idx" ON "Favorite"("userId");
    CREATE UNIQUE INDEX "Favorite_userId_productId_key" ON "Favorite"("userId","productId");
  ELSE
    SELECT string_agg(c, ',') INTO missing_cols
      FROM unnest(ARRAY['userId','productId','createdAt']) AS c
     WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema='public' AND table_name='Favorite' AND column_name=c);
    IF missing_cols IS NOT NULL THEN
      RAISE EXCEPTION
        'BOOTSTRAP_FAIL_CLOSED: Favorite existe sem colunas esperadas: %', missing_cols;
    END IF;
  END IF;
END $$;

-- 6) FKs que faltavam (divergencia comprovada contra a fonte autoritativa
--    scripts/bootstrap/local-legacy-tables.sql e contra producao):
--      Favorite_productId_fkey        -> Product(id)      ON UPDATE/DELETE CASCADE
--      PriceAlertEvent_alertId_fkey   -> PriceAlert(id)  ON UPDATE/DELETE CASCADE
--    Se a constraint existe, VALIDAR a definicao (sem dropar/recriar).
--    Se nao existe, criar (faz parte do bootstrap contract).
--    Se existe com definicao incompativel, fail-closed.
DO $$
DECLARE
  bad_fk text;
  have_product boolean;
  have_pricealert boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='Product') INTO have_product;
  SELECT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='PriceAlert') INTO have_pricealert;

  -- Favorite_productId_fkey
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='Favorite_productId_fkey') THEN
    IF have_product THEN
      SELECT string_agg(x.d, ' | ') INTO bad_fk FROM (
        SELECT pg_get_constraintdef(c.oid) AS d FROM pg_constraint c
         WHERE c.conname='Favorite_productId_fkey' AND c.contype='f'
           AND c.conrelid='public."Favorite"'::regclass
           AND c.confrelid<>'public."Product"'::regclass) x;
      IF bad_fk IS NOT NULL THEN
        RAISE EXCEPTION
          'BOOTSTRAP_FAIL_CLOSED: Favorite_productId_fkey incompativel: %', bad_fk;
      END IF;
    END IF;
  ELSIF have_product THEN
    ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "Product"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- PriceAlertEvent_alertId_fkey
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='PriceAlertEvent_alertId_fkey') THEN
    IF have_pricealert THEN
      SELECT string_agg(x.d, ' | ') INTO bad_fk FROM (
        SELECT pg_get_constraintdef(c.oid) AS d FROM pg_constraint c
         WHERE c.conname='PriceAlertEvent_alertId_fkey' AND c.contype='f'
           AND c.conrelid='public."PriceAlertEvent"'::regclass
           AND c.confrelid<>'public."PriceAlert"'::regclass) x;
      IF bad_fk IS NOT NULL THEN
        RAISE EXCEPTION
          'BOOTSTRAP_FAIL_CLOSED: PriceAlertEvent_alertId_fkey incompativel: %', bad_fk;
      END IF;
    END IF;
  ELSIF have_pricealert THEN
    ALTER TABLE "PriceAlertEvent" ADD CONSTRAINT "PriceAlertEvent_alertId_fkey"
      FOREIGN KEY ("alertId") REFERENCES "PriceAlert"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 7) PAPÉIS anon/authenticated — convenção Supabase. CREATE ROLE é aditivo;
--    em produção já existem: no-op.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE "anon" NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE "authenticated" NOLOGIN NOINHERIT;
  END IF;
END $$;

-- 8) SCHEMA auth — mesma classe do gap 7. Aditivo, no-op em produção.
CREATE SCHEMA IF NOT EXISTS "auth";

-- 9) FUNÇÕES auth.uid()/auth.role() — a policy só é VALIDADA na criação,
--    não executada; o que importa é a ASSINATURA (uuid), igual à do Supabase.
--    ATENÇÃO: corpos são stubs deliberados. A autenticação real em produção é
--    feita pelo Supabase, que tem as suas próprias versões.
CREATE OR REPLACE FUNCTION "auth"."uid"() RETURNS uuid AS $$
  SELECT NULL::uuid;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION "auth"."role"() RETURNS text AS $$
  SELECT current_user::text;
$$ LANGUAGE sql STABLE;
