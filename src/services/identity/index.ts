export {
  criarCanonicalKeyDaIdentidade,
  ehProdutoCalcado,
  ehProdutoMovel,
  normalizarCodigoIdentidade,
  normalizarMarcaIdentidade,
  normalizarTextoIdentidade,
  resolverIdentidadeProduto,
} from "./resolver";

export type {
  IdentityVariantKey,
  ProductIdentity,
  ProductKind,
} from "./resolver";

export {
  avaliarCompatibilidadeExataEntreImports,
  avaliarIdentidadesExatas,
} from "./exactMatcher";

export type {
  ExactMatchResult,
} from "./exactMatcher";
