import './block-network.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRuntime, normalize } from '../src/runtime.mjs';
import { createDrivers } from '../src/drivers.mjs';
import { derive } from '../src/derive.mjs';

const env = Object.freeze({ DIRECT_URL: 'postgresql://fixture_user:fixture_password@fixture.invalid/fixture?sslmode=disable' });
const names = events => events.map(e => e.marker);
const dryNames = ['V11_RUNTIME_START','V11_ENV_CHECK_START','V11_ENV_CHECK_OK','V11_URL_NORMALIZED',
  'V11_FINGERPRINT_READY','V11_DRY_RUN_COMPLETE','V11_PROCESS_EXIT_SUCCESS'];
async function receipt() {
  return (await createRuntime(()=>{}).run({env})).receipt;
}
async function simulate(options = {}) {
  const events=[];
  const runtime=createRuntime(e=>events.push(e));
  const calls=[];
  const factory = stage => url => {
    calls.push([stage,'construct',url]);
    if (options[stage]==='construct') throw new Error(env.DIRECT_URL);
    return {
      async connect() {
        assert.equal(events.at(-1).marker,`V11_${stage}_CONNECT_ATTEMPT`);
        assert.ok(!names(events).includes(`V11_${stage}_CONNECTED`));
        calls.push([stage,'connect']);
        if (options[stage]==='connect') throw new Error(env.DIRECT_URL);
      },
      async readOnly() {
        calls.push([stage,'readOnly']);
        assert.equal(events.at(-1).marker,`V11_${stage}_CONNECTED`);
        if(options[stage]==='query') throw new Error(env.DIRECT_URL);
        return options[stage]==='ro-off' ? [{tr:'off'}] : [{tr:'on'}];
      },
      async tls() {
        calls.push([stage,'tls']);
        assert.equal(events.at(-1).marker,`V11_${stage}_READ_ONLY_CONFIRMED`);
        if(options[stage]==='tls-query') throw new Error(env.DIRECT_URL);
        if(options[stage]==='tls-empty') return [];
        if(options[stage]==='tls-string') return [{ssl:'true'}];
        if(options[stage]==='tls-many') return [{ssl:true},{ssl:true}];
        return [{ssl:options[stage]!=='tls-off'}];
      },
      socketEncrypted:()=>options[stage]!=='socket-off',
      async disconnect() {
        assert.ok(!names(events).includes(`V11_${stage}_DISCONNECTED`));
        calls.push([stage,'disconnect']);
        if(options[stage]==='disconnect') throw new Error(env.DIRECT_URL);
      },
    };
  };
  const outcome=await runtime.run({env,mode:'real',dryRunReceipt:await receipt(),
    drivers:{pg:factory('PG'),prisma:factory('PRISMA')}});
  assert.ok(!names(events).includes('V11_PROCESS_EXIT_SUCCESS'));
  runtime.processExit(outcome.ok?0:1); // simulated host exit, never production evidence
  return {events,calls,outcome,report:derive(events)};
}

test('dry-run has exact sequence, never touches drivers, and does not invent TLS', async()=>{
  const events=[];
  const drivers=new Proxy({}, {get(){throw new Error('DRIVER_WAS_TOUCHED');}});
  const r=createRuntime(e=>events.push(e));
  const out=await r.run({env,drivers});
  assert.equal(out.ok,true);
  assert.deepEqual(names(events),dryNames.slice(0,-1));
  r.processExit(0);
  assert.deepEqual(names(events),dryNames);
  const report=derive(events);
  assert.equal(report.EVIDENCE_VALID,'YES');
  assert.equal(report.DATABASE_CONNECTION_ATTEMPTED,'NO');
  assert.equal(report.PG_CONNECTION_RESULT,'NOT_RUN');
  assert.equal(report.PG_TLS_ACTIVE,'INDETERMINATE');
});

test('happy path: connect/queries/disconnect are awaited in deterministic PG then Prisma order',async()=>{
  const {events,calls,outcome,report}=await simulate();
  assert.equal(outcome.ok,true);
  assert.deepEqual(names(events),[...dryNames.slice(0,5),...['PG','PRISMA'].flatMap(s=>
    ['PROBE_START','CONNECT_ATTEMPT','CONNECTED','READ_ONLY_CONFIRMED','TLS_CONFIRMED','DISCONNECTED'].map(m=>`V11_${s}_${m}`)),
    'V11_PROBE_COMPLETE','V11_PROCESS_EXIT_SUCCESS']);
  assert.equal(calls.filter(x=>x[1]==='construct')[0][2],calls.filter(x=>x[1]==='construct')[1][2]);
  for(const s of ['PG','PRISMA']) {
    assert.equal(report[`${s}_CONNECTION_RESULT`],'PASS');
    assert.equal(report[`${s}_TLS_ACTIVE`],'YES');
    assert.equal(report[`${s}_DISCONNECTED`],'YES');
  }
  assert.equal(report.EVIDENCE_VALID,'YES');
  assert.equal(report.BUILD_PIPELINE_RESULT,'NOT_EVIDENCED');
  assert.equal(report.FUNCTION_RUNTIME_INVOCATION_RESULT,'NOT_EVIDENCED');
});

