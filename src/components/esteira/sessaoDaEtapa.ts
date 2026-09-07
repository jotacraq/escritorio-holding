import type { EtapaJornada } from "@/types/banco";
import { ORDEM_SESSOES, ROTULO_SESSAO, type ChaveSessao } from "@/lib/pasta/trilho";

/**
 * Em qual das TRÊS SESSÕES cada coluna do quadro cai (Fase 6 §1.1).
 *
 * O João: *"o produto gira em torno de três sessões principais — Viabilidade,
 * Croqui estrutural, Entrega da holding."* As colunas do quadro continuam
 * sendo as etapas que vêm do banco (`etapas_jornada_ordem`): nenhuma some,
 * nenhuma é renomeada. O que muda é que elas passam a viver debaixo do nome da
 * sessão a que pertencem — quem opera vê o produto, não o enum.
 *
 * Este mapa é AGRUPAMENTO DE TELA, e por isso mora em `components/esteira/`,
 * não em `lib/pasta/`: `SESSAO_POR_PASSO` (trilho) e `SESSAO_POR_ITEM`
 * (Pasta) são as fontes de domínio e continuam sendo. Os rótulos vêm de
 * `ROTULO_SESSAO`, para as três telas dizerem a mesma palavra.
 */
export const SESSAO_POR_ETAPA: Record<EtapaJornada, ChaveSessao> = {
  captado: "viabilidade",
  qualificado: "viabilidade",
  sessao_contratada: "viabilidade",
  sessao_agendada: "viabilidade",
  sessao_realizada: "viabilidade",
  croqui_contratado: "croqui",
  croqui_apresentado: "croqui",
  holding_contratada: "entrega",
};

/**
 * Agrupa as colunas nas três sessões, preservando a ordem que o banco mandou.
 * Etapa que o mapa não conhece (coluna nova no banco antes de a tela saber
 * dela) cai na PRIMEIRA sessão em vez de sumir do quadro — perder uma coluna
 * em silêncio é pior que agrupá-la no lugar provável.
 */
export function agruparColunasPorSessao<T extends { etapa: string }>(colunas: T[]): { chave: ChaveSessao; rotulo: string; colunas: T[] }[] {
  return ORDEM_SESSOES.map((chave) => ({
    chave,
    rotulo: ROTULO_SESSAO[chave],
    colunas: colunas.filter((c) => (SESSAO_POR_ETAPA[c.etapa as EtapaJornada] ?? "viabilidade") === chave),
  })).filter((grupo) => grupo.colunas.length > 0);
}

/* -------------------------------------------------------------------------- */
/* Fase (Fase 8, §B3/D18)                                                      */
/* -------------------------------------------------------------------------- */

/**
 * "Fase" é como o advogado brasileiro chama isto (ADVBOX filtra por fase
 * processual; PJe e Astrea falam de fase do processo). No banco continua sendo
 * `etapa`; aqui só o rótulo muda, e a fase é o agrupamento nas TRÊS sessões
 * que já existia — não um conceito novo. Uma coisa, um nome, um mapa.
 */
export type ChaveFase = ChaveSessao;

export const ORDEM_FASES: ChaveFase[] = ORDEM_SESSOES;

/**
 * Rótulo curto para caber em coluna de tabela e em chip de filtro. O nome
 * longo (`ROTULO_SESSAO`) continua valendo no trilho da Ficha, onde há espaço:
 * é a mesma palavra-chave nos dois ("Viabilidade", "Croqui", "Holding"), então
 * ninguém precisa traduzir de uma tela para a outra.
 */
export const ROTULO_FASE: Record<ChaveFase, string> = {
  viabilidade: "Viabilidade",
  croqui: "Croqui estrutural",
  entrega: "Holding",
};

/** Etapa desconhecida cai na primeira fase — perder a linha seria pior que agrupá-la no lugar provável. */
export function faseDaEtapa(etapa: string): ChaveFase {
  return SESSAO_POR_ETAPA[etapa as EtapaJornada] ?? "viabilidade";
}
