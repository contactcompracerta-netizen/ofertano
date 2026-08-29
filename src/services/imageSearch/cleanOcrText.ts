const PACKAGING_NOISE = new Set([
  "www",
  "http",
  "https",
  "cnpj",
  "cpf",
  "industria",
  "industrial",
  "fabricado",
  "fabricada",
  "importado",
  "importada",
  "garantia",
  "warranty",
  "direitos",
  "reserved",
  "copyright",
  "made",
  "china",
  "sac",
  "ouvidoria",
  "cep",
  "ltda",
  "inc",
  "llc",
  "com",
  "br",
  "net",
  "org",
  "info",
  "email",
  "telefone",
  "whatsapp",
  "instagram",
  "facebook",
]);

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function isPackagingNoiseToken(token: string): boolean {
  const normalized = fold(token).replace(/[^a-z0-9]+/g, "");
  if (!normalized) {
    return true;
  }

  if (PACKAGING_NOISE.has(normalized)) {
    return true;
  }

  if (/^www/.test(normalized) || /\.(com|br|net|org)$/.test(normalized)) {
    return true;
  }

  return false;
}

export function cleanOcrText(raw: string): string {
  const lines = raw
    .replace(/\u0000/g, " ")
    .split(/\r?\n+/)
    .map((line) =>
      line
        .replace(/[|¦]+/g, " ")
        .replace(/[_~`^]+/g, " ")
        .replace(/[^\p{L}\p{N}\s.+/-]/gu, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((line) => {
      if (line.length < 2) {
        return false;
      }

      const letters = (line.match(/\p{L}|\p{N}/gu) ?? []).length;
      return letters >= 2;
    });

  const tokens = lines
    .join(" ")
    .split(/\s+/)
    .map((token) => token.replace(/^[,.;:]+|[,.;:]+$/g, ""))
    .filter((token) => {
      if (token.length < 2) {
        return false;
      }

      if (isPackagingNoiseToken(token)) {
        return false;
      }

      return /[\p{L}\p{N}]/u.test(token);
    });

  return tokens.join(" ").replace(/\s+/g, " ").trim();
}

export function extractDigitCodes(text: string): string[] {
  const matches = text.match(/\b\d{8,14}\b/g) ?? [];
  return Array.from(new Set(matches));
}

export function eanChecksumDigit(body: string): number {
  let sum = 0;

  for (let index = 0; index < body.length; index += 1) {
    const digit = Number(body[index]);
    const weight = index % 2 === 0 ? 1 : 3;
    sum += digit * weight;
  }

  return (10 - (sum % 10)) % 10;
}

export function isValidGtin(code: string): boolean {
  if (!/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(code)) {
    return false;
  }

  if (/^0+$/.test(code) || /^(\d)\1+$/.test(code)) {
    return false;
  }

  const body = code.slice(0, -1);
  const check = Number(code.slice(-1));

  if (code.length === 12) {
    return eanChecksumDigit(`0${body}`) === check;
  }

  return eanChecksumDigit(body) === check;
}

export function pickBestGtin(codes: string[]): string | null {
  const ranked = codes.filter(isValidGtin).sort((left, right) => right.length - left.length);
  return ranked[0] ?? null;
}
