import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from './production-ledger.fixture.json' with {type:'json'};
import security from './expected-security-state.json' with {type:'json'};
import r3b from './production-security-r3b.fixture.json' with {type:'json'};
import pins from './forensic-pins.json' with {type:'json'};
import {loadRepositoryContract,commercePending,architecturePending} from './verify-ledger-compatibility.mjs';
import {authorizeCommerceMigrateDeploy,requiredOffFlags,commerceTables} from './authorize-commerce-migrate-deploy.mjs';
function identity(){return {environment:'production',targetEnvironment:'production',projectId:pins.projectId,deliverySHA:'ec755ac167db6d46f939be1005c791142c6127c2'};}
function schemaStateFrom(core){
 const id=identity();
 return {version:2,targetIdentity:{...id},...structuredClone(core),commerceTables:Object.fromEntries(commerceTables.map(t=>[t,false])),unfinishedCount:0,unexpectedRolledBackCount:0,blockers:[],legacyCounts:Object.fromEntries(core.rls.filter(r=>r.tableName!=='_prisma_migrations').map(r=>[r.tableName,0]))};
}
function input(){
 const id=identity();
 return {ledgerSnapshot:structuredClone(fixture),allowedPending:[...commercePending,...architecturePending],repositoryContract:loadRepositoryContract(),expectedProductionIdentity:id,observedFlags:{version:1,flags:Object.fromEntries(requiredOffFlags.map(f=>[f,false])),canaryTokenPresent:false},schemaState:schemaStateFrom(security)};
}
function r3bInput(){
 const id=identity();
 return {ledgerSnapshot:structuredClone(fixture),allowedPending:[...commercePending,...architecturePending],repositoryContract:loadRepositoryContract(),expectedProductionIdentity:id,observedFlags:{version:1,flags:Object.fromEntries(requiredOffFlags.map(f=>[f,false])),canaryTokenPresent:false},schemaState:schemaStateFrom(r3b)};
}
test('all independent gates authorize exact pending without mutating inputs',()=>{
 const i=input(),before=structuredClone(i);const result=authorizeCommerceMigrateDeploy(i);
 assert.equal(result.verdict,'AUTHORIZED');assert.equal(result.knownDivergences,2);assert.deepEqual(result.pending,[...commercePending,...architecturePending]);assert.deepEqual(i,before);
});
const mutations={
 'third checksum mismatch':i=>{i.ledgerSnapshot.ledger[3].checksum='a'.repeat(64);},
 'missing RLS':i=>{i.ledgerSnapshot.ledger.pop();},
 'extra pending':i=>{i.allowedPending.push('unknown');},
 'Foundation partially represented':i=>{i.ledgerSnapshot.ledger.push({...i.ledgerSnapshot.ledger[1],migration_name:commercePending[0],checksum:i.repositoryContract.repositoryChecksums[commercePending[0]],finished_at:null});},
 'one Commerce table exists':i=>{i.schemaState.commerceTables.ProductIdentifier=true;},
 'unfinished migration':i=>{i.ledgerSnapshot.ledger[1].finished_at=null;},
 'Raw flag ON':i=>{i.observedFlags.flags.RAW_LISTING_DUAL_WRITE_ENABLED=true;},
 'Shadow flag ON':i=>{i.observedFlags.flags.COMMERCE_SHADOW_ENABLED=true;},
 'distributed canary ON':i=>{i.observedFlags.flags.COMMERCE_DISTRIBUTED_CANARY_ENABLED=true;},
 'catalog persistence ON':i=>{i.observedFlags.flags.CATALOG_POPULATE_ENABLED=true;},
 'token present':i=>{i.observedFlags.canaryTokenPresent=true;},
 'wrong environment':i=>{i.schemaState.targetIdentity.environment='preview';},
 'wrong project':i=>{i.schemaState.targetIdentity.projectId='prj_synthetic_wrong_project';},
 'wrong delivery SHA':i=>{i.schemaState.targetIdentity.deliverySHA='0'.repeat(40);},
 'missing explicit expected release':i=>{delete i.expectedProductionIdentity;},
 'wrong trusted project':i=>{i.expectedProductionIdentity.projectId='prj_synthetic_wrong_project';},
 'flag not observed':i=>{delete i.observedFlags.flags.OFFER_LEDGER_ENABLED;},
 'ambiguous flag value':i=>{i.observedFlags.flags.OFFER_LEDGER_ENABLED='false';},
 'table absence not observed':i=>{delete i.schemaState.commerceTables.OfferObservation;},
 'RLS disabled':i=>{i.schemaState.rls[0].enabled=false;},
 'ownership policy changed':i=>{i.schemaState.policies.find(p=>p.policyname==='favorite_select_own').qual='true';},
 'public write granted':i=>{i.schemaState.grants.find(r=>r.tableName==='Product'&&r.role==='anon').privileges.push('INSERT');},
 'column access beyond table grant':i=>{i.schemaState.columnPrivilegeExceptions.push({tableName:'AdminPushSubscription',role:'anon',privilege:'SELECT'});},
 'grant option added':i=>{i.schemaState.grants[0].grantOptions.push('SELECT');},
 'maintenance privilege added':i=>{i.schemaState.grants[0].privileges.push('MAINTAIN');},
 'default grant added':i=>{i.schemaState.defaultPrivileges.push({role:'anon',privilege:'SELECT'});},
 'unexpected blocker':i=>{i.schemaState.blockers.push('SYNTHETIC_BLOCKER');},
 'unfinished state count':i=>{i.schemaState.unfinishedCount=1;},
 'rolled back state count':i=>{i.schemaState.unexpectedRolledBackCount=1;},
 'legacy count absent':i=>{delete i.schemaState.legacyCounts.Product;},
 'invalid legacy count':i=>{i.schemaState.legacyCounts.Product=-1;},
 'repository contract omitted':i=>{delete i.repositoryContract;},
};
for(const [name,mutate] of Object.entries(mutations))test(`${name} DENIED`,()=>{const i=input();mutate(i);assert.equal(authorizeCommerceMigrateDeploy(i).verdict,'DENIED');});
test('missing or malformed snapshots are DENIED',()=>{assert.equal(authorizeCommerceMigrateDeploy().verdict,'DENIED');const i=input();i.schemaState.policies[0].roles=null;assert.equal(authorizeCommerceMigrateDeploy(i).verdict,'DENIED');});
// ============ R3C: managed security scope reconciliation (Part S) ============
test('R3B production-like fixture AUTHORIZED with out-of-scope observed (6 policies, platform default ACL)',()=>{
 const result=authorizeCommerceMigrateDeploy(r3bInput());
 assert.equal(result.verdict,'AUTHORIZED');
 assert.equal(result.managedTableCount,19);
 assert.equal(result.managedPolicyCount,10);
 assert.equal(result.outOfScopePolicyCount,6);
 assert.deepEqual(result.outOfScopePolicies.map(p=>p.tablename+p.policyname).sort(),['notificationsnotifications_select_own','notificationsnotifications_update_own','price_alertsprice_alerts_delete_own','price_alertsprice_alerts_insert_own','price_alertsprice_alerts_select_own','price_alertsprice_alerts_update_own'].sort());
 assert.equal(result.managedGrantCount,38);
 assert.equal(result.unsafeMigrationDefaultAclCount,0);
 assert.equal(result.publicSchemaCreateSafe,true);
 assert.equal(result.securityScope,'MANAGED_TABLES_ONLY');
});
test('S1 extra policy on unmanaged table stays AUTHORIZED and observed',()=>{
 const i=r3bInput();i.schemaState.policies.push({tablename:'notifications',policyname:'notifications_email_own',permissive:'PERMISSIVE',roles:['authenticated'],cmd:'INSERT',qual:null,with_check:'(( SELECT auth.uid() AS uid) = user_id)'});
 const result=authorizeCommerceMigrateDeploy(i);
 assert.equal(result.verdict,'AUTHORIZED');assert.equal(result.outOfScopePolicyCount,7);assert.ok(result.outOfScopePolicies.some(p=>p.policyname==='notifications_email_own'));
});
test('S2 extra policy on managed table DENIED',()=>{
 const i=r3bInput();i.schemaState.policies.push({tablename:'Product',policyname:'product_extra',permissive:'PERMISSIVE',roles:['anon'],cmd:'SELECT',qual:'true',with_check:null});
 assert.equal(authorizeCommerceMigrateDeploy(i).verdict,'DENIED');
});
test('S3 missing managed policy DENIED',()=>{const i=r3bInput();i.schemaState.policies=i.schemaState.policies.filter(p=>p.policyname!=='favorite_select_own');assert.equal(authorizeCommerceMigrateDeploy(i).verdict,'DENIED');});
test('S4 managed policy qual altered DENIED',()=>{const i=r3bInput();i.schemaState.policies.find(p=>p.policyname==='product_public_read').qual='true';assert.equal(authorizeCommerceMigrateDeploy(i).verdict,'DENIED');});
test('S5 managed policy roles altered DENIED',()=>{const i=r3bInput();i.schemaState.policies.find(p=>p.policyname==='favorite_delete_own').roles=['anon'];assert.equal(authorizeCommerceMigrateDeploy(i).verdict,'DENIED');});
test('S6 extra grant on unmanaged table observed, not denied',()=>{
 const i=r3bInput();i.schemaState.grants.push({tableName:'notifications',role:'anon',privileges:['SELECT'],grantOptions:[]});
 const result=authorizeCommerceMigrateDeploy(i);assert.equal(result.verdict,'AUTHORIZED');assert.equal(result.managedGrantCount,38);
});
test('S7 effective SELECT for anon on managed table DENIED',()=>{const i=r3bInput();i.schemaState.grants.find(r=>r.tableName==='AnalyticsEvent'&&r.role==='anon').privileges.push('SELECT');assert.equal(authorizeCommerceMigrateDeploy(i).verdict,'DENIED');});
test('S8 effective INSERT for authenticated on managed table DENIED',()=>{const i=r3bInput();i.schemaState.grants.find(r=>r.tableName==='BlogPost'&&r.role==='authenticated').privileges.push('INSERT');assert.equal(authorizeCommerceMigrateDeploy(i).verdict,'DENIED');});
test('S9 effective MAINTAIN for anon on managed table DENIED',()=>{const i=r3bInput();i.schemaState.grants.find(r=>r.tableName==='Product'&&r.role==='anon').privileges.push('MAINTAIN');assert.equal(authorizeCommerceMigrateDeploy(i).verdict,'DENIED');});
test('S10 default table ACL migration-role anon SELECT DENIED',()=>{const i=r3bInput();i.schemaState.defaultPrivileges.push({owner:'postgres',schema:'public',objectType:'r',grantee:'anon',privilege:'SELECT',grantable:false});assert.equal(authorizeCommerceMigrateDeploy(i).verdict,'DENIED');});
test('S11 default table ACL migration-role authenticated INSERT DENIED',()=>{const i=r3bInput();i.schemaState.defaultPrivileges.push({owner:'postgres',schema:'public',objectType:'r',grantee:'authenticated',privilege:'INSERT',grantable:false});assert.equal(authorizeCommerceMigrateDeploy(i).verdict,'DENIED');});
test('S12 default table ACL migration-role PUBLIC SELECT DENIED',()=>{const i=r3bInput();i.schemaState.defaultPrivileges.push({owner:'postgres',schema:'public',objectType:'r',grantee:'PUBLIC',privilege:'SELECT',grantable:false});assert.equal(authorizeCommerceMigrateDeploy(i).verdict,'DENIED');});
test('S13 supabase_admin default ACL rows do not deny (out of scope)',()=>{
 const i=r3bInput();i.schemaState.defaultPrivileges.push({owner:'supabase_admin',schema:'public',objectType:'r',grantee:'anon',privilege:'SELECT',grantable:false});
 const result=authorizeCommerceMigrateDeploy(i);assert.equal(result.verdict,'AUTHORIZED');assert.equal(result.unsafeMigrationDefaultAclCount,0);
});
test('S14 service_role default ALL rows are observational, not denied',()=>{
 const i=r3bInput();i.schemaState.defaultPrivileges.push({owner:'postgres',schema:'public',objectType:'r',grantee:'service_role',privilege:'SELECT',grantable:false});
 i.schemaState.defaultPrivileges.push({owner:'postgres',schema:'public',objectType:'r',grantee:'service_role',privilege:'MAINTAIN',grantable:false});
 assert.equal(authorizeCommerceMigrateDeploy(i).verdict,'AUTHORIZED');
});
test('S15 public schema anon CREATE=true DENIED',()=>{const i=r3bInput();i.schemaState.publicSchemaPrivileges.anon.create=true;assert.equal(authorizeCommerceMigrateDeploy(i).verdict,'DENIED');});
test('S16 public schema authenticated CREATE=true DENIED',()=>{const i=r3bInput();i.schemaState.publicSchemaPrivileges.authenticated.create=true;assert.equal(authorizeCommerceMigrateDeploy(i).verdict,'DENIED');});
test('S17 migrationRole missing DENIED',()=>{const i=r3bInput();delete i.schemaState.migrationRole;assert.equal(authorizeCommerceMigrateDeploy(i).verdict,'DENIED');});
test('S18 migrationRole other than postgres DENIED',()=>{const i=r3bInput();i.schemaState.migrationRole='supabase_admin';assert.equal(authorizeCommerceMigrateDeploy(i).verdict,'DENIED');});
test('S19 default ACL snapshot missing DENIED',()=>{const i=r3bInput();delete i.schemaState.defaultPrivileges;assert.equal(authorizeCommerceMigrateDeploy(i).verdict,'DENIED');});
test('S20 public schema privilege snapshot missing DENIED',()=>{const i=r3bInput();delete i.schemaState.publicSchemaPrivileges;assert.equal(authorizeCommerceMigrateDeploy(i).verdict,'DENIED');});
test('S21 duplicate managed policy DENIED',()=>{const i=r3bInput();const p=i.schemaState.policies.find(p=>p.policyname==='favorite_select_own');i.schemaState.policies.push({...p});assert.equal(authorizeCommerceMigrateDeploy(i).verdict,'DENIED');});
test('S22 duplicate managed grant row DENIED',()=>{const i=r3bInput();const r=i.schemaState.grants.find(r=>r.tableName==='Product'&&r.role==='anon');i.schemaState.grants.push({...r});assert.equal(authorizeCommerceMigrateDeploy(i).verdict,'DENIED');});
test('S23 malformed default ACL objectType DENIED',()=>{const i=r3bInput();i.schemaState.defaultPrivileges.push({owner:'postgres',schema:'public',objectType:'X',grantee:'anon',privilege:'SELECT',grantable:false});assert.equal(authorizeCommerceMigrateDeploy(i).verdict,'DENIED');});
test('S24 unknown managed table state DENIED',()=>{const i=r3bInput();i.schemaState.legacyCounts.UnknownTable=0;assert.equal(authorizeCommerceMigrateDeploy(i).verdict,'DENIED');});
// ============ R3C.4 (DEFECT-1): fail-closed boundary hardening on malformed authorization input ============
function verdictOf(value){try{return {threw:false,result:authorizeCommerceMigrateDeploy(value)};}catch(error){return {threw:true,error};}}
test('D1 null/undefined/primitives are DENIED with INVALID_SNAPSHOT and never throw',()=>{
 for(const value of [null,undefined,[],'', 'text',0,1,false,true,1n,Symbol('x'),function(){}]){
  const r=verdictOf(value);
  assert.equal(r.threw,false,'gate threw for '+String(value));
  assert.equal(r.result.verdict,'DENIED');
  assert.equal(r.result.code,'INVALID_SNAPSHOT');
 }
});
test('D2 empty object snapshot DENIED (never throw, never AUTHORIZED)',()=>{
 const r=verdictOf({});
 assert.equal(r.threw,false);assert.equal(r.result.verdict,'DENIED');
});
test('D3 hostile getter/proxy throws never escape the gate',()=>{
 for(const thrown of [null,undefined,'synthetic',123,{},new Error('SYNTHETIC_TEST_ERROR')]){
  const hostile=new Proxy({}, {get(){throw thrown;}});
  const r=verdictOf(hostile);
  assert.equal(r.threw,false,'hostile throw escaped for '+String(thrown));
  assert.equal(r.result.verdict,'DENIED');
 }
});
test('D4 100 consecutive null calls: 100/100 DENIED, 0 throws, 0 AUTHORIZED',()=>{
 for(let n=0;n<100;n++){const r=verdictOf(null);assert.equal(r.threw,false);assert.equal(r.result.verdict,'DENIED');assert.equal(r.result.code,'INVALID_SNAPSHOT');}
});
test('D5 malformed field corruption DENIED (no throw, no AUTHORIZED)',()=>{
 const i=input();
 for(const key of ['ledgerSnapshot','allowedPending','repositoryContract','observedFlags','schemaState','expectedProductionIdentity']){
  const j=structuredClone(i);j[key]=null;assert.equal(verdictOf(j).threw,false);assert.equal(verdictOf(j).result.verdict,'DENIED');
  const k=structuredClone(i);k[key]='x';assert.equal(verdictOf(k).threw,false);assert.equal(verdictOf(k).result.verdict,'DENIED');
  const l=structuredClone(i);l[key]=[];assert.equal(verdictOf(l).threw,false);assert.equal(verdictOf(l).result.verdict,'DENIED');
 }
});
test('D6 valid inputs still AUTHORIZED after boundary hardening',()=>{
 assert.equal(authorizeCommerceMigrateDeploy(input()).verdict,'AUTHORIZED');
 assert.equal(authorizeCommerceMigrateDeploy(r3bInput()).verdict,'AUTHORIZED');
});
// R3C.5: global (empty-schema) defaults affect tables created in public.
const aclTablePrivileges = ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'];
const aclPrivilegesByType = {r:aclTablePrivileges,S:['SELECT','UPDATE','USAGE'],f:['EXECUTE'],T:['USAGE'],n:['USAGE','CREATE']};
function aclRow(overrides={}) {
 return {owner:'postgres',schema:'',objectType:'r',grantee:'anon',privilege:'SELECT',grantable:false,...overrides};
}
function authorizeAcl(row) {
 const i=r3bInput();i.schemaState.defaultPrivileges.push(row);return authorizeCommerceMigrateDeploy(i);
}
for(const [name,row] of [
 ['public anon SELECT',aclRow({schema:'public'})],
 ['public authenticated INSERT',aclRow({schema:'public',grantee:'authenticated',privilege:'INSERT'})],
 ['public PUBLIC SELECT',aclRow({schema:'public',grantee:'PUBLIC'})],
 ['global anon SELECT',aclRow()],
 ['global authenticated INSERT',aclRow({grantee:'authenticated',privilege:'INSERT'})],
 ['global PUBLIC DELETE',aclRow({grantee:'PUBLIC',privilege:'DELETE'})],
 ['global PUBLIC MAINTAIN',aclRow({grantee:'PUBLIC',privilege:'MAINTAIN'})],
 ...['anon','authenticated','PUBLIC'].map(grantee=>['global grant option '+grantee,aclRow({grantee,grantable:true})]),
])test('R3C5 unsafe '+name+' DENIED',()=>{
 assert.deepEqual(authorizeAcl(row),{verdict:'DENIED',code:'DEFAULT_ACL_UNSAFE'});
});
for(const [name,row] of [
 ['platform global',aclRow({owner:'supabase_admin'})],
 ['platform public',aclRow({owner:'supabase_admin',schema:'public'})],
 ['unrelated schema',aclRow({schema:'unrelated_schema'})],
 ...Object.entries(aclPrivilegesByType).filter(([type])=>type!=='r').map(([objectType,privileges])=>['non-table '+objectType,aclRow({objectType,privilege:privileges[0]})]),
])test('R3C5 safe '+name+' AUTHORIZED',()=>{
 assert.equal(authorizeAcl(row).verdict,'AUTHORIZED');
});
test('R3C5 global service_role ALL-like expanded privileges remain AUTHORIZED',()=>{
 const i=r3bInput();
 i.schemaState.defaultPrivileges.push(...aclTablePrivileges.map(privilege=>aclRow({grantee:'service_role',privilege,grantable:true})));
 assert.equal(authorizeCommerceMigrateDeploy(i).verdict,'AUTHORIZED');
});
for(const malformed of [
 {privilege:''},{privilege:'BOGUS'},{privilege:'ALL'},{privilege:'select'},
 {privilege:'USAGE'},{privilege:'EXECUTE'},{privilege:null},{privilege:[]},
 {objectType:''},{objectType:'X'},{objectType:null},{objectType:['r']},{objectType:'__proto__'},
 {objectType:'S',privilege:'DELETE'},{objectType:'f',privilege:'SELECT'},
 {objectType:'T',privilege:'SELECT'},{objectType:'n',privilege:'SELECT'},
 {grantable:'true'},{schema:null},
])test('R3C5 malformed global ACL '+JSON.stringify(malformed)+' DENIED',()=>{
 assert.deepEqual(authorizeAcl(aclRow({grantee:'PUBLIC',...malformed})),{verdict:'DENIED',code:'DEFAULT_ACL_ROW_INVALID'});
});
test('R3C5 missing defaults and null snapshot stay fail closed',()=>{
 const i=r3bInput();delete i.schemaState.defaultPrivileges;
 assert.deepEqual(authorizeCommerceMigrateDeploy(i),{verdict:'DENIED',code:'DEFAULT_PRIVILEGES_MISSING'});
 assert.deepEqual(authorizeCommerceMigrateDeploy(null),{verdict:'DENIED',code:'INVALID_SNAPSHOT'});
});
test('R3C5 exhaustive mutation matrix: 7680 cases, no unsafe authorization',t=>{
 const baseline=r3bInput();assert.equal(authorizeCommerceMigrateDeploy(baseline).verdict,'AUTHORIZED');
 let mutationCases=0,unsafeCases=0,unsafeAuthorizedCount=0,malformedAuthorizedCount=0;
 // Two independent insertion positions also check that row order cannot hide an ACL.
 for(const position of ['first','last'])for(const owner of ['postgres','supabase_admin','service_role_like'])
 for(const schema of ['','public','private','other'])for(const objectType of ['r','S','f','T','n'])
 for(const grantee of ['anon','authenticated','PUBLIC','service_role'])for(const privilege of aclTablePrivileges)
 for(const grantable of [false,true]) {
  const row={owner,schema,objectType,grantee,privilege,grantable};
  const defaults=baseline.schemaState.defaultPrivileges;
  const i={...baseline,schemaState:{...baseline.schemaState,defaultPrivileges:position==='first'?[row,...defaults]:[...defaults,row]}};
  const result=authorizeCommerceMigrateDeploy(i);mutationCases++;
  // Independent property oracle: enumerate exposed targets, not the production filter.
  const unsafe=['postgres||r|anon','postgres||r|authenticated','postgres||r|PUBLIC',
   'postgres|public|r|anon','postgres|public|r|authenticated','postgres|public|r|PUBLIC'].includes([owner,schema,objectType,grantee].join('|'));
  if(unsafe){unsafeCases++;if(result.verdict==='AUTHORIZED')unsafeAuthorizedCount++;}
  if(!aclPrivilegesByType[objectType].includes(privilege)&&result.verdict==='AUTHORIZED')malformedAuthorizedCount++;
 }
 t.diagnostic(JSON.stringify({mutationCases,unsafeCases,unsafeAuthorizedCount,malformedAuthorizedCount}));
 assert.equal(mutationCases,7680);assert.equal(unsafeCases,192);
 assert.equal(unsafeAuthorizedCount,0);assert.equal(malformedAuthorizedCount,0);
});
test('R3C5 safe-case matrix: at least 2000 valid ACL cases, no false denials',t=>{
 const baseline=r3bInput();assert.equal(authorizeCommerceMigrateDeploy(baseline).verdict,'AUTHORIZED');
 const safeRows=[];
 for(const owner of ['postgres','supabase_admin','service_role_like'])for(const schema of ['','public','private','other'])
 for(const [objectType,privileges] of Object.entries(aclPrivilegesByType))for(const grantee of ['anon','authenticated','PUBLIC','service_role'])
 for(const privilege of privileges)for(const grantable of [false,true]) {
  // Construct safe families independently: another owner/schema/recipient/object class.
  if(owner==='supabase_admin'||owner==='service_role_like'||schema==='private'||schema==='other'||grantee==='service_role'||objectType!=='r')
   safeRows.push({owner,schema,objectType,grantee,privilege,grantable});
 }
 let safeCases=0,falseDenyCount=0;
 for(const row of safeRows)for(const position of ['first','last']) {
  const defaults=baseline.schemaState.defaultPrivileges;
  const result=authorizeCommerceMigrateDeploy({...baseline,schemaState:{...baseline.schemaState,defaultPrivileges:position==='first'?[row,...defaults]:[...defaults,row]}});
  safeCases++;if(result.verdict!=='AUTHORIZED')falseDenyCount++;
 }
 t.diagnostic(JSON.stringify({safeCases,distinctSafeRows:safeRows.length,falseDenyCount}));
 assert.ok(safeCases>=2000);assert.equal(falseDenyCount,0);
});
