-- Reconciliacao ADITIVA do schema legado de "PriceAlert".
--
-- PROBLEMA: 20260905120000_price_alerts pressupoe que tres objetos JA EXISTEM
-- no banco legado. O proprio arquivo lista, em "Mantidos (ja existem e
-- conferem com o schema)":
--   * "PriceAlert_active_updatedAt_idx" (active, "updatedAt")
--   * "PriceAlert_productId_fkey" -> "Product"("id")
-- e a coluna "targetPrice" nunca e criada por migration alguma.
-- Em PRODUCAO essa suposicao e verdadeira. Em bancos construidos pelo
-- bootstrap retroativo (PREVIEW), a tabela nasce no PRE-SHAPE e esses tres
-- objetos NUNCA existem: a migration passa sem erro e o drift fica PERMANENTE
-- e invisivel para o ledger.
--
-- Esta migration reconcilia EXATAMENTE quatro objetos, e nada mais:
--   1. enum "PriceAlertType": variante TARGET_PRICE
--   2. "PriceAlert"."targetPrice" DOUBLE PRECISION NULL, sem default
--   3. indice "PriceAlert_active_updatedAt_idx" btree ("active","updatedAt")
--   4. FK "PriceAlert_productId_fkey" -> "Product"("id")
--      ON DELETE CASCADE ON UPDATE CASCADE
--
-- SEGURANCA (fail-closed, aditiva, sem perda de dados):
--   - objeto AUSENTE      -> criado exatamente no formato canonico;
--   - objeto JA CORRETO   -> validado e PRESERVADO (no-op estrutural);
--   - objeto INCOMPATIVEL -> RAISE EXCEPTION, nada e sobrescrito;
--   - nenhum DROP / DELETE / TRUNCATE / coluna destruida;
--   - "TARGET_PRICE" e variante LEGADA deliberadamente preservada por
--     20260905120000 ("o valor legado TARGET_PRICE continua existindo").
--     Nenhum backfill: a coluna nasce NULL e a variante apenas passa a existir.

-- 1) ENUM "PriceAlertType" -- variante legada TARGET_PRICE.
DO $pa_enum$
DECLARE
  unexpected text;
  required_missing text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE n.nspname = 'public' AND t.typname = 'PriceAlertType') THEN
    -- Ausente: cria no conjunto completo canonico, na ordem de producao.
    CREATE TYPE "PriceAlertType" AS ENUM ('ANY_DROP', 'TARGET_PRICE', 'TARGET');
  ELSE
    SELECT string_agg(v.enumlabel, ',') INTO unexpected
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      JOIN pg_enum v ON v.enumtypid = t.oid
     WHERE n.nspname = 'public' AND t.typname = 'PriceAlertType'
       AND v.enumlabel NOT IN ('ANY_DROP', 'TARGET', 'TARGET_PRICE');
    IF unexpected IS NOT NULL THEN
      RAISE EXCEPTION
        'PRICE_ALERT_RECONCILIATION_FAIL_CLOSED: PriceAlertType com labels inesperados: %', unexpected;
    END IF;

    -- ANY_DROP e TARGET sao declarados no schema.prisma: se faltarem, o enum
    -- esta em um shape que esta migration nao sabe reconciliar.
    SELECT string_agg(r.l, ',') INTO required_missing
      FROM unnest(ARRAY['ANY_DROP', 'TARGET']) AS r(l)
     WHERE NOT EXISTS (SELECT 1 FROM pg_type t
                         JOIN pg_namespace n ON n.oid = t.typnamespace
                         JOIN pg_enum v ON v.enumtypid = t.oid
                        WHERE n.nspname = 'public' AND t.typname = 'PriceAlertType'
                          AND v.enumlabel = r.l);
    IF required_missing IS NOT NULL THEN
      RAISE EXCEPTION
        'PRICE_ALERT_RECONCILIATION_FAIL_CLOSED: PriceAlertType sem labels canonicos: %', required_missing;
    END IF;
  END IF;
END
$pa_enum$;

-- Idempotente: no-op quando a variante legada ja existe (producao).
ALTER TYPE "PriceAlertType" ADD VALUE IF NOT EXISTS 'TARGET_PRICE';

