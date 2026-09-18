import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {createCommerceRepositories} from './repositories';

async function main() {
const target=process.env.DATABASE_URL;
if(!target) throw new Error('LOCAL_URL_REQUIRED');
const url=new URL(target);
if(url.hostname!=='127.0.0.1'||url.port!=='55433'||url.pathname!=='/ofertano_50ag1_foundation') throw new Error('LOCAL_TRIPWIRE');
const prisma=new PrismaClient({adapter:new PrismaPg({connectionString:target})});
const on=createCommerceRepositories(()=>prisma,()=>true);
try {
  const observation={marketplace:'AMAZON' as const,externalId:'50ag1-lab-offer',price:'100',currency:'BRL',stock:5,available:true,capturedAt:new Date(),provenance:{lab:'50ag1'}};
  const state={marketplace:'AMAZON',externalId:observation.externalId,price:'100',currency:'BRL',stock:5,available:true,components:[{type:'SALE_PRICE' as const,amount:'100',currency:'BRL',truthState:'EXACT' as const},{type:'SHIPPING' as const,amount:'0',currency:'BRL',truthState:'EXACT' as const}]};
  const [a,b]=await Promise.all([on.offerObservationRepository.append(observation,state),on.offerObservationRepository.append(observation,{...state,components:[...state.components].reverse()})]);
  assert.equal(a.status,'written');assert.equal(b.status,'written');
  if(a.status!=='written'||b.status!=='written')throw Error('disabled');
  assert.equal(a.value.id,b.value.id);
  assert.equal(await prisma.offerPriceComponent.count({where:{observationId:a.value.id}}),2);
  const changed=await on.offerObservationRepository.append({...observation,price:'90'}, {...state,price:'90',components:[{...state.components[0],amount:'90'},state.components[1]]});
  assert.equal(changed.status,'written');if(changed.status==='written')assert.notEqual(changed.value.id,a.value.id);
  const before=await prisma.offerObservation.count();
  const off=createCommerceRepositories(()=>{throw new Error('OFF touched client');},()=>false);
  assert.deepEqual(await off.offerObservationRepository.append(observation,state),{status:'disabled'});
  assert.equal(await prisma.offerObservation.count(),before);
  const trust=await on.trustSignalRepository.append({scopeType:'OFFER_OBSERVATION',scopeId:a.value.id,observationId:a.value.id,signalType:'price.observed',state:'CONFIRMED',source:'lab',evidence:{captured:true},observedAt:new Date()});
  assert.equal(trust.status,'written');
  await assert.rejects(prisma.offerObservation.delete({where:{id:a.value.id}}), /foreign key constraint/i);
  assert.equal(await prisma.product.count(),0);assert.equal(await prisma.rawMarketplaceListing.count(),0);assert.equal(await prisma.marketplaceOffer.count(),0);
  console.log('REAL_REPOSITORY_CONCURRENT_DEDUPE=PASS\nPRICE_COMPONENT_ATOMIC_APPEND=PASS\nTRUST_SCOPE_FK=PASS\nLEDGER_DELETE_RESTRICT=PASS\nLEGACY_LOCAL_COUNTS_ZERO=PASS');
} finally {await prisma.$disconnect();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
