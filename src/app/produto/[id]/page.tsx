import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import FavoriteButton from "@/components/FavoriteButton";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import ProductGallery from "@/components/ProductGallery";
import ShareProductButton from "@/components/ShareProductButton";
import prisma from "@/lib/prisma";

type ProdutoPageProps = {
  params: Promise<{
    id: string;
  }>;
};

type IconProps = {
  className?: string;
};

function formatarPreco(valor: number) {
  return valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatarQuantidade(valor: number) {
  return new Intl.NumberFormat("pt-BR").format(valor);
}

function formatarMarketplace(marketplace: string) {
  const nomes: Record<string, string> = {
    MERCADO_LIVRE: "Mercado Livre",
    AMAZON: "Amazon",
    SHOPEE: "Shopee",
    MAGAZINE_LUIZA: "Magazine Luiza",
    CASAS_BAHIA: "Casas Bahia",
    KABUM: "KaBuM!",
    TERABYTE: "Terabyte",
    ALIEXPRESS: "AliExpress",
    CARREFOUR: "Carrefour",
  };

  return (
    nomes[marketplace] ||
    marketplace
      .replaceAll("_", " ")
      .toLowerCase()
      .replace(/\b\w/g, (letra) => letra.toUpperCase())
  );
}

function limparMarca(marca: string | null | undefined) {
  const valor = marca?.trim();

  if (!valor) return null;

  return (
    valor
      .replace(/^visite\s+a\s+loja\s+/i, "")
      .replace(/^marca:\s*/i, "")
      .trim() || null
  );
}

function obterTextoOfertaPendente(status: string, available: boolean) {
  if (!available || status === "UNAVAILABLE") {
    return "Oferta indisponível";
  }

  if (status === "ERROR") {
    return "Oferta em verificação";
  }

  return "Link em revisão";
}

function formatarValorEspecificacao(valor: unknown) {
  if (valor === null || valor === undefined) {
    return "Não informado";
  }

  if (typeof valor === "boolean") {
    return valor ? "Sim" : "Não";
  }

  if (typeof valor === "string" || typeof valor === "number") {
    return String(valor);
  }

  if (Array.isArray(valor)) {
    return valor.map((item) => String(item)).join(", ");
  }

  try {
    return JSON.stringify(valor);
  } catch {
    return String(valor);
  }
}

function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
    >
      <path
        d="m9 18 6-6-6-6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StarIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <path d="m12 2.75 2.78 5.63 6.22.91-4.5 4.38 1.06 6.19L12 16.94l-5.56 2.92 1.06-6.19L3 9.29l6.22-.91L12 2.75Z" />
    </svg>
  );
}

function ExternalLinkIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
    >
      <path d="M14 5h5v5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m19 5-8 8" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ShieldIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className={className}
    >
      <path
        d="M12 3 5 6v5c0 4.7 2.8 8.2 7 10 4.2-1.8 7-5.3 7-10V6l-7-3Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m9 12 2 2 4-4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CardIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className={className}
    >
      <rect
        x="3"
        y="5"
        width="18"
        height="14"
        rx="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M3 10h18" strokeLinecap="round" />
      <path d="M7 15h4" strokeLinecap="round" />
    </svg>
  );
}

function TruckIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className={className}
    >
      <path d="M3 6h11v11H3z" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M14 10h4l3 3v4h-7V10Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="7" cy="18" r="2" />
      <circle cx="18" cy="18" r="2" />
    </svg>
  );
}

function CheckIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
    >
      <path
        d="m5 12 4 4L19 6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}


type HistoricoPrecoEntrada = {
  offerId: string | null;
  marketplace: string | null;
  price: number;
  recordedAt: Date;
};

type PontoHistoricoPreco = {
  price: number;
  recordedAt: Date;
};

type AnalisePreco = {
  titulo: string;
  descricao: string;
  badgeClassName: string;
  cardClassName: string;
};

const UM_DIA_EM_MS = 24 * 60 * 60 * 1000;

function construirHistoricoMelhorPreco(
  historico: HistoricoPrecoEntrada[],
): PontoHistoricoPreco[] {
  const precosPorOferta = new Map<string, number>();
  const pontos: PontoHistoricoPreco[] = [];

  for (const registro of historico) {
    if (!Number.isFinite(registro.price) || registro.price <= 0) {
      continue;
    }

    const chaveOferta =
      registro.offerId ??
      `marketplace:${registro.marketplace ?? "DESCONHECIDO"}`;

    precosPorOferta.set(chaveOferta, registro.price);

    const precosConhecidos = Array.from(precosPorOferta.values());

    if (precosConhecidos.length === 0) {
      continue;
    }

    const melhorPreco = Math.min(...precosConhecidos);
    const ultimoPonto = pontos.at(-1);

    if (
      !ultimoPonto ||
      Math.abs(ultimoPonto.price - melhorPreco) > 0.009
    ) {
      pontos.push({
        price: melhorPreco,
        recordedAt: registro.recordedAt,
      });
    }
  }

  return pontos;
}

function calcularMediaPonderada(
  pontos: PontoHistoricoPreco[],
  fimPeriodo: Date,
) {
  if (pontos.length === 0) {
    return null;
  }

  if (pontos.length === 1) {
    return pontos[0].price;
  }

  let totalPonderado = 0;
  let duracaoTotal = 0;

  for (let indice = 0; indice < pontos.length; indice += 1) {
    const pontoAtual = pontos[indice];
    const proximoPonto = pontos[indice + 1];

    const inicio = pontoAtual.recordedAt.getTime();
    const fim = proximoPonto
      ? proximoPonto.recordedAt.getTime()
      : fimPeriodo.getTime();

    const duracao = Math.max(fim - inicio, 1);

    totalPonderado += pontoAtual.price * duracao;
    duracaoTotal += duracao;
  }

  return duracaoTotal > 0
    ? totalPonderado / duracaoTotal
    : pontos.at(-1)?.price ?? null;
}

