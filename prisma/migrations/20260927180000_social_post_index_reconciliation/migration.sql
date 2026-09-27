-- The retroactive bootstrap recreated its temporary non-unique dayKey index
-- after social_three_slots had already run. Only that exact stale index may go.
-- No table, column or row changes. Unexpected or incomplete state aborts.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = pg_catalog, public;
LOCK TABLE public."SocialPost" IN SHARE ROW EXCLUSIVE MODE;
DO $reconcile$
DECLARE canonical oid := to_regclass('public."SocialPost_dayKey_slot_key"');
        stale oid := to_regclass('public."SocialPost_dayKey_key"');
BEGIN
  IF canonical IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
    WHERE i.indexrelid=canonical AND i.indrelid='public."SocialPost"'::regclass
      AND c.relkind='i' AND c.reloptions IS NULL
      AND i.indisunique AND NOT i.indisprimary AND NOT i.indisexclusion
      AND i.indisvalid AND i.indisready AND i.indislive
      AND NOT i.indisreplident AND NOT i.indisclustered
      AND NOT i.indnullsnotdistinct AND i.indimmediate
      AND i.indnkeyatts=2 AND i.indnatts=2
      AND i.indpred IS NULL AND i.indexprs IS NULL
      AND pg_get_indexdef(i.indexrelid)='CREATE UNIQUE INDEX "SocialPost_dayKey_slot_key" ON public."SocialPost" USING btree ("dayKey", slot)'
  ) THEN RAISE EXCEPTION 'SOCIAL_CANONICAL_INDEX_DIVERGED'; END IF;
  IF stale IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
      WHERE i.indexrelid=stale AND i.indrelid='public."SocialPost"'::regclass
        AND c.relkind='i' AND c.reloptions IS NULL
        AND NOT i.indisunique AND NOT i.indisprimary AND NOT i.indisexclusion
        AND i.indisvalid AND i.indisready AND i.indislive
        AND NOT i.indisreplident AND NOT i.indisclustered
        AND NOT i.indnullsnotdistinct AND i.indimmediate
        AND i.indnkeyatts=1 AND i.indnatts=1
        AND i.indpred IS NULL AND i.indexprs IS NULL
        AND pg_get_indexdef(i.indexrelid)='CREATE INDEX "SocialPost_dayKey_key" ON public."SocialPost" USING btree ("dayKey")'
    ) OR EXISTS (SELECT 1 FROM pg_constraint WHERE conindid=stale)
    THEN RAISE EXCEPTION 'SOCIAL_STALE_INDEX_DIVERGED'; END IF;
    DROP INDEX public."SocialPost_dayKey_key";
  END IF;
END $reconcile$;
COMMIT;
