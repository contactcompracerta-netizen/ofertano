/**
 * Resolucao server-side do email real do usuario de um alerta.
 *
 * A identidade de destino NUNCA vem do cliente: partimos apenas do
 * `PriceAlert.userId` (gravado a partir do token autenticado no /api) e
 * consultamos o usuario no MESMO projeto Supabase Auth que o frontend usa
 * (`NEXT_PUBLIC_SUPABASE_URL`). O lookup usa a Supabase Auth Admin API
 * (`admin.auth.getUserById`), autorizada pela `SUPABASE_SERVICE_ROLE_KEY`.
 *
 * Regras de seguranca:
 * - `SUPABASE_SERVICE_ROLE_KEY` so existe em ambiente de servidor: nunca
 *   NEXT_PUBLIC_, nunca vai ao navegador, nunca entra em log e nunca e
 *   hardcoded neste repositório.
 * - A chave de admin NUNCA substitui o DATABASE_URL: este modulo nao
 *   depende mais de `auth.users` via Prisma. Se o projeto Supabase de
 *   autenticacao nao compartilha o Postgres do DATABASE_URL, a resolucao
 *   ainda funciona via Auth Admin API.
 * - Sem `SUPABASE_SERVICE_ROLE_KEY` o resolver devolve
 *   `RESOLVER_NAO_CONFIGURADO` e o motor registra
 *   `EMAIL_USER_RESOLVER_NOT_CONFIGURED` sem quebrar o monitor.
 *
 * O email retornado nunca e logado.
 */

import { createClient } from "@supabase/supabase-js";

/**
 * Resultado tipado da resolucao do email. Distingue "resolver ausente na
 * configuracao" de "usuario/email nao encontrado" para o motor decidir o
 * status por canal sem quebrar o fluxo.
 */
export type ResolucaoEmailUsuario =
  | { status: "RESOLVIDO"; email: string }
  | { status: "RESOLVER_NAO_CONFIGURADO" }
  | { status: "USUARIO_NAO_ENCONTRADO" };

export type ResolverEmailDoUsuario = (
  userId: string,
) => Promise<ResolucaoEmailUsuario>;

/**
 * Valida o formato basico de um email sem aceitar destino forjado.
 * Tambem usado como guarda final antes de qualquer envio.
 */
export function emailUsuarioValido(email: unknown): email is string {
  if (typeof email !== "string") {
    return false;
  }

  const valor = email.trim();

  if (valor.length === 0 || valor.length > 254) {
    return false;
  }

  if (/\s/.test(valor)) {
    return false;
  }

  const formato = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  return formato.test(valor);
}

/**
 * Indica se a resolucao via Admin API esta configurada. Requer a URL
 * publica do projeto Auth (mesma do frontend) e a service role key.
 * Nunca expoe o valor da chave.
 */
export function resolverEmailUsuarioConfigurado(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  return Boolean(url && serviceRoleKey);
}

/**
 * Resolve o email do usuario pelo id via Supabase Auth Admin API.
 *
 * Somente leitura e falha de forma segura: qualquer problema de
 * permissao/conexao/resposta devolve `USUARIO_NAO_ENCONTRADO`, e a chave
 * ausente devolve `RESOLVER_NAO_CONFIGURADO`. Nunca lanca e nunca loga o
 * email retornado. Requer email existente, confirmado e usuario nao
 * deletado.
 */
export async function buscarEmailDoUsuario(
  userId: string,
): Promise<ResolucaoEmailUsuario> {
  if (!userId || typeof userId !== "string") {
    return { status: "USUARIO_NAO_ENCONTRADO" };
  }

  if (!resolverEmailUsuarioConfigurado()) {
    return { status: "RESOLVER_NAO_CONFIGURADO" };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!.trim();

  try {
    const supabaseAdmin = createClient(url, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    const {
      data: { user },
      error,
    } = await supabaseAdmin.auth.admin.getUserById(userId);

    if (error || !user) {
      return { status: "USUARIO_NAO_ENCONTRADO" };
    }

    if (user.deleted_at || user.banned_until) {
      return { status: "USUARIO_NAO_ENCONTRADO" };
    }

    if (!user.email_confirmed_at && !user.email) {
      return { status: "USUARIO_NAO_ENCONTRADO" };
    }

    const email = user.email ?? null;

    return emailUsuarioValido(email)
      ? { status: "RESOLVIDO", email }
      : { status: "USUARIO_NAO_ENCONTRADO" };
  } catch {
    return { status: "USUARIO_NAO_ENCONTRADO" };
  }
}