import { criarClienteAdmin } from "@/lib/supabase/admin";
import { registrarErro } from "@/server/erros";
import { APP_URL } from "@/lib/config-publica";
import type { ResultadoConviteEmail } from "@/types/admin";

/**
 * Envio do e-mail de convite de equipe (CONFLITO C15 do plano de Fase 2).
 *
 * Criar a linha em `perfis_equipe` NUNCA depende disto — é um INSERT comum,
 * sob a RLS `pe_admin_write`. Só o e-mail (via Supabase Auth, que exige
 * `service_role`) passa por aqui. Sem a chave, a rota que chama esta função
 * responde 503 e deixa explícito: "a linha foi criada, o acesso precisa ser
 * entregue por fora" — nunca finge que o e-mail saiu.
 *
 * `redirectTo` aponta para `/login`: o primeiro acesso do convidado casa
 * `auth.uid()` com a linha pré-existente via `POST /api/auth/vincular`
 * (`app.vincular_perfil()`, 0002) — não existe fluxo de "aceitar convite"
 * separado neste sistema.
 */
export async function enviarConviteEquipe(perfil: {
  id: string;
  email: string;
  nome: string;
  papel: string;
}): Promise<ResultadoConviteEmail> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { enviado: false, motivo: "service_role_ausente" };
  }

  try {
    const clienteAdmin = criarClienteAdmin();
    const { error } = await clienteAdmin.auth.admin.inviteUserByEmail(perfil.email, {
      redirectTo: `${APP_URL}/login`,
      data: { nome: perfil.nome, papel: perfil.papel, perfil_equipe_id: perfil.id },
    });

    if (error) {
      registrarErro("server/admin/convite.enviarConviteEquipe", error, { perfil_id: perfil.id });
      return { enviado: false, motivo: "erro_provedor", detalhe: error.message };
    }

    return { enviado: true };
  } catch (erro) {
    registrarErro("server/admin/convite.enviarConviteEquipe", erro, { perfil_id: perfil.id });
    return { enviado: false, motivo: "erro_inesperado" };
  }
}
