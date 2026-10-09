# Catalog Wave 1 — Runtime e Shadow Real

Estado: infraestrutura de runtime preparada; execução real bloqueada até existirem credenciais e IDs de feed AWIN aprovados.

## Baseline de produção observado em 2026-10-09

- Products: 26
- MarketplaceOffers: 55
- Products ativos: 2
- Offers ativas: 30
- Product LIVE_COMPLETE: 1
- Product LIVE_PARTIAL: 1
- Product DRAFT/inativo: 24
- Mercado Livre offers: 47
  - listing-first identityVersion=1: 25
  - legado identityVersion=0: 22
- Shopee ACTIVE: 5
- Magazine Luiza ACTIVE: 3
- CatalogImportStagingItem: tabela existente, 0 linhas antes do primeiro shadow real

Essas métricas são snapshot operacional; não são fixtures nem metas.

## Contratos que permanecem obrigatórios

1. Mercado Livre: Listing != Catalog Product.
2. Somente anúncio/listing real, identificável e comprável pode virar oferta.
3. catalog_product_id pode enriquecer identidade/matching, nunca substituir externalId.
4. Price Monitor permanece REFRESH_ONLY; não cria Product.
5. Catalog Wave 1 é fail-closed.
6. Rede de afiliados, merchant e marketplace são identidades diferentes.
7. Nenhuma fonte não aprovada entra por fallback.
8. Nenhum parser escreve diretamente em Product/MarketplaceOffer.
9. Falha de identidade ou dado comercial incompleto vai para REVIEW/REJECT, nunca para publicação automática.

## Modos

### DISABLED
Nada executa.

### DRY_RUN
Normaliza, valida, classifica identidade, faz matching e monta plano sem gravar banco.

### SHADOW
Pode gravar somente CatalogImportStagingItem, quando todas as flags abaixo estiverem explicitamente ligadas. Product e MarketplaceOffer são auditados antes/depois e devem ficar idênticos.

### CANARY
Reservado para futura promoção controlada, depois de evidência real do shadow e aprovação dos merchants. Exige flag de escrita de catálogo.

### LIVE
Reservado; exige flag adicional de LIVE e não deve ser ativado nesta fase.

## Flags

Defaults são todos OFF:

- CATALOG_IMPORT_ENABLED=false
- AWIN_WAVE1_ENABLED=false
- AWIN_WAVE1_STAGING_WRITE_ENABLED=false
- AWIN_WAVE1_WRITE_ENABLED=false
- AWIN_WAVE1_LIVE_ENABLED=false
- CATALOG_IMPORT_MODE=DISABLED

Shadow real exige:

- CATALOG_IMPORT_ENABLED=true
- AWIN_WAVE1_ENABLED=true
- AWIN_WAVE1_STAGING_WRITE_ENABLED=true
- AWIN_WAVE1_WRITE_ENABLED=false
- AWIN_WAVE1_LIVE_ENABLED=false
- CATALOG_IMPORT_MODE=SHADOW

## Credencial AWIN

O runner usa a chave específica de Product Feed/Data Feed em AWIN_DATAFEED_API_KEY. Não confundir com token da Partner API.

Merchants preparados na Wave 1:

- kabum
- cama-in-box
- olympikus
- leveros

Para cada merchant é obrigatório configurar o advertiser ID real. Feed ID é opcional somente quando o advertiser tiver exatamente um feed disponível:

- AWIN_KABUM_ADVERTISER_ID / AWIN_KABUM_FEED_ID
- AWIN_CAMA_IN_BOX_ADVERTISER_ID / AWIN_CAMA_IN_BOX_FEED_ID
- AWIN_OLYMPIKUS_ADVERTISER_ID / AWIN_OLYMPIKUS_FEED_ID
- AWIN_LEVEROS_ADVERTISER_ID / AWIN_LEVEROS_FEED_ID

Nunca inventar advertiser/feed IDs.

## Pipeline

AWIN Feed List -> feed selecionado -> download limitado -> CSV parser -> AWIN mapper -> normalizer -> validator -> identity -> matcher -> staging -> plan.

No SHADOW o pipeline para no plan. Não existe writer de Product/Offer no caminho de shadow.

## Segurança de download

- HTTPS obrigatório.
- Hosts de download allowlisted: productdata.awin.com e datafeed.api.productserve.com.
- Timeout.
- Limite de bytes.
- Limite de linhas por execução.
- Gzip detectado por magic bytes.
- Credenciais não são logadas.

## Qualidade de dados

- externalId ausente -> REJECT
- título ausente -> REJECT
- preço inválido -> REJECT
- moeda != BRL -> REJECT
- destination URL inválida -> REJECT
- affiliate URL inválida -> REJECT
- item explicitamente indisponível -> REJECT
- affiliate URL ausente -> REVIEW
- imagem ausente -> REVIEW
- GTIN inválido -> ignorado como sinal e item fica conservador
- identidade fraca/parcial -> REVIEW
- conflito de GTIN/marca/modelo -> REVIEW
- duplicata de externalId no mesmo feed -> REJECT

## Execução

- Testes de runtime: npm run test:catalog-wave1-runtime
- Dry-run sintético: npm run wave1:dry-run
- Shadow real, somente após configurar credenciais/IDs: npm run wave1:shadow

O runner imprime run ID, contadores por merchant, Products/Offers/Staging antes/depois, merchants processados/bloqueados, PRODUCT_WRITES=0, OFFER_WRITES=0 e SHADOW_STATUS.

Se Product ou MarketplaceOffer mudar durante SHADOW, a execução falha.

## Critério para próxima fase

CANARY real só pode ser projetado/ativado após:

1. AWIN Product Feed key disponível.
2. Advertiser/feed IDs reais dos merchants aprovados.
3. Shadow real executado.
4. Distribuição de VALID/PARTIAL/INVALID conhecida.
5. Cobertura de identidade A/B conhecida.
6. Falsos positivos de matching revisados.
7. Duplicatas e conflitos auditados.
8. Product/Offer permanecerem inalterados no shadow.
9. Política de enum/merchant para Cama In Box, Olympikus e Leveros definida sem fingir que AWIN é marketplace.
10. Aprovação explícita para passar de staging para escrita controlada.

Até lá, AWIN_WAVE1_WRITE_ENABLED e AWIN_WAVE1_LIVE_ENABLED permanecem OFF.
