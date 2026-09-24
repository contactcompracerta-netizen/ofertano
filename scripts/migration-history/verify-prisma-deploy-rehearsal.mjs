/** Prisma APPLY behavior only. Historical checksum safety comes from an independent gate. */
import { commercePending } from './verify-ledger-compatibility.mjs';
export function verifyPrismaDeployRehearsal({ exitCode, output, expected = commercePending }) {
  if (exitCode !== 0) throw new Error('PRISMA_DEPLOY_REHEARSAL_NONZERO');
  if (typeof output !== 'string') throw new Error('PRISMA_DEPLOY_OUTPUT_INVALID');
  const applied = [...output.matchAll(/Applying migration `([^`]+)`/g)].map(m => m[1]);
  if (JSON.stringify(applied) !== JSON.stringify(expected)) throw new Error('PRISMA_DEPLOY_REAPPLIED_UNEXPECTED_MIGRATION');
  if (!/All migrations have been successfully applied\./i.test(output)) throw new Error('PRISMA_DEPLOY_SUCCESS_NOT_OBSERVED');
  return { verdict: 'PASS', applied, modifiedMigrationWarningObserved: /modified|changed since|checksum[^\n]*(?:mismatch|differ)/i.test(output), checksumSafetyAuthority: 'INDEPENDENT_LEDGER_VERIFIER' };
}
