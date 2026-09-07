/* eslint-disable @next/next/no-img-element */

import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";

import { getSocialPostById } from "@/services/socialAutomation/engine";
import { formatBRL, summarizeText, validHttpsImageUrl } from "@/services/socialAutomation/format";
import type { SocialOfferData, SocialPostData } from "@/services/socialAutomation/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const COLORS = {
  green: "#087a55",
  greenLight: "#dff8ed",
  ink: "#101827",
  gray: "#526071",
  line: "#dbe5df",
  white: "#ffffff",
  gold: "#d99814",
};

function OfferRow({ offer, best }: { offer: SocialOfferData; best: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        alignItems: "center",
        justifyContent: "space-between",
        border: `2px solid ${best ? COLORS.green : COLORS.line}`,
        background: best ? COLORS.greenLight : COLORS.white,
        borderRadius: 24,
        padding: "22px 26px",
        marginTop: 14,
      }}
    >
      <div style={{ display: "flex", color: COLORS.ink, fontSize: 31, fontWeight: 700 }}>
        {offer.label}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        {best ? (
          <div
            style={{
              display: "flex",
              borderRadius: 999,
              background: COLORS.green,
              color: COLORS.white,
              fontSize: 18,
              fontWeight: 800,
              padding: "8px 14px",
            }}
          >
            MELHOR PREÇO
          </div>
        ) : null}
        <div style={{ display: "flex", color: COLORS.ink, fontSize: 35, fontWeight: 800 }}>
          {formatBRL(offer.price)}
        </div>
      </div>
    </div>
  );
}

function BrandFooter() {
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        alignItems: "center",
        justifyContent: "space-between",
        borderTop: `2px solid ${COLORS.line}`,
        paddingTop: 24,
        marginTop: "auto",
      }}
    >
      <div style={{ display: "flex", color: COLORS.green, fontWeight: 900, fontSize: 32 }}>
        OFERTANO
      </div>
      <div style={{ display: "flex", color: COLORS.gray, fontWeight: 600, fontSize: 23 }}>
        Compare preços antes de comprar.
      </div>
    </div>
  );
}

function ProductVisual({ data }: { data: SocialPostData }) {
  const source = validHttpsImageUrl(data.product?.image);

  if (!source) {
    return (
      <div
        style={{
          display: "flex",
          width: 250,
          height: 250,
          borderRadius: 32,
          alignItems: "center",
          justifyContent: "center",
          background: COLORS.greenLight,
          color: COLORS.green,
          fontSize: 72,
          fontWeight: 900,
        }}
      >
        OF
      </div>
    );
  }

  return (
    <img
      alt=""
      src={source}
      width={250}
      height={250}
      style={{
        objectFit: "contain",
        borderRadius: 32,
        background: COLORS.white,
      }}
    />
  );
}

function DuelCard({ data }: { data: SocialPostData }) {
  const bestOfferId = data.bestOfferId;

  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        flexDirection: "column",
        background: COLORS.white,
        padding: 58,
      }}
    >
      <div style={{ display: "flex", color: COLORS.green, fontSize: 25, fontWeight: 900, letterSpacing: 2 }}>
        {data.eyebrow}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 30, marginTop: 22 }}>
        <ProductVisual data={data} />
        <div style={{ display: "flex", flex: 1, flexDirection: "column" }}>
          <div style={{ display: "flex", color: COLORS.ink, fontSize: 43, lineHeight: 1.08, fontWeight: 850 }}>
            {summarizeText(data.product?.shortName ?? data.headline, 46)}
          </div>
          <div style={{ display: "flex", color: COLORS.gray, fontSize: 25, marginTop: 18 }}>
            {data.subheadline}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", width: "100%", flexDirection: "column", marginTop: 26 }}>
        {data.offers.map((offer) => (
          <OfferRow key={offer.id} offer={offer} best={offer.id === bestOfferId} />
        ))}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: COLORS.ink,
          color: COLORS.white,
          borderRadius: 24,
          padding: "22px 28px",
          marginTop: 22,
        }}
      >
        <div style={{ display: "flex", fontSize: 27, fontWeight: 700 }}>ECONOMIA POSSÍVEL</div>
        <div style={{ display: "flex", color: "#8cf0c9", fontSize: 40, fontWeight: 900 }}>
          {formatBRL(data.savings ?? 0)}
        </div>
      </div>
      <BrandFooter />
    </div>
  );
}

