/** Read-only production certification. All DDL is confined to a new owned clone. */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { contract, requireState, fingerprint, classifyUnmanaged, verifyObservation, productionEquivalenceSchema } from './production-equivalence.mjs';
import { collectProductionObservation } from './production-schema-observation.mjs';
import { root, validateCloneTarget, readTarget, beginReadOnly, safeFile, dumpProduction, createClone, restoreClone, prismaDiff } from './production-audit-io.mjs';
import { verifyLedgerCompatibility } from './verify-ledger-compatibility.mjs';
export function requireZeroDiff(diff) {
  requireState(diff.status===0&&/No difference detected\./.test(diff.stdout),'PRODUCTION_EQUIVALENCE_NONZERO');
}
export async function normalizeClone(clone) {
  validateCloneTarget(clone.url,clone.name);
  requireState(clone.client.connection.stream.remoteAddress==='127.0.0.1'&&clone.client.connection.stream.remotePort===55433,'CLONE_SOCKET_DIVERGED');
  const before=await collectProductionObservation(clone.client);verifyObservation(before);
  const internal=before.shape.price_alerts.constraints.find(c=>c.conname==='price_alerts_product_id_fkey');
  requireState(internal,'INTERNAL_FK_MISSING');
  await clone.client.query('BEGIN');
  try {
    // Constant names only; never execute an observed/discovered allowlist.
    await clone.client.query('ALTER TABLE public.notifications DROP CONSTRAINT notifications_user_id_fkey');
    await clone.client.query('ALTER TABLE public.price_alerts DROP CONSTRAINT price_alerts_user_id_fkey');
    const after=await collectProductionObservation(clone.client);
    requireState(after.external.length===0,'UNEXPECTED_EXTERNAL_FK');
    const expected=structuredClone(before);
    for(const [table,name] of [['notifications','notifications_user_id_fkey'],['price_alerts','price_alerts_user_id_fkey']]) expected.shape[table].constraints=expected.shape[table].constraints.filter(c=>c.conname!==name);
    requireState(fingerprint(after.shape)===fingerprint(expected.shape),'NORMALIZATION_CHANGED_OTHER_OBJECTS');
    const internalAfter=after.shape.price_alerts.constraints.find(c=>c.conname==='price_alerts_product_id_fkey');
    requireState(fingerprint(internal)===fingerprint(internalAfter),'INTERNAL_FK_CHANGED');
    await clone.client.query('COMMIT');
    return {before:fingerprint(internal),after:fingerprint(internalAfter)};
  } catch(error) {await clone.client.query('ROLLBACK');throw error;}
}
export async function auditProduction({envFile,outDir,pgDump,psql}) {
  requireState(path.isAbsolute(outDir)&&!path.resolve(outDir).startsWith(root+path.sep),'EVIDENCE_MUST_BE_OUTSIDE_REPO');
  fs.mkdirSync(outDir,{mode:0o700});
  let clone,overlay,client;
  const report={MAIN_TOUCHED:'NO',BACKFILL_EXECUTED:'NO',BACKFILL_ALLOWED:'NO',PRODUCTION_WRITES:'NO'};
  try {
    classifyUnmanaged(fs.readFileSync(path.join(root,'prisma/schema.prisma'),'utf8'));
    report.UNMANAGED_TABLE_CLASSIFICATION='PASS';
    const t=readTarget(envFile);client=t.client;
    await beginReadOnly(client);
    report.PROJECT_GUARD='PASS';report.TARGET_CONSISTENCY='PASS';report.PRODUCTION_READ_ONLY='PASS';
    const observation=await collectProductionObservation(client);
    report.FINGERPRINTS=verifyObservation(observation);
    const ledger=JSON.parse(JSON.stringify({version:1,ledger:observation.ledger}));
    verifyLedgerCompatibility(ledger,[]);report.PRODUCTION_LEDGER='PASS';
    safeFile(outDir,'observation.json',observation);
    requireState((await client.query("SELECT format_type(atttypid,atttypmod) AS type FROM pg_attribute WHERE attrelid='auth.users'::regclass AND attname='id'")).rows[0]?.type==='uuid','AUTH_ID_TYPE_CHANGED');
    const snapshot=(await client.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot;
    const dump=path.join(outDir,'production-schema.sql');
    const text=dumpProduction(t.target,dump,pgDump,snapshot);
    report.DUMP_SHA256=createHash('sha256').update(text).digest('hex');
    await client.query('ROLLBACK');await client.end();client=null;
    clone=await createClone();await restoreClone(clone,dump,psql);
    const restored=await collectProductionObservation(clone.client);verifyObservation(restored);
    report.LEGACY_TABLE_FINGERPRINTS='PASS';report.PUBLIC_EXTERNAL_FK_COUNT=observation.external.length;
    report.EXTERNAL_FKS_MATCH='PASS';
    const internal=await normalizeClone(clone);
    report.INTERNAL_PRICE_ALERT_PRODUCT_FK_BEFORE=internal.before;report.INTERNAL_PRICE_ALERT_PRODUCT_FK_AFTER=internal.after;report.INTERNAL_FK_UNCHANGED='YES';
    overlay=productionEquivalenceSchema(path.join(root,'prisma/schema.prisma'));
    const diff=prismaDiff(clone.url,overlay.file);
    safeFile(outDir,'prisma-diff.txt',diff.stdout+'\n'+diff.stderr);requireZeroDiff(diff);
    report.PRODUCTION_EQUIVALENCE_DIFF='ZERO_WITH_EXACT_VERSIONED_LEGACY_OVERLAY';
    report.PRODUCTION_DIRECT_PRISMA_DIFF='P4002_EXPECTED_CROSS_SCHEMA_INTROSPECTION_LIMIT';
    report.PRODUCTION_DIRECT_PRISMA_DIFF_EVIDENCE='PRIOR_CERTIFICATION_NOT_RERUN';
    report.EQUIVALENCE_AUDITOR='PASS';
  } catch(error) {
    report.EQUIVALENCE_AUDITOR='FAIL_CLOSED';
    report.ERROR=/^[A-Z_]+$/.test(error.message)?error.message:'AUDIT_OPERATION_FAILED';
  } finally {
    overlay?.cleanup();await client?.end();
    try {await clone?.cleanup();report.CLONE_CLEANUP='PASS';}catch{report.CLONE_CLEANUP='FAIL';report.EQUIVALENCE_AUDITOR='FAIL_CLOSED';}
    safeFile(outDir,'report.json',report);
  }
  return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try {
    const args=process.argv.slice(2);
    requireState(args.length===8&&args[0]==='--env-file'&&args[2]==='--out-dir'&&args[4]==='--pg-dump'&&args[6]==='--psql','USAGE_ENV_OUT_DUMP_PSQL_REQUIRED');
    const report=await auditProduction({envFile:args[1],outDir:args[3],pgDump:args[5],psql:args[7]});console.log(JSON.stringify(report));process.exitCode=report.EQUIVALENCE_AUDITOR==='PASS'?0:1;
  }catch(error){console.error(JSON.stringify({EQUIVALENCE_AUDITOR:'FAIL_CLOSED',ERROR:/^[A-Z_]+$/.test(error.message)?error.message:'AUDIT_OPERATION_FAILED'}));process.exitCode=1;}
}
