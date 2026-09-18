/** Pure check of the mission's empirical CLI expectation; never creates warnings. */
import { commercePending } from './verify-ledger-compatibility.mjs';
export function verifyPrismaDeployRehearsal({ exitCode, output }) {
  if (exitCode !== 0) throw new Error('PRISMA_DEPLOY_REHEARSAL_NONZERO');
  const applied = [...output.matchAll(/Applying migration `([^`]+)`/g)].map(m => m[1]);
  if (JSON.stringify(applied) !== JSON.stringify(commercePending)) throw new Error('PRISMA_DEPLOY_REAPPLIED_UNEXPECTED_MIGRATION');
  if (!/modified|changed since|checksum[^\n]*(?:mismatch|differ)/i.test(output)) throw new Error('PRISMA_MODIFIED_MIGRATION_WARNING_NOT_OBSERVED');
  return { verdict: 'PASS', applied, modifiedMigrationWarningObserved: true };
}
