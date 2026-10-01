/**
 * ML LISTING-FIRST: a migration recuperada, a ordem de aplicacao e o replay.
 *
 * Sem banco: le arquivos, manifest e pins, e chama os validadores puros.
 * O replay de verdade em Postgres descartavel fica em
 * `scripts/bootstrap/ml-listing-first-replay.integration.mjs`.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { validateInventory } from '../bootstrap/migration-inventory.mjs';
import manifest from '../bootstrap/manifest.json' with { type: 'json' };
import pins from './forensic-pins.json' with { type: 'json' };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const readMigration = (name) =>
  fs.readFileSync(path.join(root, 'prisma/migrations', name, 'migration.sql'), 'utf8');

const RECOVERED = '20260930000000_ml_listing_first';
const CATALOG_METADATA = '20260930120000_ml_listing_first_catalog_metadata';

// O checksum que PRODUCAO tem na ledger. Nao vem do repositorio: e o valor
// contra o qual a migration recuperada foi comparada byte a byte.
const PRODUCTION_CHECKSUM =
  'a16cea210b413907ebfb47f7731e4a7eeedcc25bf0cb682b7f5dbd4e613fccbc';

test('a migration recuperada e byte-identical ao checksum pinado em producao', () => {
  const bytes = fs.readFileSync(
    path.join(root, 'prisma/migrations', RECOVERED, 'migration.sql'),
  );

  assert.equal(
    sha(bytes),
    PRODUCTION_CHECKSUM,
    'migration recuperada difere do checksum de producao: nao e a mesma migration',
  );
  assert.equal(
    manifest.forwardMigrations[RECOVERED],
    PRODUCTION_CHECKSUM,
    'manifest nao carrega o checksum de producao da migration recuperada',
  );
  assert.equal(
    pins.repositoryMigrationChecksums[RECOVERED],
    PRODUCTION_CHECKSUM,
    'pin forense nao carrega o checksum de producao da migration recuperada',
  );
});

test('a migration recuperada cria o contrato LISTING-FIRST inteiro', () => {
  const sql = readMigration(RECOVERED);

  // Colunas de evidencia.
  for (const coluna of ['rawPayload', 'condition', 'shipping', 'identityVersion']) {
    assert.match(sql, new RegExp(`ADD COLUMN "${coluna}"`), `falta ${coluna}`);
  }

  // A unicidade deixa de ser global e passa a ser PARCIAL.
  assert.match(
    sql,
    /DROP INDEX IF EXISTS "MarketplaceOffer_productId_marketplace_key"/,
    'a unique global precisa sair',
  );
  assert.match(
    sql,
    /CREATE UNIQUE INDEX "MarketplaceOffer_non_ml_product_marketplace_key"\s*\n\s*ON "MarketplaceOffer"\("productId", "marketplace"\) WHERE "marketplace" <> 'MERCADO_LIVRE'/,
    'o indice parcial por mercado precisa existir, semML excluido',
  );
  assert.match(
    sql,
    /CREATE INDEX "MarketplaceOffer_productId_marketplace_idx" ON "MarketplaceOffer"\("productId", "marketplace"\)/,
    'o par (productId, marketplace) continua legivel como indice normal',
  );

  // A guarda de identidade: e o que impede trocar o anuncio mantendo o id.
  assert.match(sql, /ADD CONSTRAINT "ml_listing_identity_v1" CHECK/, 'falta a CHECK');
  assert.match(sql, /"externalId" ~ '\^MLB\[0-9\]\+\$'/, 'externalId tem de ser MLB');
  assert.match(sql, /"externalId" <> "catalogProductId"/, 'oferta e catalogo nao podem ser o mesmo id');
  assert.match(
    sql,
    /"rawPayload"->'listing'->>'item_id' = "externalId"/,
    'o payload tem de provar exatamente o anuncio da oferta',
  );
  assert.match(
    sql,
    /\("sourceUrl" IS NULL OR "sourceUrl" !~\* '\/p\/'\)/,
    'URL de catalogo /p/ nao vale como identidade',
  );

  // Uma linha ML nova nunca pode nascer em identityVersion 0.
  assert.match(
    sql,
    /CREATE TRIGGER ml_new_listing BEFORE INSERT ON "MarketplaceOffer"/,
    'falta o trigger de INSERT',
  );
  assert.match(
    sql,
    /NEW\."identityVersion" <> 1 THEN\s*\n\s*RAISE EXCEPTION 'ML_NEW_OFFER_WITHOUT_LISTING_EVIDENCE'/,
    'o trigger precisa recusar ML nova fora da identityVersion 1',
  );
  assert.match(sql, /ML_NEW_OFFER_WITHOUT_LISTING_EVIDENCE/, 'falta a razao do trigger');
});

test('a ordem de aplicacao reproduz producao e difere da ordem lexical', () => {
  const order = manifest.forwardApplicationOrder;

  assert.ok(Array.isArray(order), 'forwardApplicationOrder precisa existir');
  assert.deepEqual(
    [...order].sort(),
    [...Object.keys(manifest.forwardMigrations)].sort(),
    'a ordem declarada tem de ser permutacao das forward migrations',
  );

  // Lexical: o timestamp menor vem primeiro.
  const lexical = [...Object.keys(manifest.forwardMigrations)].sort();
  assert.ok(
    lexical.indexOf(RECOVERED) < lexical.indexOf(CATALOG_METADATA),
    'premissa do problema: em ordem lexical, a recuperada vem antes',
  );

  // Producao aplicou ao contrario. E o que torna o replay em banco novo
  // possivel: `catalogProductId` e criada pela de metadata (ADD COLUMN sem
  // IF NOT EXISTS) e a recuperada usa ADD COLUMN IF NOT EXISTS.
  assert.ok(
    order.indexOf(CATALOG_METADATA) < order.indexOf(RECOVERED),
    'em producao, metadata roda antes da recuperada',
  );

  assert.match(
    readMigration(RECOVERED),
    /ADD COLUMN IF NOT EXISTS "catalogProductId"/,
    'a recuperada precisa ser idempotente na coluna de catalogo',
  );
  assert.match(
    readMigration(CATALOG_METADATA),
    /ALTER TABLE "MarketplaceOffer"\s*\n\s*ADD COLUMN "catalogProductId" TEXT;/,
    'a de metadata cria a coluna sem IF NOT EXISTS (e por isso exige a ordem)',
  );
});

test('a ordem de aplicacao e a mesma que a ledger de producao registra', () => {
  /*
   * `productionForwardApplicationOrder` e o PIN do que a coluna
   * `started_at` de `_prisma_migrations` mostra. Se alguem reordenar o
   * manifest para "deixar mais bonito" (por exemplo, lexical), o replay
   * quebra com 42701 — e este pin e o que impede isso de passar.
   */
  assert.deepEqual(
    manifest.forwardApplicationOrder,
    pins.productionForwardApplicationOrder,
    'a ordem do manifest precisa ser a ordem real de producao',
  );
});

