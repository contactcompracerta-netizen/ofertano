export {
  canonizarHifensModelo,
  codigoModeloMaisEspecificoQue,
  criarCanonicalKeyDaIdentidade,
  familiasModeloDistintas,
  ehAcessorioNaoSolicitadoPelaConsulta,
  ehCodigoSkuEspecifico,
  ehPapelNaoPrincipal,
  ehProdutoCalcado,
  ehProdutoMovel,
  extrairGtinDaConsulta,
  normalizarCodigoIdentidade,
  normalizarMarcaIdentidade,
  normalizarTextoIdentidade,
  papelDaIdentidade,
  resolverIdentidadeProduto,
  selecionarCodigosModeloMaisEspecificos,
  codigosDeIdentidadeDoItemVendido,
} from "./resolver";

export type {
  IdentityVariantKey,
  ProductIdentity,
  ProductKind,
  ProductRole,
} from "./resolver";

export {
  avaliarCompatibilidadeExataEntreImports,
  avaliarIdentidadesExatas,
} from "./exactMatcher";

export type { ExactMatchResult } from "./exactMatcher";

export {
  avaliarCompatibilidadeComConsulta,
  candidatoPodeSeguirNoDiscovery,
  criarConsultasGlobaisDeIdentidade,
  pontuarCoberturaLexicalPonderada,
  pontuarEspecificidadeDaConsulta,
  tokensDistintivosDaConsulta,
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
