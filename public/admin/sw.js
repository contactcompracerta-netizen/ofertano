/* Service Worker do Admin Ofertano — Web Push padrão.
 * Escopo restrito a /admin/ para não controlar o site público. */

function resolveAdminOpportunityUrl(data) {
  const focusId =
    typeof data?.focusId === "string" ? data.focusId.trim() : "";
  const path = focusId
    ? `/admin/oportunidades?focus=${encodeURIComponent(focusId)}`
    : "/admin/oportunidades";

  return new URL(path, self.location.origin);
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let title = "Ofertano — menor preço encontrado";
  let body = "Mercado Livre tem o menor preço.\nLink afiliado necessário.";
  let tag = "ofertano-admin-opportunity";
  let focusId = "";
  let opportunityKey = "";

  try {
    if (event.data) {
      const incoming = event.data.json();
      if (typeof incoming?.title === "string" && incoming.title.trim()) {
        title = incoming.title;
      }
      if (typeof incoming?.body === "string" && incoming.body.trim()) {
        body = incoming.body;
      }
      if (typeof incoming?.tag === "string" && incoming.tag.trim()) {
        tag = incoming.tag;
      }
      if (typeof incoming?.data?.focusId === "string") {
        focusId = incoming.data.focusId.trim();
      }
      if (typeof incoming?.data?.opportunityKey === "string") {
        opportunityKey = incoming.data.opportunityKey.trim();
      }
    }
  } catch {
    const text = event.data?.text?.() ?? "";
    if (text) {
      body = text;
    }
  }

  const target = resolveAdminOpportunityUrl({ focusId });

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      data: {
        url: `${target.pathname}${target.search}`,
        focusId,
        opportunityKey,
      },
      icon: "/icon.svg",
      badge: "/icon.svg",
      lang: "pt-BR",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = resolveAdminOpportunityUrl(event.notification.data);

  event.waitUntil(
    (async () => {
      const windowClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of windowClients) {
        const clientUrl = new URL(client.url);

        if (clientUrl.origin !== self.location.origin) {
          continue;
        }

        if (
          clientUrl.pathname !== "/admin" &&
          !clientUrl.pathname.startsWith("/admin/")
        ) {
          continue;
        }

        await client.focus();
        client.postMessage({
          type: "OFERTANO_FOCUS_OPPORTUNITY",
          url: `${targetUrl.pathname}${targetUrl.search}`,
        });
        return;
      }

      await self.clients.openWindow(targetUrl.href);
    })(),
  );
});