function analisarPrecoAtual({
  precoAtual,
  menorPreco,
  maiorPreco,
  mediaPreco,
  diasMonitorados,
}: {
  precoAtual: number;
  menorPreco: number;
  maiorPreco: number;
  mediaPreco: number;
  diasMonitorados: number;
}): AnalisePreco {
  if (diasMonitorados < 7) {
    return {
      titulo: "Histórico ainda insuficiente para recomendar.",
      descricao:
        "O Ofertano ainda está acumulando dados reais deste produto. A recomendação aparecerá quando houver pelo menos 7 dias de acompanhamento.",
      badgeClassName:
        "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200",
      cardClassName: "border-slate-200 bg-slate-50",
    };
  }

  const variacaoTotal =
    menorPreco > 0 ? (maiorPreco - menorPreco) / menorPreco : 0;
  const relacaoComMedia =
    mediaPreco > 0 ? precoAtual / mediaPreco : 1;

  if (variacaoTotal <= 0.02) {
    return {
      titulo: "Preço dentro da média",
      descricao:
        "O preço está estável em relação ao período acompanhado. Não houve variação suficiente para indicar uma oportunidade excepcional.",
      badgeClassName:
        "bg-sky-100 text-sky-800 ring-1 ring-inset ring-sky-200",
      cardClassName: "border-sky-200 bg-sky-50/60",
    };
  }

  if (
    precoAtual <= menorPreco * 1.01 ||
    relacaoComMedia <= 0.9
  ) {
    return {
      titulo: "Excelente momento para comprar",
      descricao:
        "O preço atual está muito próximo do menor valor observado ou bem abaixo da média do período monitorado.",
      badgeClassName:
        "bg-emerald-100 text-emerald-800 ring-1 ring-inset ring-emerald-200",
      cardClassName: "border-emerald-200 bg-emerald-50/70",
    };
  }

  if (relacaoComMedia <= 0.97) {
    return {
      titulo: "Bom preço",
      descricao:
        "O valor atual está abaixo da média registrada no período acompanhado.",
      badgeClassName:
        "bg-emerald-100 text-emerald-800 ring-1 ring-inset ring-emerald-200",
      cardClassName: "border-emerald-200 bg-emerald-50/50",
    };
  }

  if (relacaoComMedia <= 1.05) {
    return {
      titulo: "Preço dentro da média",
      descricao:
        "O valor atual está próximo da média registrada durante o acompanhamento.",
      badgeClassName:
        "bg-sky-100 text-sky-800 ring-1 ring-inset ring-sky-200",
      cardClassName: "border-sky-200 bg-sky-50/60",
    };
  }

  if (relacaoComMedia <= 1.12) {
    return {
      titulo: "Preço acima da média",
      descricao:
        "O valor atual está acima da média observada. Vale comparar as lojas antes de concluir a compra.",
      badgeClassName:
        "bg-amber-100 text-amber-900 ring-1 ring-inset ring-amber-200",
      cardClassName: "border-amber-200 bg-amber-50/70",
    };
  }

  return {
    titulo: "Pode valer a pena esperar",
    descricao:
      "O preço atual está significativamente acima da média do período monitorado. Se a compra não for urgente, acompanhar novas variações pode ser vantajoso.",
    badgeClassName:
      "bg-orange-100 text-orange-900 ring-1 ring-inset ring-orange-200",
    cardClassName: "border-orange-200 bg-orange-50/70",
  };
}

function formatarDataHistorico(data: Date) {
  return data.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

function PriceHistoryChart({
  pontos,
}: {
  pontos: PontoHistoricoPreco[];
}) {
  if (pontos.length === 0) {
    return null;
  }

  const largura = 720;
  const altura = 110;
  const margemX = 20;
  const margemSuperior = 9;
  const margemInferior = 13;
  const larguraGrafico = largura - margemX * 2;
  const alturaGrafico = altura - margemSuperior - margemInferior;

  const valores = pontos.map((ponto) => ponto.price);
  const minimo = Math.min(...valores);
  const maximo = Math.max(...valores);
  const amplitudeOriginal = maximo - minimo;
  const amplitude = Math.max(
    amplitudeOriginal,
    Math.max(maximo * 0.08, 1),
  );

  const piso = Math.max(0, minimo - amplitude * 0.18);
  const teto = maximo + amplitude * 0.18;
  const faixa = Math.max(teto - piso, 1);

  const primeiroTempo = pontos[0].recordedAt.getTime();
  const ultimoTempo = pontos.at(-1)?.recordedAt.getTime() ?? primeiroTempo;
  const faixaTempo = Math.max(ultimoTempo - primeiroTempo, 1);

  const coordenadas = pontos.map((ponto, indice) => {
    const tempo = ponto.recordedAt.getTime();

    const x =
      pontos.length === 1
        ? largura / 2
        : margemX +
          ((tempo - primeiroTempo) / faixaTempo) *
            larguraGrafico;

    const y =
      margemSuperior +
      ((teto - ponto.price) / faixa) * alturaGrafico;

    return {
      ...ponto,
      x,
      y,
      indice,
    };
  });

  const linha = coordenadas
    .map((ponto) => `${ponto.x.toFixed(2)},${ponto.y.toFixed(2)}`)
    .join(" ");

  const linhasGrade = [0, 0.5, 1].map((proporcao) => ({
    y: margemSuperior + alturaGrafico * proporcao,
  }));

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div>
        <svg
          viewBox={`0 0 ${largura} ${altura}`}
          role="img"
          aria-label="Gráfico do histórico do melhor preço do produto"
          className="h-auto w-full"
        >
          {linhasGrade.map((linhaGrade, indice) => (
            <line
              key={indice}
              x1={margemX}
              x2={largura - margemX}
              y1={linhaGrade.y}
              y2={linhaGrade.y}
              stroke="currentColor"
              strokeWidth="1"
              className="text-slate-200"
            />
          ))}

          {coordenadas.length > 1 && (
            <polyline
              points={linha}
              fill="none"
              stroke="currentColor"
              strokeWidth="3.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-emerald-600"
            />
          )}

          {coordenadas.map((ponto) => (
            <circle
              key={`${ponto.recordedAt.toISOString()}-${ponto.indice}`}
              cx={ponto.x}
              cy={ponto.y}
              r={coordenadas.length <= 20 ? 4.2 : 3.2}
              fill="currentColor"
              className="text-emerald-600"
            />
          ))}
        </svg>
      </div>

      <div className="flex items-center justify-between border-t border-slate-100 px-2.5 py-1.5 text-[9px] font-bold text-slate-500 sm:text-[10px]">
        <span>{formatarDataHistorico(pontos[0].recordedAt)}</span>
        <span>
          {formatarDataHistorico(
            pontos.at(-1)?.recordedAt ?? pontos[0].recordedAt,
          )}
        </span>
      </div>
    </div>
  );
}

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://ofertano.vercel.app"
).replace(/\/$/, "");

