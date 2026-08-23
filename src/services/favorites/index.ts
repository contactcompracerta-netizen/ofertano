export { FavoriteError, isFavoriteError } from "./errors";
export {
  FAVORITES_EVENT,
  FAVORITES_OWNER_KEY,
  FAVORITES_STORAGE_KEY,
  contarIdsFavoritosLocais,
  lerIdsFavoritosLocais,
  produtoEstaFavoritadoLocal,
  salvarIdsFavoritosLocais,
} from "./localStorage";
export { normalizarIds, unirIdsFavoritos } from "./ids";
export {
  adicionarFavoritoRemoto,
  hidratarProdutosFavoritos,
  listarFavoritosRemotos,
  removerFavoritoRemoto,
  sessaoFavoritosDisponivel,
  sincronizarFavoritosRemotos,
  verificarFavoritoRemoto,
} from "./remoteClient";
export {
  aoSairDaContaFavoritos,
  alternarFavoritoDoProduto,
  garantirSincronizacaoDaSessao,
} from "./session";
export { GUEST_OWNER, idsLocaisParaSincronizar } from "./sessionPolicy";
