import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  buildPublicSearchHandoffUrl,
  buildQueryFromOcr,
  queryReachesExistingPlan,
  sniffImageMime,
  validateImageFileMeta,
  validateImageMagic,
} from "./index";
import { IMAGE_SEARCH_MAX_BYTES, IMAGE_SEARCH_QUERY_PARAM } from "./types";

function jpegHeader(): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
}

function pngHeader(): Uint8Array {
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
}

function webpHeader(): Uint8Array {
  return Uint8Array.from([
    0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ]);
}

function pdfHeader(): Uint8Array {
  return Uint8Array.from(Buffer.from("%PDF-1.4\n", "ascii"));
}

const jpegMeta = validateImageFileMeta({
  name: "produto.jpg",
  type: "image/jpeg",
  size: 240_000,
});
assert.equal(jpegMeta.ok, true, "JPG valido precisa passar na validacao");
assert.equal(sniffImageMime(jpegHeader()), "image/jpeg");
assert.equal(validateImageMagic(jpegHeader(), "image/jpeg").ok, true);

const pngMeta = validateImageFileMeta({
  name: "produto.png",
  type: "image/png",
  size: 180_000,
});
assert.equal(pngMeta.ok, true, "PNG valido precisa passar na validacao");
assert.equal(sniffImageMime(pngHeader()), "image/png");
assert.equal(validateImageMagic(pngHeader(), "image/png").ok, true);

assert.equal(sniffImageMime(webpHeader()), "image/webp");

const notImage = validateImageFileMeta({
  name: "contrato.pdf",
  type: "application/pdf",
  size: 120_000,
});
assert.equal(notImage.ok, false, "arquivo nao-imagem precisa ser recusado");
assert.equal(validateImageMagic(pdfHeader(), "application/pdf").ok, false);

const tooBig = validateImageFileMeta({
  name: "enorme.jpg",
  type: "image/jpeg",
  size: IMAGE_SEARCH_MAX_BYTES + 1,
});
assert.equal(tooBig.ok, false, "imagem grande precisa ser recusada");

const identified = buildQueryFromOcr(`
  JBL
  TUNE 520BT
  Wireless
  www.jbl.com
  Made in China
`);

assert.match(identified.query, /jbl/i, "marca detectada precisa ir para a query");
assert.match(identified.query, /520bt/i, "modelo detectado precisa ir para a query");
assert.match(identified.query, /tune/i, "linha Tune precisa permanecer na query");
assert.doesNotMatch(identified.query, /wireless/i, "texto de marketing nao deve virar o produto");
assert.equal(identified.confidence, "HIGH");
assert.equal(identified.needsUserCorrection, false);
assert.equal("productId" in identified, false);
assert.equal("products" in identified, false);
assert.ok(identified.signals.brand);
assert.ok(identified.signals.model || identified.signals.codes.length > 0);

const withCategory = buildQueryFromOcr(
  "Fone de ouvido JBL Tune 520BT Bluetooth",
);
assert.match(withCategory.query, /jbl/i);
assert.match(withCategory.query, /520bt/i);

const gtinQuery = buildQueryFromOcr("Produto 7891234567895", ["7891234567895"]);
assert.equal(gtinQuery.signals.gtin, "7891234567895");
assert.match(gtinQuery.query, /7891234567895/);
assert.equal(gtinQuery.confidence, "HIGH");

const noisy = buildQueryFromOcr("||||  ©   www.loja.com  garantia  cnpj");
assert.ok(
  noisy.confidence === "NONE" || noisy.query.length === 0 || noisy.needsUserCorrection,
  "OCR sem produto nao pode fingir reconhecimento",
);
assert.equal(noisy.needsUserCorrection, true);

const lowConfidence = buildQueryFromOcr("caixa preta");
assert.equal(lowConfidence.needsUserCorrection, true);

const handoff = buildPublicSearchHandoffUrl(identified.query);
assert.match(handoff, /^\//);
assert.match(handoff, new RegExp(`[?&]${IMAGE_SEARCH_QUERY_PARAM}=`));
assert.doesNotMatch(handoff, /productId=/i);

const plan = queryReachesExistingPlan(identified.query);
assert.ok(plan.length >= 1, "query gerada precisa entrar no Query Plan existente");
assert.ok(
  plan.some((item) => /jbl/i.test(item)),
  "o plano existente precisa receber a marca extraida da imagem",
);

const clipped = buildPublicSearchHandoffUrl(`${"fone ".repeat(80)}JBL`);
assert.ok(clipped.length <= 200);

const imageSearchDir = path.join(process.cwd(), "src/services/imageSearch");
const uiFiles = [
  path.join(process.cwd(), "src/components/ImageSearchButton.tsx"),
  path.join(process.cwd(), "src/lib/imageSearch/recognizeInBrowser.ts"),
];

for (const filePath of [
  ...fs.readdirSync(imageSearchDir).map((name) => path.join(imageSearchDir, name)),
  ...uiFiles,
]) {
  if (!/\.(ts|tsx)$/.test(filePath) || filePath.endsWith(".test.ts")) {
    continue;
  }

  const source = fs.readFileSync(filePath, "utf8");
  assert.doesNotMatch(
    source,
    /from ["']@\/services\/database\/saveProduct["']/,
    `${path.basename(filePath)} nao pode gravar Product`,
  );
  assert.doesNotMatch(
    source,
    /from ["']@\/lib\/prisma["']/,
    `${path.basename(filePath)} nao pode usar Prisma`,
  );
}

console.log("imageSearch tests: ok");
