export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { exigirVePatrimonio } from "@/server/auth";
import { erroConflito, erroNaoEncontrado, respostaErro } from "@/server/erros";
import { copilotoEstaAtivo } from "@/server/copiloto/config";
import { executarEncerramentoCopiloto } from "@/server/copiloto/encerrar";
import type { RespostaEncerrarCopiloto } from "@/types/copiloto";

const ParametroSchema = z.object({ id: z.string().uuid() });

interface SessaoParaEncerrar {
  id: string;
  jornada_id: string;
  realizada_em: string | null;
  sessoes_copiloto: { estado: string } | null;
}

async function buscarSessaoOuFalhar(supabase: SupabaseClient, sessaoId: string): Promise<SessaoParaEncerrar> {
  const { data, error } = await supabase
    .from("sessoes_viabilidade")
    .select("id, jornada_id, realizada_em, sessoes_copiloto(estado)")
    .eq("id", sessaoId)
    .maybeSingle<SessaoParaEncerrar>();
  if (error) throw error;
  if (!data) throw erroNaoEncontrado("Sessão de Viabilidade não encontrada.");
  return data;
}

/**
 * POST /api/sessoes/[id]/copiloto/encerrar — Fase 10, Fatia 3
 * (docs/ARQUITETURA-FASE-10.md §6.1, §8, §11-item-1). O EFEITO de encerrar
 * (marcar `sessoes_copiloto.estado='encerrado'`, consolidar em
 * `transcricoes`, expirar sugestões pendentes) mora em
 * `server/copiloto/encerrar.ts::executarEncerramentoCopiloto` — este arquivo
 * só resolve a sessão e traduz o resultado para HTTP. O MESMO módulo é
 * chamado pelo ciclo automático quando `duracao_maxima_minutos` estoura
 * (§4.4: "encerra sozinho") — dois CHAMADORES, um efeito só, sem duplicar.
 *
 * IDEMPOTENTE: clicar "Encerrar" duas vezes (duplo clique, reabrir a tela e
 * clicar de novo, ou a sessão já ter sido encerrada automaticamente por
 * duração máxima) devolve 409 `sessao_ja_encerrada` na 2ª vez — não
 * reconsolida nem reexpira nada.
 *
 * KILL-SWITCH: `copiloto_sessao.ativo=false` devolve 409 `copiloto_desligado`
 * — mesmo contrato das outras rotas do copiloto.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirVePatrimonio();
    const { id: sessaoId } = ParametroSchema.parse(await params);

    const supabase = await criarClienteServidor();

    if (!(await copilotoEstaAtivo(supabase))) {
      throw erroConflito("copiloto_desligado", "O copiloto está desligado (copiloto_sessao.ativo = false em Admin).");
    }

    const sessao = await buscarSessaoOuFalhar(supabase, sessaoId);

    if (!sessao.sessoes_copiloto || sessao.sessoes_copiloto.estado === "encerrado") {
      throw erroConflito("sessao_ja_encerrada", "Esta sessão do copiloto já está encerrada.");
    }

    const admin = criarClienteAdmin();
    const resultado = await executarEncerramentoCopiloto(supabase, admin, {
      sessaoId,
      sessao: { jornadaId: sessao.jornada_id, realizadaEm: sessao.realizada_em },
    });

    if (!resultado.encerrado) {
      // Corrida: outra requisição (clique duplo, ou o encerramento
      // automático por duração máxima) encerrou entre a leitura acima e o
      // UPDATE dentro de executarEncerramentoCopiloto.
      throw erroConflito("sessao_ja_encerrada", "Esta sessão do copiloto já está encerrada.");
    }

    const resposta: RespostaEncerrarCopiloto = {
      sessao_id: sessaoId,
      estado: "encerrado",
      encerrado_em: resultado.encerradoEm!,
      transcricao_id: resultado.transcricaoId,
      ja_existia_transcricao: resultado.jaExistiaTranscricao,
      sugestoes_expiradas: resultado.sugestoesExpiradas,
    };
    return NextResponse.json(resposta);
  } catch (erro) {
    return respostaErro("POST /api/sessoes/[id]/copiloto/encerrar", erro);
  }
}
