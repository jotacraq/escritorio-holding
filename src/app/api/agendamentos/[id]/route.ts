export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno } from "@/server/auth";
import { erroConflito, erroNaoEncontrado, erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import type { AgendamentoSessao } from "@/types/banco";

const ParametroSchema = z.object({ id: z.string().uuid() });

const SQLSTATE_EXCLUSION_VIOLATION = "23P01";
const SQLSTATE_CHECK_VIOLATION = "23514";

const CorpoStatusSchema = z.object({
  status: z.enum(["agendado", "confirmado", "realizado", "nao_compareceu", "cancelado"]),
});

/** B34: a equipe confirma presença à mão (fallback do WhatsApp). Sempre `via='equipe'`, nome na timeline (trigger 0051). */
const CorpoPresencaSchema = z.object({
  presenca_confirmada: z.literal(true),
});

const CorpoRemarcarSchema = z
  .object({
    inicio_em: z.string().datetime({ offset: true }),
    fim_em: z.string().datetime({ offset: true }),
  })
  .refine((v) => new Date(v.fim_em) > new Date(v.inicio_em), {
    message: "`fim_em` precisa ser depois de `inicio_em`.",
    path: ["fim_em"],
  });

/**
 * `{status}` muda o status do slot atual. `{inicio_em, fim_em}` remarca: o slot
 * atual vira `remarcado` (histórico preservado) e nasce um novo `agendado`.
 * `{presenca_confirmada: true}` (Fase 4) grava o FATO "presença confirmada"
 * com `via='equipe'` — o banco recusa qualquer outra via para usuário logado e
 * torna a confirmação imutável (`app.protege_presenca_confirmada`, 0051).
 *
 * NOTA (gap conhecido, C26): remarcação pela equipe continua em dois passos
 * não atômicos; a Fase 5 migra este caminho para uma RPC irmã do núcleo
 * `app.confirmar_horario_da_sugestao`. O trigger `app.regua_agendamento`
 * (0013/0020/0051) já cancela as mensagens pendentes do slot antigo e o
 * `app.revoga_link_confirmacao` (0051) mata o link de confirmação dele.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirInterno();
    const { id } = ParametroSchema.parse(await params);
    const corpoBruto = await request.json().catch(() => {
      throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
    });

    const supabase = await criarClienteServidor();

    const { data: atual, error: erroAtual } = await supabase
      .from("agendamentos")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (erroAtual) throw erroAtual;
    if (!atual) throw erroNaoEncontrado("Agendamento não encontrado.");

    const agendamentoAtual = atual as AgendamentoSessao;

    const comoPresenca = CorpoPresencaSchema.safeParse(corpoBruto);
    if (comoPresenca.success) {
      if (agendamentoAtual.presenca_confirmada_em) {
        // Idempotente: já confirmada — devolve como está, sem erro.
        return NextResponse.json({ agendamento: agendamentoAtual, ja_confirmada: true });
      }
      if (agendamentoAtual.status !== "agendado" && agendamentoAtual.status !== "confirmado") {
        throw erroConflito("agendamento_inativo", "Só agendamento ativo (agendado/confirmado) recebe confirmação de presença.");
      }
      const { data: confirmado, error: erroPresenca } = await supabase
        .from("agendamentos")
        .update({ presenca_confirmada_em: new Date().toISOString(), presenca_confirmada_via: "equipe" })
        .eq("id", id)
        .select("*")
        .single();
      if (erroPresenca) {
        if (erroPresenca.code === SQLSTATE_CHECK_VIOLATION) {
          throw erroConflito("presenca_recusada", "O banco recusou a confirmação (já confirmada ou agendamento inativo).");
        }
        registrarErro("api/agendamentos/[id] PATCH presenca", erroPresenca, { agendamento_id: id });
        throw erroPresenca;
      }
      return NextResponse.json({ agendamento: confirmado as AgendamentoSessao });
    }

    const comoRemarcacao = CorpoRemarcarSchema.safeParse(corpoBruto);
    if (comoRemarcacao.success) {
      const { error: erroMarcarRemarcado } = await supabase
        .from("agendamentos")
        .update({ status: "remarcado" })
        .eq("id", id);
      if (erroMarcarRemarcado) {
        registrarErro("api/agendamentos/[id] PATCH remarcar-antigo", erroMarcarRemarcado, { agendamento_id: id });
        throw erroMarcarRemarcado;
      }

      const { data: criado, error: erroCriar } = await supabase
        .from("agendamentos")
        .insert({
          sessao_id: agendamentoAtual.sessao_id,
          inicio_em: comoRemarcacao.data.inicio_em,
          fim_em: comoRemarcacao.data.fim_em,
          advogada_id: agendamentoAtual.advogada_id,
          status: "agendado",
          origem: "equipe",
          observacoes: `Remarcado a partir do agendamento ${id}.`,
        })
        .select("*")
        .single();

      if (erroCriar) {
        if (erroCriar.code === SQLSTATE_EXCLUSION_VIOLATION) {
          throw erroConflito(
            "horario_indisponivel",
            "O novo horário já está ocupado para esta advogada.",
          );
        }
        registrarErro("api/agendamentos/[id] PATCH remarcar-novo", erroCriar, { agendamento_id: id });
        throw erroCriar;
      }

      return NextResponse.json({ agendamento: criado as AgendamentoSessao });
    }

    const corpoStatus = CorpoStatusSchema.parse(corpoBruto);

    const { data: atualizado, error } = await supabase
      .from("agendamentos")
      .update({ status: corpoStatus.status })
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      if (error.code === SQLSTATE_EXCLUSION_VIOLATION) {
        throw erroConflito("horario_indisponivel", "Conflito de horário para esta advogada.");
      }
      registrarErro("api/agendamentos/[id] PATCH status", error, { agendamento_id: id });
      throw error;
    }

    return NextResponse.json({ agendamento: atualizado as AgendamentoSessao });
  } catch (erro) {
    return respostaErro("api/agendamentos/[id] PATCH", erro);
  }
}
