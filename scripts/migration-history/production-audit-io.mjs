import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import dotenv from 'dotenv';
import { validateSupabaseTarget, EXPECTED_PROJECT_REF } from './supabase-project-guard.mjs';
import { requireState } from './production-equivalence.mjs';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export function readTarget(envFile,ref=EXPECTED_PROJECT_REF) {
  const env=dotenv.parse(fs.readFileSync(envFile));
  const target=validateSupabaseTarget(env.DIRECT_URL??env.DATABASE_URL,ref);
  requireState(target.projectGuard,'PROJECT_GUARD_FAILED');
  const client=new pg.Client({connectionString:target.connectionString,connectionTimeoutMillis:15000,options:'-c default_transaction_read_only=on -c statement_timeout=30000'});
  const u=new URL(target.connectionString),p=client.connectionParameters;
  requireState(p.host===u.hostname&&String(p.port)===(u.port||'5432')&&p.database===u.pathname.slice(1)&&p.user===decodeURIComponent(u.username),'TARGET_CONSISTENCY_FAILED');
  return {target,client};
}
export async function beginReadOnly(client) {
  await client.connect();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  requireState((await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only==='on','READ_ONLY_FAILED');
  await client.query('SET LOCAL search_path = public, pg_catalog');
}
export function safeFile(dir,name,data) {
  fs.writeFileSync(path.join(dir,name),typeof data==='string'?data:JSON.stringify(data,null,2)+'\n',{mode:0o600,flag:'wx'});
}
export function runTool(binary,args,env={}) {
  const result=spawnSync(binary,args,{cwd:root,env:{...process.env,...env},encoding:'utf8',timeout:180000,maxBuffer:16*1024*1024});
  return {status:result.status,stdout:result.stdout??'',stderr:result.stderr??''};
}
export function assertSchemaOnly(text,secrets=[]) {
  requireState(!/^\s*(COPY\s+.+FROM\s+stdin|INSERT\s+INTO)/im.test(text),'DUMP_CONTAINS_DATA');
  requireState(!secrets.filter(s=>s&&s.length>5).some(s=>text.includes(s)),'SECRET_LEAK');
  requireState(!/postgres(?:ql)?:\/\/|(?:password|secret|token)\s*=/i.test(text),'SECRET_LEAK');
  for(const table of ['notifications','price_alerts','"PriceAlert"','"SocialPost"']) requireState(text.includes(`CREATE TABLE public.${table} (`),'DUMP_OBJECT_MISSING');
}
export function dumpProduction(target,file,pgDump,snapshot) {
  const u=new URL(target.connectionString);
  const result=runTool(pgDump,['--schema-only','--schema=public','--no-owner','--no-privileges','--snapshot='+snapshot,'--file='+file],{
    PGHOST:u.hostname,PGPORT:u.port||'5432',PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGDATABASE:u.pathname.slice(1),PGSSLMODE:'require',PGOPTIONS:'-c default_transaction_read_only=on -c statement_timeout=60000',PGCONNECT_TIMEOUT:'15',
  });
  requireState(result.status===0,'PG_DUMP_FAILED');fs.chmodSync(file,0o600);
  const text=fs.readFileSync(file,'utf8');assertSchemaOnly(text,[target.connectionString,decodeURIComponent(u.password)]);return text;
}
export function validateCloneTarget(url,expectedName) {
  const u=new URL(url);
  requireState(['postgres:','postgresql:'].includes(u.protocol)&&u.hostname==='127.0.0.1'&&u.port==='55433'&&u.username==='postgres'&&!u.password&&!u.search&&!u.hash,'CLONE_TRIPWIRE_FAILED');
  requireState(/^ofertano_equivalence_[a-f0-9]{32}$/.test(expectedName)&&u.pathname==='/'+expectedName,'CLONE_NAME_FAILED');
}
export async function createClone() {
  const name='ofertano_equivalence_'+randomUUID().replaceAll('-','');
  const url='postgresql://postgres@127.0.0.1:55433/'+name;validateCloneTarget(url,name);
  const admin=new pg.Client({host:'127.0.0.1',port:55433,user:'postgres',database:'postgres',ssl:false,connectionTimeoutMillis:5000});
  await admin.connect();
  requireState(admin.connection.stream.remoteAddress==='127.0.0.1'&&admin.connection.stream.remotePort===55433,'CLONE_SOCKET_DIVERGED');
  requireState((await admin.query('SELECT current_database() AS db,current_user AS role')).rows[0].role==='postgres','CLONE_ROLE_DIVERGED');
  let created=false;let client;
  const cleanup=async()=>{await client?.end();try{if(created){validateCloneTarget(url,name);await admin.query(`DROP DATABASE "${name}"`);}}finally{await admin.end();}};
  try {
    requireState((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rowCount===0,'CLONE_ALREADY_EXISTS');
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);created=true;
    client=new pg.Client({connectionString:url,ssl:false});await client.connect();
    requireState(client.connection.stream.remoteAddress==='127.0.0.1'&&client.connection.stream.remotePort===55433,'CLONE_SOCKET_DIVERGED');
    requireState((await client.query('SELECT current_database() AS db')).rows[0].db===name,'CLONE_DATABASE_DIVERGED');
    return {name,url,client,cleanup};
  } catch(error) {await cleanup();throw error;}
}
export async function restoreClone(clone,dump,psql) {
  validateCloneTarget(clone.url,clone.name);
  await clone.client.query(`CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
    DROP SCHEMA public;`);
  // The isolated cluster already has the tested NOLOGIN auth roles; fail rather than alter them.
  const roles=(await clone.client.query("SELECT rolname,rolsuper,rolcanlogin FROM pg_roles WHERE rolname IN ('anon','authenticated') ORDER BY rolname")).rows;
  requireState(roles.length===2&&roles.every(r=>!r.rolsuper&&!r.rolcanlogin),'CLONE_ROLES_DIVERGED');
  const r=runTool(psql,['-X','-h','127.0.0.1','-p','55433','-U','postgres','-d',clone.name,'--single-transaction','-v','ON_ERROR_STOP=1','-f',dump]);
  requireState(r.status===0,'RESTORE_FAILED');
}
export function prismaDiff(url,schema) {
  return runTool(process.execPath,[path.join(root,'node_modules/prisma/build/index.js'),'migrate','diff','--from-config-datasource','--to-schema',schema,'--exit-code'],{DIRECT_URL:url,DATABASE_URL:url,DOTENV_CONFIG_PATH:'/dev/null',VERCEL_ENV:'',VERCEL_TARGET_ENV:''});
}
