import type { AmazonOffer } from "./types";

function limparTexto(
  texto?: string | null
): string {
  return (
    texto
      ?.replace(/\s+/g, " ")
      .trim() ?? ""
  );
}

function numero(
  texto?: string | null
): number | undefined {
  if (!texto) return undefined;

  const valor = texto
    .replace(/[^\d,]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");

  const numero = Number(valor);

  return Number.isFinite(numero)
    ? numero
    : undefined;
}

export function parseAmazonProduct(
  $: any,
  affiliateLink: string
): AmazonOffer {
  const title =
    limparTexto($("#productTitle").text()) ||
    limparTexto($("title").text());

  if (!title) {
    throw new Error(
      "Não foi possível identificar o título do produto."
    );
  }

  const brand =
    limparTexto($("#bylineInfo").text()) ||
    undefined;

  const price =
    numero(
      $(".a-price .a-offscreen")
        .first()
        .text()
    ) ?? 0;

  const oldPrice =
    numero(
      $(".a-text-price .a-offscreen")
        .first()
        .text()
    );

  const rating =
    Number(
      limparTexto(
        $("#acrPopover")
          .attr("title")
          ?.replace(",", ".")
          .split(" ")[0]
      )
    ) || undefined;

  const reviews =
    Number(
      limparTexto(
        $("#acrCustomerReviewText")
          .text()
          .replace(/[^\d]/g, "")
      )
    ) || undefined;

  const image =
    $("#landingImage").attr("src") ||
    $("#imgBlkFront").attr("src") ||
    "";

  const images = Array.from(
    new Set(
      [
        image,
        ...$("#altImages img")
          .map((_: any, el: any) =>
            $(el).attr("src")
          )
          .get()
          .filter(Boolean),
      ]
    )
  );

  const description =
    limparTexto(
      $("#feature-bullets").text()
    ) || undefined;

  const category =
    limparTexto(
      $("#wayfinding-breadcrumbs_container li")
        .last()
        .text()
    ) || undefined;

  const asin =
    $("#ASIN").val()?.toString() ||
    $("input[name=ASIN]")
      .val()
      ?.toString() ||
    "";

  if (!asin) {
    throw new Error(
      "Não foi possível localizar o ASIN."
    );
  }

  return {
    asin,
    affiliateLink,
    title,
    brand,
    price,
    oldPrice,
    rating,
    reviews,
    image,
    images,
    description,
    category,
  };
}