for(const stage of ['PG','PRISMA']) {
  test(`${stage} connection rejection is connection error, not TLS failure`,async()=>{
    const {events,report,outcome}=await simulate({[stage]:'connect'});
    assert.equal(outcome.ok,false);
    assert.ok(names(events).includes(`V11_${stage}_CONNECT_ERROR`));
    assert.ok(!names(events).includes(`V11_${stage}_CONNECTED`));
    assert.ok(!names(events).includes(`V11_${stage}_TLS_CONFIRMED`));
    assert.equal(report.EVIDENCE_VALID,'YES');
    assert.equal(report[`${stage}_CONNECTION_ATTEMPTED`],'YES');
    assert.equal(report[`${stage}_CONNECTION_RESULT`],'FAIL');
    assert.equal(report[`${stage}_TLS_ACTIVE`],'INDETERMINATE');
    if(stage==='PG') assert.equal(report.PRISMA_CONNECTION_RESULT,'NOT_RUN');
    else assert.equal(report.PG_CONNECTION_RESULT,'PASS');
  });
  for(const failure of ['query','ro-off','tls-query','tls-empty','tls-string','tls-many','tls-off']) {
    test(`${stage} ${failure} cannot emit TLS confirmation or process success`,async()=>{
      const {events,outcome,report}=await simulate({[stage]:failure});
      assert.equal(outcome.ok,false);
      assert.ok(names(events).includes(`V11_${stage}_QUERY_ERROR`));
      assert.ok(!names(events).includes(`V11_${stage}_TLS_CONFIRMED`));
      assert.ok(!names(events).includes('V11_PROCESS_EXIT_SUCCESS'));
      assert.equal(report[`${stage}_CONNECTION_RESULT`],'PASS');
      assert.equal(report.EVIDENCE_VALID,'YES');
      assert.equal(report[`${stage}_TLS_ACTIVE`],failure==='tls-off'?'NO':'INDETERMINATE');
    });
  }
  test(`${stage} disconnect failure never emits disconnected or completion`,async()=>{
    const {events,report,outcome}=await simulate({[stage]:'disconnect'});
    assert.equal(outcome.ok,false);
    assert.ok(!names(events).includes(`V11_${stage}_DISCONNECTED`));
    assert.ok(events.some(e=>e.marker==='V11_INTERNAL_ERROR' && e.reason==='DISCONNECT_FAILED'));
    assert.equal(report[`${stage}_DISCONNECTED`],'NOT_EVIDENCED');
  });
  test(`${stage} constructor failure never invents connect attempt`,async()=>{
    const {events,outcome,report}=await simulate({[stage]:'construct'});
    assert.equal(outcome.ok,false);
    assert.ok(!names(events).includes(`V11_${stage}_CONNECT_ATTEMPT`));
    assert.equal(report[`${stage}_CONNECTION_ATTEMPTED`],'NOT_EVIDENCED');
    assert.equal(report[`${stage}_CONNECTION_RESULT`],'INDETERMINATE');
  });
}

test('PG socket must be positively encrypted even if query returned ssl true',async()=>{
  const {events,outcome}=await simulate({PG:'socket-off'});
  assert.equal(outcome.ok,false);
  assert.ok(!names(events).includes('V11_PG_TLS_CONFIRMED'));
});

test('RUN_ID stable and unique across runs, sequence increasing, timestamp valid',async()=>{
  const a=await simulate(); const b=await simulate();
  assert.equal(new Set(a.events.map(e=>e.run_id)).size,1);
  assert.notEqual(a.events[0].run_id,b.events[0].run_id);
  for(const [i,e] of a.events.entries()) {
    assert.equal(e.sequence,i+1); assert.ok(Number.isFinite(Date.parse(e.timestamp)));
  }
});

test('no secret values, env key names, raw errors, rows or URLs in markers/results',async()=>{
  for(const opts of [{},{PG:'connect'},{PRISMA:'query'},{PG:'disconnect'}]) {
    const {events,outcome}=await simulate(opts);
    const serialized=JSON.stringify({events,outcome});
    for(const secret of ['fixture_user','fixture_password','fixture.invalid','postgresql://','DIRECT_URL','DATABASE_URL']) {
      assert.ok(!serialized.includes(secret));
    }
    const fp=events.find(e=>e.marker==='V11_FINGERPRINT_READY').fingerprint;
    assert.match(fp,/^sha256:[a-f0-9]{16}$/);
  }
});

