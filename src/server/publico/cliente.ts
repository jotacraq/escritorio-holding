import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/config-publica";

/**
 * Cliente Supabase para a superfície pública: chave publicável, SEM sessão, SEM
 * cookie. As rotas `/api/publico/**` (exceto upload de documento, que precisa de
 * `service_role` para o Storage) chamam as 4 RPCs públicas por este cliente — o
 * mesmo papel `anon` que o PostgREST usaria se o front chamasse direto. Least
 * privilege mesmo no lado do servidor: nada aqui precisa de mais do que `anon` tem.
 */
export function criarClientePublico() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
