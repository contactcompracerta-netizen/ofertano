import { supabase } from "@/lib/supabaseClient";

import {
  jaSincronizouNestaSessao,
  lerDonoFavoritosLocais,
  lerIdsFavoritosLocais,
  limparSincronizacaoDaSessao,
  marcarSincronizacaoDaSessao,
  salvarDonoFavoritosLocais,
  salvarIdsFavoritosLocais,
} from "./localStorage";
import {
  adicionarFavoritoRemoto,
  listarFavoritosRemotos,
  removerFavoritoRemoto,
  sincronizarFavoritosRemotos,
} from "./remoteClient";
import { GUEST_OWNER, idsLocaisParaSincronizar } from "./sessionPolicy";

let sincronizacaoEmAndamento: Promise<string[]> | null = null;

async function buscarIdsDoServidor(): Promise<string[] | null> {
  const lista = await listarFavoritosRemotos();

  if (!lista.success || !Array.isArray(lista.productIds)) {
    return null;
  }

  return lista.productIds;
}

async function executarSincronizacao(forcar: boolean): Promise<string[]> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user?.id) {
    return lerIdsFavoritosLocais();
  }

  const userId = session.user.id;

  if (!forcar && jaSincronizouNestaSessao(userId)) {
    return lerIdsFavoritosLocais();
  }

  const idsParaEnviar = idsLocaisParaSincronizar({
    ownerId: lerDonoFavoritosLocais(),
    userId,
    idsLocais: lerIdsFavoritosLocais(),
  });

  const sync = await sincronizarFavoritosRemotos(idsParaEnviar);

  let idsFinais =
    sync.success && Array.isArray(sync.productIds)
      ? sync.productIds
      : null;

  const confirmados = await buscarIdsDoServidor();

  if (confirmados) {
    idsFinais = confirmados;
  }

  if (!idsFinais) {
    return lerIdsFavoritosLocais();
  }

  salvarIdsFavoritosLocais(idsFinais);
  salvarDonoFavoritosLocais(userId);
  marcarSincronizacaoDaSessao(userId);

  return idsFinais;
}

export async function garantirSincronizacaoDaSessao(
  opcoes?: { forcar?: boolean }
): Promise<string[]> {
  if (sincronizacaoEmAndamento) {
    return sincronizacaoEmAndamento;
  }

  sincronizacaoEmAndamento = executarSincronizacao(
    Boolean(opcoes?.forcar)
  );

  try {
    return await sincronizacaoEmAndamento;
  } finally {
    sincronizacaoEmAndamento = null;
  }
}

export function aoSairDaContaFavoritos() {
  salvarIdsFavoritosLocais([]);
  salvarDonoFavoritosLocais(GUEST_OWNER);
  limparSincronizacaoDaSessao();
}

export async function alternarFavoritoDoProduto(
  productId: string
): Promise<boolean> {
  const atuais = lerIdsFavoritosLocais();
  const jaEraFavorito = atuais.includes(productId);
  const proximos = jaEraFavorito
    ? atuais.filter((id) => id !== productId)
    : [...atuais, productId];

  salvarIdsFavoritosLocais(proximos);

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) {
    return !jaEraFavorito;
  }

  const remoto = jaEraFavorito
    ? await removerFavoritoRemoto(productId)
    : await adicionarFavoritoRemoto(productId);

  if (!remoto.success) {
    salvarIdsFavoritosLocais(atuais);
    throw new Error(
      remoto.error || "Não foi possível atualizar este favorito."
    );
  }

  return !jaEraFavorito;
}
