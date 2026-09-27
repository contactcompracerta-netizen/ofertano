-- Reconciliacao aditiva de schema.
-- Alinha as tabelas do autopilot com schema.prisma e normaliza o nome
-- fisico do indice CandidateBlockingKey. Nenhum dado e removido.

ALTER TABLE "CatalogCutoverAutopilot"
  ALTER COLUMN "cooldownUntil" TYPE TIMESTAMPTZ(3) USING "cooldownUntil" AT TIME ZONE 'UTC',
  ALTER COLUMN "stageStartedAt" TYPE TIMESTAMPTZ(3) USING "stageStartedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "lastRunAt" TYPE TIMESTAMPTZ(3) USING "lastRunAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "trippedAt" TYPE TIMESTAMPTZ(3) USING "trippedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "completedAt" TYPE TIMESTAMPTZ(3) USING "completedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" DROP DEFAULT,
  ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

ALTER TABLE "CatalogCutoverAutopilotRun"
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';

ALTER TABLE "CatalogCutoverStageMetric"
  ALTER COLUMN "startedAt" TYPE TIMESTAMPTZ(3) USING "startedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "completedAt" TYPE TIMESTAMPTZ(3) USING "completedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" DROP DEFAULT,
  ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

ALTER INDEX "CandidateBlockingKey_productId_keyType_normalizedValue_policyVe"
  RENAME TO "CandidateBlockingKey_productId_keyType_normalizedValue_poli_key";
