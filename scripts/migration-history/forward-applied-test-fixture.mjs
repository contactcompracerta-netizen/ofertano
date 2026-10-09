/**
 * Synthetic already-applied state for historical gate tests, NOT deployment evidence.
 *
 * Reproduz o estado de PRODUCAO: as migrations forward mais recentes ja aplicadas
 * (reconciliacao do indice de SocialPost e o catalogo LISTING-FIRST) entram no
 * ledger do snapshot sintetico, para que o gate nao as trate como pendentes.
 */
import { loadRepositoryContract, socialPostReconciliationPending, mlListingFirstMigration, catalogWave1Applied } from './verify-ledger-compatibility.mjs';
export function withForwardMigrationsApplied(fixture) {
  const result = structuredClone(fixture);
  const checksums = loadRepositoryContract().repositoryChecksums;
  for (const name of [socialPostReconciliationPending[0], ...mlListingFirstMigration, ...catalogWave1Applied]) { // includes applied production migrations in defined order
    result.ledger.push({ ...result.ledger[0], migration_name: name, checksum: checksums[name], applied_steps_count: 1 });
  }
  return result;
}
