import type { Metadata } from "next";
import Link from "next/link";

import HealthStatus from "./HealthStatus";
import styles from "./operations.module.css";
import { loadOperationsDashboard } from "@/services/admin/operations/queries";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: "Operações | Admin",
  robots: { index: false, follow: false },
};

const numberFormat = new Intl.NumberFormat("pt-BR");
const dateFormat = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

function number(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : numberFormat.format(value);
}

function date(value: Date | null | undefined): string {
  return value ? dateFormat.format(value) : "Sem registro";
}

function duration(value: number | null): string {
  if (value === null) return "Em andamento";
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

function StatusTag({
  status,
  children,
}: {
  status: string;
  children: React.ReactNode;
}) {
  return (
    <span className={styles.status} data-status={status}>
      {children}
    </span>
  );
}

export default async function OperationsPage() {
  const dashboard = await loadOperationsDashboard();
  const metrics = dashboard.metrics;
  const failedRuns = dashboard.runs.filter(
    (run) => run.status === "FAILED" || run.status === "PARTIAL" || run.itemsFailed > 0,
  );

  const summary = [
    { label: "Products", value: number(metrics?.catalog.products) },
    { label: "Offers", value: number(metrics?.offers.total) },
    { label: "Produtos públicos", value: number(metrics?.catalog.publicProducts) },
    { label: "Price Monitor", value: metrics?.priceMonitor.mode ?? "UNKNOWN" },
  ];

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Painel administrativo / Observação</p>
          <h1>Operações</h1>
          <p className={styles.intro}>
            Visão operacional somente leitura. Nenhuma ação altera catálogo,
            ofertas, fontes ou processos.
          </p>
        </div>
        <p className={styles.snapshotTime}>
          Snapshot gerado {date(dashboard.generatedAt)}
        </p>
      </header>

      <section className={styles.healthStrip} aria-label="Saúde do sistema">
        <div className={styles.healthItem}>
          <span>API Health</span>
          <HealthStatus />
        </div>
        <div className={styles.healthItem}>
          <span>Consultas operacionais</span>
          <StatusTag status={dashboard.status}>
            {dashboard.status === "OK" ? "OK" : "UNKNOWN"}
          </StatusTag>
        </div>
        <div className={styles.healthItem}>
          <span>Dados de jobs</span>
          <StatusTag status={dashboard.jobsAvailable ? "OK" : "UNKNOWN"}>
            {dashboard.jobsAvailable ? "ImportRun" : "UNKNOWN"}
          </StatusTag>
        </div>
      </section>

      <section className={styles.summaryGrid} aria-label="Resumo executivo">
        {summary.map((item) => (
          <article className={styles.summaryCard} key={item.label}>
            <p>{item.label}</p>
            <strong>{item.value}</strong>
          </article>
        ))}
      </section>

      <section className={styles.section} aria-labelledby="catalog-title">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.eyebrow}>Inventário</p>
            <h2 id="catalog-title">Catálogo</h2>
          </div>
          <p className={styles.sectionNote}>Products não são ofertas compráveis.</p>
        </div>

        {metrics ? (
          <>
            <dl className={styles.metricGrid}>
              <div><dt>Total Products</dt><dd>{number(metrics.catalog.products)}</dd></div>
              <div><dt>Ativos</dt><dd>{number(metrics.catalog.activeProducts)}</dd></div>
              <div><dt>Inativos</dt><dd>{number(metrics.catalog.inactiveProducts)}</dd></div>
              <div><dt>Publicados</dt><dd>{number(metrics.catalog.publishedProducts)}</dd></div>
              <div><dt>Não publicados</dt><dd>{number(metrics.catalog.unpublishedProducts)}</dd></div>
              <div><dt>Navegáveis publicamente</dt><dd>{number(metrics.catalog.publicProducts)}</dd></div>
              <div><dt>Sem Offer</dt><dd>{number(metrics.catalog.productsWithoutOffers)}</dd></div>
              <div><dt>Com 1 Offer</dt><dd>{number(metrics.catalog.productsWithOneOffer)}</dd></div>
              <div><dt>Com 2+ Offers</dt><dd>{number(metrics.catalog.productsWithMultipleOffers)}</dd></div>
              <div><dt>Comparação pública</dt><dd>{number(metrics.catalog.productsWithPublicComparison)}</dd></div>
            </dl>
            <div className={styles.statusList} aria-label="Status de publicação">
              {metrics.catalog.publicationStatuses.map((item) => (
                <span key={item.status}>
                  {item.status}: <strong>{number(item.count)}</strong>
                </span>
              ))}
            </div>
            <p className={styles.mutedLine}>
              Última atualização de Product: {date(metrics.catalog.latestUpdate)}
            </p>
          </>
        ) : (
          <p className={styles.unknownMessage}>Dados do catálogo indisponíveis.</p>
        )}
      </section>

      <section className={styles.section} aria-labelledby="offers-title">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.eyebrow}>Fontes observadas no banco</p>
            <h2 id="offers-title">Ofertas e marketplaces</h2>
          </div>
          <p className={styles.sectionNote}>Fontes sem Offer não são exibidas como ativas.</p>
        </div>

        {metrics ? (
          <>
            <dl className={styles.metricGrid}>
              <div><dt>Total Offers</dt><dd>{number(metrics.offers.total)}</dd></div>
              <div><dt>Ativas</dt><dd>{number(metrics.offers.active)}</dd></div>
              <div><dt>Inativas</dt><dd>{number(metrics.offers.inactive)}</dd></div>
              <div><dt>Média Offers / Product</dt><dd>{metrics.offers.averagePerProduct.toFixed(2)}</dd></div>
              <div><dt>Offers sem URL de origem</dt><dd>{number(metrics.offers.withoutSourceUrl)}</dd></div>
              <div><dt>Potencialmente incompletas</dt><dd>{number(metrics.offers.incomplete)}</dd></div>
              <div><dt>Products com comparação</dt><dd>{number(metrics.offers.productsWithComparison)}</dd></div>
            </dl>

            {metrics.offers.bySource.length > 0 ? (
              <div className={styles.tableWrap}>
                <table>
                  <caption>Ofertas por marketplace presente no banco</caption>
                  <thead>
                    <tr>
                      <th scope="col">Fonte</th>
                      <th scope="col">Offers</th>
                      <th scope="col">Ativas</th>
                      <th scope="col">Products</th>
                      <th scope="col">Última atividade</th>
                      <th scope="col">Estado observado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.offers.bySource.map((source) => (
                      <tr key={source.marketplace}>
                        <th scope="row">{source.label}</th>
                        <td>{number(source.offers)}</td>
                        <td>{number(source.activeOffers)}</td>
                        <td>{number(source.products)}</td>
                        <td>{date(source.latestUpdatedAt)}</td>
                        <td>
                          <StatusTag status={source.status}>
                            {source.status === "ACTIVE" ? "ACTIVE · há Offers ativas" : "UNKNOWN"}
                          </StatusTag>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className={styles.unknownMessage}>Nenhuma fonte encontrada no banco.</p>
            )}
            <p className={styles.mutedLine}>
              Última atualização de Offer: {date(metrics.offers.latestUpdate)}
            </p>
          </>
        ) : (
          <p className={styles.unknownMessage}>Dados de ofertas indisponíveis.</p>
        )}
      </section>

      <section className={styles.section} aria-labelledby="monitor-title">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.eyebrow}>Política de atualização</p>
            <h2 id="monitor-title">Price Monitor</h2>
          </div>
          {metrics && (
            <StatusTag status="OK">{metrics.priceMonitor.mode}</StatusTag>
          )}
        </div>

        <p className={styles.monitorNotice}>Price Monitor não cria produtos.</p>
        {metrics ? (
          <dl className={styles.metricGrid}>
            <div><dt>Modo</dt><dd>{metrics.priceMonitor.mode}</dd></div>
            <div><dt>Criação de Product</dt><dd>DISABLED · {metrics.priceMonitor.productCreation}</dd></div>
            <div><dt>Offers ativas</dt><dd>{number(metrics.priceMonitor.activeOffers)}</dd></div>
            <div><dt>Checagens vencidas</dt><dd>{number(metrics.priceMonitor.dueOffers)}</dd></div>
            <div>
              <dt>Última checagem registrada</dt>
              <dd>{date(metrics.priceMonitor.latestOfferCheck)}</dd>
            </div>
            <div>
              <dt>Atualização de preço</dt>
              <dd>{date(metrics.priceMonitor.latestPriceRecord)}</dd>
            </div>
            <div>
              <dt>Freshness</dt>
              <dd>
                <StatusTag status={metrics.priceMonitor.freshness}>
                  {metrics.priceMonitor.freshness}
                </StatusTag>
              </dd>
            </div>
          </dl>
        ) : (
          <p className={styles.unknownMessage}>Estado do Price Monitor indisponível.</p>
        )}
        <p className={styles.mutedLine}>
          O schema não registra uma execução dedicada do monitor; horários acima
          vêm das ofertas e do histórico de preços.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="jobs-title">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.eyebrow}>Ledger existente</p>
            <h2 id="jobs-title">Sincronizações e jobs</h2>
          </div>
          <p className={styles.sectionNote}>ImportRun · somente leitura</p>
        </div>

        {!dashboard.jobsAvailable ? (
          <p className={styles.unknownMessage}>Dados de jobs não disponíveis.</p>
        ) : dashboard.runs.length === 0 ? (
          <p className={styles.unknownMessage}>Nenhuma execução registrada.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table>
              <caption>Últimas execuções registradas</caption>
              <thead>
                <tr>
                  <th scope="col">Fonte</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Início</th>
                  <th scope="col">Duração</th>
                  <th scope="col">Falhas</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.runs.map((run) => (
                  <tr key={run.id}>
                    <th scope="row">{run.source}</th>
                    <td>{run.mode}</td>
                    <td>
                      <StatusTag
                        status={run.status === "COMPLETED" ? "OK" : run.status === "FAILED" ? "ERROR" : "WARNING"}
                      >
                        {run.status}
                      </StatusTag>
                    </td>
                    <td>{date(run.startedAt)}</td>
                    <td>{duration(run.durationMs)}</td>
                    <td>{number(run.itemsFailed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className={styles.errorSummary}>
          <h3>Falhas recentes</h3>
          {!dashboard.jobsAvailable ? (
            <p className={styles.unknownMessage}>Dados de erros não disponíveis.</p>
          ) : failedRuns.length === 0 ? (
            <p className={styles.mutedLine}>Nenhuma falha registrada nas execuções consultadas.</p>
          ) : (
            <ul>
              {failedRuns.map((run) => (
                <li key={run.id}>
                  <StatusTag status={run.status === "FAILED" ? "ERROR" : "WARNING"}>
                    {run.status}
                  </StatusTag>
                  <span>{run.source} · {date(run.startedAt)}</span>
                  <span>{number(run.itemsFailed)} itens com falha</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <footer className={styles.footerNote}>
        <Link href="/api/health" target="_blank" rel="noreferrer">
          Health endpoint
        </Link>
        <span>Snapshot sem cache longo; carregado uma vez por navegação.</span>
      </footer>
    </main>
  );
}