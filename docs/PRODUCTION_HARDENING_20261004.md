# Produção Hardening + UX Premium — 2026-10-04

Missão autônoma de endurecimento de produção e UX premium, com o catálogo
congelado (nenhuma nova fonte, nenhum Product novo, Price Monitor
`REFRESH_ONLY`).

## Fonte de verdade

- Branch de trabalho: `feat/production-hardening-ux-premium-20261004`
- Base: `origin/main` em `ea50d160c6fe925a6bffbd786869bd4366225f4f`
- Catálogo: congelado durante toda a missão.
- `PRICE_MONITOR_MODE=REFRESH_ONLY`: preservado e agora protegido por
  teste estático dedicado (`src/services/priceMonitor/priceMonitorInvariant.test.mts`).

## Baseline (antes das alterações)

| CHECK | BEFORE |
| --- | --- |
| typecheck (`tsc --noEmit`) | PASS |
| lint (`eslint`) | 47 erros, 107 warnings (pré-existentes) |
| testes (`npm test`) | PASS |
| build (`npm run build`) | PASS |
| error.tsx / not-found.tsx / global-error.tsx | AUSENTES |
| health endpoint (`/api/health`) | AUSENTE |
| código morto legacy (`components/home`, `components/layout`, `components/products`, `search/SearchBar`, `CategoriesSection`) | PRESENTE |
| guardas `prefers-reduced-motion` | AUSENTE no CSS global |

## O que foi alterado

1. **Remoção de código morto** (duplicatas legacy não importadas por
   nenhuma rota real):
   - `src/components/home/` (Hero, Offers, Categories)
   - `src/components/layout/Header.tsx` (usava busca em `?search=` que não
     corresponde mais ao contrato da Home, `?q=`)
   - `src/components/products/` (ProductCard/ProductInfo duplicados)
   - `src/components/search/SearchBar.tsx`, `src/components/search/ProductInfo.tsx`
   - `src/components/CategoriesSection.tsx` (sem importadores)

2. **Estados de erro e 404 premium e consistentes**:
   - `src/app/not-found.tsx`
   - `src/app/error.tsx`
   - `src/app/global-error.tsx`

3. **Observabilidade mínima**:
   - `GET /api/health` (read-only, sem segredos, `Cache-Control: no-store`)

4. **Acessibilidade/robustez global**:
   - `globals.css`: `font-family` usa `var(--font-geist-sans)` e guarda
     global `prefers-reduced-motion`.

5. **Teste de invariante**:
   - `src/services/priceMonitor/priceMonitorInvariant.test.mts` falha se
     qualquer módulo do Price Monitor referenciar criação de Product.
   - Incluído em `npm run test:listing-first`.

## Decisões documentadas

- **Não** foi feita reformulação visual ampla: a identidade atual (slate +
  emerald, cards, badges discretos) já é consistente; preferiu-se remover
  dívida e tapar lacunas de estado/observabilidade.
- O painel operacional interno (Fase 11) não foi criado porque a arquitetura
  atual já possui páginas de admin protegidas por sessão; criar um painel
  paralelo sem autenticação dedicada seria risco, não benefício.
- A preparação da camada de afiliados (Fase 12) permanece como abstração
  neutra: `src/lib/affiliates/publicPurchase.ts` já é o ponto único de
  resolução de CTA comprável; nenhuma integração nova foi ativada.
