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
import { executarEncerramentoCopiloto, tentarNovamenteEncerrarBotPendente } from "@/server/copiloto/encerrar";
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
 * 🔴 CORREÇÃO (achado B do Fable, revisão de Solidificação): "ninguém limpa
 * a pendência ... a rota recusa sessão em `erro` com 409 — então nem existe
 * retry que pudesse limpar". Sessão já `'encerrado'` COM
 * `pendencia_encerramento_bot` (achado A/0097) agora tenta
 * `tentarNovamenteEncerrarBotPendente` ANTES de devolver o 409 de sempre.
 *
 * 🔴 CORREÇÃO (achado seguinte do Fable: "o ciclo da pendência fechou para 1
 * dos 3 nascedouros"). Os DOIS nascedouros da pendência em `bot/route.ts`
 * (retenção infinita detectada, falha ao persistir o vínculo) deixam a
 * sessão em `estado='erro'`, NÃO `'encerrado'` — o gate abaixo era
 * `estado === 'encerrado'` sozinho, então essas duas sessões NUNCA entravam
 * no retry: caíam direto em `executarEncerramentoCopiloto`, que recusava
 * `'erro'` como origem, devolvendo 409 puro, sem retry nenhum — sessão
 * BRICADA (nem bot novo, nem encerramento formal, nem limpeza). Corrigido:
 * o gate agora cobre `'encerrado' || 'erro'`, e `tentarNovamenteEncerrarBotPendente`
 * decide internamente o efeito certo para cada caso (ver comentário dela em
 * `encerrar.ts`) e devolve o `resultadoEncerramento` PRONTO quando a sessão
 * sai do `'erro'` nesta chamada — a rota NUNCA chama
 * `executarEncerramentoCopiloto` de novo por fora (isso criaria uma corrida
 * contra a chamada que já aconteceu dentro do retry). Quando isso acontece,
 * a resposta é o payload de SUCESSO normal (200, com `transcricao_id` etc.)
 * — não mais um 409, porque a sessão realmente acabou de ser encerrada de
 * verdade, com consolidação e tudo.
 *
 * KILL-SWITCH: `copiloto_sessao.ativo=false` devolve 409 `copiloto_desligado`
 * — mesmo contrato das outras rotas do copiloto.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const usuario = await exigirVePatrimonio();
    const { id: sessaoId } = ParametroSchema.parse(await params);

    const supabase = await criarClienteServidor();

    if (!(await copilotoEstaAtivo(supabase))) {
      throw erroConflito("copiloto_desligado", "O copiloto está desligado (copiloto_sessao.ativo = false em Admin).");
    }

    const sessao = await buscarSessaoOuFalhar(supabase, sessaoId);

    if (!sessao.sessoes_copiloto) {
      throw erroConflito("sessao_ja_encerrada", "Esta sessão do copiloto já está encerrada.");
    }

    const admin = criarClienteAdmin();
    const sessaoParaEncerrar = { jornadaId: sessao.jornada_id, realizadaEm: sessao.realizada_em };

    // 🔴 CORREÇÃO: gate cobre 'encerrado' E 'erro' — ver doc-comment acima.
    if (sessao.sessoes_copiloto.estado === "encerrado" || sessao.sessoes_copiloto.estado === "erro") {
      const retentativa = await tentarNovamenteEncerrarBotPendente(supabase, admin, sessaoId, sessaoParaEncerrar, usuario.id);

      if (retentativa.tentou && retentativa.resultadoEncerramento) {
        // A sessão estava em 'erro' e ACABOU de ser encerrada de verdade —
        // não é mais "já estava encerrada", é sucesso normal, 200. O
        // resultado já veio PRONTO do retry (nunca chamar
        // executarEncerramentoCopiloto de novo aqui).
        const resultadoCompleto = retentativa.resultadoEncerramento;
        const resposta: RespostaEncerrarCopiloto = {
          sessao_id: sessaoId,
          estado: "encerrado",
          encerrado_em: resultadoCompleto.encerradoEm!,
          transcricao_id: resultadoCompleto.transcricaoId,
          ja_existia_transcricao: resultadoCompleto.jaExistiaTranscricao,
          sugestoes_expiradas: resultadoCompleto.sugestoesExpiradas,
          retrospecto: resultadoCompleto.retrospecto,
        };
        return NextResponse.json(resposta);
      }

      if (retentativa.tentou) {
        throw erroConflito(
          "sessao_ja_encerrada",
          retentativa.resolvida
            ? "Esta sessão do copiloto já está encerrada. O bot foi encerrado agora com sucesso."
            : "Esta sessão do copiloto já está encerrada. O bot ainda não pôde ser encerrado — tente de novo em instantes.",
        );
      }
      throw erroConflito("sessao_ja_encerrada", "Esta sessão do copiloto já está encerrada.");
    }

    const resultado = await executarEncerramentoCopiloto(supabase, admin, {
      sessaoId,
      sessao: sessaoParaEncerrar,
      // FASE 13 — autoria do Retrospecto. `usuario.id` é o id do PERFIL
      // (`perfis_equipe`), que é para onde `copiloto_retrospectos.criado_por`
      // aponta (0125) — nunca `auth_user_id`. O encerramento AUTOMÁTICO (por
      // `duracao_maxima_minutos`) não passa por aqui e grava `null`: não há
      // humano por trás, e inventar autoria seria mentir.
      criadoPor: usuario.id,
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
      // `null` = kill-switch desligado OU montagem falhou. A tela distingue
      // stub rotulado de documento real — nunca mostra retrospecto vazio
      // disfarçado de retrospecto (ver `RespostaEncerrarCopiloto`).
      retrospecto: resultado.retrospecto,
    };
    return NextResponse.json(resposta);
  } catch (erro) {
    return respostaErro("POST /api/sessoes/[id]/copiloto/encerrar", erro);
  }
}
