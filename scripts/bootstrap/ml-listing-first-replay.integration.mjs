/**
 * Replay da cadeia LISTING-FIRST em PostgreSQL descartavel (127.0.0.1:55433).
 *
 * O que este ensaio prova, com Postgres de verdade:
 *
 *   1. A migration recuperada e a de metadata podem ser aplicadas juntas em um
 *      banco NOVO, na ordem REAL de producao, sem 42701 e sem `migrate resolve`.
 *   2. O schema resultante tem o indice PARCIAL, o indice normal, as colunas
 *      de evidencia, a CHECK e o trigger — e NAO tem mais a unique global.
 *   3. A garantia parcial se comporta: duas listings ML no mesmo Product
 *      coexistem; duas ofertas Shopee no mesmo Product nao.
 *   4. O writer central nao emite mais 42P10 no caminho nao-ML (que era o que
 *      quebrava toda escrita de Shopee/Magalu).
 *   5. O schema e IDENTICO ao de producao (drift ZERO) na superficie
 *      LISTING-FIRST.
 *
 * NUNCA escreve em producao: a conexao de producao e aberta em
 * `BEGIN TRANSACTION READ ONLY` e usada so para comparar metadados.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

import manifest from './manifest.json' with { type: 'json' };
import {
  validateLocalTarget,
  scaffoldLocalSupabase,
} from './local-supabase-compatibility.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const PRISMA = path.join(ROOT, 'node_modules/prisma/build/index.js');

const RECOVERED = '20260930000000_ml_listing_first';
const CATALOG_METADATA = '20260930120000_ml_listing_first_catalog_metadata';

const ok = (rotulo) => console.log(`${rotulo}=PASS`);
const runId = process.env.MIGRATION_HISTORY_RUN_ID ?? 'r2g2';
const DATABASE = `ofertano_mlreplay_${runId}`;

/** psql local de manutencao: cria/destroi o banco descartavel. */
function admin(sql) {
  const r = spawnSync(
    'psql',
    [
      '-h', '127.0.0.1', '-p', '55433', '-U', 'postgres',
      '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', sql,
    ],
    { encoding: 'utf8', env: { ...process.env, PGPASSWORD: 'postgres' } },
  );
  assert.equal(r.status, 0, `psql falhou: ${r.stderr}`);
  return r.stdout;
}

/** Metadados de `MarketplaceOffer` que o replay precisa reproduzir. */
const OBSERVACAO = `
  SELECT json_build_object(
    'colunas', (
      SELECT coalesce(json_agg(json_build_object(
        'column_name', column_name, 'data_type', data_type, 'udt_name', udt_name,
        'is_nullable', is_nullable, 'column_default', column_default,
        'character_maximum_length', character_maximum_length
      ) ORDER BY column_name), '[]'::json)
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'MarketplaceOffer'
    ),
    'indices', (
      SELECT coalesce(json_agg(json_build_object(
        'name', indexname, 'definition', indexdef
      ) ORDER BY indexname), '[]'::json)
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'MarketplaceOffer'
    ),
    'constraints', (
      SELECT coalesce(json_agg(json_build_object(
        'name', conname, 'definition', pg_get_constraintdef(oid)
      ) ORDER BY conname), '[]'::json)
      FROM pg_constraint
      WHERE conrelid = 'public."MarketplaceOffer"'::regclass
    ),
    'triggers', (
      SELECT coalesce(json_agg(json_build_object(
        'name', tgname, 'definition', pg_get_triggerdef(oid)
      ) ORDER BY tgname), '[]'::json)
      FROM pg_trigger
      WHERE tgrelid = 'public."MarketplaceOffer"'::regclass AND NOT tgisinternal
    )
  ) AS observed`;

async function observar(client) {
  const { rows } = await client.query(OBSERVACAO);
  return rows[0].observed;
}

