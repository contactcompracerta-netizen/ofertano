# Raw Listing Real Canary Probe Precheck

## Objetivo

O precheck interno para um futuro canary real de `RawMarketplaceListing` responde apenas se existe um plano mínimo, seguro e determinístico para executar um único `probe` real sem alterar o legado.

Esta missão não executa o canary real. Ela apenas valida se o canary futuro pode ser considerado tecnicamente pronto.

## Diferença entre readiness e precheck real

A missão 49H respondeu a pergunta:

- a infraestrutura do canary está pronta?

A missão 49I responde a pergunta:

- temos um plano específico e seguro para um canary real de exatamente 1 listing?

A resposta não autoriza ativação.

`READY` aqui significa apenas que o precheck interno concluiu que o caminho futuro está preparado para uma execução isolada, documentada e controlada.

## Regras absolutas

- `RAW_LISTING_DUAL_WRITE_ENABLED=false` por padrão
- nenhum write real nesta missão
- nenhuma escrita em `RawMarketplaceListing`
- nenhum auto-enable
- nenhuma alteração persistente de env
- nenhuma mudança em Vercel
- nenhum cron, job ou auto-rollout
- nenhum canary real executado

## Condições mínimas para READY

### A) Readiness gate da 49H precisa estar READY

O precheck exige que o readiness gate da missão anterior esteja em `READY`.

Se o readiness falhar:

- `NOT_READY`
- motivo: `READINESS_GATE_NOT_READY`

### B) Dual write deve continuar OFF

`RAW_LISTING_DUAL_WRITE_ENABLED` precisa estar desligado no momento da avaliação.

Se estiver ON:

- `NOT_READY`
- motivo: `DUAL_WRITE_ALREADY_ENABLED`

### C) Exatamente 1 marketplace

Para um primeiro canary real, a configuração deve identificar exatamente um marketplace.

Aceito:

- `MERCADO_LIVRE`

Rejeitado:

- lista vazia
- mais de um marketplace
- wildcard
- marketplace inválido

Motivo sugerido:

- `PROBE_MARKETPLACE_COUNT_INVALID`
- `PROBE_MARKETPLACE_INVALID`

### D) `RAW_LISTING_CANARY_MAX_WRITES=1`

O futuro canary real deve ter limite de write exatamente igual a `1`.

Rejeitado:

- ausente
- 0
- 2
- 5
- negativo
- inválido

Motivo sugerido:

- `CANARY_MAX_WRITES_NOT_ONE`

### E) externalId único obrigatório

O futuro canary exige um único `externalId` válido e específico.

Rejeitado:

- ausente
- mais de um ID
- inválido
- vazio

Motivo sugerido:

- `PROBE_EXTERNAL_ID_MISSING`
- `PROBE_EXTERNAL_ID_COUNT_INVALID`
- `PROBE_EXTERNAL_ID_INVALID`

### F) Baseline do banco conhecido

A base de `RawMarketplaceListing` precisa estar conhecida antes do canary real.

Se não tiver baseline conhecida:

- `NOT_READY`
- motivo: `BASELINE_UNKNOWN`

### G) rollback definido

O plano futuro deve prever rollback claro.

Se não estiver definido:

- `NOT_READY`
- motivo: `ROLLBACK_NOT_DEFINED`

### H) abort criteria definidos

O plano futuro deve definir critérios de abort.

Se ausentes:

- `NOT_READY`
- motivo: `ABORT_CRITERIA_NOT_DEFINED`

## Marketplace escolhido para o primeiro probe

A recomendação de segurança é escolher um único marketplace com maior previsibilidade e menor ambiguidade no fluxo legado.

A decisão final do marketplace deve ser baseada em:

- externalId estável
- ingestão previsível
- menor risco de variação
- menor chance de crescimento em branqueamento ou duplicidade
- cobertura já testada pelo legado

Não há escolha aleatória. A escolha precisa ser justificada pela cadeia de testes e pela análise do fluxo atual.

