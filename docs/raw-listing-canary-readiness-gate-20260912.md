# Raw Listing Canary Readiness Gate

## Objetivo

O readiness gate interno para `RawMarketplaceListing` avalia apenas se um futuro canary controlado pode ser considerado seguro para prosseguir.

Ele não ativa nada. Ele não escreve no banco. Ele não altera env. Ele não modifica o legado. Ele apenas responde com:

- `READY`
- `NOT_READY`

## Semântica de segurança

- `RAW_LISTING_DUAL_WRITE_ENABLED=false` por padrão
- nenhuma ativação automática
- nenhuma escrita real no banco
- nenhuma dependência de banco para leitura de readiness
- fail-closed em qualquer configuração ambígua
- abordagem leitura-only

## Significado de READY

`READY` indica apenas que as condições mínimas do canary foram verificadas com segurança e que o sistema está em estado de avaliação interna para um futuro rollout controlado.

`READY` não autoriza ativação automática.

`READY` não significa que o dual-write foi ligado.

## Significado de NOT_READY

`NOT_READY` indica que alguma condição crítica falhou:

- dual-write já habilitado
- allowlist de marketplace ausente ou inválida
- `RAW_LISTING_CANARY_MAX_WRITES` ausente ou inválido
- external IDs inválidos em allowlist
- métricas indisponíveis
- configuração malformada ou ambígua

## Condições mínimas exigidas

### A) Dual write desligado

A flag `RAW_LISTING_DUAL_WRITE_ENABLED` deve estar desligada ao avaliar readiness.

Se estiver habilitada:

- `NOT_READY`
- motivo: `DUAL_WRITE_ALREADY_ENABLED`

### B) Marketplace canary explícito

Deve existir allowlist válida de marketplaces para um futuro canary.

Sem allowlist válida:

- `NOT_READY`
- motivo: `MARKETPLACE_ALLOWLIST_MISSING` ou `MARKETPLACE_ALLOWLIST_INVALID`

Não se aceita "todos os marketplaces" como configuração segura.

### C) Max writes válido

`RAW_LISTING_CANARY_MAX_WRITES` deve estar presente e representar um inteiro positivo, limitado e interpretável.

Aceito:

- `1`
- `2`
- `5`

Rejeitado:

- `0`
- `-1`
- `NaN`
- `Infinity`
- strings inválidas

### D) External IDs

Se `RAW_LISTING_CANARY_EXTERNAL_IDS` estiver presente, cada valor deve ser válido segundo as regras já existentes do canary.

IDs com whitespace, vazio ou formato inválido:

- `NOT_READY`
- motivo: `EXTERNAL_ID_ALLOWLIST_INVALID`

### E) Métricas

O gate exige que a infraestrutura interna de métricas esteja presente e legível.

Se as métricas não forem acessíveis:

- `NOT_READY`
- motivo: `METRICS_UNAVAILABLE`

### F) Banco

O gate não consulta banco de forma ativa para decisão de readiness, salvo se houver arquitetura funcional já existente. Esta missão não adiciona dependência de banco apenas para readiness.

A verificação de banco continua sendo feita por validações independentes da missão.

## Fail-closed

Qualquer ambiguidade ou entrada malformada resulta em `NOT_READY`.

Nunca há comportamento otimista.

Se a configuração não puder ser interpretada com segurança:

- `NOT_READY`
- sem lançar erro para o legado

## Comportamento read-only

`evaluateRawListingCanaryReadiness()` não pode:

- alterar env
- ativar flag
- escrever no banco
- consumir max writes
- incrementar contadores de canary operacionais
- tocar em repositório
- acessar marketplace externo
- mudar estado de produto
- alterar dados persistentes
- mudar legado

O gate é uma avaliação somente leitura.

## Kill switch

O kill switch continua sendo o mesmo definido anteriormente:

- `RAW_LISTING_DUAL_WRITE_ENABLED=false` por padrão
- allowlists restritivas
- limite máximo de writes
- rejeição por marketplace e external ID
- qualquer configuração inválida bloqueia a decisão

## Limitações

Este gate não implementa rollout automático.

Ele também não exige histórico vencedor de canary real, porque nenhum canary real foi executado nesta missão.

Os critérios futuros para expansão real devem incluir:

- `writeFailed = 0`
- nenhuma falha no legado
- ausência de duplicidade
- sem alterações públicas
- sem crescimento inesperado de volume
- banco consistente
- kill switch validado

## Relação com a missão 49H

A missão 49H apenas responde:

- o sistema está pronto para um canary futuro?

Ela não autoriza:

- ativação
- deploy
- push
- alteração persistente de `.env`
- alteração de Vercel
- alteração de schema
- migration
- escreve no banco
- rollout em produção

## Conclusão

A missão 49H deve servir como gate interno e determinístico para segurança operacional. O sistema pode ficar em `READY` apenas quando as condições mínimas estiverem todas satisfeitas e a configuração estiver explicitamente segura.

O padrão de operação continua sendo:

- `RAW_LISTING_DUAL_WRITE_ENABLED=false`
- avaliação somente leitura
- fail-closed
- legado intacto

`READY` não autoriza ativação automática.

A MISSÃO 49H NÃO AUTORIZA ATIVAÇÃO EM PRODUÇÃO.
