import { createClient, type User } from "@supabase/supabase-js";

import { readBearerToken } from "@/lib/favorites/http";

export { readBearerToken };

export function getSupabasePublicConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error("Supabase não está configurado.");
  }

  return { url, publishableKey };
}

export function createUserSupabaseClient(accessToken: string) {
  const { url, publishableKey } = getSupabasePublicConfig();

  return createClient(url, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

export async function authenticateFavoritesRequest(
  request: Request,
): Promise<{ user: User; accessToken: string } | null> {
  const accessToken = readBearerToken(request);

  if (!accessToken) {
    return null;
  }

  const { url, publishableKey } = getSupabasePublicConfig();
  const supabase = createClient(url, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(accessToken);

  if (error || !user) {
    return null;
  }

  return { user, accessToken };
}
