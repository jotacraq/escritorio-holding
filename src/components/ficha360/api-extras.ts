/**
 * Recorte da Fase 4 de `GET /api/jornadas/[id]` (`Ficha360` já tipa
 * `diagnosticoAtual`, `cenarios`, `ligacaoIaAtual`, `tarefasAbertas` — agente
 * K, Onda 3). O que fica aqui é o que o tipo não diz: se a chave VEIO no
 * payload (tabela lida) ou não (servidor anterior à 0053/0058) — mesma
 * disciplina de `lib/pasta/sinais.ts`: ausente = "sem informação", nunca
 * inventado.
 */
import type { Ficha360 } from "@/lib/api";
import type { AgendamentoSessao, LigacaoIaResumo, SessaoViabilidade, Tarefa } from "@/types/banco";
import type { DiagnosticoSv } from "@/types/cenario";

export type CenariosDaFicha = NonNullable<Ficha360["cenarios"]>;

export interface ExtrasFicha360 {
  diagnosticoAtual: DiagnosticoSv | null;
  cenarios: CenariosDaFicha | null;
  ligacaoIaAtual: LigacaoIaResumo | null;
  tarefasAbertas: Tarefa[];
  /** `true` quando o payload já carrega `tarefasAbertas` (tabela lida, mesmo que vazia). */
  tarefasDisponiveis: boolean;
  /** `true` quando o payload já carrega `ligacaoIaAtual` (chave presente, mesmo `null`). */
  ligacaoIaDisponivel: boolean;
  /** Agendamentos com os campos de presença (0051) — `presenca_confirmada_em` fica `undefined` quando a coluna não veio. */
  agendamentos: Array<AgendamentoSessao & { presenca_confirmada_em?: string | null; presenca_confirmada_via?: string | null }>;
  /** Sessão com origem/solicitação da sala (0051) — campos `undefined` quando a coluna não veio. */
  sessao: (Partial<Pick<SessaoViabilidade, "link_sala_origem" | "link_sala_atualizado_em" | "sala_solicitada_em">> & Ficha360["sessao"]) | null;
}

function temChave(objeto: object, chave: keyof Ficha360): boolean {
  return Object.prototype.hasOwnProperty.call(objeto, chave);
}

export function extrasDaFicha(ficha: Ficha360): ExtrasFicha360 {
  return {
    diagnosticoAtual: ficha.diagnosticoAtual ?? null,
    cenarios: ficha.cenarios ?? null,
    ligacaoIaAtual: ficha.ligacaoIaAtual ?? null,
    tarefasAbertas: Array.isArray(ficha.tarefasAbertas) ? ficha.tarefasAbertas : [],
    tarefasDisponiveis: temChave(ficha, "tarefasAbertas"),
    ligacaoIaDisponivel: temChave(ficha, "ligacaoIaAtual"),
    // `Agendamento`/`SessaoViabilidade` de `lib/api.ts` e de `types/banco.ts`
    // são espelhos (os campos 0051 já opcionais nos dois) — a ponte de tipo
    // fica aqui, num lugar só.
    agendamentos: ficha.agendamentos as ExtrasFicha360["agendamentos"],
    sessao: ficha.sessao as ExtrasFicha360["sessao"],
  };
}

/** Próximo agendamento ativo (`agendado`/`confirmado`), o mais cedo. */
export function proximoAgendamentoAtivo(agendamentos: ExtrasFicha360["agendamentos"]) {
  return (
    agendamentos
      .filter((a) => a.status === "agendado" || a.status === "confirmado")
      .sort((a, b) => a.inicio_em.localeCompare(b.inicio_em))[0] ?? null
  );
}