async function main() {
  const target = `postgresql://postgres:postgres@127.0.0.1:55433/${DATABASE}`;
  const { database } = validateLocalTarget(target, {
    ...process.env,
    BOOTSTRAP_ALLOWED_DATABASES: DATABASE,
  });

  admin(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  admin(`CREATE DATABASE ${database}`);
  ok('THROW_AWAY_DATABASE_CREATED');

  // 1) Replay completo pela ferramenta de bootstrap, que aplica as forward
  //    migrations na ORDEM REAL de producao (ver manifest.forwardApplicationOrder).
  const bootstrap = spawnSync(
    process.execPath,
    [path.join(HERE, 'fresh-bootstrap.mjs')],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        DIRECT_URL: target,
        DATABASE_URL: target,
        BOOTSTRAP_ALLOWED_DATABASES: database,
      },
      timeout: 900_000,
    },
  );
  assert.equal(
    bootstrap.status,
    0,
    `fresh-bootstrap falhou: ${bootstrap.stdout}\n${bootstrap.stderr}`,
  );
  assert.match(bootstrap.stdout, /"verdict":"PASS"/, 'bootstrap nao passou');
  ok('FRESH_REPLAY_IN_PRODUCTION_ORDER');

  const client = new Client({ connectionString: target });
  await client.connect();
  await scaffoldLocalSupabase(client, target);

  // 2) A ordem de aplicacao gravada e a de producao.
  const { rows: ledger } = await client.query(
    `SELECT migration_name FROM "_prisma_migrations" ORDER BY started_at`,
  );
  const nomes = ledger.map((r) => r.migration_name);

  // A ordem esperada NAO e a lexical dos nomes: e a ordem declarada em
  // `forwardApplicationOrder`, que e a que a ledger de producao registra.
  const esperado = [
    manifest.forwardApplicationOrder.indexOf(CATALOG_METADATA),
    manifest.forwardApplicationOrder.indexOf(RECOVERED),
  ];
  assert.deepEqual(
    [esperado[0], esperado[1]],
    [...esperado].sort((a, b) => a - b),
    'premissa do ensaio: metadata roda antes da recuperada',
  );
  /*
   * A ledger tem `baselineMigrations` resolvidas primeiro e, depois, as
   * forward na ordem REAL de aplicacao. O esperado vem do manifest: e a ordem
   * que a ledger de producao registra, e nao a ordem lexical dos nomes (que
   * abortaria com 42701 na migration de metadata).
   */
  const baseline = Object.keys(manifest.baselineMigrations).length;
  assert.deepEqual(
    nomes.slice(baseline),
    manifest.forwardApplicationOrder,
    'a cadeia forward foi aplicada na ordem declarada (que reproduz producao)',
  );
  assert.ok(
    nomes.indexOf(CATALOG_METADATA) < nomes.indexOf(RECOVERED),
    'as duas migrations do ML foram aplicadas na ordem de producao',
  );
  assert.ok(
    [...manifest.forwardApplicationOrder].sort().indexOf(RECOVERED) <
      [...manifest.forwardApplicationOrder].sort().indexOf(CATALOG_METADATA),
    'premissa do ensaio: na ordem lexical, a recuperada vem antes',
  );
  // Nenhum `migrate resolve`: as duas entraram com applied_steps_count = 1.
  const { rows: passos } = await client.query(
    `SELECT migration_name, applied_steps_count FROM "_prisma_migrations"
     WHERE migration_name = ANY($1::text[])`,
    [[RECOVERED, CATALOG_METADATA]],
  );
  for (const passo of passos) {
    assert.equal(
      passo.applied_steps_count,
      1,
      `${passo.migration_name} foi marcada como aplicada sem executar`,
    );
  }
  ok('ML_MIGRATIONS_EXECUTED_NOT_RESOLVED');

  // 3) O schema do replay tem o contrato LISTING-FIRST.
  const replay = await observar(client);

  const indice = (observado, nome) =>
    observado.indices.find((i) => i.name === nome)?.definition ?? null;

  const parcial = indice(replay, 'MarketplaceOffer_non_ml_product_marketplace_key');
  assert.ok(parcial, 'falta o indice parcial nao-ML');
  assert.match(parcial, /UNIQUE INDEX/);
  assert.match(parcial, /\("productId", marketplace\)/);
  assert.match(parcial, /WHERE \(marketplace <> 'MERCADO_LIVRE'::"Marketplace"\)/);

  assert.equal(
    indice(replay, 'MarketplaceOffer_productId_marketplace_key'),
    null,
    'a unicidade global nao pode sobreviver ao replay',
  );

  const normal = indice(replay, 'MarketplaceOffer_productId_marketplace_idx');
  assert.ok(normal, 'falta o indice normal por (productId, marketplace)');
  assert.doesNotMatch(normal, /UNIQUE/, 'o indice por produto/mercado e normal');

  const identidade = indice(replay, 'MarketplaceOffer_marketplace_externalId_key');
  assert.ok(identidade, 'a identidade de anuncio precisa continuar unica');
  assert.match(identidade, /UNIQUE INDEX/);

  for (const coluna of [
    'catalogProductId',
    'rawPayload',
    'condition',
    'shipping',
    'identityVersion',
  ]) {
    assert.ok(
      replay.colunas.some((c) => c.column_name === coluna),
      `falta a coluna ${coluna}`,
    );
  }

  const check = replay.constraints.find((c) => c.name === 'ml_listing_identity_v1');
  assert.ok(check, 'falta a CHECK de identidade');
  assert.match(check.definition, /rawPayload/);
  assert.match(check.definition, /listing/);

  const trigger = replay.triggers.find((t) => t.name === 'ml_new_listing');
  assert.ok(trigger, 'falta o trigger de oferta ML nova');
  assert.match(trigger.definition, /BEFORE INSERT/);
  ok('LISTING_FIRST_SCHEMA_ON_REPLAY');

  // 4) A garantia parcial se comporta na pratica.
  await client.query(`
    INSERT INTO "Product" ("id","name","image","images","category","store",
                           "affiliateLink","price","createdAt","updatedAt")
    VALUES ('p-replay','Replay','','{}','Replay','Replay','',1,now(),now())
  `);

  /*
   * Insercao crua de oferta: usa SQL direto de proposito. O caminho do Prisma
   * e testado em `ml-listing-first-writer.probe.mts`; aqui o que esta em jogo
   * e o que o BANCO aceita e recusa.
   */
  /*
   * Cast explicito por coluna: sem isso o Postgres nao consegue inferir o tipo
   * de um parametro que so aparece em `extras`.
   */
  const TIPO = {
    rawPayload: 'jsonb',
    shipping: 'jsonb',
    identityVersion: 'int',
  };

  const inserir = async ({ id, marketplace, externalId, extras = {} }) => {
    const nomes = Object.keys(extras);
    const colunas = nomes.length ? `,"${nomes.join('","')}"` : '';
    const marcadores = nomes.map(
      (_, i) => `$${6 + i}::${TIPO[nomes[i]] ?? 'text'}`,
    );
    const { rows } = await client.query(
      `INSERT INTO "MarketplaceOffer"
         ("id","productId","marketplace","externalId","title","price",
          "active","createdAt","updatedAt"${colunas})
       VALUES ($1,$2,$3,$4,$5,10,true,now(),now()${
         marcadores.length ? `,${marcadores.join(',')}` : ''
       })
       RETURNING id`,
      [
        id,
        'p-replay',
        marketplace,
        externalId,
        id,
        ...nomes.map((nome) => {
          const valor = extras[nome];
          return valor !== null && typeof valor === 'object'
            ? JSON.stringify(valor)
            : valor === null || valor === undefined
              ? null
              : String(valor);
        }),
      ],
    );
    return rows[0].id;
  };

  // Duas listings ML do MESMO Product: e o que o indice parcial permite.
  for (const [id, item] of [
    ['ml-1', 'MLB1000000001'],
    ['ml-2', 'MLB1000000002'],
  ]) {
    await inserir({
      id,
      marketplace: 'MERCADO_LIVRE',
      externalId: item,
      extras: {
        identityVersion: '1',
        catalogProductId: 'MLB9876543210',
        rawPayload: { listing: { item_id: item } },
      },
    });
  }
  const { rows: mlRows } = await client.query(
    `SELECT count(*)::int AS total FROM "MarketplaceOffer"
     WHERE "productId" = 'p-replay' AND "marketplace" = 'MERCADO_LIVRE'`,
  );
  assert.equal(
    mlRows[0].total,
    2,
    'um Product pode ter varias listings ML',
  );
  ok('MULTIPLE_ML_LISTINGS_PER_PRODUCT');

  // Fora do ML, o indice parcial continua valendo: a segunda oferta e recusada.
  await inserir({
    id: 'sh-1',
    marketplace: 'SHOPEE',
    externalId: 'S-1',
    extras: { sourceUrl: 'https://shopee.com.br/item/S-1' },
  });
  await assert.rejects(
    () =>
      inserir({
        id: 'sh-2',
        marketplace: 'SHOPEE',
        externalId: 'S-2',
        extras: { sourceUrl: 'https://shopee.com.br/item/S-2' },
      }),
    /MarketplaceOffer_non_ml_product_marketplace_key/,
    'a segunda oferta nao-ML do mesmo Product tem de ser recusada',
  );
  ok('NON_ML_ONE_OFFER_PER_PRODUCT_ENFORCED');

  // A CHECK barra o payload que nao prova o anuncio da oferta.
  await assert.rejects(
    () =>
      inserir({
        id: 'ml-falsa',
        marketplace: 'MERCADO_LIVRE',
        externalId: 'MLB3000000003',
        extras: {
          identityVersion: '1',
          catalogProductId: 'MLB9876543210',
          rawPayload: { listing: { item_id: 'MLB9999999999' } },
        },
      }),
    /ml_listing_identity_v1/,
    'payload que prova outro anuncio tem de ser recusado',
  );

  // O trigger barra oferta ML nova fora da identityVersion 1.
  await assert.rejects(
    () =>
      inserir({
        id: 'ml-legada-nova',
        marketplace: 'MERCADO_LIVRE',
        externalId: 'MLB4000000004',
        extras: { identityVersion: '0' },
      }),
    /ML_NEW_OFFER_WITHOUT_LISTING_EVIDENCE/,
    'oferta ML nova nao pode nascer sem evidencia de anuncio',
  );

  // E a URL de catalogo /p/ nao vale como identidade.
  await assert.rejects(
    () =>
      inserir({
        id: 'ml-url-catalogo',
        marketplace: 'MERCADO_LIVRE',
        externalId: 'MLB5000000005',
        extras: {
          identityVersion: '1',
          catalogProductId: 'MLB9876543210',
          rawPayload: { listing: { item_id: 'MLB5000000005' } },
          sourceUrl: 'https://www.mercadolivre.com.br/p/MLB9876543210',
        },
      }),
    /ml_listing_identity_v1/,
    'URL de catalogo /p/ nao pode ser a identidade da oferta',
  );
  ok('ML_LISTING_GUARDS_ACTIVE_ON_REPLAY');

  await client.query('DELETE FROM "MarketplaceOffer" WHERE "productId" = \'p-replay\'');
  await client.query('DELETE FROM "Product" WHERE "id" = \'p-replay\'');

  // 5) O writer central nao emite 42P10 no caminho nao-ML.
  const writer = spawnSync(
    path.join(ROOT, 'node_modules/.bin/tsx'),
    [path.join(HERE, 'ml-listing-first-writer.probe.mts'), target],
    { cwd: ROOT, encoding: 'utf8', timeout: 300_000 },
  );
  assert.equal(
    writer.status,
    0,
    `a prova do writer falhou: ${writer.stdout}\n${writer.stderr}`,
  );
  assert.match(writer.stdout, /WRITER_42P10_COUNT=0/, 'o writer ainda emite 42P10');
  assert.match(writer.stdout, /WRITER_SHOPEE_ROWS=1/, 'Shopee nao convergiu para 1 linha');
  assert.match(writer.stdout, /WRITER_ML_ROWS=2/, 'ML nao preservou as 2 listings');
  ok('WRITER_WITHOUT_42P10');

  // 6) Drift ZERO entre o replay e producao na superficie LISTING-FIRST.
  const envFile = path.join(ROOT, '.env');
  if (!fs.existsSync(envFile)) {
    throw new Error('PRODUCTION_DRIFT_SKIPPED_NO_ENV');
  }
  const env = Object.fromEntries(
    fs.readFileSync(envFile, 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, '')];
    }),
  );
  const production = new Client({ connectionString: env.DIRECT_URL });
  await production.connect();
  await production.query('BEGIN TRANSACTION READ ONLY');
  const observado = await observar(production);
  await production.query('ROLLBACK');
  await production.end();

  const drift = (a, b) => JSON.stringify(a) === JSON.stringify(b) ? null : { replay: a, production: b };
  for (const parte of ['colunas', 'indices', 'constraints', 'triggers']) {
    const d = drift(replay[parte], observado[parte]);
    assert.equal(
      d,
      null,
      `drift entre replay e producao em ${parte}:\n${JSON.stringify(d, null, 2)}`,
    );
  }
  ok('FRESH_VS_PRODUCTION_DRIFT_ZERO');

  await client.end();
  admin(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  ok('THROW_AWAY_DATABASE_DROPPED');
  console.log('ml-listing-first-replay: todos os casos passaram');
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