function FoundDealCard({ data }: { data: SocialPostData }) {
  const best = data.offers.find((offer) => offer.id === data.bestOfferId) ?? data.offers[0];

  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        flexDirection: "column",
        background: `linear-gradient(145deg, ${COLORS.green} 0%, #054d39 100%)`,
        padding: 58,
      }}
    >
      <div style={{ display: "flex", color: "#b9ffe3", fontSize: 27, fontWeight: 900, letterSpacing: 2 }}>
        {data.eyebrow}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 34, marginTop: 28 }}>
        <ProductVisual data={data} />
        <div style={{ display: "flex", flex: 1, flexDirection: "column" }}>
          <div style={{ display: "flex", color: COLORS.white, fontSize: 44, lineHeight: 1.1, fontWeight: 850 }}>
            {summarizeText(data.product?.shortName ?? data.headline, 46)}
          </div>
          <div style={{ display: "flex", color: "#c5f7e1", fontSize: 26, marginTop: 16 }}>
            {data.subheadline}
          </div>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          background: COLORS.white,
          borderRadius: 32,
          padding: "32px 34px",
          marginTop: 42,
        }}
      >
        <div style={{ display: "flex", color: COLORS.gray, fontSize: 24, fontWeight: 800 }}>
          MENOR PREÇO ENCONTRADO
        </div>
        <div style={{ display: "flex", color: COLORS.ink, fontSize: 66, fontWeight: 900, marginTop: 8 }}>
          {best ? formatBRL(best.price) : "—"}
        </div>
        <div style={{ display: "flex", color: COLORS.green, fontSize: 28, fontWeight: 800, marginTop: 8 }}>
          Economia possível: {formatBRL(data.savings ?? 0)}
        </div>
      </div>
      {data.comparisonPrice ? (
        <div style={{ display: "flex", color: "#d5ffec", fontSize: 26, marginTop: 24 }}>
          {data.comparisonLabel}: {formatBRL(data.comparisonPrice)}
        </div>
      ) : null}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 999,
          background: COLORS.gold,
          color: COLORS.ink,
          fontSize: 25,
          fontWeight: 900,
          padding: "17px 28px",
          marginTop: 32,
        }}
      >
        {data.cta}
      </div>
      <div
        style={{
          display: "flex",
          width: "100%",
          justifyContent: "space-between",
          borderTop: "2px solid rgba(255,255,255,0.28)",
          paddingTop: 24,
          marginTop: "auto",
        }}
      >
        <div style={{ display: "flex", color: COLORS.white, fontWeight: 900, fontSize: 32 }}>OFERTANO</div>
        <div style={{ display: "flex", color: "#c5f7e1", fontWeight: 600, fontSize: 23 }}>
          Compare preços antes de comprar.
        </div>
      </div>
    </div>
  );
}

function EngagementCard({ data }: { data: SocialPostData }) {
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        flexDirection: "column",
        background: COLORS.ink,
        padding: 66,
      }}
    >
      <div style={{ display: "flex", color: "#8cf0c9", fontSize: 26, fontWeight: 900, letterSpacing: 2 }}>
        {data.eyebrow}
      </div>
      <div style={{ display: "flex", color: COLORS.white, fontSize: 68, lineHeight: 1.08, fontWeight: 900, marginTop: 44 }}>
        {summarizeText(data.headline, 94)}
      </div>
      <div style={{ display: "flex", color: "#c8d3df", fontSize: 35, lineHeight: 1.25, marginTop: 30 }}>
        {data.subheadline}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 28,
          background: COLORS.green,
          color: COLORS.white,
          fontSize: 31,
          fontWeight: 800,
          padding: "27px 32px",
          marginTop: 52,
        }}
      >
        {data.cta}
      </div>
      <div
        style={{
          display: "flex",
          width: "100%",
          alignItems: "center",
          justifyContent: "space-between",
          borderTop: "2px solid #334155",
          paddingTop: 26,
          marginTop: "auto",
        }}
      >
        <div style={{ display: "flex", color: "#8cf0c9", fontWeight: 900, fontSize: 32 }}>OFERTANO</div>
        <div style={{ display: "flex", color: "#c8d3df", fontWeight: 600, fontSize: 23 }}>
          Compare preços antes de comprar.
        </div>
      </div>
    </div>
  );
}

function SocialCard({ data }: { data: SocialPostData }) {
  if (data.template === "FOUND_DEAL") return <FoundDealCard data={data} />;
  if (data.template === "DUEL") return <DuelCard data={data} />;
  return <EngagementCard data={data} />;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const post = await getSocialPostById(id.trim());

    if (!post) {
      return NextResponse.json(
        { success: false, error: "Post social não encontrado." },
        { status: 404 },
      );
    }

    return new ImageResponse(<SocialCard data={post.data} />, {
      width: 1080,
      height: 1080,
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=86400",
      },
    });
  } catch (error) {
    console.error("Erro ao gerar imagem social:", error);

    return NextResponse.json(
      { success: false, error: "Não foi possível gerar a imagem social." },
      { status: 500 },
    );
  }
}
