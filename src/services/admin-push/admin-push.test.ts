import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  canDispatchPendingAffiliateOpportunity,
  findSecondLowestOffer,
  isPermanentPushFailure,
  opportunityDispatchKey,
  shouldMarkDispatchDelivered,
  type ComparableOffer,
} from "./eligibility";
import {
  ADMIN_PUSH_BODY,
  ADMIN_PUSH_TITLE,
  buildAdminPushPayload,
  buildOpportunityFocusPath,
  parseFocusId,
  publicVapidResponse,
} from "./payload";
import {
  parsePushSubscriptionBody,
  parseUnsubscribeEndpoint,
} from "./subscriptionInput";
import { validateOfficialMercadoLivreAffiliateLink } from "../../lib/affiliates/validateAdminAffiliateLink";
import { ehLinkAfiliadoConfirmadoMercadoLivre } from "../../lib/affiliates/publicPurchase";
import { config as proxyConfig } from "../../proxy";

function offer(
  input: Partial<ComparableOffer> & Pick<ComparableOffer, "id" | "marketplace">,
): ComparableOffer {
  return {
    price: 100,
    status: "PENDING_AFFILIATE",
    matchStatus: "EXACT",
    available: true,
    active: true,
    affiliateLink: null,
    ...input,
  };
}

const mlPending = offer({
  id: "ml-1",
  marketplace: "MERCADO_LIVRE",
  price: 899,
  status: "PENDING_AFFILIATE",
});

const amazonActive = offer({
  id: "amz-1",
  marketplace: "AMAZON",
  price: 1099,
  status: "ACTIVE",
  affiliateLink: "https://amazon.com.br/dp/X?tag=ofertano-20",
});

assert.equal(
  canDispatchPendingAffiliateOpportunity({
    marketplace: "MERCADO_LIVRE",
    status: "WAITING_AFFILIATE",
  }),
  true,
  "ProductOpportunity WAITING_AFFILIATE autoriza o Push.",
);

assert.equal(
  canDispatchPendingAffiliateOpportunity({
    marketplace: "MERCADO_LIVRE",
    status: "PUBLISHED",
  }),
  false,
  "Oportunidade já resolvida não dispara Push.",
);

assert.equal(
  canDispatchPendingAffiliateOpportunity({
    marketplace: "AMAZON",
    status: "WAITING_AFFILIATE",
  }),
  false,
  "Amazon não dispara o aviso de menor preço do Mercado Livre.",
);

assert.equal(
  findSecondLowestOffer(mlPending.id, [mlPending, amazonActive])?.id,
  amazonActive.id,
);

assert.equal(
  opportunityDispatchKey("opp-99"),
  "opportunity:opp-99",
);

assert.equal(
  opportunityDispatchKey("opp-99"),
  opportunityDispatchKey("  opp-99  "),
  "A mesma ProductOpportunity gera a mesma chave anti-spam.",
);

assert.equal(
  shouldMarkDispatchDelivered({ sent: 1, failed: 0 }),
  true,
);
assert.equal(
  shouldMarkDispatchDelivered({ sent: 0, failed: 2 }),
  false,
  "Falha de entrega não registra dispatch; tentativa futura pode reenviar.",
);
assert.equal(
  shouldMarkDispatchDelivered({ sent: 0, failed: 0, skipped: true }),
  false,
);

assert.equal(isPermanentPushFailure(410), true);
assert.equal(isPermanentPushFailure(404), true);
assert.equal(isPermanentPushFailure(500), false);
assert.equal(isPermanentPushFailure(null), false);

const payload = buildAdminPushPayload({
  focusId: "opp-99",
  opportunityKey: "opportunity:opp-99",
});

assert.equal(payload.title, ADMIN_PUSH_TITLE);
assert.equal(payload.body, ADMIN_PUSH_BODY);
assert.equal(payload.data.url, "/admin/oportunidades?focus=opp-99");
assert.equal(payload.data.focusId, "opp-99");
assert.equal(buildOpportunityFocusPath("abc"), "/admin/oportunidades?focus=abc");
assert.equal(parseFocusId("  xyz  "), "xyz");
assert.equal(parseFocusId(""), null);

const publicVapid = publicVapidResponse("PUBLIC_KEY_TEST");
assert.equal(publicVapid.publicKey, "PUBLIC_KEY_TEST");
assert.equal("privateKey" in publicVapid, false);

