export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel } from "@/server/auth";
import { erroConflito, erroValidacao, registrarErro, respostaErro, ErroApi } from "@/server/erros";
import { enviarConviteEquipe } from "@/server/admin/convite";
import type { PerfilEquipeAdmin } from "@/types/admin";

/**
 * GET /api/admin/equipe — lista COMPLETA de `perfis_equipe` (inclusive
 * inativos e e-mail), para a tela de gestão. Diferente de `GET /api/equipe`
 * (existente, fora da minha fronteira): aquela é o filtro "responsável" do
 * kanban e deliberadamente esconde e-mail; esta é a tela de Admin e precisa
 * do e-mail para o convite. Guard de papel ANTES da RLS: `pe_select` já
 * exige `app.eh_interno()` — aqui a área é "Admin", restrita a `admin`.
 */
export async function GET() {
  try {
    await exigirPapel("admin");

    const supabase = await criarClienteServidor();
    const { data, error } = await supabase
      .from("perfis_equipe")
      .select("*")
      .order("ativo", { ascending: false })
      .order("nome", { ascending: true });

    if (error) {
      registrarErro("api/admin/equipe GET", error);
      throw error;
    }

    return NextResponse.json({ itens: (data as PerfilEquipeAdmin[] | null) ?? [] });
  } catch (erro) {
    return respostaErro("api/admin/equipe GET", erro);
  }
}

const CorpoSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  nome: z.string().trim().min(2).max(200),
  papel: z.enum(["admin", "advogada", "relacionamento", "assistente"]),
});

interface ErroPostgrest {
  code?: string;
  message: string;
}

/**
 * POST /api/admin/equipe — cria o convite (CONFLITO C15). Dois passos, o
 * primeiro sempre funciona, o segundo depende de `SUPABASE_SERVICE_ROLE_KEY`:
 *
 *   1. INSERT em `perfis_equipe` (sob RLS `pe_admin_write`, `app.eh_admin()`).
 *   2. `auth.admin.inviteUserByEmail` — sem a chave, responde 503 com a linha
 *      JÁ CRIADA no corpo do erro: honesto, não quebrado (a tarefa é clara:
 *      "a linha foi criada, o acesso precisa ser entregue por fora").
 *
 * Falha do PASSO 2 por qualquer OUTRO motivo (e-mail já cadastrado no Auth,
 * erro do provedor) não desfaz o passo 1 — a linha fica, e a tela mostra
 * `convite.enviado=false` para o admin tentar de novo via
 * `POST /api/admin/equipe/[id]/convite`.
 */
export async function POST(request: NextRequest) {
  try {
    const usuario = await exigirPapel("admin");
    const corpo = CorpoSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    const supabase = await criarClienteServidor();
    const agora = new Date().toISOString();

    const { data: criado, error: erroInsercao } = await supabase
      .from("perfis_equipe")
      .insert({
        email: corpo.email,
        nome: corpo.nome,
        papel: corpo.papel,
        convidado_em: agora,
        criado_por: usuario.id,
      })
      .select("*")
      .single<PerfilEquipeAdmin>();

    if (erroInsercao) {
      const pg = erroInsercao as ErroPostgrest;
      if (pg.code === "23505") {
        throw erroConflito("email_ja_convidado", "Já existe um perfil de equipe com este e-mail.");
      }
      registrarErro("api/admin/equipe POST#insert", erroInsercao, { email: corpo.email });
      throw erroInsercao;
    }

    const resultadoConvite = await enviarConviteEquipe(criado);

    if (!resultadoConvite.enviado) {
      if (resultadoConvite.motivo === "service_role_ausente") {
        throw new ErroApi(
          503,
          "convite_email_indisponivel",
          "Linha de convite criada. Envio de e-mail indisponível — entregue o acesso por fora.",
          { perfil: criado },
        );
      }
      // Erro do provedor/inesperado: a linha fica, a tela mostra o aviso e o
      // admin pode tentar de novo (POST /api/admin/equipe/[id]/convite).
      return NextResponse.json(
        { perfil: criado, convite: resultadoConvite },
        { status: 201 },
      );
    }

    const { data: atualizado, error: erroAtualizar } = await supabase
      .from("perfis_equipe")
      .update({ convite_enviado_em: agora })
      .eq("id", criado.id)
      .select("*")
      .single<PerfilEquipeAdmin>();

    if (erroAtualizar) {
      // O convite JÁ SAIU — não falhar a resposta por causa do carimbo.
      registrarErro("api/admin/equipe POST#carimbar_convite", erroAtualizar, { perfil_id: criado.id });
      return NextResponse.json(
        { perfil: { ...criado, convite_enviado_em: agora }, convite: resultadoConvite },
        { status: 201 },
      );
    }

    return NextResponse.json({ perfil: atualizado, convite: resultadoConvite }, { status: 201 });
  } catch (erro) {
    return respostaErro("api/admin/equipe POST", erro);
  }
}
