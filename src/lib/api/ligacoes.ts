/** Ligação estratégica feita por gente (POP 03/03-B) — não confundir com `ligacoes_ia`. */
import { chamar } from "./nucleo";

export type Ritmo = "rapido" | "moderado" | "pausado";
export type EstiloResposta = "muito_objetiva" | "objetiva" | "detalhada" | "conta_historias";
export type ProcessoDecisorio = "influenciador" | "comunicador" | "decisor_conjunto" | "decide_sozinho";

export interface LigacaoEstrategica {
  id?: string;
  jornada_id: string;
  pop: "03" | "03-B";
  realizada_em: string | null;
  duracao_segundos: number | null;
  respostas: Record<string, string>;
  expectativa_principal: string | null;
  preocupacao_principal: string | null;
  assunto_atencao_especial: string | null;
  objecoes_percebidas: string[];
  pessoas_mencionadas: string[];
  ritmo: Ritmo | null;
  estilo_resposta: EstiloResposta | null;
  sinais: string[];
  frases_marcantes: string[];
  processo_decisorio: ProcessoDecisorio | null;
  decisores_presentes_na_sessao: boolean | null;
  observacoes: string | null;
  origem_dado?: "real" | "exemplo";
}

/** POST cria a primeira ligação da jornada; PUT atualiza a mais recente (backend não faz upsert). */
export function criarLigacao(jornadaId: string, payload: Partial<LigacaoEstrategica>) {
  return chamar<{ ligacao: LigacaoEstrategica }>(`/api/jornadas/${jornadaId}/ligacao`, { method: "POST", body: JSON.stringify(payload) });
}
export function atualizarLigacao(jornadaId: string, payload: Partial<LigacaoEstrategica>) {
  return chamar<{ ligacao: LigacaoEstrategica }>(`/api/jornadas/${jornadaId}/ligacao`, { method: "PUT", body: JSON.stringify(payload) });
}
