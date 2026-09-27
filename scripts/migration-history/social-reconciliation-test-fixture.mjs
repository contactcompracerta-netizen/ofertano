/** Synthetic already-applied state for historical gate tests, NOT deployment evidence. */
import { loadRepositoryContract, socialPostReconciliationPending } from './verify-ledger-compatibility.mjs';
export function withSocialReconciliationApplied(fixture) {
  const result=structuredClone(fixture), name=socialPostReconciliationPending[0];
  result.ledger.push({...result.ledger[0],migration_name:name,checksum:loadRepositoryContract().repositoryChecksums[name],applied_steps_count:1});
  return result;
}
