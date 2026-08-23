import { detectarDuplicataEditorial } from "./duplicates";
import { criarProviderDeterministico } from "./deterministicProvider";
import { normalizarPautaEditorial } from "./normalize";
import { resolverProviderPadrao } from "./provider";
import type { EditorialAiProvider } from "./provider";
import type {
  DuplicateCheckResult,
  EditorialPackage,
  EditorialPostCatalog,
  GenerateEditorialPackageInput,
} from "./types";
import { validarPacoteEditorial } from "./validatePackage";

export type GerarPacoteEditorialDeps = {
  provider?: EditorialAiProvider;
  catalog?: EditorialPostCatalog;
  now?: Date;
};

export async function gerarPacoteEditorial(
  input: GenerateEditorialPackageInput,
  deps: GerarPacoteEditorialDeps = {},
): Promise<EditorialPackage> {
  const normalized = normalizarPautaEditorial(input);
  const now = deps.now ?? new Date();

  let duplicateCheck: DuplicateCheckResult = {
    verdict: "OK",
    matches: [],
  };

  if (deps.catalog) {
    duplicateCheck = await detectarDuplicataEditorial(
      normalized,
      deps.catalog,
      now,
    );
  }

  const provider =
    deps.provider ??
    resolverProviderPadrao({
      deterministicProvider: criarProviderDeterministico(),
    });
  const raw = await provider.gerar(normalized);
  const pacote = validarPacoteEditorial(raw, normalized);

  return {
    ...pacote,
    metadata: {
      ...pacote.metadata,
      duplicateCheck,
      provider: provider.kind,
      generatedAt: now.toISOString(),
    },
  };
}

export const generateEditorialPackage = gerarPacoteEditorial;
