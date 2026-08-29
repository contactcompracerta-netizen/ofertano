"use client";

import type { ImageSearchQueryResult } from "@/services/imageSearch";
import { buildQueryFromOcr } from "@/services/imageSearch/buildQueryFromOcr";

const MAX_OCR_EDGE = 1600;

type RecognizeProgress = (message: string) => void;

let workerPromise: Promise<TesseractWorker> | null = null;

type TesseractWorker = {
  recognize: (image: Blob) => Promise<{ data: { text: string } }>;
  setParameters: (params: Record<string, unknown>) => Promise<unknown>;
};

function progressLabel(status: string): string {
  if (status.includes("loading tesseract") || status.includes("initializing")) {
    return "Carregando leitor de imagem...";
  }

  if (status.includes("language") || status.includes("traineddata")) {
    return "Preparando OCR local...";
  }

  if (status.includes("recognizing")) {
    return "Lendo o texto da embalagem...";
  }

  return "Analisando a imagem...";
}

async function canvasToJpeg(source: CanvasImageSource, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });

  if (!context) {
    throw new Error("canvas");
  }

  context.drawImage(source, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", 0.82);
  });

  canvas.width = 0;
  canvas.height = 0;

  if (!blob) {
    throw new Error("jpeg");
  }

  return blob;
}

function scaledSize(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= MAX_OCR_EDGE) {
    return { width, height };
  }

  const ratio = MAX_OCR_EDGE / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

async function decodeImage(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
    } catch {
      /*
       * HEIC e alguns WEBP caem no fallback com elemento Image.
       */
    }
  }

  const url = URL.createObjectURL(file);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("decode"));
      element.src = url;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function prepareImageForOcr(file: Blob): Promise<Blob> {
  const decoded = await decodeImage(file);
  const size = scaledSize(decoded.width, decoded.height);
  const prepared = await canvasToJpeg(decoded, size.width, size.height);

  if ("close" in decoded && typeof decoded.close === "function") {
    decoded.close();
  }

  return prepared;
}

async function detectBarcodes(file: Blob): Promise<string[]> {
  const Detector = (
    window as Window & {
      BarcodeDetector?: new (options: { formats: string[] }) => {
        detect: (source: ImageBitmap) => Promise<Array<{ rawValue: string }>>;
      };
    }
  ).BarcodeDetector;

  if (!Detector) {
    return [];
  }

  let bitmap: ImageBitmap | null = null;

  try {
    const detector = new Detector({
      formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"],
    });
    bitmap = await createImageBitmap(file);
    const codes = await detector.detect(bitmap);
    return codes
      .map((item) => item.rawValue.trim())
      .filter((value) => /^\d{8,14}$/.test(value));
  } catch {
    return [];
  } finally {
    bitmap?.close();
  }
}

async function getOcrWorker(onProgress: RecognizeProgress): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const tesseract = await import("tesseract.js");
      const worker = await tesseract.createWorker("por", 1, {
        workerPath:
          "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js",
        corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0",
        logger: (message) => {
          if (message?.status) {
            onProgress(progressLabel(String(message.status)));
          }
        },
      });
      await worker.setParameters({
        tessedit_pageseg_mode: tesseract.PSM.AUTO,
        preserve_interword_spaces: "1",
      });
      return worker;
    })().catch((error) => {
      workerPromise = null;
      throw error;
    });
  }

  return workerPromise;
}

export async function recognizeImageQuery(
  file: Blob,
  onProgress: RecognizeProgress = () => undefined,
): Promise<ImageSearchQueryResult> {
  onProgress("Preparando a imagem...");
  const prepared = await prepareImageForOcr(file);

  onProgress("Procurando códigos visíveis...");
  const barcodes = await detectBarcodes(prepared);

  onProgress("Lendo o texto da imagem...");
  const worker = await getOcrWorker(onProgress);
  const recognized = await worker.recognize(prepared);
  const ocrText = recognized.data.text ?? "";

  return buildQueryFromOcr(ocrText, barcodes);
}