test('o inventario rejeita ordem inventada', () => {
  const base = {
    baselineMigrations: manifest.baselineMigrations,
    forwardMigrations: manifest.forwardMigrations,
    retroactiveForwardMigrations: manifest.retroactiveForwardMigrations,
    actualNames: [...Object.keys(manifest.baselineMigrations), ...Object.keys(manifest.forwardMigrations)],
    actualChecksums: { ...manifest.baselineMigrations, ...manifest.forwardMigrations },
  };

  // 1. Ordem que nao cobre todas as forward migrations.
  assert.throws(
    () =>
      validateInventory({
        ...base,
        forwardApplicationOrder: manifest.forwardApplicationOrder.slice(1),
      }),
    /FORWARD_APPLICATION_ORDER_NOT_A_PERMUTATION/,
  );

  // 2. Ordem com migration que nao existe.
  assert.throws(
    () =>
      validateInventory({
        ...base,
        forwardApplicationOrder: [
          ...manifest.forwardApplicationOrder,
          '20260101000000_nao_existe',
        ],
      }),
    /FORWARD_APPLICATION_ORDER_NOT_A_PERMUTATION/,
  );

  // 3. Reordenar uma migration que NAO tem justificativa de ledger.
  const reordenado = [...manifest.forwardApplicationOrder];
  const catalogo = reordenado.indexOf('20260927180000_social_post_index_reconciliation');
  const rls = reordenado.indexOf('20260915194500_rls_security_hardening');
  reordenado[catalogo] = reordenado[rls];
  reordenado[rls] = '20260927180000_social_post_index_reconciliation';
  assert.throws(
    () => validateInventory({ ...base, forwardApplicationOrder: reordenado }),
    /FORWARD_APPLICATION_ORDER_UNEXPECTED_INVERSION/,
    'so o par do ML pode estar fora da ordem lexical',
  );

  // 4. A ordem real passa.
  const resultado = validateInventory({
    ...base,
    forwardApplicationOrder: manifest.forwardApplicationOrder,
  });
  assert.deepEqual(
    resultado.forwardApplicationOrder,
    manifest.forwardApplicationOrder,
    'a ordem de producao tem de ser aceita',
  );
});

test('o schema nao declara mais a unicidade global e nenhum codigo depende dela', () => {
  const schema = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');
  const modelo = schema.slice(schema.indexOf('model MarketplaceOffer {'));
  const corpo = modelo.slice(0, modelo.indexOf('\n}'));

  assert.ok(
    !/@@unique\(\[productId, marketplace\]\)/.test(corpo),
    'a unicidade global nao pode voltar ao schema',
  );
  assert.match(
    corpo,
    /@@index\(\[productId, marketplace\]\)/,
    'o par (productId, marketplace) continua como indice normal',
  );
  assert.match(
    corpo,
    /@@unique\(\[marketplace, externalId\]\)/,
    'a identidade de anuncio continua unica',
  );

  for (const coluna of ['rawPayload', 'condition', 'shipping', 'identityVersion']) {
    assert.match(
      corpo,
      new RegExp(`\\b${coluna}\\b`),
      `a coluna ${coluna} precisa estar no schema`,
    );
  }

  // O cliente gerado nao pode oferecer a unique que o banco nao tem.
  const gerado = fs.readFileSync(
    path.join(root, 'node_modules/.prisma/client/index.d.ts'),
    'utf8',
  );
  assert.ok(
    !gerado.includes('productId_marketplace'),
    'o cliente gerado ainda expoe productId_marketplace (42P10 de volta)',
  );
  assert.ok(
    gerado.includes('marketplace_externalId'),
    'a identidade de anuncio precisa existir no cliente gerado',
  );
});
