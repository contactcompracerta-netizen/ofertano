# V11.2 — instrumentação evidencial

Camada independente. V9, V10, V11 e V11.1 não são importadas nem modificadas.
Esta entrega implementa instrumentação e validação local; não inclui deployment,
endpoint público, configuração Vercel ou execução real contra banco.

## Componentes

- `src/runtime.mjs`: eventos JSON com UUID aleatório por execução, timestamp UTC e
  sequência crescente. Normaliza `sslmode=require` em memória e publica apenas
  fingerprint SHA-256 truncado. Falhas são códigos fixos, sem mensagens de drivers.
- `src/drivers.mjs`: adapta os construtores pg, PrismaClient e PrismaPg fornecidos
  pelo host. Não importa bibliotecas de banco nem conecta ao carregar o módulo.
  Executa apenas duas consultas literais SELECT por cliente. Read-only é imposto
  na inicialização de cada backend e confirmado por consulta; opções de URL que
  poderiam sobrepor essa proteção são rejeitadas antes da conexão. O pg exige
  também socket criptografado. Prisma usa `pg_stat_ssl`, sem introspecção privada.
- `src/dry-run.mjs`: entrada exclusiva de dry-run; não importa drivers ou dotenv.
  Não existe opção CLI para executar o probe real. Emite saída síncrona JSONL e
  registra o exit code no hook `exit`, depois da conclusão do fluxo.
- `src/derive.mjs`: deriva resultados de um único run, valida sequência e
  pré-requisitos e rejeita evidência misturada, contraditória ou fora de ordem.
  Não deriva build, packaging ou invocação de função a partir de runtime local.

## Garantias e limites da evidência

O caminho dry-run retorna antes de ler ou construir drivers. Seu marcador de
conclusão permite afirmar `DATABASE_CONNECTION_ATTEMPTED=NO` por essa garantia
estrutural; não simula sucesso TLS ou read-only.

O fluxo real exportado exige um recibo interno de dry-run PASS, de uso único,
associado ao hash completo da mesma URL normalizada. Esse recibo não é aceito
como JSON nem extraído de logs, e vive apenas no processo. Não constitui uma
autorização humana: a integração futura continua dependendo de autorização.
O host autorizado deverá fornecer os construtores compatíveis e registrar
`runtime.processExit(code)` exclusivamente no hook de saída do processo.
Nenhum host real está conectado nesta entrega.

Um término abrupto (por exemplo SIGKILL) pode impedir o marcador de saída.
Nesse caso, o exit code permanece INDETERMINATE até existir evidência externa.
Um marcador `CONNECTED` comprova que a API de conexão retornou com sucesso;
os marcadores de consulta comprovam separadamente respostas do backend.
O marcador de desconexão só aparece depois de o encerramento retornar com sucesso.
Erro na desconexão impede conclusão e saída com sucesso.

`NO` exige prova positiva de não ocorrência; `NOT_EVIDENCED` significa evento
não demonstrado; `INDETERMINATE` significa resultado desconhecido; `NOT_RUN`
exige uma conclusão dry-run estrutural ou marcador explícito de etapa omitida
com erro causal. `PASS` e `FAIL` exigem evidência positiva de resultado.
Uma falha pg impede Prisma e gera marcador causal explícito de etapa omitida.
Falha de conexão não é classificada como falha TLS.

## Validação local

A partir desta pasta, com Node 24 disponível:

```sh
node --test tests/runtime.test.mjs
node scripts/static-scan.mjs
```

Os testes usam somente construtores simulados e URLs fictícias `.invalid`.
O preload `tests/block-network.mjs` bloqueia sockets, DNS, TLS, UDP e fetch, e
faz o processo falhar se alguma tentativa ocorrer. Testes de subprocesso usam
ambiente explícito, sem herdar credenciais. Nenhum driver real é importado.
A varredura usa somente o parser TypeScript já instalado no projeto pai.

`evidence/local-dry-run.jsonl` contém uma execução local com fixture, não prova de
Vercel Production. `evidence/tests.txt` e `evidence/static-scan.json` registram a
validação. Os manifests de preservação incluem todos os arquivos encontrados
(inclusive dependências) nas pastas V9/V10/V11/V11.1 selecionadas. Nenhum valor
de conexão existente foi lido para executar os testes.

## Estado canônico anterior preservado

```text
CLASSIFICATION=V11_PROBE_RESULT_INDETERMINATE
STATIC_BUILD_NO_OUT_DIR=CONFIRMED
V11_PROBE_STARTED=NOT_EVIDENCED
PG_CONNECTION_ATTEMPTED=NOT_EVIDENCED
PG_CONNECTION_RESULT=INDETERMINATE
PRISMA_CONNECTION_ATTEMPTED=NOT_EVIDENCED
PRISMA_CONNECTION_RESULT=INDETERMINATE
DATABASE_ACCESS_BY_V11=INDETERMINATE
READY_FOR_R3_WRITE_AUTHORIZATION=NO
R3_WRITE_AUTHORIZED=NO
```

Os resultados locais V11.2 não substituem esse estado nem comprovam conectividade
real, empacotamento de função ou invocação remota.
