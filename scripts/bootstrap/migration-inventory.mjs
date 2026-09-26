// Contrato do inventário de migrations versionadas.
//
// Três categorias, com semânticas distintas e NÃO intercambiáveis:
//
//  baselineMigrations          -> migrations que a PRODUÇÃO JÁ EXECUTOU
//  forwardMigrations           -> migrations normais, ainda pendentes;
//                                 invariante OBRIGATÓRIA: name > lastBaseline
//  retroactiveForwardMigrations-> exceção EXPLÍCITA e pinada: migration que
//                                 precisa ocupar uma posição dentro da cadeia
//                                 histórica (por isso ordena <= lastBaseline),
//                                 mas ainda NÃO foi executada em produção.
//                                 Aceita com segurança PRE-SHAPE (fresh) e
//                                 POST-SHAPE (produção).
//
// Este módulo é PURO: recebe dados, lança Error com código estável. Sem I/O.
// fresh-bootstrap.mjs e os testes consomem esta mesma lógica.

const HEX64 = /^[0-9a-f]{64}$/;

export function validateInventory({
  baselineMigrations = {},
  forwardMigrations = {},
  retroactiveForwardMigrations = {},
  actualNames = [],
  actualChecksums = {},
} = {}) {
  const baselineNames = Object.keys(baselineMigrations);
  if (baselineNames.length === 0) {
    throw new Error('BOOTSTRAP_BASELINE_EMPTY');
  }
  const lastBaseline = baselineNames.slice().sort().at(-1);
  const retroEntries = Object.entries(retroactiveForwardMigrations);
  const retroNames = retroEntries.map(([n]) => n);

  // 3) Uma migration antiga NÃO pode estar em categoria errada.
  for (const [n] of retroEntries) {
    if (n in baselineMigrations) {
      const err = new Error('RETROACTIVE_DECLARED_AS_BASELINE');
      err.migration = n;
      throw err;
    }
    if (n in forwardMigrations) {
      const err = new Error('RETROACTIVE_DECLARED_AS_NORMAL_FORWARD');
      err.migration = n;
      throw err;
    }
  }

  // Migration antiga nao declarada: existe no disco, ordena <= lastBaseline e
  // nao esta em baseline nem foi declarada como retroativa. Verificado ANTES
  // da comparacao generica de inventario, para dar o erro especifico.
  const actualEarly = [...actualNames];
  for (const n of actualEarly) {
    if (n > lastBaseline) continue;
    if (n in baselineMigrations) continue;
    if (n in forwardMigrations) continue;
    if (retroNames.includes(n)) continue;
    const err = new Error('RETROACTIVE_NOT_DECLARED');
    err.migration = n;
    throw err;
  }

  // 1) Inventário canônico: declarado == disco.
  const declared = [...baselineNames, ...Object.keys(forwardMigrations), ...retroNames].sort();
  const actual = [...actualNames].sort();
  if (JSON.stringify(declared) !== JSON.stringify(actual)) {
    throw new Error('BOOTSTRAP_MIGRATION_INVENTORY_DIVERGED');
  }

  // 2) INVARIANTE NORMAL, PRESERVADA INTACTA (nunca afrouxada):
  //    toda forward migration ordinária precisa ser > última baseline.
  for (const n of Object.keys(forwardMigrations)) {
    if (n <= lastBaseline) {
      const err = new Error('BOOTSTRAP_MIGRATION_ORDER_VIOLATION');
      err.migration = n;
      throw err;
    }
  }

  // 4) Contrato explícito de cada entrada retroativa (exceção, não brecha).
  for (const [n, meta] of retroEntries) {
    const fail = (code, reason) => {
      const err = new Error(code);
      err.migration = n;
      err.reason = reason;
      throw err;
    };
    if (!meta || typeof meta !== 'object') fail('RETROACTIVE_CONTRACT_INVALID', 'missing metadata');
    if (!meta.mustPrecede) fail('RETROACTIVE_MUST_PRECEDE_MISSING', 'mustPrecede ausente');
    // O anchor precisa ser uma migration que a produção já executou.
    if (!(meta.mustPrecede in baselineMigrations)) {
      fail('RETROACTIVE_MUST_PRECEDE_INVALID', 'mustPrecede não está em baselineMigrations');
    }
    // POSIÇÃO: a retroativa tem de rodar ANTES da migration que depende dela.
    if (!(n < meta.mustPrecede)) {
      fail('RETROACTIVE_POSITION_INVALID', 'retroativa deve ordenar antes de mustPrecede');
    }
    // É retroativa justamente porque ordena dentro do bloco baseline.
    if (!(n <= lastBaseline)) {
      fail('RETROACTIVE_NOT_RETROACTIVE', 'retroativa ordena depois de lastBaseline');
    }
    if (meta.productionState !== 'PENDING') {
      fail('RETROACTIVE_PRODUCTION_STATE_INVALID', 'productionState deve ser PENDING');
    }
    if (!meta.rationale || !String(meta.rationale).trim()) {
      fail('RETROACTIVE_RATIONALE_MISSING', 'rationale ausente');
    }
    if (!HEX64.test(meta.checksum ?? '')) {
      fail('RETROACTIVE_CHECKSUM_MISSING', 'checksum sha256 ausente/inválido');
    }
    if (actualChecksums[n] !== meta.checksum) {
      fail('RETROACTIVE_CHECKSUM_DIVERGED', 'checksum do disco difere do pinado');
    }
  }

  return { lastBaseline, baseline: baselineNames, forward: Object.keys(forwardMigrations), retroactive: retroNames };
}

// Semântica pós-produção: depois que a retroativa for aplicada, ela NÃO pode
// continuar declarada como PENDING. Exige reconciliação em commit separado.
export function assertRetroactivePending(ledger = [], retroNames = []) {
  const applied = new Set(ledger.map((r) => r.migration_name ?? r.name));
  for (const n of retroNames) {
    if (applied.has(n)) {
      const err = new Error('RETROACTIVE_POST_DEPLOY_RECONCILIATION_REQUIRED');
      err.migration = n;
      throw err;
    }
  }
  return true;
}
