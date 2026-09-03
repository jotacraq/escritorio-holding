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

const CorpoStatusSchema = z.object({
  status: z.enum(["agendado", "confirmado", "realizado", "nao_compareceu", "cancelado"]),
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
 *
 * NOTA (gap conhecido, fora do escopo deste agente): remarcar/cancelar deveria
 * também cancelar as `mensagens_agendadas` pendentes do slot antigo e enfileirar
 * novas para o slot novo (ver ARQUITETURA §5.3). `mensagens_agendadas` é tabela
 * de outro agente (migration 0013) — este endpoint não a toca. Quem for fechar
 * B9 (régua) precisa fazer esse enfileiramento reagir a este UPDATE.
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

    const comoRemarcacao = CorpoRemarcarSchema.safeParse(corpoBruto);
    if (comoRemarcacao.success) {
      // Remarcação sem transação SQL dedicada (sem RPC próprio para isto no MVP):
      // 1) marca o slot atual como remarcado; 2) cria o novo. Se o passo 2 falhar
      // por conflito de horário, o passo 1 já aconteceu — aceitável para o MVP
      // porque o card na tela mostra o histórico e a equipe pode tentar de novo
      // (não há perda de dado, só um estado intermediário visível no log).
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