function normalizarUrlAbsoluta(url: string) {
  const valor = url.trim();

  if (!valor) return null;

  if (/^https?:\/\//i.test(valor)) {
    return valor;
  }

  return `${SITE_URL}${valor.startsWith("/") ? "" : "/"}${valor}`;
}

function criarDescricaoCompartilhamento(
  nome: string,
  descricao: string | null | undefined,
) {
  const descricaoLimpa = descricao?.replace(/\s+/g, " ").trim();

  if (descricaoLimpa) {
    return descricaoLimpa.length > 180
      ? `${descricaoLimpa.slice(0, 177).trimEnd()}...`
      : descricaoLimpa;
  }

  return `Compare o preço de ${nome} no Ofertano e compre diretamente na loja parceira.`;
}

export async function generateMetadata({
  params,
}: ProdutoPageProps): Promise<Metadata> {
  const { id } = await params;

  const produto = await prisma.product.findFirst({
    where: {
      id,
      active: true,
    },
    select: {
      name: true,
      description: true,
      image: true,
      images: true,
    },
  });

  if (!produto) {
    return {
      title: "Produto não encontrado | Ofertano",
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  const urlProduto = `${SITE_URL}/produto/${id}`;
  const imagemPrincipal = [produto.image, ...produto.images]
    .filter((imagem): imagem is string => Boolean(imagem?.trim()))
    .map(normalizarUrlAbsoluta)
    .find((imagem): imagem is string => Boolean(imagem));

  const descricao = criarDescricaoCompartilhamento(
    produto.name,
    produto.description,
  );

  return {
    title: `${produto.name} | Ofertano`,
    description: descricao,
    alternates: {
      canonical: urlProduto,
    },
    openGraph: {
      title: produto.name,
      description: descricao,
      url: urlProduto,
      siteName: "Ofertano",
      locale: "pt_BR",
      type: "website",
      images: imagemPrincipal
        ? [{ url: imagemPrincipal, alt: produto.name }]
        : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: produto.name,
      description: descricao,
      images: imagemPrincipal ? [imagemPrincipal] : undefined,
    },
  };
}

export default async function ProdutoPage({ params }: ProdutoPageProps) {
  const { id } = await params;

  const produto = await prisma.product.findFirst({
    where: {
      id,
      active: true,
    },
    include: {
      offers: {
        where: {
          active: true,
        },
        orderBy: {
          price: "asc",
        },
      },
      priceHistory: {
        orderBy: {
          recordedAt: "desc",
        },
        take: 120,
        select: {
          offerId: true,
          marketplace: true,
          price: true,
          recordedAt: true,
        },
      },
    },
  });

  if (!produto) {
    notFound();
  }

  const historicoCronologico = [...produto.priceHistory].reverse();
  const pontosHistorico = construirHistoricoMelhorPreco(
    historicoCronologico,
  );

  const ultimaVerificacao = produto.offers.reduce<Date | null>(
    (maisRecente, oferta) => {
      if (!oferta.lastCheckedAt) {
        return maisRecente;
      }

      if (
        !maisRecente ||
        oferta.lastCheckedAt.getTime() > maisRecente.getTime()
      ) {
        return oferta.lastCheckedAt;
      }

      return maisRecente;
    },
    null,
  );

  if (produto.price > 0) {
    const ultimoPonto = pontosHistorico.at(-1);
    const dataAtualDoPreco =
      ultimaVerificacao ??
      ultimoPonto?.recordedAt ??
      produto.updatedAt;

    if (
      !ultimoPonto ||
      Math.abs(ultimoPonto.price - produto.price) > 0.009
    ) {
      pontosHistorico.push({
        price: produto.price,
        recordedAt: dataAtualDoPreco,
      });
    } else if (
      dataAtualDoPreco.getTime() > ultimoPonto.recordedAt.getTime()
    ) {
      pontosHistorico.push({
        price: produto.price,
        recordedAt: dataAtualDoPreco,
      });
    }
  }

  const precosHistorico = pontosHistorico.map(
    (ponto) => ponto.price,
  );

  const menorPrecoHistorico =
    precosHistorico.length > 0
      ? Math.min(...precosHistorico)
      : produto.price;

  const maiorPrecoHistorico =
    precosHistorico.length > 0
      ? Math.max(...precosHistorico)
      : produto.price;

  const inicioMonitoramento =
    historicoCronologico[0]?.recordedAt ?? null;

  const fimMonitoramento =
    ultimaVerificacao ??
    pontosHistorico.at(-1)?.recordedAt ??
    inicioMonitoramento;

  const diasMonitorados =
    inicioMonitoramento && fimMonitoramento
      ? Math.max(
          0,
          Math.floor(
            (fimMonitoramento.getTime() -
              inicioMonitoramento.getTime()) /
              UM_DIA_EM_MS,
          ),
        )
      : 0;

  const mediaHistorica =
    calcularMediaPonderada(
      pontosHistorico,
      fimMonitoramento ??
        pontosHistorico.at(-1)?.recordedAt ??
        new Date(),
    ) ?? produto.price;

  const analisePreco = analisarPrecoAtual({
    precoAtual: produto.price,
    menorPreco: menorPrecoHistorico,
    maiorPreco: maiorPrecoHistorico,
    mediaPreco: mediaHistorica,
    diasMonitorados,
  });

  const filtrosSemelhantes = [
    { category: produto.category },
    ...(produto.brand?.trim() ? [{ brand: produto.brand }] : []),
  ];

  const selectRecomendado = {
    id: true,
    name: true,
    image: true,
    price: true,
    oldPrice: true,
    discount: true,
    store: true,
    brand: true,
    rating: true,
    reviews: true,
  } as const;

  const produtosSemelhantesDiretos = await prisma.product.findMany({
    where: {
      id: { not: produto.id },
      active: true,
      price: { gt: 0 },
      image: { not: "" },
      OR: filtrosSemelhantes,
    },
    select: selectRecomendado,
    orderBy: [{ featured: "desc" }, { updatedAt: "desc" }],
    take: 8,
  });

  const idsJaSelecionados = produtosSemelhantesDiretos.map(
    (item) => item.id,
  );

  const produtosComplementares =
    produtosSemelhantesDiretos.length < 8
      ? await prisma.product.findMany({
          where: {
            id: {
              notIn: [produto.id, ...idsJaSelecionados],
            },
            active: true,
            price: { gt: 0 },
            image: { not: "" },
          },
          select: selectRecomendado,
          orderBy: [{ featured: "desc" }, { updatedAt: "desc" }],
          take: 8 - produtosSemelhantesDiretos.length,
        })
      : [];

  const produtosRecomendados = [
    ...produtosSemelhantesDiretos,
    ...produtosComplementares,
  ];

  const temSemelhantesDiretos =
    produtosSemelhantesDiretos.length > 0;

  const imagens = Array.from(
    new Set([produto.image, ...produto.images].filter(Boolean)),
  ).slice(0, 6);

  const possuiPrecoAnterior =
    produto.oldPrice !== null && produto.oldPrice > produto.price;

  const percentualDesconto =
    produto.discount !== null && produto.discount > 0
      ? Math.round(produto.discount)
      : possuiPrecoAnterior && produto.oldPrice !== null
        ? Math.round(
            ((produto.oldPrice - produto.price) / produto.oldPrice) * 100,
          )
        : 0;

  const possuiDesconto = percentualDesconto > 0;
  const possuiAvaliacao =
    produto.rating !== null && produto.rating > 0;
  const possuiAvaliacoes =
    produto.reviews !== null && produto.reviews > 0;
  const possuiVendas =
    produto.sales !== null && produto.sales > 0;
  const possuiEstoque =
    produto.stock !== null && produto.stock > 0;

  const linkLegadoPrincipal =
    produto.affiliateLink?.trim() ?? "";

  const ofertaPrincipalComLink = produto.offers.find((oferta) => {
    const link = oferta.affiliateLink?.trim();

    return (
      Boolean(link) &&
      oferta.status === "ACTIVE" &&
      oferta.available
    );
  });

  const linkPrincipal =
    linkLegadoPrincipal ||
    ofertaPrincipalComLink?.affiliateLink?.trim() ||
    "";

  const marketplacePrincipal = linkLegadoPrincipal
    ? produto.store?.trim() || "Loja parceira"
    : ofertaPrincipalComLink
      ? formatarMarketplace(ofertaPrincipalComLink.marketplace)
      : produto.store?.trim() || "Loja parceira";

  const ofertaBaseComparador =
    produto.offers.length > 0
      ? produto.offers.reduce((maisAntiga, oferta) =>
          oferta.createdAt.getTime() < maisAntiga.createdAt.getTime()
            ? oferta
            : maisAntiga,
        )
      : null;

  const ofertasComparador = produto.offers.filter(
    (oferta) =>
      oferta.id === ofertaBaseComparador?.id ||
      oferta.matchStatus === "EXACT",
  );

  const ofertasComparadorDisponiveis = ofertasComparador.filter(
    (oferta) =>
      oferta.available &&
      oferta.status !== "UNAVAILABLE" &&
      oferta.status !== "ERROR" &&
      Number.isFinite(oferta.price) &&
      oferta.price > 0,
  );

  const menorPrecoComparador =
    ofertasComparadorDisponiveis.length > 0
      ? Math.min(
          ...ofertasComparadorDisponiveis.map(
            (oferta) => oferta.price,
          ),
        )
      : null;

  const possuiComparacaoEntreLojas =
    new Set(ofertasComparador.map((oferta) => oferta.marketplace)).size > 1;

  const possuiLinkPrincipal = linkPrincipal.length > 0;

  const usarBarraMobileEmDuasLinhas =
    marketplacePrincipal.toLowerCase().includes("amazon") ||
    formatarPreco(produto.price).length >= 11;

  const marcaExibicao = limparMarca(produto.brand);

  const especificacoes =
    produto.specifications &&
    typeof produto.specifications === "object" &&
    !Array.isArray(produto.specifications)
      ? Object.entries(
          produto.specifications as Record<string, unknown>,
        )
      : [];

  return (
    <div className="min-h-screen bg-slate-50 pb-20 text-slate-950 lg:pb-0">
      <Header />

      <main className="bg-slate-50/70">
        <div className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-[1280px] px-3 py-2 sm:px-5 lg:px-6">
            <nav
              aria-label="Navegação estrutural"
              className="flex min-w-0 items-center gap-1 text-[11px] font-medium text-slate-500 sm:text-xs"
            >
              <Link
                href="/"
                className="shrink-0 transition hover:text-emerald-700"
              >
                Início
              </Link>

              <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-slate-300" />

              <Link
                href="/ofertas"
                className="shrink-0 transition hover:text-emerald-700"
              >
                Ofertas
              </Link>

              <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-slate-300" />

              <span className="min-w-0 truncate font-semibold text-slate-700">
                {produto.name}
              </span>
            </nav>
          </div>
        </div>

        <section className="mx-auto max-w-[1280px] px-3 py-2 sm:px-5 sm:py-3 lg:px-6 lg:py-3">
          <div className="grid items-start gap-2.5 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-0 lg:overflow-visible lg:rounded-2xl lg:border lg:border-slate-200 lg:bg-white lg:p-2.5 lg:shadow-sm xl:grid-cols-[minmax(0,1fr)_375px] xl:p-3">
            <ProductGallery
              images={imagens}
              productName={produto.name}
              discountPercent={percentualDesconto}
              featured={produto.featured}
            />

            <aside className="lg:sticky lg:top-20 lg:border-l lg:border-slate-200 lg:pl-4 xl:pl-5">
              <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-700 ring-1 ring-inset ring-emerald-200 sm:text-[11px]">
                      <CheckIcon className="h-3.5 w-3.5" />
                      Oferta em {marketplacePrincipal}
                    </span>

                    {marcaExibicao && (
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-600 sm:text-[11px]">
                        {marcaExibicao}
                      </span>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5 [&_button]:h-9 [&_button]:w-9">
                    <FavoriteButton
                      productId={produto.id}
                      variant="icon"
                    />

                    <ShareProductButton
                      title={produto.name}
                      text={`Confira esta oferta no Ofertano: ${produto.name}`}
                      platform="whatsapp"
                      variant="icon"
                    />

                    <ShareProductButton
                      title={produto.name}
                      text={`Confira esta oferta no Ofertano: ${produto.name}`}
                      variant="icon"
                    />
                  </div>
                </div>

                <h1 className="mt-2 text-[16px] font-bold leading-[1.25] tracking-[-0.01em] text-slate-950 sm:text-[17px] lg:text-[18px]">
                  {produto.name}
                </h1>

                {(possuiAvaliacao ||
                  possuiVendas ||
                  (possuiEstoque && produto.stock! <= 5)) && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] sm:text-xs">
                    {possuiAvaliacao && (
                      <div className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 font-bold text-amber-800">
                        <StarIcon className="h-3.5 w-3.5 text-amber-500" />
                        <span>{produto.rating?.toFixed(1)}</span>

                        {possuiAvaliacoes && (
                          <span className="font-medium text-amber-700">
                            ({formatarQuantidade(produto.reviews!)} avaliações)
                          </span>
                        )}
                      </div>
                    )}

                    {possuiVendas && (
                      <span className="rounded-md bg-slate-100 px-2 py-1 font-semibold text-slate-600">
                        {formatarQuantidade(produto.sales!)} vendidos
                      </span>
                    )}

                    {possuiEstoque && produto.stock! <= 5 && (
                      <span className="rounded-md bg-orange-50 px-2 py-1 font-black text-orange-700">
                        Últimas {produto.stock} unidades
                      </span>
                    )}
                  </div>
                )}

                <div className="my-2.5 h-px bg-slate-200" />

                <div>
                  {possuiPrecoAnterior &&
                    produto.oldPrice !== null && (
                      <p className="text-xs font-semibold text-slate-400 line-through sm:text-[13px]">
                        {formatarPreco(produto.oldPrice)}
                      </p>
                    )}

                  <div className="mt-0.5 flex flex-wrap items-end gap-2">
                    <p className="text-[27px] font-black leading-none tracking-tight text-emerald-700 sm:text-[29px] lg:text-[30px]">
                      {formatarPreco(produto.price)}
                    </p>

                    {possuiDesconto && (
                      <span className="mb-0.5 rounded-md bg-emerald-100 px-2 py-1 text-[10px] font-black text-emerald-800 sm:text-[11px]">
                        Economize {percentualDesconto}%
                      </span>
                    )}
                  </div>

                  {produto.installments && (
                    <p className="mt-1.5 text-xs font-semibold text-slate-700 sm:text-[13px]">
                      {produto.installments}
                    </p>
                  )}

                  <p className="mt-1.5 text-[11px] leading-4 text-slate-500 sm:text-xs">
                    Preço e condições podem mudar na loja parceira.
                  </p>
                </div>

                {possuiLinkPrincipal ? (
                  <a
                    href={linkPrincipal}
                    target="_blank"
                    rel="noopener noreferrer sponsored"
                    className="mt-2.5 flex min-h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 text-center text-[12px] font-black text-white shadow-md shadow-emerald-600/15 transition hover:-translate-y-0.5 hover:bg-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-200"
                  >
                    Ver oferta em {marketplacePrincipal}
                    <ExternalLinkIcon className="h-4 w-4" />
                  </a>
                ) : (
                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-center">
                    <p className="text-sm font-black text-amber-950">
                      Link em revisão
                    </p>
                    <p className="mt-1 text-xs leading-4 text-amber-800">
                      A oferta já foi encontrada, mas o link individual ainda está sendo validado.
                    </p>
                  </div>
                )}

                <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
                  <div className="flex items-start gap-2">
                    <ShieldIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" />
                    <p className="text-[10px] leading-4 text-slate-600">
                      <span className="font-black text-slate-900">
                        Compra na loja parceira.
                      </span>{" "}
                      Pagamento, entrega e garantia são confirmados diretamente na loja.
                    </p>
                  </div>
                </div>

                <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                  <div className="flex items-center justify-center gap-1 rounded-md border border-slate-200 px-1.5 py-1.5 text-center">
                    <CardIcon className="h-3.5 w-3.5 shrink-0 text-slate-700" />
                    <p className="text-[9px] font-black text-slate-800 sm:text-[10px]">
                      Pagamento
                    </p>
                  </div>

                  <div className="flex items-center justify-center gap-1 rounded-md border border-slate-200 px-1.5 py-1.5 text-center">
                    <TruckIcon className="h-3.5 w-3.5 shrink-0 text-slate-700" />
                    <p className="text-[9px] font-black text-slate-800 sm:text-[10px]">
                      Entrega
                    </p>
                  </div>

                  <div className="flex items-center justify-center gap-1 rounded-md border border-slate-200 px-1.5 py-1.5 text-center">
                    <ShieldIcon className="h-3.5 w-3.5 shrink-0 text-slate-700" />
                    <p className="text-[9px] font-black text-slate-800 sm:text-[10px]">
                      Garantia
                    </p>
                  </div>
                </div>
              </section>
            </aside>
          </div>

          {possuiComparacaoEntreLojas && (
            <section className="mt-2.5 rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm sm:mt-3 sm:p-3">
              <div className="grid gap-2 lg:grid-cols-[340px_minmax(0,1fr)] lg:items-center lg:gap-5">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700 sm:text-[11px]">
                    Comparador Ofertano
                  </p>
                  <h2 className="mt-0.5 text-lg font-black tracking-tight text-slate-950 sm:text-xl lg:text-[18px] lg:leading-6 xl:text-xl xl:whitespace-nowrap">
                    Compare preços em outras lojas
                  </h2>
                  <p className="mt-1 text-[10px] leading-4 text-slate-500 lg:hidden">
                    Confira preço, parcelamento e disponibilidade antes de concluir a compra.
                  </p>
                </div>

                <div className={`min-w-0 grid gap-1.5 ${ofertasComparador.length === 1 ? "grid-cols-1" : "md:grid-cols-2 2xl:grid-cols-3"}`}>
                {ofertasComparador.map((oferta) => {
                  const link = oferta.affiliateLink?.trim();
                  const linkAtivo =
                    Boolean(link) &&
                    oferta.status === "ACTIVE" &&
                    oferta.available;
                  const marketplace = formatarMarketplace(
                    oferta.marketplace,
                  );
                  const menorPrecoEncontrado =
                    menorPrecoComparador !== null &&
                    oferta.available &&
                    oferta.status !== "UNAVAILABLE" &&
                    oferta.status !== "ERROR" &&
                    Math.abs(oferta.price - menorPrecoComparador) < 0.01;

                  const conteudoOferta = (
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="text-sm font-black text-slate-950">
                            {marketplace}
                          </p>

                          {menorPrecoEncontrado && (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-800">
                              Menor preço encontrado
                            </span>
                          )}
                        </div>

                        {oferta.installments && (
                          <p className="mt-0.5 text-[11px] leading-4 text-slate-500">
                            {oferta.installments}
                          </p>
                        )}

                        {!linkAtivo && (
                          <span className="mt-1.5 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-800">
                            {obterTextoOfertaPendente(
                              oferta.status,
                              oferta.available,
                            )}
                          </span>
                        )}
                      </div>

                      <div className="shrink-0 text-right">
                        <p className="text-base font-black text-emerald-700 sm:text-lg">
                          {formatarPreco(oferta.price)}
                        </p>

                        {linkAtivo && (
                          <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-black text-emerald-700">
                            Ver oferta
                            <ExternalLinkIcon className="h-3 w-3" />
                          </p>
                        )}
                      </div>
                    </div>
                  );

                  if (linkAtivo && link) {
                    return (
                      <a
                        key={oferta.id}
                        href={link}
                        target="_blank"
                        rel="noopener noreferrer sponsored"
                        className="rounded-lg border border-slate-200 px-2.5 py-2 transition hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-emerald-50/60 hover:shadow-sm"
                      >
                        {conteudoOferta}
                      </a>
                    );
                  }

                  return (
                    <div
                      key={oferta.id}
                      className="rounded-lg border border-amber-200 bg-amber-50/60 px-2.5 py-2"
                    >
                      {conteudoOferta}
                    </div>
                  );
                })}
                </div>
              </div>
            </section>
          )}

          {pontosHistorico.length > 0 && (
            <section className="mt-2.5 rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm sm:mt-3 sm:p-3">
              <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700 sm:text-[11px]">
                    Inteligência de preço
                  </p>
                  <h2 className="mt-0.5 text-lg font-black tracking-tight text-slate-950 sm:text-xl">
                    Histórico de preços
                  </h2>
                </div>

                <p className="max-w-xl text-[11px] leading-4 text-slate-600 sm:text-xs">
                  Acompanhamos o melhor preço registrado no Ofertano sem inventar valores anteriores.
                </p>
              </div>

              <div className="mt-2 grid grid-cols-3 gap-1.5">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
                  <p className="text-[9px] font-black uppercase tracking-wide text-slate-500 sm:text-[10px]">
                    Preço atual
                  </p>
                  <p className="mt-0.5 text-base font-black text-emerald-700 sm:text-lg">
                    {formatarPreco(produto.price)}
                  </p>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
                  <p className="text-[9px] font-black uppercase tracking-wide text-slate-500 sm:text-[10px]">
                    Menor registrado
                  </p>
                  <p className="mt-0.5 text-base font-black text-slate-950 sm:text-lg">
                    {formatarPreco(menorPrecoHistorico)}
                  </p>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
                  <p className="text-[9px] font-black uppercase tracking-wide text-slate-500 sm:text-[10px]">
                    Média do período
                  </p>
                  <p className="mt-0.5 text-base font-black text-slate-950 sm:text-lg">
                    {formatarPreco(mediaHistorica)}
                  </p>
                </div>
              </div>

              <div className="mt-2 grid gap-2 lg:grid-cols-[minmax(0,1fr)_260px]">
                <PriceHistoryChart pontos={pontosHistorico} />

                <div
                  className={`rounded-lg border p-2.5 ${analisePreco.cardClassName}`}
                >
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                    Comprar agora ou esperar?
                  </p>

                  <span
                    className={`mt-1.5 block rounded-md px-2 py-1 text-[10px] font-black leading-4 ${analisePreco.badgeClassName}`}
                  >
                    {analisePreco.titulo}
                  </span>

                  <p className="mt-1.5 text-[10px] leading-4 text-slate-700 sm:text-[11px]">
                    {analisePreco.descricao}
                  </p>

                  <div className="mt-2 border-t border-slate-200/80 pt-2">
                    <p className="text-[11px] font-bold text-slate-600">
                      {diasMonitorados > 0
                        ? `${diasMonitorados} ${diasMonitorados === 1 ? "dia" : "dias"} de acompanhamento`
                        : "Acompanhamento iniciado recentemente"}
                    </p>
                    <p className="mt-0.5 text-[9px] leading-[14px] text-slate-500 sm:text-[10px] sm:leading-4">
                      A análise usa somente preços realmente registrados pelo Ofertano e pode mudar conforme novas verificações são realizadas.
                    </p>
                  </div>
                </div>
              </div>
            </section>
          )}

          {(produto.description || especificacoes.length > 0) && (
            <div className="mt-4 grid gap-3 sm:mt-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)]">
              {produto.description && (
                <details className="group overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 outline-none transition hover:bg-slate-50 focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-emerald-100 sm:px-5 [&::-webkit-details-marker]:hidden">
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700">
                        Detalhes
                      </p>
                      <h2 className="mt-0.5 text-base font-black tracking-tight text-slate-950 sm:text-lg">
                        Sobre o produto
                      </h2>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5 text-slate-500">
                      <span className="hidden text-[11px] font-bold sm:inline group-open:hidden">
                        Ver detalhes
                      </span>
                      <span className="hidden text-[11px] font-bold sm:group-open:inline">
                        Recolher
                      </span>
                      <span className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-700 transition group-open:border-emerald-200 group-open:bg-emerald-50 group-open:text-emerald-700">
                        <ChevronRightIcon className="h-4 w-4 transition-transform duration-200 group-open:rotate-90" />
                      </span>
                    </div>
                  </summary>

                  <div className="border-t border-slate-200 px-4 pb-4 pt-3 sm:px-5 sm:pb-5">
                    <p className="whitespace-pre-line text-[13px] leading-6 text-slate-600 sm:text-sm">
                      {produto.description}
                    </p>
                  </div>
                </details>
              )}

              {especificacoes.length > 0 && (
                <details className="group overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 outline-none transition hover:bg-slate-50 focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-emerald-100 sm:px-5 [&::-webkit-details-marker]:hidden">
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700">
                        Informações
                      </p>
                      <h2 className="mt-0.5 text-base font-black tracking-tight text-slate-950 sm:text-lg">
                        Ficha técnica
                      </h2>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5 text-slate-500">
                      <span className="hidden text-[11px] font-bold sm:inline group-open:hidden">
                        Ver especificações
                      </span>
                      <span className="hidden text-[11px] font-bold sm:group-open:inline">
                        Recolher
                      </span>
                      <span className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-700 transition group-open:border-emerald-200 group-open:bg-emerald-50 group-open:text-emerald-700">
                        <ChevronRightIcon className="h-4 w-4 transition-transform duration-200 group-open:rotate-90" />
                      </span>
                    </div>
                  </summary>

                  <div className="border-t border-slate-200 px-4 pb-4 sm:px-5 sm:pb-5">
                    <dl className="divide-y divide-slate-200">
                      {especificacoes.map(([chave, valor]) => (
                        <div
                          key={chave}
                          className="grid gap-1 py-2.5 sm:grid-cols-[0.8fr_1.2fr] sm:gap-3"
                        >
                          <dt className="text-xs font-black text-slate-800 sm:text-[13px]">
                            {chave}
                          </dt>
                          <dd className="text-xs leading-5 text-slate-600 sm:text-right sm:text-[13px]">
                            {formatarValorEspecificacao(valor)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                </details>
              )}
            </div>
          )}

          {produtosRecomendados.length > 0 && (
            <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:mt-5 sm:p-5 lg:p-6">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700 sm:text-[11px]">
                    Você também pode gostar
                  </p>
                  <h2 className="mt-0.5 text-xl font-black tracking-tight text-slate-950 sm:text-[22px]">
                    {temSemelhantesDiretos
                      ? "Produtos semelhantes"
                      : "Ofertas recomendadas"}
                  </h2>
                </div>

                <p className="max-w-lg text-xs leading-5 text-slate-600">
                  {temSemelhantesDiretos
                    ? "Produtos da mesma categoria ou marca para você comparar antes de comprar."
                    : "Outras ofertas ativas do Ofertano selecionadas para você continuar comparando."}
                </p>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
                {produtosRecomendados.map((item) => {
                  const temPrecoAnterior =
                    item.oldPrice !== null &&
                    item.oldPrice > item.price;

                  const desconto =
                    item.discount !== null &&
                    item.discount > 0
                      ? Math.round(item.discount)
                      : temPrecoAnterior &&
                          item.oldPrice !== null
                        ? Math.round(
                            ((item.oldPrice - item.price) /
                              item.oldPrice) *
                              100,
                          )
                        : 0;

                  return (
                    <Link
                      key={item.id}
                      href={`/produto/${item.id}`}
                      className="group overflow-hidden rounded-xl border border-slate-200 bg-white transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md"
                    >
                      <div className="relative flex aspect-square items-center justify-center overflow-hidden bg-slate-50 p-3">
                        {desconto > 0 && (
                          <span className="absolute left-2 top-2 z-10 rounded-full bg-rose-600 px-2 py-0.5 text-[9px] font-black text-white shadow-sm sm:text-[10px]">
                            {desconto}% OFF
                          </span>
                        )}

                        <img
                          src={item.image}
                          alt={item.name}
                          loading="lazy"
                          className="h-full w-full object-contain transition duration-300 group-hover:scale-[1.03]"
                        />
                      </div>

                      <div className="p-2.5 sm:p-3">
                        <p className="text-[9px] font-black uppercase tracking-wide text-emerald-700 sm:text-[10px]">
                          {item.store}
                        </p>

                        <h3 className="mt-1 line-clamp-2 min-h-9 text-xs font-bold leading-[18px] text-slate-900 sm:text-[13px]">
                          {item.name}
                        </h3>

                        <div className="mt-2">
                          {temPrecoAnterior &&
                            item.oldPrice !== null && (
                              <p className="text-[10px] font-semibold text-slate-400 line-through sm:text-[11px]">
                                {formatarPreco(item.oldPrice)}
                              </p>
                            )}

                          <p className="text-base font-black text-emerald-700 sm:text-lg">
                            {formatarPreco(item.price)}
                          </p>
                        </div>

                        <span className="mt-2 flex min-h-9 items-center justify-center rounded-lg bg-slate-900 px-2 text-[11px] font-black text-white transition group-hover:bg-emerald-700">
                          Ver produto
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:mt-5 sm:p-5 lg:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                  <ShieldIcon className="h-5 w-5" />
                </div>

                <div>
                  <h2 className="text-base font-black text-slate-950 sm:text-lg">
                    Compre com segurança
                  </h2>
                  <p className="mt-0.5 max-w-2xl text-xs leading-5 text-slate-600 sm:text-[13px]">
                    O Ofertano não recebe pagamentos e não vende produtos diretamente. Sempre confira o endereço da loja, o preço final e as condições da oferta.
                  </p>
                </div>
              </div>

              <Link
                href="/seguranca"
                className="inline-flex shrink-0 items-center justify-center gap-1 rounded-lg border border-slate-200 px-3 py-2.5 text-xs font-black text-slate-800 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800"
              >
                Orientações de segurança
                <ChevronRightIcon className="h-3.5 w-3.5" />
              </Link>
            </div>
          </section>
        </section>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-[100] border-t border-slate-200 bg-white/95 px-2.5 py-2 shadow-[0_-6px_22px_rgba(15,23,42,0.10)] backdrop-blur lg:hidden [padding-bottom:calc(0.5rem+env(safe-area-inset-bottom))]">
        {usarBarraMobileEmDuasLinhas ? (
          <div className="mx-auto max-w-2xl">
            <div className="flex min-w-0 items-center gap-1.5">
              <div className="min-w-0 flex-1">
                {possuiPrecoAnterior &&
                  produto.oldPrice !== null && (
                    <p className="truncate text-[9px] font-semibold text-slate-400 line-through">
                      {formatarPreco(produto.oldPrice)}
                    </p>
                  )}

                <p className="truncate text-[16px] font-black leading-none text-emerald-700">
                  {formatarPreco(produto.price)}
                </p>
              </div>

              <div className="[&_button]:h-9 [&_button]:w-9">
                <ShareProductButton
                  title={produto.name}
                  text={`Confira esta oferta no Ofertano: ${produto.name}`}
                  platform="whatsapp"
                  variant="icon"
                />
              </div>

              <div className="[&_button]:h-9 [&_button]:w-9">
                <ShareProductButton
                  title={produto.name}
                  text={`Confira esta oferta no Ofertano: ${produto.name}`}
                  variant="icon"
                />
              </div>
            </div>

            <div className="mt-1.5">
              {possuiLinkPrincipal ? (
                <a
                  href={linkPrincipal}
                  target="_blank"
                  rel="noopener noreferrer sponsored"
                  className="flex min-h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-center text-[13px] font-black text-white shadow-md shadow-emerald-600/15 active:scale-[0.99]"
                >
                  Ver oferta em {marketplacePrincipal}
                  <ExternalLinkIcon className="h-3.5 w-3.5 shrink-0" />
                </a>
              ) : (
                <div className="flex min-h-10 w-full items-center justify-center rounded-lg border border-amber-200 bg-amber-50 px-3 text-center text-[12px] font-black text-amber-800">
                  Link em revisão
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="mx-auto grid max-w-2xl grid-cols-[minmax(68px,auto)_36px_36px_minmax(92px,1fr)] items-center gap-1.5">
            <div className="min-w-0">
              {possuiPrecoAnterior &&
                produto.oldPrice !== null && (
                  <p className="truncate text-[9px] font-semibold text-slate-400 line-through">
                    {formatarPreco(produto.oldPrice)}
                  </p>
                )}

              <p className="truncate text-[15px] font-black leading-none text-emerald-700">
                {formatarPreco(produto.price)}
              </p>
            </div>

            <div className="[&_button]:h-9 [&_button]:w-9">
              <ShareProductButton
                title={produto.name}
                text={`Confira esta oferta no Ofertano: ${produto.name}`}
                platform="whatsapp"
                variant="icon"
              />
            </div>

            <div className="[&_button]:h-9 [&_button]:w-9">
              <ShareProductButton
                title={produto.name}
                text={`Confira esta oferta no Ofertano: ${produto.name}`}
                variant="icon"
              />
            </div>

            {possuiLinkPrincipal ? (
              <a
                href={linkPrincipal}
                target="_blank"
                rel="noopener noreferrer sponsored"
                className="flex min-h-10 min-w-0 items-center justify-center gap-1 rounded-lg bg-emerald-600 px-2 text-center text-[12px] font-black text-white shadow-md shadow-emerald-600/15 active:scale-[0.99]"
              >
                <span className="truncate">Ver oferta</span>
                <ExternalLinkIcon className="h-3 w-3 shrink-0" />
              </a>
            ) : (
              <div className="flex min-h-10 min-w-0 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 px-2 text-center text-[11px] font-black text-amber-800">
                Link em revisão
              </div>
            )}
          </div>
        )}
      </div>

      <Footer />
    </div>
  );
}