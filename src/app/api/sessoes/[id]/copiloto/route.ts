export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { exigirVePatrimonio } from "@/server/auth";
import { erroConflito, registrarErro, respostaErro } from "@/server/erros";
import { montarEstadoCopiloto } from "@/server/copiloto/estado";
import { copilotoEstaAtivo, lerConfigPollingCopiloto } from "@/server/copiloto/config";
import { executarCicloCopiloto, type ResultadoCiclo } from "@/server/copiloto/ciclo";
import { lerConfiguracaoJson } from "@/server/ia/configuracao";
import type {
  EstadoCopilotoComPolling,
  InfoCicloCopiloto,
  SegmentoCopiloto,
  SugestaoCopilotoPolling,
} from "@/types/copiloto";

const ParametroSchema = z.object({ id: z.string().uuid() });

// `bloco` — Fase 12, Fatia 1: OPCIONAL e DEPRECIADO (nunca removido — quebraria
// o fallback de reversão). Antes desta fatia era a ÚNICA fonte do bloco
// atual; agora só vale como FIXAÇÃO MANUAL, e só quando vier acompanhado de
// `fixado_em` (ISO, carimbo de QUANDO a tela leu o clique) — um `?bloco=`
// solto (link antigo, `sessionStorage` remanescente de antes desta fatia)
// NUNCA ressuscita como fixação (ver `estado.ts::FixacaoManualBloco`). Sem
// os dois juntos, o servidor decide sozinho via inferência
// (`copiloto_sessao.inferencia_bloco_ativa`).
// `desde_segmento`/`desde_sugestao` são os cursores incrementais da Fatia 3
// (§2.2/§4.1) — mesma convenção de `GET .../segmentos`: 0 = "desde o início".
const QuerySchema = z.object({
  bloco: z.coerce.number().int().min(0).optional(),
  fixado_em: z.string().datetime({ offset: true }).optional(),
  desde_segmento: z.coerce.number().int().min(0).optional().default(0),
  desde_sugestao: z.coerce.number().int().min(0).optional().default(0),
});

// Mesmo teto defensivo de `GET .../segmentos` (§2.2 do plano: leitura nunca
// varre sem fim) — aqui o número é bem menor porque o polling roda a cada 3s
// e nunca deveria acumular centenas de itens novos entre duas chamadas.
const LIMITE_SEGMENTOS_NOVOS = 100;
const LIMITE_SUGESTOES_NOVAS = 20;

const CHAVE_CONFIANCA_MINIMA = "copiloto_sessao.confianca_minima";
const PADRAO_CONFIANCA_MINIMA = 0.6;

interface SegmentoRow {
  id: string;
  sessao_id: string;
  ordem: number;
  falante: string | null;
  falante_confianca: number | null;
  texto: string;
  iniciado_ms: number | null;
  origem: "bot" | "manual";
  criado_em: string;
}

interface SugestaoRow {
  id: string;
  ordem_evento: number;
  gatilho: "intervalo" | "virada_bloco" | "sob_demanda";
  conteudo: SugestaoCopilotoPolling["sugestao"];
  confianca: number | null;
  desfecho: SugestaoCopilotoPolling["desfecho"];
  criado_em: string;
}

/**
 * `select ... where sessao_id=$1 and ordem > $2 order by ordem limit $3` —
 * caractere a caractere o predicado de `idx_copiloto_segmentos_polling`
 * (0091, §2.2/§4.1). MESMA query de `GET .../segmentos`; duplicada aqui
 * (não reexportada daquele módulo) porque aquela rota é o caminho MANUAL da
 * Fatia 1 e continua existindo por si — este é o caminho de POLLING
 * coalescido da Fatia 3, com teto de itens diferente.
 *
 * `explain (analyze)` — A MEDIR. CORREÇÃO (achado do Fable): o comando
 * exato NÃO está em `verificacao-0096.sql` — está em
 * `scripts/verificacao-0091.sql` §7, onde esta MESMA query (do caminho
 * manual, idêntica na forma) já foi documentada desde a Fatia 1.
 */
