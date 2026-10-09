/**
 * CATALOG_WAVE 1 - FASE N: AwinAdvertiserConfig + Approved Source Guard.
 *
 * Cobertura: config dos 4 merchants, allowlist forte, rejeição explícita
 * de TEMU/Nike/Dafiti/adidas/Polishop/VX Case/Shopee/Amazon/ML e demais
 * fontes não aprovadas.
 */
import {
  WAVE1_AWIN_ADVERTISERS,
  WAVE1_MERCHANT_SLUGS,
  getAdvertiser,
  isApprovedMerchant,
} from "./advertisers";
import {
  approveAwinSource,
  assertNoForbiddenApprovedSource,
  isUnapprovedSource,
  UNAPPROVED_SOURCES,
} from "./sourceGuard";

let passed = 0;
function ok(cond: boolean, label: string): void {
  if (!cond) {
    throw new Error(`FAIL: ${label}`);
  }
  passed += 1;
}

/* --- FASE B: config multi-advertiser ---------------------------------- */
ok(WAVE1_AWIN_ADVERTISERS.length === 4, "exatamente 4 advertisers");
ok(
  WAVE1_MERCHANT_SLUGS.join(",") === "kabum,cama-in-box,olympikus,leveros",
  "slugs da Wave 1",
);

for (const adv of WAVE1_AWIN_ADVERTISERS) {
  ok(adv.affiliateNetwork === "AWIN", `${adv.slug}: affiliateNetwork=AWIN`);
  ok(adv.country === "BR", `${adv.slug}: country=BR`);
  ok(adv.currency === "BRL", `${adv.slug}: currency=BRL`);
  ok(adv.advertiserId === null, `${adv.slug}: advertiserId null até dados reais`);
  ok(adv.feedId === null, `${adv.slug}: feedId null até dados reais`);
  ok(adv.merchantIdentifier === adv.slug, `${adv.slug}: merchantIdentifier`);
  ok(adv.catalogWriteEnabled === false, `${adv.slug}: escrita OFF por padrão`);
  ok(adv.feedConfigured === false, `${adv.slug}: feed não configurado`);
  ok(adv.displayName.length > 0, `${adv.slug}: displayName presente`);
  ok(isApprovedMerchant(adv.slug), `${adv.slug}: aprovado`);
  ok(getAdvertiser(adv.slug) !== undefined, `getAdvertiser(${adv.slug})`);
}

/* --- FASE F: approved source guard ------------------------------------ */
const approved = ["kabum", "cama-in-box", "olympikus", "leveros", "KABUM", "Olympikus"];
for (const slug of approved) {
  const result = approveAwinSource(slug);
  ok(result.approved, `aprovado: ${slug}`);
}

const rejected = [
  "temu",
  "nike",
  "dafiti",
  "adidas",
  "polishop",
  "vx-case",
  "shopee",
  "amazon",
  "mercado-livre",
  "aliexpress",
  "ml",
  "decor-colors",
  "granado",
  "phebo",
  "fut-fanatics",
  "eotica",
  "riachuelo",
  "decathlon",
  "unknown-store",
  "",
  "  ",
];
for (const slug of rejected) {
  const result = approveAwinSource(slug);
  ok(!result.approved, `rejeitado: "${slug}"`);
  if (!result.approved) {
    ok(
      result.reason === "REJECT_UNAPPROVED_SOURCE",
      `reason de "${slug}" = REJECT_UNAPPROVED_SOURCE`,
    );
  }
  ok(isUnapprovedSource(slug), `isUnapprovedSource("${slug}")`);
}

ok(UNAPPROVED_SOURCES.includes("temu"), "lista contém temu");
ok(UNAPPROVED_SOURCES.includes("shopee"), "lista contém shopee");
assertNoForbiddenApprovedSource();
passed += 1;

/* --- Nenhum aprovado é proibido (e vice-versa) ------------------------- */
for (const slug of WAVE1_MERCHANT_SLUGS) {
  ok(!UNAPPROVED_SOURCES.includes(slug), `allowlist não lista ${slug} como proibido`);
}

console.log(`advertisers.test.ts PASS (${passed} asserções)`);
