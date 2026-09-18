import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { commerceEnabled, commerceFlagNames } from './flags';
import { normalizeAttributes, buildVariantKey, extractIdentifiers, identifiersConflict, buildObservationFingerprint, computeEffectivePrice, type PriceComponent } from './domain';
import { createCommerceRepositories } from './repositories';

async function main() {
for (const flag of commerceFlagNames) {
  for (const value of [undefined,'','false','TRUEish','1','yes']) assert.equal(commerceEnabled(flag,{[flag]:value}),false);
  assert.equal(commerceEnabled(flag,{[flag]:' True '}),true);
}
assert.deepEqual(normalizeAttributes([{id:'COLOR',value_name:' Azul '},{id:'RAM_MEMORY',value_name:'16 GB'}]),{color:'azul',memory:'16gb'});
assert.equal(buildVariantKey({Color:' AZUL ',size:'M'}),buildVariantKey({size:' m ',color:'azul'}));
assert.equal(buildVariantKey([{id:'color',value:'a'},{id:'cor',value:'b'}]),buildVariantKey([{id:'cor',value:'b'},{id:'color',value:'a'}]));
assert.notEqual(buildVariantKey({voltage:'110v'}),buildVariantKey({voltage:'220v'}));
const ids=extractIdentifiers({ean:'4006381333931',mpn:' abc  123 ',brand:' Acme ',marketplace:'AMAZON',externalId:'a123'});
assert.equal(ids.find(i=>i.type==='EAN')?.valid,true);
assert.equal(ids.find(i=>i.type==='MPN')?.normalizedValue,'ABC 123');
assert.equal(ids.find(i=>i.type==='MPN')?.value,' abc  123 ');
assert.equal(extractIdentifiers({ean:'4006381333932'})[0].valid,false);
assert.equal(extractIdentifiers({ean:'invented'})[0].valid,false);
assert.equal(extractIdentifiers({isbn:'0-306-40615-2'})[0].valid,true);
assert.deepEqual(extractIdentifiers({}),[]);
assert.deepEqual(normalizeAttributes(JSON.parse('{"__proto__":"x","constructor":"y"}')),{});
assert.deepEqual(extractIdentifiers({attributes:JSON.parse('{"__proto__":"x","constructor":"y"}')}),[]);
assert.equal(extractIdentifiers({gtin:'0000000000000'})[0].valid,false);
const mpn=ids.find(i=>i.type==='MPN')!;
assert.equal(identifiersConflict(mpn,{...mpn,brandScope:'other'}),false);
assert.equal(identifiersConflict(mpn,{...mpn,brandScope:undefined}),false);
assert.equal(identifiersConflict(mpn,mpn),true);
const ext=ids.find(i=>i.type==='MARKETPLACE_EXTERNAL_ID')!;
assert.equal(identifiersConflict(ext,{...ext,marketplace:'SHOPEE'}),false);
assert.equal(identifiersConflict(ids[0],ids[0]),true);
const c=(type:PriceComponent['type'],amount?:number,conditions?:PriceComponent['conditions']):PriceComponent=>({type,amount,currency:'BRL',truthState:amount==null?'UNKNOWN':'EXACT',conditions});
const base={marketplace:'AMAZON',externalId:'a1',price:100,currency:'BRL',stock:1,available:true};
assert.equal(buildObservationFingerprint(base),buildObservationFingerprint({...base,price:'100.000000'}));
for(const patch of [{price:99},{stock:0},{available:false},{currency:'USD'},{sellerId:'different'}]) assert.notEqual(buildObservationFingerprint(base),buildObservationFingerprint({...base,...patch}));
const components=[c('SALE_PRICE',100),c('SHIPPING',10)];
assert.equal(buildObservationFingerprint({...base,components}),buildObservationFingerprint({...base,components:[...components].reverse()}));
assert.notEqual(buildObservationFingerprint({...base,components}),buildObservationFingerprint({...base,components:[c('SALE_PRICE',100),c('SHIPPING',20)]}));
assert.equal(computeEffectivePrice(components).value,'110.000000');
assert.equal(computeEffectivePrice(components).state,'EXACT');
assert.equal(computeEffectivePrice([c('SALE_PRICE',100)]).state,'PARTIAL');
assert.ok(computeEffectivePrice([c('SALE_PRICE',100)]).explanation.missing.includes('shipping'));
assert.equal(computeEffectivePrice([]).state,'UNKNOWN');
assert.equal(computeEffectivePrice([c('LIST_PRICE',100)]).state,'UNKNOWN');
assert.equal(computeEffectivePrice([...components,c('PIX_DISCOUNT',10,{eligible:true})]).value,'100.000000');
assert.equal(computeEffectivePrice([...components,c('COUPON',20,{code:'X'})]).state,'PARTIAL');
assert.equal(computeEffectivePrice([...components,c('COUPON',20,{eligible:true})]).value,'90.000000');
assert.equal(computeEffectivePrice([c('SALE_PRICE',0.1),c('SHIPPING',0.2)]).value,'0.300000');
assert.equal(computeEffectivePrice([c('SALE_PRICE',100),c('SHIPPING')]).state,'PARTIAL');
assert.equal(computeEffectivePrice([c('SALE_PRICE',100),c('SALE_PRICE',90)]).state,'UNKNOWN');
assert.equal(computeEffectivePrice([c('SALE_PRICE',100),{...c('SHIPPING',10),currency:'USD'}]).state,'UNKNOWN');
assert.equal(computeEffectivePrice([{...c('FINAL_EFFECTIVE_PRICE',20),truthState:'ESTIMATED'}]).state,'ESTIMATED');
for(let i=0;i<200;i++) {
  const attrs={color:'Blue '+i,storage:i+' GB',voltage:'220 V'};
  assert.equal(buildVariantKey(attrs),buildVariantKey(Object.fromEntries(Object.entries(attrs).reverse())));
}
const repos=createCommerceRepositories(()=>{throw new Error('DB touched while OFF');},()=>false);
assert.deepEqual(await repos.productIdentifierRepository.create({productId:'p',type:'MPN',value:'x',normalizedValue:'X',source:'test',confidence:'LOW'}),{status:'disabled'});
assert.deepEqual(await repos.variantRepository.upsert('p',{color:'blue'}),{status:'disabled'});
assert.deepEqual(await repos.identityEvidenceRepository.append({kind:'TITLE_MATCH',rawEvidence:{},confidence:'LOW',source:'test'}),{status:'disabled'});
assert.deepEqual(await repos.identityConflictRepository.record({reason:'test',details:{}}),{status:'disabled'});
assert.deepEqual(await repos.offerObservationRepository.append({marketplace:'AMAZON',externalId:'a1',capturedAt:new Date(),provenance:{}},base),{status:'disabled'});
assert.deepEqual(await repos.trustSignalRepository.append({scopeType:'PRODUCT',scopeId:'p',signalType:'seller.verified',state:'UNKNOWN',source:'test',evidence:{},observedAt:new Date()}),{status:'disabled'});
assert.deepEqual(await repos.productRelationRepository.create({fromProductId:'p',toProductId:'q',relationType:'ACCESSORY',confidence:'LOW',source:'test',evidence:{}}),{status:'disabled'});

assert.equal(computeEffectivePrice([...components,c('PIX_DISCOUNT',10)]).state,'PARTIAL');
assert.equal(computeEffectivePrice([...components,c('PIX_DISCOUNT',10)]).value,'110.000000');
let writes=0;
const mock={trustSignal:{create:async (args:unknown)=>{writes++;return args;}},offerObservation:{create:async ()=>{throw Object.assign(new Error('duplicate'),{code:'P2002'});},findUnique:async ()=>({id:'existing'})}};
const on=createCommerceRepositories(()=>mock as unknown as ReturnType<Parameters<typeof createCommerceRepositories>[0]>,()=>true);
await assert.rejects(on.trustSignalRepository.append({scopeType:'PRODUCT',scopeId:'p',productId:'q',signalType:'seller.verified',state:'CONFIRMED',source:'test',evidence:{},observedAt:new Date()}),/INVALID_TRUST_SCOPE/);
assert.equal(writes,0);
await on.trustSignalRepository.append({scopeType:'PRODUCT',scopeId:'p',productId:'p',signalType:'seller.verified',state:'CONFIRMED',source:'test',evidence:{},observedAt:new Date()});
assert.equal(writes,1);
assert.deepEqual(await on.offerObservationRepository.append({marketplace:'AMAZON',externalId:'a1',price:100,capturedAt:new Date(),provenance:{}},base),{status:'written',value:{id:'existing'}});
await assert.rejects(on.productIdentifierRepository.create({productId:'p',type:'MPN',value:'abc',normalizedValue:'ABC',source:'test',confidence:'HIGH'}),/BRAND_SCOPE_REQUIRED/);
await assert.rejects(on.productIdentifierRepository.create({productId:'p',type:'GTIN',value:'fake',normalizedValue:'fake',source:'test',confidence:'LOW'}),/INVALID_IDENTIFIER/);

const manifest=JSON.parse(readFileSync('scripts/bootstrap/manifest.json','utf8'));
assert.equal(manifest.version,3);
assert.equal(Object.keys(manifest.baselineMigrations).length,7);
// forwardMigrations é um inventário EXTENSÍVEL: 50AG.3+ adicionou
// legitimamente 20260918100000_commerce_canary_control_plane. Este teste da
// Foundation deve provar que a migration Foundation continua PRESENTE, PINADA
// e ADITIVA — e não impor uma contagem total de forward migrations.
const foundationMigration='20260917120000_commerce_intelligence_foundation';
const foundationChecksum=manifest.forwardMigrations[foundationMigration];
assert.ok(typeof foundationChecksum==='string'&&/^[0-9a-f]{64}$/.test(foundationChecksum),'foundation migration presente e pinada no manifest (checksum valido)');
const sql=readFileSync('prisma/migrations/'+foundationMigration+'/migration.sql','utf8');
for (const statement of sql.replace(/--[^\n]*/g,'').split(';').filter(s=>s.trim())) assert.match(statement.trim(), /^(CREATE (TYPE|TABLE|(?:UNIQUE )?INDEX)|ALTER TABLE \"[^\"]+\" ADD CONSTRAINT)/);
console.log('COMMERCE_FOUNDATION_TESTS=PASS');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
