/** Catalog metadata and aggregate counts only. Caller must open a read-only transaction. */
export async function collectProductionObservation(client) {
const q=async(sql,args)=>(await client.query(sql,args)).rows;
const shape={};
for(const table of ['notifications','price_alerts','PriceAlert','SocialPost']){
shape[table]={};const s=shape[table];
s.columns=await q(`SELECT column_name,ordinal_position,data_type,udt_schema,udt_name,is_nullable,column_default,is_generated,generation_expression,is_identity,identity_generation,identity_start,identity_increment,identity_maximum,identity_minimum,identity_cycle,datetime_precision,numeric_precision,numeric_scale,character_maximum_length FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,[table]);
s.constraints=await q(`SELECT conname,contype,pg_get_constraintdef(oid) AS definition,condeferrable,condeferred,convalidated FROM pg_constraint WHERE conrelid=to_regclass($1) ORDER BY conname`,['public."'+table+'"']);
s.indexes=await q(`SELECT ci.relname AS name,pg_get_indexdef(i.indexrelid) AS definition,indisunique,indisprimary,indisvalid,indisready,pg_get_expr(indpred,indrelid) AS predicate,pg_get_expr(indexprs,indrelid) AS expressions,indnkeyatts,indnatts,indkey::text,indoption::text FROM pg_index i JOIN pg_class ci ON ci.oid=i.indexrelid WHERE indrelid=to_regclass($1) ORDER BY ci.relname`,['public."'+table+'"']);
s.rls=await q(`SELECT relrowsecurity,relforcerowsecurity,relkind FROM pg_class WHERE oid=to_regclass($1)`,['public."'+table+'"']);
s.policies=await q(`SELECT policyname,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename=$1 ORDER BY policyname`,[table]);
s.triggers=await q(`SELECT tgname,pg_get_triggerdef(oid) AS definition,tgenabled,tgisinternal FROM pg_trigger WHERE tgrelid=to_regclass($1) AND NOT tgisinternal ORDER BY tgname`,['public."'+table+'"']);
s.sequences=await q(`SELECT a.attname,pg_get_serial_sequence($1,a.attname) AS sequence FROM pg_attribute a WHERE attrelid=to_regclass($1) AND attnum>0 AND NOT attisdropped AND pg_get_serial_sequence($1,a.attname) IS NOT NULL ORDER BY attnum`,['public."'+table+'"']);
}
const columns=['armed','lastEvaluatedAt','lastEvaluatedHadExact','lastEvaluatedPrice','lastTriggeredAt','lastTriggeredPrice'];
const aggregates=await q('SELECT count(*)::int AS total,'+columns.map(c=>'count(*) FILTER (WHERE "'+c+'" IS NOT NULL)::int AS "'+c+'"').join(',')+' FROM public."PriceAlert"');
const external=await q(`SELECT c.relname AS table_name,con.conname,pg_get_constraintdef(con.oid) AS definition,con.condeferrable,con.condeferred,con.convalidated FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class rc ON rc.oid=con.confrelid JOIN pg_namespace rn ON rn.oid=rc.relnamespace WHERE con.contype='f' AND n.nspname='public' AND rn.nspname<>'public' ORDER BY c.relname,con.conname`);
const ledger=await q('SELECT migration_name,checksum,applied_steps_count,started_at,finished_at,rolled_back_at FROM public._prisma_migrations ORDER BY migration_name,started_at');
const social=await q('SELECT count(*)::int AS days_with_multiple_posts FROM (SELECT "dayKey" FROM public."SocialPost" GROUP BY "dayKey" HAVING count(*)>1) s');
const functions=await q(`SELECT p.proname,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.oid IN (SELECT tgfoid FROM pg_trigger WHERE tgrelid='public.price_alerts'::regclass AND NOT tgisinternal) ORDER BY p.proname`);
return {shape,aggregates,external,ledger,social,functions};
}
