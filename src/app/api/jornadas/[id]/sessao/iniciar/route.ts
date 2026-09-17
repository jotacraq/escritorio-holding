export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirVePatrimonio } from "@/server/auth";
import { erroConflito, erroNaoEncontrado, registrarErro, respostaErro } from "@/server/erros";
import { CHAVE_INICIO_DIRETO_DO_CARD, lerConfiguracaoBool } from "@/server/agenda/config";
import { iniciarSessaoImediata, SQLSTATE_EXCLUSION_VIOLATION } from "@/server/agenda/iniciar-sessao";

const ParametroSchema = z.object({ id: z.string().uuid() });

/**
 * POST /api/jornadas/[id]/sessao/iniciar — 17/09/2026, Fatia 1 "iniciar a
 * sessão quando quiser, sem burocracia". Sem corpo.
 *
 * A filosofia do dono, textual: "ela não precisa de regras, não precisa de
 * travas... não é ela que segue o roteiro, é ela quem define o roteiro. Ele
 * tem que poder conduzir a sessão independente de ter documentos,
 * agendamento, contrato, formulário ou nada." Este é o ÚNICO ponto de
 * "iniciar sessão": garante `sessoes_viabilidade` (1:1 com a jornada) e um
 * `agendamentos` vivo agora, com idempotência — chamar duas vezes seguidas
 * reaproveita, nunca duplica (mesmo miolo de
 * `POST /api/jornadas/[id]/agendamentos` com `modo: "imediato"`, ver
 * `server/agenda/iniciar-sessao.ts`).
 *
 * `IniciarSessaoAgora.tsx` hoje orquestra 2 chamadas em sequência (criar
 * agendamento + gravar link, com tratamento de falha parcial) — este
 * endpoint fica pronto para o front consumir; a migração do componente é
 * trabalho à parte (fora desta fatia de backend).
 *
 * KILL-SWITCH: `configuracoes['sessao.inicio_direto_do_card']=false` → 409
 * `inicio_direto_desligado`. Nasce `true` (pedido explícito do dono) —
 * mesmo contrato de kill-switch das outras rotas do projeto
 * (`copiloto_desligado`, `agente_desligado`), só que fail-OPEN por padrão,
 * de propósito: aqui a regra é remover exigência, não acrescentar.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirVePatrimonio();
    const { id: jornadaId } = ParametroSchema.parse(await params);

    const supabase = await criarClienteServidor();

    const ativo = await lerConfiguracaoBool(supabase, CHAVE_INICIO_DIRETO_DO_CARD, true);
    if (!ativo) {
      throw erroConflito("inicio_direto_desligado", "Iniciar sessão pelo card está desligado (sessao.inicio_direto_do_card = false em Admin).");
    }

    const { data: jornada, error: erroJornada } = await supabase
      .from("jornadas")
      .select("id")
      .eq("id", jornadaId)
      .maybeSingle();
    if (erroJornada) throw erroJornada;
    if (!jornada) throw erroNaoEncontrado("Jornada não encontrada.");

    // `advogada_id` fica de propósito fora daqui — ver o comentário de
    // `iniciarSessaoImediata` sobre a EXCLUDE constraint. Preencher mudaria o
    // comportamento da trava para todo o fluxo normal de agendar.
    const resultado = await iniciarSessaoImediata(supabase, {
      jornadaId,
    }).catch((erro) => {
      if ((erro as { code?: string })?.code === SQLSTATE_EXCLUSION_VIOLATION) {
        throw erroConflito("horario_indisponivel", "Este horário já está ocupado para a advogada selecionada.");
      }
      registrarErro("api/jornadas/[id]/sessao/iniciar POST", erro, { jornada_id: jornadaId });
      throw erro;
    });

    return NextResponse.json(
      {
        sessaoId: resultado.sessao.id,
        jornadaId,
        temLinkSala: Boolean(resultado.sessao.link_sala),
        reaproveitado: resultado.reaproveitado,
      },
      { status: resultado.reaproveitado ? 200 : 201 },
    );
  } catch (erro) {
    return respostaErro("api/jornadas/[id]/sessao/iniciar POST", erro);
  }
}
