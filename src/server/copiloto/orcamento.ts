import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarErro } from "@/server/erros";
import { lerConfiguracaoInt } from "@/server/ia/configuracao";

/**
 * Orçamento próprio do copiloto (§4.4 do plano, CONFLITO C4) — o mesmo
 * raciocínio de `agente-whatsapp/ia.ts::conferirOrcamento`:
 * `verificar_cooldown_ia` tem cooldown de 600s POR JORNADA (calaria o
 * copiloto na 2ª sugestão da sessão) e teto diário por `criado_por`, que o
 * copiloto não tem (`criadoPor: null`, igual ao agente de WhatsApp). Trava
 * errada aperta, trava certa não existe — a conta é feita ANTES, aqui, pelo
 * `prompt_versao_id` do copiloto.
 *
 * Duas contagens, não uma: `teto_ia_sessao` (por `sessao_id`) e `teto_ia_dia`
 * (global, todas as sessões). Falha de leitura NUNCA libera — "não saber
 * quanto já se gastou não é licença para gastar" (mesma frase do agente).
 */

export const CHAVE_PROMPT_COPILOTO = "copiloto_sessao";
const CHAVE_TETO_IA_SESSAO = "copiloto_sessao.teto_ia_sessao";
const CHAVE_TETO_IA_DIA = "copiloto_sessao.teto_ia_dia";
const PADRAO_TETO_IA_SESSAO = 30;
const PADRAO_TETO_IA_DIA = 150;

export interface OrcamentoCopiloto {
  dentro: boolean;
  naSessao: number;
  noDia: number;
  motivo: "teto_ia_sessao" | "teto_ia_dia" | "falha_ao_contar_orcamento" | "prompt_do_copiloto_inexistente" | null;
}

/** ISO do início do dia em America/Sao_Paulo — mesma função de
 * `agente-whatsapp/ia.ts::inicioDoDiaSp` (UTC-3, sem DST desde 2019).
 * Duplicada aqui de propósito: `agente-whatsapp/` não é fronteira desta
 * entrega (regra da casa: não editar arquivo fora da própria fronteira). */
export function inicioDoDiaSp(agora: number = Date.now()): string {
  const emSp = new Date(agora - 3 * 3_600_000);
  const iso = emSp.toISOString().slice(0, 10);
  return `${iso}T03:00:00.000Z`;
}

/**
 * Quantas execuções do prompt `copiloto_sessao` já rodaram: nesta sessão e
 * hoje (todas as sessões). `execucoes_ia.jornada_id` é o vínculo disponível
 * (não há `sessao_id` na tabela) — por isso a contagem "na sessão" usa
 * `hash_entrada` não, usa a mesma jornada da sessão E filtra por
 * `criado_em >= inicioDaSessao` (a sessão pode ser reaberta em outro dia se
 * ficar pendurada — §4.4 do plano cobre isso com `duracao_maxima_minutos`,
 * fora desta função).
 */
export async function conferirOrcamentoCopiloto(
  admin: SupabaseClient,
  params: { jornadaId: string; inicioSessaoIso: string; agora?: number },
): Promise<OrcamentoCopiloto> {
  const desdeHoje = inicioDoDiaSp(params.agora);
  try {
    const { data: prompts, error: erroPrompts } = await admin
      .from("prompts_versoes")
      .select("id")
      .eq("chave", CHAVE_PROMPT_COPILOTO)
      .returns<Array<{ id: string }>>();
    if (erroPrompts) throw erroPrompts;
    const ids = (prompts ?? []).map((p) => p.id);
    if (ids.length === 0) {
      return { dentro: false, naSessao: 0, noDia: 0, motivo: "prompt_do_copiloto_inexistente" };
    }

    const [tetoSessao, tetoDia] = await Promise.all([
      lerConfiguracaoInt(admin, CHAVE_TETO_IA_SESSAO, PADRAO_TETO_IA_SESSAO),
      lerConfiguracaoInt(admin, CHAVE_TETO_IA_DIA, PADRAO_TETO_IA_DIA),
    ]);

    const naSessaoQuery = await admin
      .from("execucoes_ia")
      .select("id", { count: "exact", head: true })
      .in("prompt_versao_id", ids)
      .eq("jornada_id", params.jornadaId)
      .gte("criado_em", params.inicioSessaoIso);
    if (naSessaoQuery.error) throw naSessaoQuery.error;

    const noDiaQuery = await admin
      .from("execucoes_ia")
      .select("id", { count: "exact", head: true })
      .in("prompt_versao_id", ids)
      .gte("criado_em", desdeHoje);
    if (noDiaQuery.error) throw noDiaQuery.error;

    const naSessao = naSessaoQuery.count ?? 0;
    const noDia = noDiaQuery.count ?? 0;

    if (naSessao >= tetoSessao) return { dentro: false, naSessao, noDia, motivo: "teto_ia_sessao" };
    if (noDia >= tetoDia) return { dentro: false, naSessao, noDia, motivo: "teto_ia_dia" };
    return { dentro: true, naSessao, noDia, motivo: null };
  } catch (erro) {
    registrarErro("copiloto/orcamento.conferirOrcamentoCopiloto", erro, { jornada_id: params.jornadaId });
    return { dentro: false, naSessao: 0, noDia: 0, motivo: "falha_ao_contar_orcamento" };
  }
}
