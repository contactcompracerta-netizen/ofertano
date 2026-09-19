/** Disposable-local snapshot collector producing version-2 schemaState. Never a Production helper. */
import security from '../migration-history/expected-security-state.json' with { type: 'json' };
import { commerceTables } from '../migration-history/authorize-commerce-migrate-deploy.mjs';
const TABLE_PRIVILEGES = ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'];
const protectedRoles = ['anon','authenticated'];
async function counts(client, tables) {
  const result = {};
  for (const table of tables) result[table] = Number((await client.query(`SELECT count(*) AS n FROM "${table}"`)).rows[0].n);
  return result;
}
/**
 * Produces the version-2 schemaState observed from a disposable local database:
 * managed RLS/policies/grants (effective), expanded default-ACL rows, public-schema
 * privileges, migration role. Grants are collected for ALL public tables so that
 * out-of-scope (external/legacy) grants are observed, never silently discarded.
 */
export async function collectPredeployState(client, identity) {
  const rls=(await client.query("SELECT c.relname AS \"tableName\",c.relrowsecurity AS enabled,c.relforcerowsecurity AS forced FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname",[security.rls.map(r=>r.tableName)])).rows;
  const policies=(await client.query("SELECT tablename,policyname,permissive,roles::text[] AS roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname")).rows;
  const tables=(await client.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname NOT LIKE 'pg_%' ORDER BY c.relname")).rows.map(r=>r.relname);
  const grants=[],columnPrivilegeExceptions=[];
  for(const t of tables)for(const role of protectedRoles) {
   const privileges=[],grantOptions=[];
   for(const p of TABLE_PRIVILEGES) {
    const allowed=(await client.query('SELECT has_table_privilege($1,$2,$3) AS allowed,has_table_privilege($1,$2,$4) AS grantable',[role,`public."${t}"`,p,p+' WITH GRANT OPTION'])).rows[0];
    if(allowed.allowed)privileges.push(p);if(allowed.grantable)grantOptions.push(p);
    if(['SELECT','INSERT','UPDATE','REFERENCES'].includes(p)&&!allowed.allowed&&(await client.query('SELECT has_any_column_privilege($1,$2,$3) AS allowed',[role,`public."${t}"`,p])).rows[0].allowed)columnPrivilegeExceptions.push({tableName:t,role,privilege:p});
   }
   grants.push({tableName:t,role,privileges,grantOptions});
  }
  // Expanded default-ACL rows: every owner/schema/objectType/grantee/privilege. The gate scopes them.
  const defaultPrivileges=(await client.query("SELECT pg_get_userbyid(d.defaclrole) AS owner,COALESCE(n.nspname,'') AS schema,d.defaclobjtype AS \"objectType\",pg_get_userbyid(a.grantee) AS grantee,a.privilege_type AS privilege,a.is_grantable AS grantable FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace CROSS JOIN LATERAL aclexplode(d.defaclacl) a ORDER BY owner,schema,\"objectType\",grantee,privilege")).rows;
  const publicSchemaPrivileges={};
  for(const role of protectedRoles) {
   const row=(await client.query('SELECT has_schema_privilege($1,$2,$3) AS usage,has_schema_privilege($1,$2,$4) AS create',[role,'public','USAGE','CREATE'])).rows[0];
   publicSchemaPrivileges[role]={usage:row.usage,create:row.create};
  }
  const migrationRole=(await client.query('SELECT current_user AS role')).rows[0].role;
  const present=(await client.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[])",[commerceTables])).rows.map(r=>r.relname);
  const ledgerCounts=(await client.query('SELECT count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::int AS unfinished,count(*) FILTER (WHERE rolled_back_at IS NOT NULL)::int AS rolled_back FROM "_prisma_migrations"')).rows[0];
  return {version:2,targetIdentity:identity,rls,policies,grants,defaultPrivileges,columnPrivilegeExceptions,publicSchemaPrivileges,migrationRole,commerceTables:Object.fromEntries(commerceTables.map(t=>[t,present.includes(t)])),unfinishedCount:ledgerCounts.unfinished,unexpectedRolledBackCount:ledgerCounts.rolled_back,blockers:[],legacyCounts:await counts(client,security.rls.map(r=>r.tableName).filter(n=>n!=='_prisma_migrations'))};
}