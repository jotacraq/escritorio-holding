/**
 * Tipos da Fase 4 / F4 (agente D): parâmetros do método (0056), Cenário
 * Patrimonial com procedência por rubrica (0057) e Diagnóstico da SV (0058).
 *
 * Contratos consumidos pelos agentes H (Ficha: gaveta Cenário + tela do
 * Diagnóstico), I (`PainelOferta` lê o preço por `GET /api/parametros-metodo`)
 * e G (Admin → Parâmetros). Formas de resposta de cada rota no fim do arquivo.
 */

import type { CategoriaAfirmacao } from "@/server/ia/schema-croqui-analise";

// ---------------------------------------------------------------------------
// 0056 — parametros_metodo
// ---------------------------------------------------------------------------

export type UnidadeParametro = "brl" | "percentual" | "parcelas" | "dias" | "meses" | "quantidade";

/** Chaves que o código lê por nome. Chaves de imposto (`itcmd.*`/`itbi.*`)
 * são cadastradas pelo Admin com base legal — nunca semeadas (B30). */
export const CHAVE_PARAMETRO = {
  croquiPadrao: "honorarios.croqui.padrao",
  croquiIncentivo: "honorarios.croqui.incentivo",
  itcmdAliquota: "itcmd.aliquota",
  itbiAliquota: "itbi.aliquota",
} as const;
export type ChaveParametroConhecida = (typeof CHAVE_PARAMETRO)[keyof typeof CHAVE_PARAMETRO];

export interface ParametroMetodo {
  id: string;
  chave: string;
  versao: number;
  valor: number;
  unidade: UnidadeParametro;
  uf: string | null;
  municipio: string | null;
  base_legal: string | null;
  vigente_de: string;
  ativo: boolean;
  ativado_por: string | null;
  ativado_em: string | null;
  notas: string | null;
  criado_em: string;
  criado_por: string | null;
}

/** `GET /api/parametros-metodo?chaves=a,b[&uf=SP[&municipio=...]]` —
 * uma entrada por chave pedida; `null` = nenhuma versão ativa (a tela mostra
 * `<SeloStub>`, nunca um número de fallback). */
export interface RespostaParametrosMetodo {
  parametros: Record<string, ParametroMetodo | null>;
  /** chaves pedidas sem versão ativa — para a tela nomear o que falta */
  ausentes: string[];
}

/** `GET /api/admin/parametros[?chave=]` — histórico completo (todas as versões). */
export interface RespostaAdminParametros {
  itens: ParametroMetodo[];
}

/** Corpo de `POST /api/admin/parametros` — cria versão nova (INSERT), nunca
 * edita valor. `ativar: true` chama `ativar_parametro_metodo` na sequência. */
export interface CorpoCriarParametro {
  chave: string;
  valor: number;
  unidade: UnidadeParametro;
  uf?: string | null;
  municipio?: string | null;
  base_legal?: string | null;
  vigente_de?: string;
  notas?: string | null;
  ativar?: boolean;
}

// ---------------------------------------------------------------------------
// 0057 — cenarios_patrimoniais + cenario_rubricas
// ---------------------------------------------------------------------------

export const TIPOS_CENARIO = [
  "inventario",
  "doacao",
  "holding_1_celula",
  "holding_2_celulas",
  "holding_3_celulas",
] as const;
export type TipoCenario = (typeof TIPOS_CENARIO)[number];

export const ROTULO_CENARIO: Record<TipoCenario, string> = {
  inventario: "Inventário",
  doacao: "Doação em vida",
  holding_1_celula: "Holding · 1 célula",
  holding_2_celulas: "Holding · 2 células",
  holding_3_celulas: "Holding · 3 células",
};

export type ProcedenciaValor = "calculado" | "digitado" | "ausente";

export interface CenarioPatrimonial {
  id: string;
  jornada_id: string;
  cenario: TipoCenario;
  nota: string | null;
  criado_em: string;
  atualizado_em: string;
  criado_por: string | null;
  atualizado_por: string | null;
}

export interface CenarioRubrica {
  id: string;
  cenario_id: string;
  rubrica: string;
  ordem: number;
  procedencia: ProcedenciaValor;
  valor: number | null;
  base_calculo: number | null;
  aliquota: number | null;
  /** carimbo: versão de `parametros_metodo` que multiplicou (só `calculado`) */
  parametro_id: string | null;
  nota: string | null;
  criado_em: string;
  atualizado_em: string;
  atualizado_por: string | null;
}

/** Linha de `vw_cenarios_totais`. `total` é `null` enquanto qualquer rubrica
 * estiver `ausente` — a tela diz "faltam N rubricas", nunca soma parcial. */
