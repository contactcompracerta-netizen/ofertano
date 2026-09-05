/**
 * Montagem do conteúdo do e-mail de alerta em português do Brasil.
 *
 * Inclui: nome do produto, preço anterior, preço atual, economia em R$,
 * queda em %, marketplace/oferta relevante, link público do produto no
 * Ofertano e CTA "Ver oferta". Nenhum segredo entra aqui.
 */

import { siteUrl } from "@/lib/siteUrl";

export function produtoLinkPublico(productId: string): string {
  return siteUrl(`/produto/${productId}`);
}

export function formatarPrecoBRL(valor: number): string {
  return valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export type DadosEmailAlerta = {
  productName: string;
  productId: string;
  previousPrice: number;
  currentPrice: number;
  dropPercentage: number;
  marketplace?: string | null;
  store?: string | null;
};

export function montarAssuntoEmail(dados: DadosEmailAlerta): string {
  return `Preço caiu: ${dados.productName}`;
}

export function montarCorpoEmail(dados: DadosEmailAlerta): {
  subject: string;
  html: string;
  text: string;
} {
  const savings = dados.previousPrice - dados.currentPrice;
  const mercado = dados.marketplace ?? dados.store ?? null;
  const link = produtoLinkPublico(dados.productId);

  const subject = montarAssuntoEmail(dados);

  const htmlMercado = mercado
    ? `<p style="color:#64748b;margin:0 0 16px;">Oferta em <strong>${escapeHtml(
        mercado,
      )}</strong></p>`
    : "";

  const textMercado = mercado ? `Oferta em ${mercado}\n\n` : "";

  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#0f172a;">
  <h2 style="color:#047857;margin:0 0 8px;">Preço caiu!</h2>
  <p style="margin:0 0 16px;font-size:15px;line-height:1.5;"><strong>${escapeHtml(
    dados.productName,
  )}</strong></p>
  ${htmlMercado}
  <table style="width:100%;border-collapse:collapse;margin:0 0 16px;">
    <tr>
      <td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px 0 0 8px;">
        <div style="font-size:12px;color:#64748b;">Preço anterior</div>
        <div style="font-size:16px;color:#64748b;text-decoration:line-through;">${formatarPrecoBRL(
          dados.previousPrice,
        )}</div>
      </td>
      <td style="width:8px;"></td>
      <td style="padding:8px 12px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:0 8px 8px 0;">
        <div style="font-size:12px;color:#047857;">Preço agora</div>
        <div style="font-size:20px;font-weight:700;color:#047857;">${formatarPrecoBRL(
          dados.currentPrice,
        )}</div>
      </td>
    </tr>
  </table>
  <p style="margin:0 0 4px;">Você economiza <strong>${formatarPrecoBRL(
    savings,
  )}</strong> (${dados.dropPercentage.toFixed(2)}% de queda).</p>
  <p style="margin:0 0 20px;font-size:14px;color:#475569;">Aproveite enquanto dura!</p>
  <a href="${link}" style="display:inline-block;background:#059669;color:#ffffff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700;">Ver oferta</a>
  <p style="margin:16px 0 0;font-size:12px;color:#94a3b8;">Se não quiser mais receber, desative este alerta na página do produto no Ofertano.</p>
</div>
`;

  const text = `Preço caiu!
${dados.productName}
${textMercado}
Preço anterior: ${formatarPrecoBRL(dados.previousPrice)}
Preço agora: ${formatarPrecoBRL(dados.currentPrice)}

Você economiza ${formatarPrecoBRL(savings)} (${dados.dropPercentage.toFixed(
    2,
  )}% de queda).

Ver oferta: ${link}
`;

  return { subject, html, text };
}

export function escapeHtml(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}