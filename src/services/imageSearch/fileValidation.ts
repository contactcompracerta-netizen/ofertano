import {
  IMAGE_SEARCH_ACCEPTED_MIME,
  IMAGE_SEARCH_MAX_BYTES,
  type ImageFileMeta,
  type ImageValidationResult,
} from "./types";

const JPEG_HEADER = [0xff, 0xd8, 0xff];
const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function headerEquals(bytes: Uint8Array, header: number[]): boolean {
  if (bytes.length < header.length) {
    return false;
  }

  return header.every((value, index) => bytes[index] === value);
}

function asciiAt(bytes: Uint8Array, offset: number, value: string): boolean {
  if (bytes.length < offset + value.length) {
    return false;
  }

  for (let index = 0; index < value.length; index += 1) {
    if (bytes[offset + index] !== value.charCodeAt(index)) {
      return false;
    }
  }

  return true;
}

export function sniffImageMime(
  bytes: Uint8Array,
): "image/jpeg" | "image/png" | "image/webp" | "image/heic" | null {
  if (headerEquals(bytes, JPEG_HEADER)) {
    return "image/jpeg";
  }

  if (headerEquals(bytes, PNG_HEADER)) {
    return "image/png";
  }

  if (asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP")) {
    return "image/webp";
  }

  if (asciiAt(bytes, 4, "ftyp")) {
    const brands = ["heic", "heix", "heif", "mif1", "msf1"];
    if (brands.some((brand) => asciiAt(bytes, 8, brand))) {
      return "image/heic";
    }
  }

  return null;
}

export function normalizeClaimedMime(value: string): string {
  const mime = value.trim().toLowerCase();

  if (mime === "image/jpg") {
    return "image/jpeg";
  }

  return mime;
}

export function validateImageFileMeta(file: ImageFileMeta): ImageValidationResult {
  if (!file || file.size <= 0) {
    return { ok: false, error: "Selecione uma imagem para pesquisar." };
  }

  if (file.size > IMAGE_SEARCH_MAX_BYTES) {
    return {
      ok: false,
      error: "A imagem é grande demais. Use um arquivo de até 8 MB.",
    };
  }

  const claimed = normalizeClaimedMime(file.type);
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const extensionLooksImage = ["jpg", "jpeg", "png", "webp", "heic", "heif"].includes(
    extension,
  );

  if (claimed && !IMAGE_SEARCH_ACCEPTED_MIME.has(claimed) && !extensionLooksImage) {
    return {
      ok: false,
      error: "Envie uma imagem JPG, PNG ou WEBP.",
    };
  }

  if (!claimed && !extensionLooksImage) {
    return {
      ok: false,
      error: "Envie uma imagem JPG, PNG ou WEBP.",
    };
  }

  return { ok: true };
}

export function validateImageMagic(
  bytes: Uint8Array,
  claimedMime = "",
): ImageValidationResult {
  if (!bytes.length) {
    return { ok: false, error: "Não foi possível ler a imagem." };
  }

  const sniffed = sniffImageMime(bytes);
  const claimed = normalizeClaimedMime(claimedMime);

  if (sniffed) {
    return { ok: true };
  }

  if (claimed === "image/heic" || claimed === "image/heif") {
    /*
     * Alguns browsers nao expõem o container HEIC completo no recorte
     * inicial. A decodificacao real acontece depois no canvas.
     */
    return { ok: true };
  }

  if (asciiAt(bytes, 0, "%PDF") || asciiAt(bytes, 0, "PK")) {
    return {
      ok: false,
      error: "Este arquivo não é uma imagem. Envie JPG, PNG ou WEBP.",
    };
  }

  return {
    ok: false,
    error: "Este arquivo não é uma imagem válida.",
  };
}

export async function readFileHeader(file: Blob, length = 16): Promise<Uint8Array> {
  const slice = file.slice(0, length);
  const buffer = await slice.arrayBuffer();
  return new Uint8Array(buffer);
}

export async function validateImageFile(file: File): Promise<ImageValidationResult> {
  const meta = validateImageFileMeta({
    name: file.name,
    type: file.type,
    size: file.size,
  });

  if (!meta.ok) {
    return meta;
  }

  const header = await readFileHeader(file);
  return validateImageMagic(header, file.type);
}
