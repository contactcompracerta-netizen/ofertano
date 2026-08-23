export { EditorialError, isEditorialError } from "./errors";
export {
  avaliarSimilaridadeEditorial,
  criarCatalogoEmMemoria,
  detectarDuplicataEditorial,
} from "./duplicates";
export { criarCatalogoPrisma } from "./catalog";
export { criarProviderDeterministico } from "./deterministicProvider";
export {
  gerarPacoteEditorial,
  generateEditorialPackage,
} from "./generateEditorialPackage";
export { mapearPacoteParaRascunho } from "./mapToDraft";
export { normalizarPautaEditorial } from "./normalize";
export {
  criarProviderOpenAiCompativel,
  resolverProviderPadrao,
} from "./provider";
export { sanitizarProdutosEditoriais } from "./products";
export { criarSlugEditorial, slugEditorialValido } from "./slug";
export { validarPacoteEditorial } from "./validatePackage";

export type { EditorialAiProvider } from "./provider";
export type {
  DuplicateCheckResult,
  DuplicateVerdict,
  EditorialPackage,
  EditorialProductInput,
  GenerateEditorialPackageInput,
  NormalizedEditorialInput,
} from "./types";
