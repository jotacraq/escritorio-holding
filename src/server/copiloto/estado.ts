import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoteiroDefinicao } from "@/types/roteiro";
import type { BlocoPendente, CampoPendente, EstadoCopiloto, SimPendente } from "@/types/copiloto";
import { erroNaoEncontrado } from "@/server/erros";

/**
 * Montagem do estado determinístico do copiloto — Fase 10, Fatia 1
 * (docs/ARQUITETURA-FASE-10.md §8, §12). ZERO IA: tudo aqui é derivado de
 * dado que já existe (roteiro ativo, `sessoes_viabilidade.sims`,
 * `consentimentos`). Fica em `server/copiloto/` (não direto na rota) porque a
 * Fatia 3 (polling automático) vai reusar exatamente esta função no polling
 * de 3 s — ~1.800 chamadas por sessão de 90 min (§4.1 do plano). É por isso
 * que o número de idas ao banco por chamada importa aqui mais do que numa
 * rota comum, e por que as duas seções abaixo foram corrigidas (achado do
 * Fable): a query principal agora embute `jornadas(pessoa_id)` — 2 idas ao
 * banco no total, não 3 — e o comentário da 2ª idas passou a descrever o que
 * o código realmente faz (ela roda SEMPRE, não só "quando o bloco é o 1º").
 *
 * UMA QUERY COALESCIDA para sessão + jornada + roteiro + estado do copiloto
 * (§2.4): `sessoes_viabilidade` embute `jornadas(pessoa_id)` pela FK
 * `jornada_id` e `roteiros_versoes(definicao)` pela FK `roteiro_versao_id` —
 * é o mesmo padrão de embed que `src/app/api/croquis/[id]/analise/route.ts`
 * já usa. `sessoes_copiloto` embute junto pela FK `sessao_id`. Consentimento
 * (1º SIM) fica de FORA do embed porque `consentimentos` não tem FK para
 * `sessao_id` (é por PESSOA, 0005) — mesma limitação que já existe em
 * `GET /api/sessoes/[id]/sims`; é a 2ª (e última) ida ao banco desta função.
 */

interface SessaoComRoteiroEBloco {
  id: string;
  roteiro_versao_id: string | null;
  sims: Record<string, { ok: boolean; em: string; registrado_por: string | null }>;
  jornadas: { pessoa_id: string } | null;
  roteiros_versoes: { definicao: RoteiroDefinicao } | null;
  sessoes_copiloto: { estado: "aguardando" | "ativo" | "encerrado" | "erro" } | null;
}

const ROTULOS_SIM: Record<"sigilo_gravacao" | "licitude" | "decisores" | "proximo_passo", string> = {
  sigilo_gravacao: "Sigilo e gravação",
  licitude: "Licitude",
  decisores: "Decisores presentes",
  proximo_passo: "Próximo passo",
};

/**
 * `indiceBlocoAtual` vem do CHAMADOR (a rota recebe `?bloco=<indice>` — é o
 * mesmo índice que `ConduzirSessaoApp` já guarda em `sessionStorage`, nunca
 * recalculado aqui: o servidor não tem "onde a advogada está agora", só a
 * tela tem). Fora do intervalo válido → trata como 0, nunca lança.
 */
export async function montarEstadoCopiloto(
  supabase: SupabaseClient,
  sessaoId: string,
  indiceBlocoAtual: number,
): Promise<EstadoCopiloto> {
  const { data, error } = await supabase
    .from("sessoes_viabilidade")
    .select(
      "id, roteiro_versao_id, sims, jornadas(pessoa_id), roteiros_versoes(definicao), sessoes_copiloto(estado)",
    )
    .eq("id", sessaoId)
    .maybeSingle<SessaoComRoteiroEBloco>();
  if (error) throw error;
  if (!data) throw erroNaoEncontrado("Sessão de Viabilidade não encontrada.");

  const blocos = data.roteiros_versoes?.definicao?.blocos ?? [];
  const indice = Number.isInteger(indiceBlocoAtual) && indiceBlocoAtual >= 0 && indiceBlocoAtual < blocos.length
    ? indiceBlocoAtual
    : 0;
  const blocoAtual = blocos[indice] ?? null;

  const camposPendentes: CampoPendente[] = (blocoAtual?.campos ?? []).map((c) => ({
    id: c.id,
    rotulo: c.rotulo,
    tipo: c.tipo,
  }));
  const observarPendente: string[] = blocoAtual?.observar ?? [];

  const simsPendentes = await calcularSimsPendentes(supabase, data.jornadas?.pessoa_id ?? null, data.sims);

  const blocosNaoPercorridos: BlocoPendente[] = blocos
    .map((b, i) => ({ id: b.id, titulo: b.titulo, indice: i }))
    .filter((b) => b.indice > indice);

  return {
    sessao_id: data.id,
    bloco_atual_id: blocoAtual?.id ?? null,
    falta_no_bloco: { campos: camposPendentes, observar: observarPendente },
    sims_pendentes: simsPendentes,
    blocos_nao_percorridos: blocosNaoPercorridos,
    estado_copiloto: data.sessoes_copiloto?.estado ?? "aguardando",
  };
}

/**
 * Os 4 SIMs — 3 vêm de `sessoes_viabilidade.sims` (já na query principal); o
 * 1º (sigilo_gravacao) é o consentimento MAIS RECENTE do tipo
 * 'gravacao_sessao' da pessoa (mesma regra de "vigente" que
 * `GET /api/sessoes/[id]/sims` já usa) — 2ª leitura, pequena (1 linha, por
 * pessoa_id indexado em `idx_consent_pessoa_tipo`, 0005). Roda em TODA
 * chamada (não só quando o bloco atual é o 1º): o 1º SIM pode continuar
 * pendente em qualquer bloco da sessão, e a lista de pendentes precisa
 * refletir isso o tempo todo.
 *
 * `pessoaId` já vem resolvido do embed da query principal — nenhuma consulta
 * a `jornadas` aqui (era uma 3ª ida ao banco; achado do Fable, corrigido).
 */
async function calcularSimsPendentes(
  supabase: SupabaseClient,
  pessoaId: string | null,
  simsConducao: SessaoComRoteiroEBloco["sims"],
): Promise<SimPendente[]> {
  const pendentes: SimPendente[] = [];

  if (pessoaId) {
    const { data: consentimento, error: erroConsentimento } = await supabase
      .from("consentimentos")
      .select("concedido, revogado_em")
      .eq("pessoa_id", pessoaId)
      .eq("tipo", "gravacao_sessao")
      .order("concedido_em", { ascending: false })
      .limit(1)
      .maybeSingle<{ concedido: boolean; revogado_em: string | null }>();
    if (erroConsentimento) throw erroConsentimento;

    const sigiloOk = !!consentimento && consentimento.concedido && !consentimento.revogado_em;
    if (!sigiloOk) pendentes.push({ sim: "sigilo_gravacao", rotulo: ROTULOS_SIM.sigilo_gravacao });
  }

  for (const sim of ["licitude", "decisores", "proximo_passo"] as const) {
    if (!simsConducao?.[sim]?.ok) {
      pendentes.push({ sim, rotulo: ROTULOS_SIM[sim] });
    }
  }

  return pendentes;
}
