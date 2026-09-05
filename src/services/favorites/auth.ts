/**
 * Compatibilidade: helpers de autenticacao Supabase agora vivem em
 * src/lib/supabaseAuth.ts. Re-exportamos daqui para nao quebrar chamadas
 * existentes em src/app/api/favorites/route.ts.
 */
export {
  readBearerToken,
  getSupabasePublicConfig,
  createUserSupabaseClient,
  authenticateSupabaseRequest as authenticateFavoritesRequest,
} from "@/lib/supabaseAuth";