for(const value of [undefined,'','not a URL','https://fixture.invalid','postgresql://fixture.invalid/db#fragment']) {
  test(`invalid input ${String(value)} fails closed before factories`,async()=>{
    const events=[]; const r=createRuntime(e=>events.push(e));
    const out=await r.run({env:{DIRECT_URL:value}}); r.processExit(1);
    assert.equal(out.ok,false); assert.ok(names(events).includes('V11_ENV_ERROR'));
    assert.equal(derive(events).DATABASE_CONNECTION_ATTEMPTED,'NO');
  });
}

test('required production signals fail closed without leaking environment values',async()=>{
  const events=[]; const r=createRuntime(e=>events.push(e));
  assert.equal((await r.run({env:{...env,V11_REQUIRE_PRODUCTION:'true',VERCEL_ENV:'secret-env'}})).ok,false);
  assert.ok(!JSON.stringify(events).includes('secret-env'));
});

test('normalization enforces require, preserves unrelated parameters and input',()=>{
  const raw=env.DIRECT_URL+'&application_name=fixture';
  const normalized=normalize(raw); const u=new URL(normalized);
  assert.equal(u.searchParams.get('sslmode'),'require');
  assert.equal(u.searchParams.get('application_name'),'fixture');
  assert.ok(raw.includes('sslmode=disable'));
  assert.equal(normalize(normalized),normalized);
});

test('real mode rejects absent, forged, mismatched or reused dry-run receipt before factory',async()=>{
  const realReceipt=await receipt();
  for(const [candidate,input] of [[undefined,env],[{},env],[realReceipt,{DIRECT_URL:env.DIRECT_URL+'/other'}]]) {
    const events=[]; const r=createRuntime(e=>events.push(e));
    const out=await r.run({env:input,mode:'real',dryRunReceipt:candidate});
    assert.equal(out.ok,false); assert.equal(derive(events).DATABASE_CONNECTION_ATTEMPTED,'NO');
  }
  const r=createRuntime(()=>{});
  assert.equal((await r.run({env,mode:'real',dryRunReceipt:realReceipt})).ok,false); // consumes receipt, no drivers
  const events=[];
  await createRuntime(e=>events.push(e)).run({env,mode:'real',dryRunReceipt:realReceipt});
  assert.ok(events.some(e=>e.reason==='DRY_RUN_PASS_REQUIRED'));
});

test('empty/incomplete evidence remains indeterminate; mixed, reordered or contradictory logs rejected',async()=>{
  assert.equal(derive([]).PG_CONNECTION_ATTEMPTED,'NOT_EVIDENCED');
  assert.equal(derive([]).PG_CONNECTION_RESULT,'INDETERMINATE');
  const {events}=await simulate();
  assert.equal(derive(events.slice(0,5)).PG_CONNECTION_RESULT,'INDETERMINATE');
  const changed=events.map(e=>({...e}));
  changed[6].run_id='00000000-0000-0000-0000-000000000000';
  assert.equal(derive(changed).EVIDENCE_VALID,'NO');
  const reordered=events.map(e=>({...e}));
  [reordered[6].marker,reordered[7].marker]=[reordered[7].marker,reordered[6].marker];
  assert.equal(derive(reordered).EVIDENCE_VALID,'NO');
  assert.equal(derive([null]).EVIDENCE_VALID,'NO');
});

test('success marker only after host exit zero and only once',async()=>{
  const events=[]; const r=createRuntime(e=>events.push(e));
  await r.run({env}); assert.equal(names(events).at(-1),'V11_DRY_RUN_COMPLETE');
  r.processExit(2); r.processExit(0);
  assert.equal(names(events).at(-1),'V11_PROCESS_EXIT_FAILURE');
  assert.equal(derive(events).V11_PROCESS_EXIT_CODE,2);
});

