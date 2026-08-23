export const GUEST_OWNER = "guest";

export function idsLocaisParaSincronizar(params: {
  ownerId: string | null;
  userId: string;
  idsLocais: string[];
}): string[] {
  const { ownerId, idsLocais } = params;

  if (!ownerId || ownerId === GUEST_OWNER) {
    return idsLocais;
  }

  return [];
}
