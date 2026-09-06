/** Briefing Estratégico (gerado por IA) e a porta de completude que o barra. */
import { chamar, chamarOpcional } from "./nucleo";

export interface BriefingResumo {
  id: string;
  jornada_id: string;
  versao: number;
  grau_confianca: number | null;
  fontes_usadas: string[];
  atual: boolean;
  criado_em: string;
}

/** Espelha `server/ia/completude.ts#ResultadoCompletude` — vem em `ApiError.detalhe`
 * quando `POST /api/briefings/gerar` responde 409 `dados_insuficientes`. */
export interface ItemChecklistCompletude {
  sinal: string;
  peso: number;
  atendido: boolean;
  rotulo: string;
}
export interface ResultadoCompletude {
  score: number;
  minimo: number;
  atingiu: boolean;
  checklist: ItemChecklistCompletude[];
}

export interface Briefing {
  id: string;
  jornada_id: string;
  versao: number;
  grau_confianca: number | null;
  fontes_usadas: string[];
  modo_reduzido?: boolean;
  criado_em: string;
  prompt_versao?: { chave: string; versao: number } | null;
  custo_usd?: number | null;
  conteudo: {
    resumo_executivo: string;
    perfil_disc: { predominante: string; secundario: string | null; confianca: number; evidencias: string[] };
    arquetipo_patrimonial: { escolhido: string; justificativa: string; evidencias: string[] };
    o_que_protege: { objeto: string; justificativa: string };
    motivadores: { principal: string; secundarios: string[]; justificativa: string };
    objecoes_provaveis: { objecao: string; probabilidade: "alta" | "media" | "baixa"; justificativa: string }[];
    processo_decisorio: {
      velocidade: string;
      necessidade_seguranca: string;
      necessidade_validacao: string;
      necessidade_detalhe: string;
      decisores: string[];
    };
    linguagem_recomendada: { tom: string[]; justificativa: string };
    pontos_de_atencao: { nao_fazer: string; motivo: string }[];
    perguntas_para_aprofundar: { pergunta: string; motivo: string }[];
    frases_para_o_fechamento: { frase_literal: string; como_usar: string }[];
    estrategia_sessao: {
      ritmo: string;
      mais_tempo_em: string[];
      menos_tempo_em: string[];
      momento_croqui: string;
      momento_investimento: string;
      tratamento_objecoes: string;
    };
    estrategia_fechamento: string;
    grau_confianca: number;
    lacunas: string[];
  };
}

export function gerarBriefing(jornadaId: string, forcarRegeracao = false, forcarMesmoAssim = false) {
  return chamar<{ execucao_id: string; briefing_id: string }>(`/api/briefings/gerar`, {
    method: "POST",
    body: JSON.stringify({
      jornada_id: jornadaId,
      forcar_regeracao: forcarRegeracao,
      forcar_mesmo_assim: forcarMesmoAssim,
    }),
  });
}

interface BriefingBruto extends Omit<Briefing, "prompt_versao" | "custo_usd"> {
  execucoes_ia?: {
    custo_usd: number | null;
    prompt_versao_id: string;
    prompts_versoes?: { chave: string; versao: number; titulo: string } | null;
  } | null;
}

export async function buscarBriefing(id: string): Promise<Briefing> {
  const { briefing } = await chamar<{ briefing: BriefingBruto }>(`/api/briefings/${id}`);
  const { execucoes_ia, ...resto } = briefing;
  return {
    ...resto,
    custo_usd: execucoes_ia?.custo_usd ?? null,
    prompt_versao: execucoes_ia?.prompts_versoes
      ? { chave: execucoes_ia.prompts_versoes.chave, versao: execucoes_ia.prompts_versoes.versao }
      : null,
  };
}

/** Histórico de versões do Briefing. A rota existe desde 04/09/2026 — antes
 * disso `chamarOpcional` engolia o 404 e o histórico sumia em silêncio. */
export function listarBriefingsDaJornada(jornadaId: string) {
  return chamarOpcional<{ itens: Pick<Briefing, "id" | "versao" | "grau_confianca" | "criado_em">[] }>(`/api/jornadas/${jornadaId}/briefings`);
}
