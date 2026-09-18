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
function verifySecurity(snapshot) {
 requireState(Array.isArray(snapshot.rls) && same(sortRows(snapshot.rls,r=>r.tableName),sortRows(security.rls,r=>r.tableName)), 'RLS_STATE_DIVERGED');
 requireState(Array.isArray(snapshot.policies), 'POLICY_STATE_MISSING');
 const policy = p => ({tablename:p.tablename,policyname:p.policyname,permissive:p.permissive,roles:[...p.roles].sort(),cmd:p.cmd,qual:p.qual,with_check:p.with_check});
 requireState(same(sortRows(snapshot.policies.map(policy),p=>p.tablename+p.policyname),sortRows(security.policies.map(policy),p=>p.tablename+p.policyname)), 'POLICY_STATE_DIVERGED');
 requireState(Array.isArray(snapshot.grants), 'GRANT_STATE_MISSING');
 const grant = r => ({tableName:r.tableName,role:r.role,privileges:[...r.privileges].sort(),grantOptions:[...r.grantOptions].sort()});
 requireState(same(sortRows(snapshot.grants.map(grant),r=>r.tableName+r.role),sortRows(security.grants.map(grant),r=>r.tableName+r.role)), 'GRANT_STATE_DIVERGED');
 requireState(same(snapshot.defaultPrivileges, []), 'DEFAULT_PRIVILEGES_DIVERGED');
 requireState(same(snapshot.columnPrivilegeExceptions, []), 'COLUMN_PRIVILEGES_DIVERGED');
}
export function authorizeCommerceMigrateDeploy({ledgerSnapshot,allowedPending,repositoryContract,observedFlags,schemaState,expectedProductionIdentity} = {}) {
 try {
  // expected delivery SHA is a trusted release input, never inferred from observations.
  requireState(expectedProductionIdentity?.environment === 'production' && expectedProductionIdentity.targetEnvironment === 'production' && expectedProductionIdentity.projectId === pins.projectId && /^[a-f0-9]{40}$/.test(expectedProductionIdentity.deliverySHA ?? ''), 'TRUSTED_RELEASE_IDENTITY_REQUIRED');
  requireState(schemaState?.version === 1 && same(schemaState.targetIdentity, expectedProductionIdentity), 'TARGET_IDENTITY_DIVERGED');
  requireState(repositoryContract && same(allowedPending,commercePending), 'EXACT_COMMERCE_PENDING_REQUIRED');
  const ledger = verifyLedgerCompatibility(ledgerSnapshot,allowedPending,repositoryContract);
  requireState(ledger.warnings.length === 2, 'EXACT_KNOWN_DIVERGENCES_REQUIRED');
  requireState(observedFlags?.version === 1 && observedFlags.flags && namesEqual(Object.keys(observedFlags.flags),requiredOffFlags) && requiredOffFlags.every(f=>observedFlags.flags[f] === false) && observedFlags.canaryTokenPresent === false, 'FLAGS_OR_TOKEN_UNSAFE');
  requireState(schemaState.commerceTables && namesEqual(Object.keys(schemaState.commerceTables),commerceTables) && commerceTables.every(t=>schemaState.commerceTables[t] === false), 'COMMERCE_TABLE_ALREADY_PRESENT_OR_UNOBSERVED');
  requireState(schemaState.unfinishedCount === 0 && schemaState.unexpectedRolledBackCount === 0 && Array.isArray(schemaState.blockers) && schemaState.blockers.length === 0, 'DATABASE_STATE_BLOCKED');
  const legacyNames=security.rls.map(r=>r.tableName).filter(n=>n!=='_prisma_migrations');
  requireState(schemaState.legacyCounts && namesEqual(Object.keys(schemaState.legacyCounts),legacyNames) && Object.values(schemaState.legacyCounts).every(n=>Number.isSafeInteger(n)&&n>=0), 'LEGACY_COUNTS_UNOBSERVED_OR_INVALID');
  verifySecurity(schemaState);
  return {verdict:'AUTHORIZED',pending:ledger.pending,knownDivergences:2,checksumSafetyAuthority:'INDEPENDENT_LEDGER_VERIFIER'};
 } catch(error) {
  return {verdict:'DENIED',code:/^[A-Z_]+$/.test(error.message)?error.message:'INVALID_SNAPSHOT'};
 }
}
