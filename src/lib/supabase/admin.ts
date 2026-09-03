import { createClient } from "@supabase/supabase-js";

/**
 * Cliente Supabase com `service_role`. Ignora RLS por completo.
 *
 * Uso permitido SOMENTE em: webhook, cron, camada de IA, upload de documento e
 * convite de equipe (`auth.admin.inviteUserByEmail`, `src/server/admin/convite.ts`
 * — CONFLITO C15 do plano de Fase 2: criar a linha em `perfis_equipe` não precisa
 * disto, mas disparar o e-mail de convite via Supabase Auth exige) — nunca em
 * rota que só lê/edita dado de sessão comum. Nunca importar em componente
 * client nem em Server Component que renderiza a página (só em route handler / job).
 *
 * NOTA: o pacote `server-only` não está nas deps do projeto — a barreira aqui é de
 * convenção de import (grep -r "SERVICE_ROLE" src/app/**\/page.tsx tem que voltar vazio,
 * checado no CI/relatório de entrega) mais o fato de `SUPABASE_SERVICE_ROLE_KEY` nunca
 * ter prefixo `NEXT_PUBLIC_`, então mesmo que este módulo fosse importado por engano
 * num componente client, o valor da env não existiria no bundle do navegador.
 */
export function criarClienteAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !chave) {
    // Fail-closed: sem a chave, não existe cliente admin. Nunca cair para a chave
    // publicável em silêncio — isso rodaria operação de sistema sob RLS de anon.
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY ausente — cliente admin não pode ser criado.",
    );
  }

  return createClient(url, chave, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
