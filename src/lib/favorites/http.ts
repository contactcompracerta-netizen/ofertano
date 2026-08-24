export function readBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");

  if (!header) {
    return null;
  }

  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();

  if (!token) {
    return null;
  }

  return token;
}