export interface CenarioTotais {
  cenario_id: string;
  jornada_id: string;
  cenario: TipoCenario;
  /** `null` enquanto qualquer rubrica de `configuracoes['cenario.rubricas']` não existir ou estiver `ausente` (0060). */
  total: number | null;
  rubricas_total: number;
  /** Quantas rubricas travam o total (padrão não gravada ∪ gravada como `ausente`, 0060). */
  rubricas_ausentes: number;
  tem_calculado: boolean;
  atualizado_em: string;
  /** 0060 — nomes das rubricas que travam o total. `undefined` = banco ainda na 0057. */
  rubricas_faltantes?: string[];
  /** 0060 — quantas rubricas a config pede. */
  rubricas_padrao?: number;
}

/** `GET /api/jornadas/[id]/cenario` */
export interface RespostaCenarioJornada {
  /** cabeçalhos existentes (só os cenários que a advogada já tocou) */
  cenarios: CenarioPatrimonial[];
  rubricas: CenarioRubrica[];
  totais: CenarioTotais[];
  /** `configuracoes['cenario.rubricas']` — chaves de tela (B37); vazio se a config não existir */
  rubricas_padrao: string[];
  /** parâmetros carimbados nas rubricas `calculado` (para tooltip "alíquota X% · v2 · base legal") */
  parametros: Record<string, ParametroMetodo>;
  tipos: readonly TipoCenario[];
}

/** Corpo de `PUT /api/jornadas/[id]/cenario` — grava UMA célula (upsert por
 * `cenario × rubrica`). O cabeçalho do cenário é criado se não existir.
 * - `digitado`  → `valor` obrigatório
 * - `calculado` → `base_calculo` + `parametro_id` obrigatórios; `valor` e
 *                 `aliquota` vêm do banco (trigger), nunca do corpo
 * - `ausente`   → só limpa */
export interface CorpoGravarRubrica {
  cenario: TipoCenario;
  rubrica: string;
  procedencia: ProcedenciaValor;
  valor?: number | null;
  base_calculo?: number | null;
  parametro_id?: string | null;
  nota?: string | null;
  ordem?: number;
}

export interface RespostaGravarRubrica {
  cenario: CenarioPatrimonial;
  rubrica: CenarioRubrica;
  totais: CenarioTotais | null;
}

// ---------------------------------------------------------------------------
// 0058 — diagnosticos_sv
// ---------------------------------------------------------------------------

export const CHAVES_BLOCO_DIAGNOSTICO = [
  "situacao_familiar",
  "mapa_patrimonial",
  "riscos_identificados",
  "cenario_patrimonial",
  "arquitetura_recomendada",
  "proximos_passos",
  "o_que_falta",
] as const;
export type ChaveBlocoDiagnostico = (typeof CHAVES_BLOCO_DIAGNOSTICO)[number];

/** Mesmo vocabulário de `SlideAnalise` (schema-analise-v2.ts) + o toggle B31.
 * `o_que_falta` nunca pode ser `visivel_ao_cliente` (CHECK no banco). */
export interface BlocoDiagnostico {
  chave: ChaveBlocoDiagnostico | string;
  titulo: string;
  conteudo: string;
  pontos: string[];
  fontes: string[];
  categoria: CategoriaAfirmacao;
  visivel_ao_cliente: boolean;
}

export interface DiagnosticoSv {
  id: string;
  jornada_id: string;
  versao: number;
  analise_id: string | null;
  blocos: BlocoDiagnostico[];
  atual: boolean;
  aprovado_por: string | null;
  aprovado_em: string | null;
  criado_em: string;
  atualizado_em: string;
  criado_por: string | null;
  atualizado_por: string | null;
}

export type DiagnosticoSvResumo = Omit<DiagnosticoSv, "blocos">;

/** `GET /api/jornadas/[id]/diagnostico` */
export interface RespostaDiagnosticoJornada {
  atual: DiagnosticoSv | null;
  historico: DiagnosticoSvResumo[];
}

/** `POST /api/jornadas/[id]/diagnostico` → `{ diagnostico }` (versão nova, 201).
 * `PATCH` → `{ diagnostico }`; corpo abaixo. Edita só a versão atual. */
export interface CorpoEditarDiagnostico {
  /** substitui o texto/pontos/visibilidade dos blocos informados (por `chave`) */
  blocos?: Array<Partial<Omit<BlocoDiagnostico, "chave">> & { chave: string }>;
  /** atalho: `{ chave: boolean }` só para o toggle "Visível ao cliente" */
  visibilidade?: Record<string, boolean>;
  /** `true` carimba `aprovado_por/em` com o usuário atual */
  aprovar?: boolean;
}

// ---------------------------------------------------------------------------
// Ofertas (rota já existente, agora lendo preço do parâmetro)
// ---------------------------------------------------------------------------

/** Bloco `preco` de `GET /api/jornadas/[id]/ofertas`. Sem parâmetro ativo →
 * `null` + chave em `parametro_ausente`; a tela mostra `<SeloStub>`. */
export interface PrecoCroqui {
  padrao: number | null;
  incentivo: number | null;
  parametro_ausente: string[];
}
