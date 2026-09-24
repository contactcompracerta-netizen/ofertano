import test from 'node:test';
import assert from 'node:assert/strict';
import {commercePending, architecturePending} from './verify-ledger-compatibility.mjs';
import {verifyPrismaDeployRehearsal} from './verify-prisma-deploy-rehearsal.mjs';
const applied=commercePending.map(n=>`Applying migration \`${n}\``).join('\n');
const success=applied+'\nAll migrations have been successfully applied.';
const fullApplied=[...commercePending, ...architecturePending].map(n=>`Applying migration \`${n}\``).join('\n');
test('correct APPLY passes without warning and assigns checksum authority independently',()=>{
 const result=verifyPrismaDeployRehearsal({exitCode:0,output:success});
 assert.equal(result.verdict,'PASS');assert.equal(result.modifiedMigrationWarningObserved,false);assert.equal(result.checksumSafetyAuthority,'INDEPENDENT_LEDGER_VERIFIER');
});
test('explicit full forward APPLY (including Architecture V1) passes when expected explicitly',()=>{
 const result=verifyPrismaDeployRehearsal({exitCode:0,output:fullApplied+'\nAll migrations have been successfully applied.',expected:[...commercePending,...architecturePending]});
 assert.equal(result.verdict,'PASS');assert.deepEqual(result.applied,[...commercePending,...architecturePending]);
});
test('unexpected Architecture V1 APPLY without explicit expected blocks (fail-closed)',()=>{
 assert.throws(()=>verifyPrismaDeployRehearsal({exitCode:0,output:fullApplied+'\nAll migrations have been successfully applied.'}),/UNEXPECTED_MIGRATION/);
});
test('modified warning and generic npm warning are telemetry only',()=>{
 assert.equal(verifyPrismaDeployRehearsal({exitCode:0,output:'modified migration\n'+success}).modifiedMigrationWarningObserved,true);
 assert.equal(verifyPrismaDeployRehearsal({exitCode:0,output:'npm warn unknown config\n'+success}).modifiedMigrationWarningObserved,false);
});
test('silent, incomplete and unsuccessful execution cannot PASS',()=>{
 assert.throws(()=>verifyPrismaDeployRehearsal({exitCode:0,output:''}),/UNEXPECTED_MIGRATION/);
 assert.throws(()=>verifyPrismaDeployRehearsal({exitCode:0,output:applied}),/SUCCESS_NOT_OBSERVED/);
 assert.throws(()=>verifyPrismaDeployRehearsal({exitCode:1,output:success}),/NONZERO/);
});
for(const extra of ['20260824000000_postgresql_baseline','20260915194500_rls_security_hardening','unknown',commercePending[0]])test(`unexpected/repeated APPLY ${extra} blocks`,()=>{
 assert.throws(()=>verifyPrismaDeployRehearsal({exitCode:0,output:`Applying migration \`${extra}\`\n`+success}),/UNEXPECTED_MIGRATION/);
});