## External ID do primeiro probe

O `externalId` do primeiro probe deve ser:

- real
- conhecido
- estável
- pertencente ao marketplace escolhido
- válido para o canary
- explicitamente listado na allowlist

Não deve ser inventado nesta missão.

## dry-run e exigência de isolamento

Mesmo quando tudo estiver pronto, o future canary real deve ser executado em ambiente isolado, com:

- `RAW_LISTING_DUAL_WRITE_ENABLED=false` por padrão
- `maxWrites=1`
- `externalId` único
- `marketplace` único
- rollback documentado
- abort criteria explícitos

## Plano futuro de execução (conceitual)

A missão futura, em uma etapa separada e autorizada, deve seguir este fluxo:

1. verificar o banco antes
2. guardar `RAW_LISTING_COUNT_BEFORE`
3. confirmar readiness do gate 49H
4. confirmar precheck 49I em `READY`
5. definir marketplace único
6. definir `externalId` único válido
7. definir `RAW_LISTING_CANARY_MAX_WRITES=1`
8. ligar o canary apenas no processo isolado e temporário
9. executar uma única ingestão
10. verificar `metrics`
11. verificar o registro novo e seus campos essenciais
12. verificar idempotência
13. desligar a flag imediatamente
14. validar legado
15. se necessário, remover apenas o registro do probe de forma precisa
16. confirmar `RAW_LISTING_COUNT_AFTER`
17. abortar imediatamente em qualquer divergência

## Abort criteria

Abortar imediatamente se qualquer uma dessas condições ocorrer:

- `writeFailed > 0`
- mais de 1 write
- marketplace divergente do autorizado
- externalId divergente do autorizado
- duplicidade detectada
- legado falhar
- public search mudar
- Multi Loja mudar
- ranking mudar
- `RawMarketplaceListing` crescer além do esperado
- metrics inconsistentes
- readiness retornar `NOT_READY`
- `kill switch` falhar

## Rollback

O rollback de um probe real deve ser simples e preciso:

- desligar `RAW_LISTING_DUAL_WRITE_ENABLED`
- não alterar schema
- não executar `TRUNCATE`
- não executar `DELETE` amplo
- identificar exatamente o registro do probe
- remover apenas esse registro, se a missão autorizada permitir cleanup
- confirmar count final
- reexecutar smoke tests do legado

## Banco e base line

Antes da missão real:

- `SELECT COUNT(*) FROM "RawMarketplaceListing";`
- registrar `RAW_LISTING_COUNT_BEFORE`

Depois da missão real:

- repetir count
- registrar `RAW_LISTING_COUNT_AFTER`

A regra esperada é:

- `RAW_LISTING_COUNT_AFTER == RAW_LISTING_COUNT_BEFORE`

Se a contagem mudar sem justificativa explícita: abortar.

## Read-only e fail-closed

O precheck 49I não pode:

- gravar no banco
- alterar env
- ativar flag
- mudar métricas operacionais
- consumir canary slots
- chamar repository write
- alterar public search
- alterar legacy

Ele deve apenas avaliar e responder `READY` ou `NOT_READY`.

Qualquer configuração ambígua:

- `NOT_READY`

## Limitações

- esta missão não executa canary real
- esta missão não muda produção
- esta missão não cria migration
- esta missão não altera `RawMarketplaceListing`
- esta missão não valida UX pública
- `READY` não autoriza ativação automática

## Observação final

A missão 49I é um precheck de segurança para a próxima etapa autorizada. Ela não executa o canary real. Ela apenas prova que existe um plano mínimo seguro para um `probe` de 1 listing, com kontrolles de kill switch, maxWrites=1, single marketplace, single external ID, rollback e abort criteria bem definidos.

`READY` não autoriza ativação automática.

`RAW_LISTING_DUAL_WRITE_ENABLED=false` por padrão.

A MISSÃO 49I NÃO EXECUTA CANARY REAL.
