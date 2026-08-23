import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

function criarClienteAuth() {
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error(
      "As variáveis de autenticação do Supabase não foram configuradas."
    );
  }

  return createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function extrairToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");

  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(" ");

  if (scheme?.toLowerCase() !== "bearer" || !token?.trim()) {
    return null;
  }

  return token.trim();
}

export async function obterUserIdAutenticado(
  request: Request
): Promise<string | null> {
  const token = extrairToken(request);

  if (!token) {
    return null;
  }

  const supabase = criarClienteAuth();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user?.id) {
    return null;
  }

  return user.id;
}
