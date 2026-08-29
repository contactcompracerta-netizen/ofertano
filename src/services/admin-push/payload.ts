export const ADMIN_PUSH_TITLE =
  "Ofertano — menor preço encontrado";

export const ADMIN_PUSH_BODY =
  "Mercado Livre tem o menor preço.\nLink afiliado necessário.";

export function buildOpportunityFocusPath(focusId: string) {
  const id = focusId.trim();

  if (!id) {
    return "/admin/oportunidades";
  }

  return `/admin/oportunidades?focus=${encodeURIComponent(id)}`;
}

export function parseFocusId(value: string | null | undefined) {
  const id = value?.trim();
  return id || null;
}

export type AdminPushPayload = {
  title: string;
  body: string;
  tag: string;
  data: {
    url: string;
    focusId: string;
    opportunityKey: string;
  };
};

export function buildAdminPushPayload(input: {
  focusId: string;
  opportunityKey: string;
}): AdminPushPayload {
  const focusId = input.focusId.trim();

  return {
    title: ADMIN_PUSH_TITLE,
    body: ADMIN_PUSH_BODY,
    tag: `ofertano-${input.opportunityKey}`,
    data: {
      url: buildOpportunityFocusPath(focusId),
      focusId,
      opportunityKey: input.opportunityKey,
    },
  };
}

export function publicVapidResponse(publicKey: string) {
  return {
    configured: true,
    publicKey,
  };
}
