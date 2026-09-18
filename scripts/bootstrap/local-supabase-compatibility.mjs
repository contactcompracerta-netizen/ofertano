/** Minimal compatibility for disposable local PostgreSQL only. Never a Production helper. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const patterns = [/^ofertano_bootstrap_probe_n1[abc]$/, /^ofertano_4e_[a-z0-9_]+$/, /^ofertano_50ag1_(foundation|forward|partial|unknown)$/, /^ofertano_50ag2_(shadow|forward)$/, /^ofertano_50ag3_(control_plane|forward)$/, /^ofertano_50ag4b_history_(fresh|forward|rehearsal|partial|unknown)$/];
const uidBody = "SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid";
const compact = s => s.trim().replace(/\s+/g, ' ');
const assert = (ok, code) => { if (!ok) throw new Error(code); };
export function validateLocalTarget(target, env = process.env) {
  assert(env.VERCEL_ENV !== 'production' && env.VERCEL_TARGET_ENV !== 'production', 'PRODUCTION_ENV_REFUSED');
  let url; try { url = new URL(target); } catch { throw new Error('CONNECTION_URL_INVALID'); }
  assert(['postgres:', 'postgresql:'].includes(url.protocol) && url.hostname === '127.0.0.1' && url.port === '55433' && !url.search && !url.hash, 'LOCAL_TRIPWIRE_VIOLATED');
  const database = url.pathname.slice(1);
  const override = (env.BOOTSTRAP_ALLOWED_DATABASES ?? '').split(',').filter(n => /^ofertano_[a-z0-9_]+$/.test(n));
  assert(patterns.some(p => p.test(database)) || override.includes(database), 'TARGET_NOT_DISPOSABLE');
  return { target, database };
}
export async function assertLocalConnection(client, target) {
  const validated = validateLocalTarget(target);
  assert(client.connection.stream.remoteAddress === '127.0.0.1' && client.connection.stream.remotePort === 55433, 'LOCAL_SOCKET_DIVERGED');
  const identity = (await client.query('SELECT current_database() AS database, current_user AS role')).rows[0];
  assert(identity.database === validated.database && identity.role === 'postgres', 'LOCAL_DATABASE_IDENTITY_DIVERGED');
}
export async function verifyLocalRolesAndAuth(client) {
  const rows = (await client.query("SELECT rolname,rolsuper,rolcanlogin,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) AS has_memberships FROM pg_roles r WHERE rolname IN ('anon','authenticated') ORDER BY rolname")).rows;
  assert(rows.length === 2 && rows.every(r => !r.rolsuper && !r.rolcanlogin && !r.rolcreatedb && !r.rolcreaterole && !r.rolreplication && !r.rolbypassrls && !r.has_memberships), 'LOCAL_ROLE_SECURITY_DIVERGED');
  const schema = (await client.query("SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname='auth'")).rows;
  assert(schema.length === 1 && schema[0].owner === 'postgres', 'LOCAL_AUTH_SCHEMA_DIVERGED');
  const functions = (await client.query("SELECT p.prosrc,p.prosecdef,p.provolatile,p.proconfig,pg_get_userbyid(p.proowner) AS owner,l.lanname,pg_get_function_result(p.oid) AS result,p.pronargs FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname='auth'")).rows;
  assert(functions.length === 1 && functions[0].owner === 'postgres' && functions[0].lanname === 'sql' && functions[0].result === 'uuid' && functions[0].pronargs === 0 && !functions[0].prosecdef && functions[0].provolatile === 's' && JSON.stringify(functions[0].proconfig) === JSON.stringify(['search_path=pg_catalog']) && compact(functions[0].prosrc) === uidBody, 'LOCAL_AUTH_FUNCTION_DIVERGED');
  return rows;
}
export async function scaffoldLocalSupabase(client, target) {
  // Reject URL/environment/socket/database BEFORE any DDL, including cluster-wide roles.
  await assertLocalConnection(client, target);
  await client.query('BEGIN');
  try {
    for (const role of ['anon', 'authenticated']) {
      const exists = (await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount;
      if (!exists) await client.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    }
    const schema = (await client.query("SELECT 1 FROM pg_namespace WHERE nspname='auth'")).rowCount;
    if (!schema) await client.query('CREATE SCHEMA auth AUTHORIZATION postgres');
    const functions = (await client.query("SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='auth'")).rowCount;
    if (!functions) await client.query(`CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE SET search_path = pg_catalog AS $local_uid$ ${uidBody} $local_uid$`);
    await verifyLocalRolesAndAuth(client);
    await client.query('REVOKE ALL ON SCHEMA auth FROM PUBLIC');
    await client.query('GRANT USAGE ON SCHEMA auth TO anon, authenticated');
    await client.query('REVOKE ALL ON FUNCTION auth.uid() FROM PUBLIC');
    await client.query('GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated');
    await client.query(fs.readFileSync(path.join(here, 'local-legacy-tables.sql'), 'utf8'));
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}
export function localEquivalenceSchema(schemaPath) {
  // Runtime schema/client stay unchanged; account explicitly for the two legacy prerequisites.
  let schema = fs.readFileSync(schemaPath, 'utf8');
  assert(schema.includes('model Product {') && schema.includes('model PriceAlert {'), 'LOCAL_EQUIVALENCE_SCHEMA_DIVERGED');
  schema = schema.replace('model Product {', 'model Product {\n  localFavorites Favorite[] @relation("LocalFavoriteProduct")').replace('model PriceAlert {', 'model PriceAlert {\n  localEvents PriceAlertEvent[] @relation("LocalPriceAlertEvent")');
  schema += `\nmodel Favorite {
  id String @id
  userId String
  productId String
  createdAt DateTime @default(now()) @db.Timestamp(3)
  product Product @relation("LocalFavoriteProduct", fields: [productId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  @@unique([userId, productId])
  @@index([userId, createdAt])
  @@index([userId])
}
model PriceAlertEvent {
  id String @id
  alertId String
  type PriceAlertType
  price Float
  previousReferencePrice Float?
  targetPrice Float?
  createdAt DateTime @default(now()) @db.Timestamp(3)
  alert PriceAlert @relation("LocalPriceAlertEvent", fields: [alertId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  @@index([alertId, createdAt])
}\n`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ofertano-local-schema-'));
  const file = path.join(dir, 'schema.prisma'); fs.writeFileSync(file, schema);
  return { file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
export async function verifyLocalRls(client, target) {
  await assertLocalConnection(client, target);
  await verifyLocalRolesAndAuth(client);
  const required = ['Product','BlogPost','MarketplaceOffer','MarketplaceConnection','RawMarketplaceListing','ProductOpportunity','ImportQueue','SearchRequest','PriceHistory','PriceAlert','PriceAlertEvent','Favorite','AnalyticsEvent','AnalyticsDailyAgg','AnalyticsSessionDay','SocialPost','AdminPushSubscription','AdminPushDispatch','_prisma_migrations'];
  const state = (await client.query("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND relname=ANY($1::text[]) ORDER BY relname", [required])).rows;
  assert(state.length === required.length && state.every(r => r.relrowsecurity && !r.relforcerowsecurity), 'LOCAL_RLS_STATE_DIVERGED');
  const policies = (await client.query("SELECT tablename,policyname,cmd,roles::text[] AS roles,qual,with_check,permissive FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname")).rows;
  const expected = { product_public_read: ['Product','SELECT'], blog_post_public_read: ['BlogPost','SELECT'], marketplace_offer_public_read: ['MarketplaceOffer','SELECT'], favorite_select_own: ['Favorite','SELECT'], favorite_insert_own: ['Favorite','INSERT'], favorite_delete_own: ['Favorite','DELETE'], price_alert_select_own: ['PriceAlert','SELECT'], price_alert_insert_own: ['PriceAlert','INSERT'], price_alert_update_own: ['PriceAlert','UPDATE'], price_alert_delete_own: ['PriceAlert','DELETE'] };
  assert(policies.length === 10 && policies.every(p => expected[p.policyname]?.[0] === p.tablename && expected[p.policyname]?.[1] === p.cmd && p.permissive === 'PERMISSIVE' && JSON.stringify([...p.roles].sort()) === JSON.stringify(['Product','BlogPost','MarketplaceOffer'].includes(p.tablename) ? ['anon','authenticated'] : ['authenticated'])), 'LOCAL_RLS_POLICY_DIVERGED');
  const product = policies.find(p => p.policyname === 'product_public_read');
  assert(/HAVING\s*\(?\s*count\s*\(\s*DISTINCT\s+o\.marketplace\s*\)\s*>=\s*2/i.test(product.qual) && !/GROUP\s+BY/i.test(product.qual), 'LOCAL_PRODUCT_POLICY_DIVERGED');
  const newTables = ['ProductIdentifier','ProductVariant','IdentityEvidence','IdentityConflict','OfferObservation','OfferPriceComponent','TrustSignal','ProductRelation','CommerceCanaryGrant','CommerceCanaryAttempt'];
  for (const role of ['anon','authenticated']) for (const table of [...required,...newTables]) {
    const privileges = (await client.query("SELECT has_table_privilege($1,$2,'SELECT') AS s,has_table_privilege($1,$2,'INSERT') AS i,has_table_privilege($1,$2,'UPDATE') AS u,has_table_privilege($1,$2,'DELETE') AS d,has_table_privilege($1,$2,'TRUNCATE') AS t,has_table_privilege($1,$2,'REFERENCES') AS r,has_table_privilege($1,$2,'TRIGGER') AS g", [role,`public."${table}"`])).rows[0];
    const publicRead = ['Product','BlogPost','MarketplaceOffer'].includes(table);
    const own = role === 'authenticated' && ['Favorite','PriceAlert'].includes(table);
    assert(privileges.s === (publicRead || own) && privileges.i === own && privileges.u === own && privileges.d === own && !privileges.t && !privileges.r && !privileges.g, 'LOCAL_GRANT_STATE_DIVERGED');
  }
  const defaults = (await client.query("SELECT count(*)::int AS n FROM pg_default_acl d JOIN pg_roles owner_role ON owner_role.oid=d.defaclrole JOIN pg_namespace n ON n.oid=d.defaclnamespace CROSS JOIN LATERAL aclexplode(d.defaclacl) a JOIN pg_roles grantee ON grantee.oid=a.grantee WHERE owner_role.rolname='postgres' AND n.nspname='public' AND grantee.rolname IN ('anon','authenticated')")).rows[0].n;
  assert(defaults === 0, 'LOCAL_DEFAULT_PRIVILEGES_DIVERGED');
  return { rls: 'PASS', grants: 'PASS', defaultPrivileges: 'PASS' };
}