test('actual local child dry-run exits 0, emits exit last, with network APIs blocked',()=>{
  const child=spawnSync(process.execPath,['--import',new URL('./block-network.mjs',import.meta.url).pathname,
    new URL('../src/dry-run.mjs',import.meta.url).pathname,'--dry-run'],{env:{...env},encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);
  assert.equal(child.stderr,'');
  assert.deepEqual(names(child.stdout.trim().split('\n').map(JSON.parse)),dryNames);
});

test('actual local child with missing env exits 1 and never emits success',()=>{
  const child=spawnSync(process.execPath,['--import',new URL('./block-network.mjs',import.meta.url).pathname,
    new URL('../src/dry-run.mjs',import.meta.url).pathname],{env:{},encoding:'utf8'});
  assert.equal(child.status,1,child.stderr);
  const events=child.stdout.trim().split('\n').map(JSON.parse);
  assert.ok(!names(events).includes('V11_PROCESS_EXIT_SUCCESS'));
  assert.equal(names(events).at(-1),'V11_PROCESS_EXIT_FAILURE');
});

test('concrete adapters use only fixed read queries, same URL, startup read-only and awaited lifecycles',async()=>{
  const calls=[];
  class Client {
    constructor(config){this.config=config; calls.push(['pg-config',config]); this.connection={stream:{encrypted:true}};}
    async connect(){calls.push(['pg-connect']);}
    async query(sql){calls.push(['query',sql]); return {rows:sql.includes('current_setting')?[{tr:'on'}]:[{ssl:true}]};}
    async end(){calls.push(['pg-end']);}
  }
  class PrismaPg {constructor(config){calls.push(['prisma-config',config]);}}
  class PrismaClient {
    constructor({log}){assert.deepEqual(log,[]);}
    async $connect(){calls.push(['prisma-connect']);}
    async $queryRaw(strings,...values){assert.equal(values.length,0); const sql=strings.join(''); calls.push(['query',sql]); return sql.includes('current_setting')?[{tr:'on'}]:[{ssl:true}];}
    async $disconnect(){calls.push(['prisma-end']);}
  }
  const drivers=createDrivers({Client,PrismaClient,PrismaPg});
  assert.deepEqual(calls,[]);
  const events=[]; const r=createRuntime(e=>events.push(e));
  const out=await r.run({env,mode:'real',dryRunReceipt:await receipt(),drivers});
  assert.equal(out.ok,true);
  const configs=calls.filter(x=>x[0].endsWith('-config')).map(x=>x[1]);
  assert.equal(configs.length,2); assert.deepEqual(configs[0],configs[1]);
  assert.equal(configs[0].connectionString,normalize(env.DIRECT_URL));
  assert.match(configs[0].options,/default_transaction_read_only=on/);
  const sql=calls.filter(x=>x[0]==='query').map(x=>x[1]);
  assert.deepEqual(sql,["SELECT current_setting('transaction_read_only') AS tr;",'SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid();',
    "SELECT current_setting('transaction_read_only') AS tr;",'SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid();']);
  assert.throws(()=>drivers.pg(normalize(env.DIRECT_URL+'&options=unsafe')),/OPTIONS_OVERRIDE_REJECTED/);
  assert.throws(()=>drivers.prisma(normalize(env.DIRECT_URL+'&options=unsafe')),/OPTIONS_OVERRIDE_REJECTED/);
});

test('pending connect and disconnect never produce premature success markers',async()=>{
  const events=[];
  let releaseConnect, releaseDisconnect;
  const connected=new Promise(resolve=>{releaseConnect=resolve;});
  const disconnected=new Promise(resolve=>{releaseDisconnect=resolve;});
  const stub={connect:()=>connected,readOnly:async()=>[{tr:'on'}],tls:async()=>[{ssl:true}],
    socketEncrypted:()=>true,disconnect:()=>disconnected};
  const r=createRuntime(e=>events.push(e));
  const pending=r.run({env,mode:'real',dryRunReceipt:await receipt(),drivers:{pg:()=>stub,
    prisma:()=>({...stub,connect:async()=>{},disconnect:async()=>{}})}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(names(events).includes('V11_PG_CONNECT_ATTEMPT'));
  assert.ok(!names(events).includes('V11_PG_CONNECTED'));
  releaseConnect();
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(names(events).includes('V11_PG_TLS_CONFIRMED'));
  assert.ok(!names(events).includes('V11_PG_DISCONNECTED'));
  assert.ok(!names(events).includes('V11_PRISMA_PROBE_START'));
  releaseDisconnect();
  assert.equal((await pending).ok,true);
});

test('events after disconnect or completion invalidate evidence',async()=>{
  const {events}=await simulate();
  const reordered=events.map(e=>({...e}));
  const i=reordered.findIndex(e=>e.marker==='V11_PG_DISCONNECTED');
  [reordered[i].marker,reordered[i-1].marker]=[reordered[i-1].marker,reordered[i].marker];
  assert.equal(derive(reordered).EVIDENCE_VALID,'NO');
  const late=events.map(e=>({...e}));
  late.splice(-1,0,{...late[0],marker:'V11_INTERNAL_ERROR',reason:'LATE_ERROR'});
  late.forEach((e,i)=>e.sequence=i+1);
  assert.equal(derive(late).EVIDENCE_VALID,'NO');
});
