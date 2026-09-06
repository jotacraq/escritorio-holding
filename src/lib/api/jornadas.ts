/** Esteira: a jornada, a pessoa, o kanban e a Ficha 360 (o payload que junta tudo). */
import { chamar, chamarOpcional, paraQueryString } from "./nucleo";
import type { Agendamento } from "./agenda";
import type { BriefingResumo } from "./briefings";
import type { Documento } from "./documentos";
import type { FormularioResposta } from "./formularios";
import type { LigacaoEstrategica } from "./ligacoes";
import type { Familiar, PatrimonioItem } from "./patrimonio";
import type { RelatorioSessao, SessaoViabilidade } from "./sessoes";
import type { MaterialGeradoResumo } from "@/types/material";
import type { LigacaoIaResumo, Tarefa } from "@/types/banco";
import type { CenarioPatrimonial, CenarioRubrica, CenarioTotais, DiagnosticoSv } from "@/types/cenario";

export type EtapaJornada =
  | "captado"
  | "qualificado"
  | "sessao_contratada"
  | "sessao_agendada"
  | "sessao_realizada"
  | "croqui_contratado"
  | "croqui_apresentado"
  | "holding_contratada";

export type DesfechoJornada = "aberta" | "ganha" | "perdida" | "descartada" | "congelada" | "anonimizada";
export type OrigemLead = "seminario" | "indicacao" | "organico" | "trafego_pago" | "outro";
export type TrilhaJornada = "seminario" | "preliminar";

export interface EtapaOrdem {
  etapa: EtapaJornada;
  ordem: number;
  rotulo: string;
  cor: string;
}

export interface JornadaKanban {
  id: string;
  etapa: EtapaJornada;
  desfecho: DesfechoJornada;
  origem: OrigemLead;
  trilha: TrilhaJornada;
  edicao_id: string | null;
  edicao_codigo: string | null;
  faixa_patrimonio_declarada: string | null;
  nivel_pago: 0 | 1 | 2 | 3;
  responsavel_id: string | null;
  pessoa_id: string;
  nome: string;
  cidade: string | null;
  uf: string | null;
  telefone: string | null;
  email: string | null;
  entrou_na_etapa_em: string;
  dias_na_etapa: number;
  tem_formulario: boolean;
  tem_ligacao: boolean;
  tem_briefing: boolean;
  proxima_sessao_em: string | null;
  /** presente quando a linha vem do seed de desenvolvimento (`origem_dado='exemplo'`) */
  origem_dado?: "real" | "exemplo";
}

export interface FiltrosJornadas {
  etapa?: EtapaJornada;
  edicao_id?: string;
  origem?: OrigemLead;
  responsavel_id?: string;
  busca?: string;
  desfecho?: DesfechoJornada;
  /** Sem isto (e sem `desfecho`), o backend só devolve jornadas abertas. */
  incluir_fechadas?: boolean;
  pagina?: number;
}

export interface Pessoa {
  id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  cidade: string | null;
  uf: string | null;
  profissao: string | null;
  faixa_etaria: string | null;
  estado_civil: string | null;
  observacoes: string | null;
}

export interface EventoTimeline {
  id: string;
  tipo: string;
  titulo: string;
  descricao: string | null;
  dados?: Record<string, unknown>;
  ator_tipo: "humano" | "sistema" | "ia";
  ocorrido_em: string;
}

/** Linha crua da tabela `jornadas` — não confundir com `JornadaKanban` (a view, com pessoa/edição já juntadas). */
export interface Jornada {
  id: string;
  pessoa_id: string;
  edicao_id: string | null;
  origem: OrigemLead;
  trilha: TrilhaJornada;
  etapa: EtapaJornada;
  desfecho: DesfechoJornada;
  motivo_desfecho: string | null;
  nivel_pago: 0 | 1 | 2 | 3;
  faixa_patrimonio_declarada: string | null;
  responsavel_id: string | null;
  origem_dado: "real" | "exemplo";
  entrou_na_etapa_em: string;
}

