/**
 * Forma real de `briefings.conteudo` hoje em produção (schema v2,
 * `src/server/ia/schema-briefing.ts`, fora da fronteira deste agente —
 * ARQUITETURA-FASE-3.md §6, Onda 1 · agente A). `Briefing.conteudo` em
 * `src/lib/api.ts` (TRAVADO, nenhum agente edita) ainda reflete o schema v1
 * — sem os `_nota`, sem `nivel_autoridade`/`decisores_presentes_na_sessao`,
 * com `perfil_disc.predominante` tipado como `string` livre em vez do enum
 * D/I/S/C. Isso não quebra em runtime (todo campo novo ainda é string
 * compatível), só deixa a tela cega para o que o schema v2 acrescentou.
 *
 * Este tipo espelha o schema v2 para os componentes de briefing lerem o dado
 * de verdade sem reescrever `lib/api.ts`. Pedido de reconciliação formal no
 * relatório desta entrega — o dono de `lib/api.ts` decide quando atualizar.
 */
export interface BriefingConteudoV2 {
  resumo_executivo: string;
  perfil_disc: {
    predominante: "D" | "I" | "S" | "C";
    secundario: "D" | "I" | "S" | "C" | null;
    confianca: number;
    evidencias: string[];
  };
  arquetipo_patrimonial: {
    escolhido: string;
    justificativa: string;
    evidencias: string[];
  };
  o_que_protege: { objeto: string; justificativa: string };
  motivadores: { principal: string; secundarios: string[]; justificativa: string };
  objecoes_provaveis: { objecao: string; probabilidade: "alta" | "media" | "baixa"; justificativa: string }[];
  processo_decisorio: {
    velocidade: string;
    velocidade_nota?: string;
    necessidade_seguranca: string;
    necessidade_seguranca_nota?: string;
    necessidade_validacao: string;
    necessidade_validacao_nota?: string;
    necessidade_detalhe: string;
    necessidade_detalhe_nota?: string;
    nivel_autoridade?: string;
    nivel_autoridade_nota?: string;
    decisores_presentes_na_sessao?: string;
    decisores_presentes_na_sessao_nota?: string;
    decisores: string[];
  };
  linguagem_recomendada: { tom: string[]; justificativa: string };
  pontos_de_atencao: { nao_fazer: string; motivo: string }[];
  perguntas_para_aprofundar: { pergunta: string; motivo: string }[];
  frases_para_o_fechamento: { frase_literal: string; como_usar: string }[];
  estrategia_sessao: {
    ritmo: string;
    ritmo_nota?: string;
    mais_tempo_em: string[];
    menos_tempo_em: string[];
    momento_croqui: string;
    momento_investimento: string;
    tratamento_objecoes: string;
  };
  estrategia_fechamento: string;
  grau_confianca: number;
  lacunas: string[];
}

/**
 * Verificação de fidelidade (`briefings.verificacao`, `src/server/ia/fidelidade.ts`)
 * — coluna já existe no banco (`0042`) e já é calculada em toda geração real,
 * mas nem `GET /api/briefings/[id]` nem `POST /api/briefings/gerar` a
 * devolvem hoje (ambos em `src/app/api/**`, fora da fronteira deste agente).
 * Tipo mantido aqui, opcional, para o painel exibir a marca assim que o
 * backend passar a expor — sem isso, nenhuma marca de fidelidade aparece
 * (nunca um "verificada" fabricado no cliente).
 */
export interface VerificacaoFraseLiteralV2 {
  frase_literal: string;
  status: "verificada" | "nao_localizada";
}
export interface ResultadoFidelidadeV2 {
  frases_fechamento: VerificacaoFraseLiteralV2[];
}

const ROTULO_DISC: Record<string, string> = {
  D: "Dominância (D)",
  I: "Influência (I)",
  S: "Estabilidade (S)",
  C: "Conformidade (C)",
};

export function rotularDisc(codigo: string | null | undefined): string {
  if (!codigo) return "—";
  return ROTULO_DISC[codigo] ?? codigo;
}

const ROTULO_ARQUETIPO: Record<string, string> = {
  Empresario: "Empresário",
  Nenhum_se_aplica: "Nenhum se aplica",
};

export function rotularArquetipo(valor: string): string {
  return ROTULO_ARQUETIPO[valor] ?? valor;
}

const ROTULO_TOM: Record<string, string> = {
  tecnica: "Técnica",
  emocional: "Emocional",
  objetiva: "Objetiva",
  detalhada: "Detalhada",
  acolhedora: "Acolhedora",
  firme: "Firme",
  consultiva: "Consultiva",
};

export function rotularTom(valor: string): string {
  return ROTULO_TOM[valor] ?? valor;
}

const ROTULO_NIVEL: Record<string, string> = {
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
  indefinida: "Indefinida",
  rapida: "Rápida",
  lenta: "Lenta",
};

const ROTULO_NIVEL_AUTORIDADE: Record<string, string> = {
  decide_sozinho: "Decide sozinho(a)",
  decide_com_conjuge: "Decide com o cônjuge",
  decide_com_socios: "Decide com sócios",
  nao_decide: "Não decide",
  indefinido: "Indefinido",
};

const ROTULO_SIM_NAO: Record<string, string> = {
  sim: "Sim",
  nao: "Não",
  indefinido: "Indefinido",
};

const ROTULO_RITMO: Record<string, string> = {
  lento: "Lento",
  moderado: "Moderado",
  rapido: "Rápido",
};

const ROTULO_PROBABILIDADE: Record<string, string> = {
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
};

export function rotularNivel(valor: string): string {
  return ROTULO_NIVEL[valor] ?? valor;
}
export function rotularNivelAutoridade(valor: string): string {
  return ROTULO_NIVEL_AUTORIDADE[valor] ?? valor;
}
export function rotularSimNao(valor: string): string {
  return ROTULO_SIM_NAO[valor] ?? valor;
}
export function rotularRitmo(valor: string): string {
  return ROTULO_RITMO[valor] ?? valor;
}
export function rotularProbabilidade(valor: string): string {
  return ROTULO_PROBABILIDADE[valor] ?? valor;
}

/** Tom do `Chip` (`atomos.tsx`) para cada nível de probabilidade — usado no painel compacto e na aba completa. */
export function tomProbabilidade(valor: string): "vermelho" | "ambar" | "neutro" {
  if (valor === "alta") return "vermelho";
  if (valor === "media") return "ambar";
  return "neutro";
}