async function buscarSegmentosNovos(
  supabase: SupabaseClient,
  sessaoId: string,
  desde: number,
): Promise<{ itens: SegmentoCopiloto[]; proximoCursor: number }> {
  const { data, error } = await supabase
    .from("sessoes_copiloto_segmentos")
    .select("id, sessao_id, ordem, falante, falante_confianca, texto, iniciado_ms, origem, criado_em")
    .eq("sessao_id", sessaoId)
    .gt("ordem", desde)
    .order("ordem", { ascending: true })
    .limit(LIMITE_SEGMENTOS_NOVOS)
    .returns<SegmentoRow[]>();
  if (error) throw error;

  const itens = data ?? [];
  return { itens, proximoCursor: itens.length > 0 ? itens[itens.length - 1]!.ordem : desde };
}

/**
 * `select ... where sessao_id=$1 and ordem_evento > $2 order by ordem_evento
 * limit $3` — caractere a caractere o predicado de
 * `idx_copiloto_sugestoes_polling` (0091, §2.2). `bigint identity` ordena;
 * `uuid` não ordenaria — é a ARMADILHA DO CURSOR-UUID que o §2.2 do plano
 * nomeia explicitamente para esta query.
 *
 * `explain (analyze)` — A MEDIR. CORREÇÃO (achado do Fable, 2ª rodada): o
 * comando exato agora está em `scripts/verificacao-0096.sql` §8 (c) — antes
 * não existia em roteiro nenhum, apesar do comentário anterior apontar para
 * lá.
 */
async function buscarSugestoesNovas(
  supabase: SupabaseClient,
  sessaoId: string,
  desde: number,
  confiancaMinima: number,
): Promise<{ itens: SugestaoCopilotoPolling[]; proximoCursor: number }> {
  const { data, error } = await supabase
    .from("copiloto_sugestoes")
    .select("id, ordem_evento, gatilho, conteudo, confianca, desfecho, criado_em")
    .eq("sessao_id", sessaoId)
    .gt("ordem_evento", desde)
    .order("ordem_evento", { ascending: true })
    .limit(LIMITE_SUGESTOES_NOVAS)
    .returns<SugestaoRow[]>();
  if (error) throw error;

  const linhas = data ?? [];
  const itens: SugestaoCopilotoPolling[] = linhas.map((linha) => {
    // `visivel` é RECALCULADA aqui contra a confiança mínima ATUAL (a config
    // pode ter mudado entre a gravação e esta leitura) — mesma regra de
    // exibição de `sugestaoEVisivel` (Fatia 2), aplicada na LEITURA. A
    // sugestão SEMPRE existe em `conteudo` (coluna `not null`, 0091): o que
    // varia é se a tela pode MOSTRAR o campo `sugestao` ou só o aviso de
    // baixa confiança — nunca se a linha existe.
    const confiancaGeral = linha.confianca ?? 0;
    const visivel = confiancaGeral >= confiancaMinima;
    return {
      sugestao_id: linha.id,
      ordem_evento: linha.ordem_evento,
      gatilho: linha.gatilho,
      confianca_geral: confiancaGeral,
      visivel,
      sugestao: visivel ? linha.conteudo : null,
      desfecho: linha.desfecho,
      criado_em: linha.criado_em,
    };
  });

  return { itens, proximoCursor: itens.length > 0 ? itens[itens.length - 1]!.ordem_evento : desde };
}

/**
 * Traduz o `ResultadoCiclo` (server/copiloto/ciclo.ts) para o contrato de
 * polling que o FRONT recebe (`InfoCicloCopiloto`). É AQUI que a tela aprende
 * "o gate fechou no meio da sessão" (§6.2.2 da errata) — nunca por inferência
 * (ex.: "sumiu sugestão nova" não é o mesmo que "o gate bloqueou"; podia ser
 * silêncio normal na sala).
 */
function paraInfoCiclo(resultado: ResultadoCiclo): InfoCicloCopiloto {
  switch (resultado.situacao) {
    case "nenhum_gatilho":
    case "sessao_nao_ativa_para_ciclo":
      return { avaliado: true, resultado: null, motivo_bloqueio: null };
    case "janela_ja_claimada_por_outra_requisicao":
      // Outra aba já reivindicou — para ESTA requisição não houve tentativa própria.
      return { avaliado: true, resultado: null, motivo_bloqueio: null };
    case "sessao_encerrada_por_duracao_maxima":
      return { avaliado: true, resultado: "sessao_encerrada_por_duracao_maxima", motivo_bloqueio: null };
    case "bloqueado_pelo_gate":
      return { avaliado: true, resultado: "bloqueado_pelo_gate", motivo_bloqueio: resultado.motivo };
    case "orcamento_estourado":
      return { avaliado: true, resultado: "orcamento_estourado", motivo_bloqueio: resultado.motivo };
    case "timeout":
      return { avaliado: true, resultado: "timeout", motivo_bloqueio: null };
    case "indisponivel":
      return { avaliado: true, resultado: "indisponivel", motivo_bloqueio: resultado.motivo };
    case "conteudo_recusado":
      return { avaliado: true, resultado: "conteudo_recusado", motivo_bloqueio: null };
    case "sugestao_gravada":
      return { avaliado: true, resultado: "sugestao_gravada", motivo_bloqueio: null };
  }
}

