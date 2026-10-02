# docs/evidence — política de evidências

Este diretório guarda **evidências de auditoria** do Ofertano. A política é
deliberada: evidência que é **fixture exigido por um gate** fica versionada;
saída **gerada por execução** não fica.

## O que é versionado (obrigatório)

| Caminho | Consumido por | Motivo |
| --- | --- | --- |
| `production-equivalence/diff-inventory.json` | `docs/production-schema-equivalence.md` (link direto) | Inventário da certificação de equivalência exata entre o schema de produção e o schema Prisma runtime. Sem ele, a tabela de classificação de objetos legados fica sem lastro. |

Regra: se um arquivo de evidência é **lido** por código, teste, runbook ou
documentação, ele é fixture e permanece versionado.

## O que NÃO é versionado (gerado)

Saída produced por execução de teste/rehearsal/canário é **gerada** e é
reconstruída a cada execução. Todos os escritores usam
`mkdirSync(..., { recursive: true })`, portanto o diretório não precisa existir
no repositório:

| Caminho | Escritor |
| --- | --- |
| `50ag1/` | `scripts/bootstrap/commerce-foundation.integration.mjs` |
| `50ag2/` | `scripts/bootstrap/shadow-regression.integration.mjs`, `src/services/commerce-intelligence/shadow/shadow.integration.test.ts` |
| `50ag3/` | `src/services/commerce-intelligence/control-plane/*.integration.test.ts`, `control-plane.multiprocess.test.ts`, `multiprocess-audit-10-rounds.ts` |
| `50ag4b-r2g/`, `50ag4b-r2g2/` | `scripts/bootstrap/migration-history.integration.mjs` |
| `50ag4b-r3c/`, `50ag4b-r3c4/`, `50ag4b-r3c5/` | `scripts/bootstrap/r3c-rehearsal.integration.mjs` |
| `50ag4b-r3d2a/` | ensaio de build da branch `feature/build-purity-blog-r3d2a` |

Esses caminhos estão em `.gitignore` (`/docs/evidence/50ag*/`). O conteúdo
anterior permanece preservado no histórico Git.

## Por que

- ~360 KB de JSON de execução ocupavam o repositório sem adicionar
  conhecimento: o mesmo arquivo é reescrito a cada `npm test`.
- Evidência que muda sozinha a cada execução não é evidência — é log.
- Nenhum gate, teste, script ou runbook **lia** esses arquivos. A auditoria
  confirmou `readFile`/`readdir`/`import` de `docs/evidence`: **zero**.

## Saídas futuras

Novos artefatos gerados devem ir para fora do tracking. Convenções já
ignoradas pelo Git:

- `/docs/evidence/50ag*/` — evidência de canário/rehearsal gerada
- `/tmp/` — saída efêmera de probes e auditorias locais
- `.artifacts/`, `reports/generated/` — quando forem adotados