-- 2) COLUNA "PriceAlert"."targetPrice" -- DOUBLE PRECISION NULL, sem default.
DO $pa_col$
DECLARE
  shape text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema = 'public' AND table_name = 'PriceAlert') THEN
    RAISE EXCEPTION
      'PRICE_ALERT_RECONCILIATION_FAIL_CLOSED: tabela PriceAlert ausente';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'PriceAlert'
                    AND column_name = 'targetPrice') THEN
    -- Ausente: nullable, sem default. Nenhum backfill.
    ALTER TABLE "PriceAlert" ADD COLUMN "targetPrice" DOUBLE PRECISION;
    RETURN;
  END IF;

  -- Presente: so aceita a definicao canonica exata.
  SELECT format('type=%s notnull=%s default=%s',
                format_type(a.atttypid, a.atttypmod),
                a.attnotnull,
                coalesce(pg_get_expr(d.adbin, d.adrelid), '<none>'))
    INTO shape
    FROM pg_class r
    JOIN pg_namespace n ON n.oid = r.relnamespace
    JOIN pg_attribute a ON a.attrelid = r.oid AND a.attname = 'targetPrice'
    LEFT JOIN pg_attrdef d ON d.adrelid = r.oid AND d.adnum = a.attnum
   WHERE n.nspname = 'public' AND r.relname = 'PriceAlert'
     AND a.attnum > 0 AND NOT a.attisdropped;

  IF shape IS DISTINCT FROM 'type=double precision notnull=f default=<none>' THEN
    RAISE EXCEPTION
      'PRICE_ALERT_RECONCILIATION_FAIL_CLOSED: PriceAlert.targetPrice incompativel: %', shape;
  END IF;
END
$pa_col$;

-- 3) INDICE "PriceAlert_active_updatedAt_idx" btree ("active","updatedAt")
DO $pa_idx$
DECLARE
  cols text;
  is_unique boolean;
  is_valid boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relname = 'PriceAlert_active_updatedAt_idx') THEN
    SELECT string_agg(a.attname, ',' ORDER BY k.ord),
           bool_and(i.indisunique),
           bool_and(i.indisvalid)
      INTO cols, is_unique, is_valid
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
                    AND i.indrelid = 'public."PriceAlert"'::regclass
      CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
     WHERE n.nspname = 'public' AND c.relname = 'PriceAlert_active_updatedAt_idx';

    IF cols IS DISTINCT FROM 'active,updatedAt' OR is_unique OR NOT is_valid THEN
      RAISE EXCEPTION
        'PRICE_ALERT_RECONCILIATION_FAIL_CLOSED: PriceAlert_active_updatedAt_idx incompativel: cols=% unique=% valid=%',
        cols, is_unique, is_valid;
    END IF;
  ELSE
    CREATE INDEX "PriceAlert_active_updatedAt_idx" ON "PriceAlert"("active", "updatedAt");
  END IF;
END
$pa_idx$;

-- 4) FK "PriceAlert_productId_fkey" -> "Product"("id") CASCADE / CASCADE
DO $pa_fk$
DECLARE
  definition text;
  canonical constant text :=
    'FOREIGN KEY ("productId") REFERENCES "Product"(id) ON UPDATE CASCADE ON DELETE CASCADE';
  product_exists boolean;
  other_fk text;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema = 'public' AND table_name = 'Product')
    INTO product_exists;
  IF NOT product_exists THEN
    RAISE EXCEPTION
      'PRICE_ALERT_RECONCILIATION_FAIL_CLOSED: tabela Product ausente';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'PriceAlert_productId_fkey'
                AND conrelid = 'public."PriceAlert"'::regclass
                AND contype = 'f') THEN
    SELECT pg_get_constraintdef(oid) INTO definition
      FROM pg_constraint
     WHERE conname = 'PriceAlert_productId_fkey'
       AND conrelid = 'public."PriceAlert"'::regclass
       AND contype = 'f';

    -- Compara a definicao canonica ignorando apenas espacos.
    IF replace(definition, ' ', '') <> replace(canonical, ' ', '') THEN
      RAISE EXCEPTION
        'PRICE_ALERT_RECONCILIATION_FAIL_CLOSED: PriceAlert_productId_fkey incompativel: %', definition;
    END IF;
  ELSE
    -- Ja existe alguma FK sobre "productId" com outro nome? Nao criar uma
    -- segunda constraint paralela: aborta em vez de duplicar silenciosamente.
    SELECT string_agg(c.conname, ',') INTO other_fk
      FROM pg_constraint c
      JOIN LATERAL unnest(c.conkey) AS k(attnum) ON TRUE
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
     WHERE c.conrelid = 'public."PriceAlert"'::regclass
       AND c.contype = 'f'
       AND a.attname = 'productId';

    IF other_fk IS NOT NULL THEN
      RAISE EXCEPTION
        'PRICE_ALERT_RECONCILIATION_FAIL_CLOSED: PriceAlert.productId ja tem FK fora do nome canonico: %', other_fk;
    END IF;

    -- Ausente: cria no formato canonico. A validacao das linhas existentes e
    -- intrinseca; se violar, o ADD CONSTRAINT falha e a migration aborta sem
    -- destruir nada.
    ALTER TABLE "PriceAlert" ADD CONSTRAINT "PriceAlert_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$pa_fk$;