/**
 * GET /api/sessoes/[id]/copiloto — MESMA rota da Fatia 1, agora com o
 * POLLING COALESCIDO da Fatia 3 (docs/ARQUITETURA-FASE-10.md §2.4/§4.1/§8):
 * estado determinístico + segmentos novos + sugestões novas + o CICLO
 * AUTOMÁTICO, num payload só. É a rota que a tela chama a cada 3s (1.800
 * vezes por sessão de 90 min) — a maioria das chamadas sai sem novidade
 * nenhuma de conteúdo e sem gatilho de IA (§2.3: "silêncio = zero chamada").
 *
 * ORDEM:
 *  1. `exigirVePatrimonio()` + kill-switch (`copiloto_sessao.ativo`) — igual
 *     à Fatia 1.
 *  2. `montarEstadoCopiloto` — 1 query coalescida (sessão+jornada+roteiro+sims).
 *  3. Segmentos novos + sugestões novas — 2 queries sobre os índices
 *     compostos do caminho quente (§2.2).
 *  4. `executarCicloCopiloto` — avalia o GATILHO primeiro; se não bateu,
 *     sai sem escrever nada além da leitura do gatilho. Só quando o gatilho
 *     dispara é que claim/gate/orçamento/IA entram em jogo.
 *
 * O CICLO NUNCA DERRUBA O POLLING: se `executarCicloCopiloto` lançar (erro
 * inesperado, não um resultado de negócio — aqueles já vêm como valor de
 * retorno tipado), o erro é registrado e a resposta segue com
 * `ciclo: { avaliado: false, ... }` — a tela continua mostrando segmentos e
 * sugestões já existentes mesmo se a avaliação do ciclo falhar nesta
 * chamada específica (a próxima, 3s depois, tenta de novo).
 *
 * 🔴 CORREÇÃO (Fase 11 — "eliminar o double-hop de polling"): o comentário
 * anterior aqui afirmava que esperar o ciclo terminar para então incluir a
 * sugestão gravada "adicionaria latência real (até ~8s) à resposta de TODA
 * chamada" — isso está ERRADO e provável de checar: `executarCicloCopiloto`
 * já é `await`ado ABAIXO, no mesmo `try`, MESMO ANTES desta correção. A
 * resposta HTTP já esperava o ciclo inteiro (incl. o timeout de 8s quando o
 * gatilho dispara) — os 8s já eram pagos por toda chamada onde o gatilho
 * dispara; só a EXIBIÇÃO da sugestão é que ficava represada até o tick
 * seguinte (+3s), sem motivo. `ResultadoCiclo.sugestao_gravada` já traz
 * `ordemEvento`/`criadoEm` (ciclo.ts) — usados abaixo para montar a
 * `SugestaoCopilotoPolling` desta MESMA chamada, ZERO query extra. O cursor
 * (`proximo_cursor_sugestao`) avança junto: sem isso, a mesma sugestão
 * voltaria duplicada no tick seguinte (o front concatena sem deduplicar).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirVePatrimonio();
    const { id: sessaoId } = ParametroSchema.parse(await params);
    const { bloco, fixado_em, desde_segmento, desde_sugestao } = QuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );

    const supabase = await criarClienteServidor();

    if (!(await copilotoEstaAtivo(supabase))) {
      throw erroConflito(
        "copiloto_desligado",
        "O copiloto está desligado (copiloto_sessao.ativo = false em Admin).",
      );
    }

    const confiancaMinima = await lerConfiguracaoJson<number>(supabase, CHAVE_CONFIANCA_MINIMA, PADRAO_CONFIANCA_MINIMA);

    // Fase 12, Fatia 1: `?bloco=` só vale como FIXAÇÃO MANUAL quando vem
    // ACOMPANHADO de `fixado_em` — sem os dois juntos, `fixacaoManual` é
    // `null` e `montarEstadoCopiloto` decide sozinho via inferência (ver
    // `estado.ts::resolverBlocoAtual`). Um `?bloco=` solto (link antigo,
    // `sessionStorage` remanescente) nunca ressuscita como fixação.
    const fixacaoManual = bloco !== undefined && fixado_em ? { indice: bloco, fixadoEm: fixado_em } : null;

    const [estado, segmentos, sugestoes, polling] = await Promise.all([
      montarEstadoCopiloto(supabase, sessaoId, bloco ?? null, fixacaoManual),
      buscarSegmentosNovos(supabase, sessaoId, desde_segmento),
      buscarSugestoesNovas(supabase, sessaoId, desde_sugestao, confiancaMinima),
      lerConfigPollingCopiloto(supabase),
    ]);

    let ciclo: InfoCicloCopiloto = { avaliado: false, resultado: null, motivo_bloqueio: null };
    // Mutáveis: o ciclo pode acrescentar a sugestão gravada NESTA chamada e
    // avançar o cursor — ver Tarefa 7 (comentário de topo desta função).
    let sugestoesNovas = sugestoes.itens;
    let proximoCursorSugestao = sugestoes.proximoCursor;
    try {
      const admin = criarClienteAdmin();
      // Fase 12, Fatia 1: o índice/origem para o CICLO (gatilho + montagem
      // de contexto) vêm do bloco JÁ RESOLVIDO pelo servidor
      // (`bloco_atual_resolvido`), não mais do `?bloco=` cru — é a correção
      // do defeito-raiz propagada até aqui. `origem: "fixado_manualmente"`
      // mapeia para `"manual"` (só ela pode disparar `virada_bloco`, ver
      // `gatilho.ts`); `"indisponivel"` cai no índice 0 só para a MONTAGEM
      // de contexto não ficar sem bloco (nunca para decidir virada).
      const blocoParaCiclo = estado.bloco_atual_resolvido.indice ?? 0;
      const origemParaCiclo =
        estado.bloco_atual_resolvido.origem === "fixado_manualmente" ? "manual" : estado.bloco_atual_resolvido.origem;
      const resultado = await executarCicloCopiloto(supabase, admin, {
        sessaoId,
        blocoAtualIndice: blocoParaCiclo,
        blocoAtualOrigem: origemParaCiclo,
      });
      ciclo = paraInfoCiclo(resultado);

      if (resultado.situacao === "sugestao_gravada" && resultado.ordemEvento > proximoCursorSugestao) {
        // `> proximoCursorSugestao` (não só "!== já presente"): dedup pelo
        // MESMO critério de cursor que `buscarSugestoesNovas` usa — se por
        // qualquer motivo a query paralela já tivesse pego esta linha (ex.:
        // corrida rara entre o SELECT e o INSERT), o cursor já estaria à
        // frente e este bloco não duplicaria a entrada.
        sugestoesNovas = [
          ...sugestoesNovas,
          {
            sugestao_id: resultado.sugestaoId,
            ordem_evento: resultado.ordemEvento,
            gatilho: resultado.gatilho,
            confianca_geral: resultado.confiancaGeral,
            visivel: resultado.visivel,
            sugestao: resultado.sugestao,
            desfecho: null, // sugestão recém-gravada nesta chamada — nunca teve tempo de ganhar desfecho
            criado_em: resultado.criadoEm,
          },
        ];
        proximoCursorSugestao = resultado.ordemEvento;
      }
    } catch (erroCiclo) {
      // O CICLO NUNCA DERRUBA O POLLING (comentário de topo) — registra e
      // segue com o que já tinha antes de tentar o ciclo.
      registrarErro("GET /api/sessoes/[id]/copiloto (ciclo)", erroCiclo, { sessao_id: sessaoId });
    }

    const resposta: EstadoCopilotoComPolling = {
      ...estado,
      segmentos_novos: segmentos.itens,
      proximo_cursor_segmento: segmentos.proximoCursor,
      sugestoes_novas: sugestoesNovas,
      proximo_cursor_sugestao: proximoCursorSugestao,
      ciclo,
      polling,
    };

    return NextResponse.json(resposta);
  } catch (erro) {
    return respostaErro("GET /api/sessoes/[id]/copiloto", erro);
  }
}
