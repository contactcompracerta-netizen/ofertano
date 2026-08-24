"use client";

import { useEffect } from "react";

import { supabase } from "@/lib/supabaseClient";
import { bindFavoritesAuthAndSync } from "@/lib/favorites/store";

export default function FavoritesBootstrap() {
  useEffect(() => bindFavoritesAuthAndSync(supabase), []);
  return null;
}
