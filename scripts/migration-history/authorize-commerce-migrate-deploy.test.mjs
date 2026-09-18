import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from './production-ledger.fixture.json' with {type:'json'};
import security from './expected-security-state.json' with {type:'json'};
import pins from './forensic-pins.json' with {type:'json'};
import {loadRepositoryContract,commercePending} from './verify-ledger-compatibility.mjs';
import {authorizeCommerceMigrateDeploy,requiredOffFlags,commerceTables} from './authorize-commerce-migrate-deploy.mjs';
function input(){
 const identity={environment:'production',targetEnvironment:'production',projectId:pins.projectId,deliverySHA:'ec755ac167db6d46f939be1005c791142c6127c2'};
 return {ledgerSnapshot:structuredClone(fixture),allowedPending:[...commercePending],repositoryContract:loadRepositoryContract(),expectedProductionIdentity:identity,observedFlags:{version:1,flags:Object.fromEntries(requiredOffFlags.map(f=>[f,false])),canaryTokenPresent:false},schemaState:{...structuredClone(security),targetIdentity:{...identity},commerceTables:Object.fromEntries(commerceTables.map(t=>[t,false])),unfinishedCount:0,unexpectedRolledBackCount:0,blockers:[],legacyCounts:Object.fromEntries(security.rls.filter(r=>r.tableName!=='_prisma_migrations').map(r=>[r.tableName,0]))}};
}
test('all independent gates authorize exact pending without mutating inputs',()=>{
 const i=input(),before=structuredClone(i);const result=authorizeCommerceMigrateDeploy(i);
 assert.equal(result.verdict,'AUTHORIZED');assert.equal(result.knownDivergences,2);assert.deepEqual(result.pending,commercePending);assert.deepEqual(i,before);
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
