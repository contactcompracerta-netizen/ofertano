export {
  canonizarHifensModelo,
  codigoModeloMaisEspecificoQue,
  criarCanonicalKeyDaIdentidade,
  ehCodigoSkuEspecifico,
  ehProdutoCalcado,
  ehProdutoMovel,
  extrairGtinDaConsulta,
  normalizarCodigoIdentidade,
  normalizarMarcaIdentidade,
  normalizarTextoIdentidade,
  resolverIdentidadeProduto,
  selecionarCodigosModeloMaisEspecificos,
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

export type { ExactMatchResult } from "./exactMatcher";

export {
  avaliarCompatibilidadeComConsulta,
  criarConsultasGlobaisDeIdentidade,
  pontuarEspecificidadeDaConsulta,
} from "./queryMatcher";

export type {
  QueryIdentityInput,
  QueryMatchResult,
} from "./queryMatcher";

export {
  agruparPorIdentidadeExata,
  pontuarEvidenciaIdentidade,
} from "./clustering";

export type {
  ExactIdentityCluster,
  IdentityEvidence,
} from "./clustering";
