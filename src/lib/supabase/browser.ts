"use client";

import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/config-publica";

/** Cliente Supabase do navegador. Só chave publicável — nunca service_role. */
export function criarClienteNavegador() {
  return createBrowserClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
  );
}