/** Espelha `server/jornadas.montarFicha360` — ver GET /api/jornadas/[id]. */
export interface Ficha360 {
  jornada: Jornada;
  pessoa: Pessoa;
  formulario: FormularioResposta | null;
  ligacao: LigacaoEstrategica | null;
  briefingAtual: BriefingResumo | null;
  sessao: SessaoViabilidade | null;
  relatorio: RelatorioSessao | null;
  agendamentos: Agendamento[];
  documentos: Documento[];
  timeline: EventoTimeline[];
  /** null quando o papel do usuário não permite ver patrimônio — nunca "escondido depois". */
  patrimonio: PatrimonioItem[] | null;
  familiares: Familiar[] | null;
  /** Material pós-sessão atual, sem `conteudo` (payload leve). `null` = jornada
   * nunca gerou material. Usado por `derivarPasta()` (`lib/pasta/derivar.ts`). */
  materialAtual: Omit<MaterialGeradoResumo, "chave_modelo"> | null;
  // --- Fase 4 (0053/0057/0058, `server/jornadas.ts`). Carregados de forma
  // tolerante: tabela ausente no banco vira `null`/`[]`, nunca derruba a ficha. ---
  /** `diagnosticos_sv` atual — mesma forma de `GET /api/jornadas/[id]/diagnostico`.atual. `null` sem `ve_patrimonio`. */
  diagnosticoAtual: DiagnosticoSv | null;
  /** Cenário Patrimonial — mesma forma de `GET /api/jornadas/[id]/cenario` (sem `rubricas_padrao`/`parametros`). `null` sem permissão. */
  cenarios: { cenarios: CenarioPatrimonial[]; rubricas: CenarioRubrica[]; totais: CenarioTotais[] } | null;
  /** Última `ligacoes_ia` da jornada, sem transcrição. */
  ligacaoIaAtual: LigacaoIaResumo | null;
  /** `tarefas` abertas (ex.: `tipo='enviar_link_croqui'`). */
  tarefasAbertas: Tarefa[];
  /**
   * Fase 6 §6.3 — configuração de UI lida de `configuracoes` (RLS `cfg_sel`,
   * 0027:174). **Nada de segredo aqui**, e só a chave que a tela precisa:
   * `ligacaoIaAtiva === (configuracoes['ligacao_ia.provedor'] === 'n8n')`.
   * `false` (o estado de hoje) esconde o cartão da ligação por IA — sem
   * esconder a tarefa HUMANA de ligar para agendar, que é outra coisa.
   */
  configuracoesUi: { ligacaoIaAtiva: boolean };
}

/** ASSUMIDO — não há rota dedicada em §3; F2 exige colunas vindas do banco. */
export function buscarEtapasOrdem() {
  return chamarOpcional<EtapaOrdem[]>("/api/etapas");
}

export function listarJornadas(filtros: FiltrosJornadas) {
  return chamar<{ itens: JornadaKanban[]; total: number }>(`/api/jornadas${paraQueryString(filtros as Record<string, string | number | boolean | undefined>)}`);
}

export function criarJornada(payload: {
  pessoa: { nome: string; email?: string; telefone?: string; cidade?: string; uf?: string };
  edicao_id?: string;
  origem: OrigemLead;
  trilha: TrilhaJornada;
}) {
  return chamar<{ jornada_id: string }>("/api/jornadas", { method: "POST", body: JSON.stringify(payload) });
}

export function buscarFicha360(id: string) {
  return chamar<Ficha360>(`/api/jornadas/${id}`);
}

export function atualizarEtapa(id: string, payload: { etapa?: EtapaJornada; desfecho?: DesfechoJornada; motivo?: string }) {
  return chamar<{ jornada: JornadaKanban }>(`/api/jornadas/${id}/etapa`, { method: "PATCH", body: JSON.stringify(payload) });
}
