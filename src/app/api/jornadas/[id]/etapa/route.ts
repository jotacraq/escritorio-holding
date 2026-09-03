export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel } from "@/server/auth";
import { erroConflito, erroNaoEncontrado, registrarErro, respostaErro } from "@/server/erros";
import { traduzErroTransicaoPostgres, validarMotivoDesfecho, validarTransicaoEtapa } from "@/server/jornadas";
import type { Jornada } from "@/types/banco";

const CorpoSchema = z
  .object({
    etapa: z
      .enum([
        "captado",
        "qualificado",
        "sessao_contratada",
        "sessao_agendada",
        "sessao_realizada",
        "croqui_contratado",
        "croqui_apresentado",
        "holding_contratada",
      ])
      .optional(),
    desfecho: z.enum(["aberta", "ganha", "perdida", "descartada", "congelada"]).optional(),
    motivo: z.string().trim().min(1).max(1000).optional(),
  })
  .refine((v) => v.etapa !== undefined || v.desfecho !== undefined, {
    message: "Informe ao menos `etapa` ou `desfecho`.",
  });

/**
 * Valida a transição NO SERVIDOR antes de tocar o banco, para devolver 409 com
 * motivo legível. O banco (trigger `app.valida_transicao_jornada`) é a segunda
 * trava e vale por último — se as duas divergirem (corrida entre requisições),
 * o erro do Postgres é traduzido do mesmo jeito.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirPapel("admin", "advogada", "relacionamento");

    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      throw erroNaoEncontrado("Jornada não encontrada.");
    }

    const corpo = CorpoSchema.parse(await request.json().catch(() => ({})));

    const supabase = await criarClienteServidor();

    const { data: atual, error: erroAtual } = await supabase
      .from("jornadas")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (erroAtual) throw erroAtual;
    if (!atual) throw erroNaoEncontrado("Jornada não encontrada.");

    const jornadaAtual = atual as Jornada;

    const etapaAlvo = corpo.etapa ?? jornadaAtual.etapa;
    const desfechoAlvo = corpo.desfecho ?? jornadaAtual.desfecho;

    if (corpo.etapa) {
      const resultado = validarTransicaoEtapa({
        etapaAtual: jornadaAtual.etapa,
        etapaNova: corpo.etapa,
        nivelPago: jornadaAtual.nivel_pago,
      });
      if (!resultado.valida) {
        throw erroConflito("transicao_invalida", resultado.motivo);
      }
    }

    if (corpo.desfecho) {
      const resultado = validarMotivoDesfecho({ desfechoNovo: corpo.desfecho, motivo: corpo.motivo });
      if (!resultado.valida) {
        throw erroConflito("motivo_obrigatorio", resultado.motivo);
      }
    }

    const atualizacao: Record<string, unknown> = {};
    if (corpo.etapa) atualizacao.etapa = corpo.etapa;
    if (corpo.desfecho) {
      atualizacao.desfecho = corpo.desfecho;
      atualizacao.motivo_desfecho = corpo.motivo ?? (corpo.desfecho === "aberta" ? null : jornadaAtual.motivo_desfecho);
    }

    const { data: atualizada, error: erroUpdate } = await supabase
      .from("jornadas")
      .update(atualizacao)
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (erroUpdate) {
      // O trigger do banco recusou algo que a validação de servidor deixou passar
      // (corrida, ou uma regra que só existe no Postgres). Traduz para 409 legível.
      const mensagem = erroUpdate.message ?? "";
      if (mensagem.includes("transicao_invalida")) {
        throw erroConflito("transicao_invalida", traduzErroTransicaoPostgres(mensagem));
      }
      registrarErro("api/jornadas/[id]/etapa PATCH", erroUpdate, { jornada_id: id, etapaAlvo, desfechoAlvo });
      throw erroUpdate;
    }

    if (!atualizada) throw erroNaoEncontrado("Jornada não encontrada.");

    return NextResponse.json({ jornada: atualizada as Jornada });
  } catch (erro) {
    return respostaErro("api/jornadas/[id]/etapa PATCH", erro);
  }
}