const validSubscription = parsePushSubscriptionBody({
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  keys: {
    p256dh: "p256dh-key",
    auth: "auth-key",
  },
});

assert.ok(validSubscription);
assert.equal(
  validSubscription?.endpoint,
  "https://fcm.googleapis.com/fcm/send/abc",
);

const duplicateParsed = parsePushSubscriptionBody({
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  keys: {
    p256dh: "p256dh-key",
    auth: "auth-key",
  },
});

assert.equal(duplicateParsed?.endpoint, validSubscription?.endpoint);

assert.equal(
  parsePushSubscriptionBody({
    endpoint: "http://insecure.example/push",
    keys: { p256dh: "x", auth: "y" },
  }),
  null,
  "Endpoint HTTP inseguro é rejeitado.",
);

assert.equal(
  parseUnsubscribeEndpoint({
    endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  }),
  "https://fcm.googleapis.com/fcm/send/abc",
);

const official =
  "https://www.mercadolivre.com.br/social/ofertano?matt_word=ofertano";
assert.ok(validateOfficialMercadoLivreAffiliateLink(official));
assert.equal(
  Boolean(validateOfficialMercadoLivreAffiliateLink(official)),
  ehLinkAfiliadoConfirmadoMercadoLivre(official),
  "Admin e applyAffiliateLink compartilham a mesma regra canônica.",
);

assert.equal(
  validateOfficialMercadoLivreAffiliateLink(
    "https://produto.mercadolivre.com.br/MLB-123-_JM",
  ),
  null,
  "URL comum do anúncio não vale como afiliado oficial.",
);

assert.equal(
  validateOfficialMercadoLivreAffiliateLink("https://evil.example/phishing"),
  null,
);

assert.ok(
  proxyConfig.matcher.includes("/api/admin/:path*"),
  "Endpoints /api/admin/push permanecem atrás do Basic Auth.",
);
assert.ok(
  proxyConfig.matcher.includes("/api/opportunities/:path*"),
  "Endpoint de release permanece protegido.",
);
assert.ok(
  proxyConfig.matcher.includes("/admin/:path*"),
  "Painel /admin/oportunidades permanece protegido.",
);

const buttonSource = fs.readFileSync(
  path.join(process.cwd(), "src/app/admin/oportunidades/AdminPushButton.tsx"),
  "utf8",
);
assert.match(
  buttonSource,
  /register\("\/admin\/sw\.js"/,
  "Service Worker deve ser registrado em /admin/sw.js.",
);
assert.match(buttonSource, /scope:\s*"\/admin\/"/);
assert.match(
  buttonSource,
  /Notification\.requestPermission/,
);
assert.doesNotMatch(
  buttonSource,
  /register\("\/sw\.js"/,
);

assert.equal(
  fs.existsSync(path.join(process.cwd(), "public/admin/sw.js")),
  true,
  "O Service Worker físico deve ficar em public/admin/sw.js.",
);
assert.equal(
  fs.existsSync(path.join(process.cwd(), "public/sw.js")),
  false,
  "Não deve existir public/sw.js fora do escopo administrativo.",
);

const swSource = fs.readFileSync(
  path.join(process.cwd(), "public/admin/sw.js"),
  "utf8",
);
assert.match(swSource, /\/admin\/oportunidades\?focus=/);
assert.match(swSource, /clients\.matchAll/);
assert.match(swSource, /clients\.openWindow/);
assert.doesNotMatch(
  swSource,
  /event\.notification\.data\?\.url/,
  "notificationclick não pode abrir URL arbitrária do payload.",
);

const proxySource = fs.readFileSync(
  path.join(process.cwd(), "src/proxy.ts"),
  "utf8",
);
assert.match(
  proxySource,
  /pathname === "\/admin\/sw\.js"/,
  "GET /admin/sw.js deve passar sem Basic Auth para o browser registrar o SW.",
);

const nextConfig = fs.readFileSync(
  path.join(process.cwd(), "next.config.ts"),
  "utf8",
);
assert.match(nextConfig, /source:\s*"\/admin\/sw\.js"/);
assert.match(nextConfig, /Cache-Control/);
assert.doesNotMatch(
  nextConfig,
  /Service-Worker-Allowed/,
  "Service-Worker-Allowed é redundante para /admin/sw.js com scope /admin/.",
);
assert.doesNotMatch(nextConfig, /serverExternalPackages/);

console.log("admin-push.test: ok");
