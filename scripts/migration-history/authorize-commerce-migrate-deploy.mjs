/** Pure decision over trusted repository/release inputs and observed snapshots. No DB/CLI. */
import pins from './forensic-pins.json' with { type: 'json' };
import security from './expected-security-state.json' with { type: 'json' };
import {verifyLedgerCompatibility, commercePending} from './verify-ledger-compatibility.mjs';
export const commerceTables = ['ProductIdentifier','ProductVariant','IdentityEvidence','IdentityConflict','OfferObservation','OfferPriceComponent','TrustSignal','ProductRelation','CommerceCanaryGrant','CommerceCanaryAttempt'];
export const requiredOffFlags = ['COMMERCE_IDENTITY_GRAPH_ENABLED','COMMERCE_VARIANTS_ENABLED','OFFER_LEDGER_ENABLED','PRICE_TRUTH_ENABLED','TRUST_SIGNALS_ENABLED','COMMERCE_SHADOW_ENABLED','COMMERCE_DISTRIBUTED_CANARY_ENABLED','RAW_LISTING_DUAL_WRITE_ENABLED','CATALOG_POPULATE_ENABLED','IMPORT_QUEUE_PROCESS_ENABLED','PUBLIC_SEARCH_PERSISTENCE_ENABLED'];
const requireState = (ok, code) => { if (!ok) throw new Error(code); };
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const namesEqual = (a,b) => same([...a].sort(), [...b].sort());
const sortRows = (rows,key) => [...rows].sort((a,b)=>key(a).localeCompare(key(b)));
const TABLE_PRIVILEGES = ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'];
const DEFAULT_ACL_OBJECT_TYPES = ['r','S','f','T','n'];
const protectedRoles = ['anon','authenticated'];
// Managed security scope is derived ONLY from the authoritative canonical inventory (security.rls).
function managedTableSet(){
  const names = security.rls.map(r=>r.tableName);
  requireState(Array.isArray(security.rls) && names.length > 0 && new Set(names).size === names.length && names.every(n=>typeof n==='string' && n.length>0), 'MANAGED_TABLE_SET_INVALID');
  return names;
}
function verifySecurity(snapshot) {
  const managed = managedTableSet();
  const managedSet = new Set(managed);
  // RLS: exact canonical state over the managed set (collector is already managed-scoped).
  requireState(Array.isArray(snapshot.rls) && same(sortRows(snapshot.rls,r=>r.tableName),sortRows(security.rls,r=>r.tableName)), 'RLS_STATE_DIVERGED');
  // POLICIES: split observed into managed (exact) vs out-of-scope (observed, never silently discarded).
  requireState(Array.isArray(snapshot.policies), 'POLICY_STATE_MISSING');
  const policy = p => ({tablename:p.tablename,policyname:p.policyname,permissive:p.permissive,roles:[...p.roles].sort(),cmd:p.cmd,qual:p.qual,with_check:p.with_check});
  const validPolicy = p => p && typeof p.tablename==='string' && p.tablename.length>0 && typeof p.policyname==='string' && Array.isArray(p.roles) && p.roles.length>0 && p.roles.every(r=>typeof r==='string') && ['PERMISSIVE','RESTRICTIVE'].includes(p.permissive) && ['SELECT','INSERT','UPDATE','DELETE','ALL'].includes(p.cmd) && (p.qual===null || typeof p.qual==='string') && (p.with_check===null || typeof p.with_check==='string');
  snapshot.policies.forEach(p=>requireState(validPolicy(p), 'POLICY_STATE_INVALID'));
  const managedPolicies = snapshot.policies.filter(p=>managedSet.has(p.tablename));
  const outOfScopePolicies = snapshot.policies.filter(p=>!managedSet.has(p.tablename));
  const managedKeys = new Set();
  for (const p of managedPolicies){ const k=p.tablename+'|'+p.policyname; requireState(!managedKeys.has(k), 'DUPLICATE_MANAGED_POLICY'); managedKeys.add(k); }
  requireState(managedPolicies.length === security.policies.length && same(sortRows(managedPolicies.map(policy),p=>p.tablename+p.policyname),sortRows(security.policies.map(policy),p=>p.tablename+p.policyname)), 'POLICY_STATE_DIVERGED');
  // GRANTS: exact for managed tables / protected roles; PUBLIC-derived effective privileges appear here via has_table_privilege.
  requireState(Array.isArray(snapshot.grants), 'GRANT_STATE_MISSING');
  const grant = r => ({tableName:r.tableName,role:r.role,privileges:[...r.privileges].sort(),grantOptions:[...r.grantOptions].sort()});
  const validGrant = r => r && typeof r.tableName==='string' && r.tableName.length>0 && typeof r.role==='string' && Array.isArray(r.privileges) && r.privileges.every(pr=>TABLE_PRIVILEGES.includes(pr)) && Array.isArray(r.grantOptions) && r.grantOptions.every(pr=>TABLE_PRIVILEGES.includes(pr));
  snapshot.grants.forEach(r=>requireState(validGrant(r), 'GRANT_STATE_INVALID'));
  const managedGrants = snapshot.grants.filter(r=>managedSet.has(r.tableName) && protectedRoles.includes(r.role));
  const grantKeys = new Set();
  for (const r of managedGrants){ const k=r.tableName+'|'+r.role; requireState(!grantKeys.has(k), 'DUPLICATE_MANAGED_GRANT'); grantKeys.add(k); }
  requireState(managedGrants.length === security.grants.length && same(sortRows(managedGrants.map(grant),r=>r.tableName+r.role),sortRows(security.grants.map(grant),r=>r.tableName+r.role)), 'GRANT_STATE_DIVERGED');
  // DEFAULT ACL: scoped contract — only the migration role / public schema / TABLES matter for Commerce-created objects.
  requireState(Array.isArray(snapshot.defaultPrivileges), 'DEFAULT_PRIVILEGES_MISSING');
  const dap = security.defaultPrivilegeSafety;
  const forbidden = new Set(dap.forbiddenTablePrivileges);
  const validAcl = row => row && typeof row.owner==='string' && row.owner.length>0 && typeof row.schema==='string' && DEFAULT_ACL_OBJECT_TYPES.includes(row.objectType) && typeof row.grantee==='string' && typeof row.privilege==='string' && typeof row.grantable==='boolean';
  snapshot.defaultPrivileges.forEach(row=>requireState(validAcl(row), 'DEFAULT_ACL_ROW_INVALID'));
  const unsafe = snapshot.defaultPrivileges.filter(row => row.owner===dap.migrationRole && row.schema===dap.schema && row.objectType==='r' && (dap.protectedRoles.includes(row.grantee) || row.grantee==='PUBLIC') && (forbidden.has(row.privilege) || row.grantable===true));
  requireState(unsafe.length === 0, 'DEFAULT_ACL_UNSAFE');
  // COLUMN privileges: fail-closed, no exceptions may be observed on managed tables.
  requireState(same(snapshot.columnPrivilegeExceptions, []), 'COLUMN_PRIVILEGES_DIVERGED');
  // MIGRATION ROLE: trust anchor of the default-ACL and schema contract.
  requireState(snapshot.migrationRole === security.migrationRole, 'MIGRATION_ROLE_UNEXPECTED');
  // PUBLIC SCHEMA: USAGE may be true; CREATE=true for anon/authenticated is fail-closed DENIED.
  requireState(snapshot.publicSchemaPrivileges && typeof snapshot.publicSchemaPrivileges==='object' && snapshot.publicSchemaPrivileges.anon && snapshot.publicSchemaPrivileges.authenticated && typeof snapshot.publicSchemaPrivileges.anon.usage==='boolean' && typeof snapshot.publicSchemaPrivileges.anon.create==='boolean' && typeof snapshot.publicSchemaPrivileges.authenticated.usage==='boolean' && typeof snapshot.publicSchemaPrivileges.authenticated.create==='boolean', 'PUBLIC_SCHEMA_PRIVILEGES_MISSING');
  const publicSchemaCreateSafe = !snapshot.publicSchemaPrivileges.anon.create && !snapshot.publicSchemaPrivileges.authenticated.create;
  requireState(publicSchemaCreateSafe, 'PUBLIC_SCHEMA_CREATE_UNSAFE');
  return {
    managedTableCount: managed.length,
    managedPolicyCount: managedPolicies.length,
    outOfScopePolicyCount: outOfScopePolicies.length,
    outOfScopePolicies: outOfScopePolicies.map(p=>({tablename:p.tablename,policyname:p.policyname,cmd:p.cmd})).sort((a,b)=>(a.tablename+a.policyname).localeCompare(b.tablename+b.policyname)),
    managedGrantCount: managedGrants.length,
    unsafeMigrationDefaultAclCount: unsafe.length,
    publicSchemaCreateSafe
  };
}
export function authorizeCommerceMigrateDeploy(input) {
 try {
  requireState(input !== null && typeof input === 'object' && !Array.isArray(input), 'INVALID_SNAPSHOT');
  const {ledgerSnapshot,allowedPending,repositoryContract,observedFlags,schemaState,expectedProductionIdentity} = input;
  // expected delivery SHA is a trusted release input, never inferred from observations.
  requireState(expectedProductionIdentity?.environment === 'production' && expectedProductionIdentity.targetEnvironment === 'production' && expectedProductionIdentity.projectId === pins.projectId && /^[a-f0-9]{40}$/.test(expectedProductionIdentity.deliverySHA ?? ''), 'TRUSTED_RELEASE_IDENTITY_REQUIRED');
  requireState(schemaState?.version === 2 && same(schemaState.targetIdentity, expectedProductionIdentity), 'TARGET_IDENTITY_DIVERGED');
  requireState(repositoryContract && same(allowedPending,commercePending), 'EXACT_COMMERCE_PENDING_REQUIRED');
  const ledger = verifyLedgerCompatibility(ledgerSnapshot,allowedPending,repositoryContract);
  requireState(ledger.warnings.length === 2, 'EXACT_KNOWN_DIVERGENCES_REQUIRED');
  requireState(observedFlags?.version === 1 && observedFlags.flags && namesEqual(Object.keys(observedFlags.flags),requiredOffFlags) && requiredOffFlags.every(f=>observedFlags.flags[f] === false) && observedFlags.canaryTokenPresent === false, 'FLAGS_OR_TOKEN_UNSAFE');
  requireState(schemaState.commerceTables && namesEqual(Object.keys(schemaState.commerceTables),commerceTables) && commerceTables.every(t=>schemaState.commerceTables[t] === false), 'COMMERCE_TABLE_ALREADY_PRESENT_OR_UNOBSERVED');
  requireState(schemaState.unfinishedCount === 0 && schemaState.unexpectedRolledBackCount === 0 && Array.isArray(schemaState.blockers) && schemaState.blockers.length === 0, 'DATABASE_STATE_BLOCKED');
  const legacyNames=security.rls.map(r=>r.tableName).filter(n=>n!=='_prisma_migrations');
  requireState(schemaState.legacyCounts && namesEqual(Object.keys(schemaState.legacyCounts),legacyNames) && Object.values(schemaState.legacyCounts).every(n=>Number.isSafeInteger(n)&&n>=0), 'LEGACY_COUNTS_UNOBSERVED_OR_INVALID');
  const scope = verifySecurity(schemaState);
  return {verdict:'AUTHORIZED',pending:ledger.pending,knownDivergences:2,checksumSafetyAuthority:'INDEPENDENT_LEDGER_VERIFIER',securityScope:'MANAGED_TABLES_ONLY',managedTableCount:scope.managedTableCount,managedPolicyCount:scope.managedPolicyCount,outOfScopePolicyCount:scope.outOfScopePolicyCount,outOfScopePolicies:scope.outOfScopePolicies,managedGrantCount:scope.managedGrantCount,unsafeMigrationDefaultAclCount:scope.unsafeMigrationDefaultAclCount,publicSchemaCreateSafe:scope.publicSchemaCreateSafe};
 } catch(error) {
  const message=error instanceof Error?error.message:'';
  return {verdict:'DENIED',code:/^[A-Z_]+$/.test(message)?message:'INVALID_SNAPSHOT'};
 }
}