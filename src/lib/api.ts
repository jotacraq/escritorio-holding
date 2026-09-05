/**
 * Camada de acesso à API do SIC-HF.
 *
 * Regra do projeto: nunca inventar dado que pareça real. Toda função aqui tipa
 * o contrato documentado em docs/ARQUITETURA.md §3 e propaga erro — quem chama
 * decide o estado de tela (carregando / vazio / erro), nunca um mock.
 *
 * Endpoints marcados "ASSUMIDO" não estão na tabela de contratos da arquitetura,
 * mas são exigidos pelas telas F2/F7/F8/F10. Foram inferidos das policies de RLS
 * já desenhadas (ex.: `ma_upd` em mensagens_agendadas só faz sentido se existir
 * rota para acioná-la). Se o backend expuser caminho diferente, ajustar só aqui.
 * Falha desses (404/501) é tratada como "recurso indisponível", nunca mock.
 */

import type { MaterialGeradoResumo } from "@/types/material";
import type { LigacaoIaResumo, OrigemLinkSala, Tarefa, ViaPresencaConfirmada } from "@/types/banco";
import type { CenarioPatrimonial, CenarioRubrica, CenarioTotais, DiagnosticoSv } from "@/types/cenario";
import type { DocumentoTipoRadar } from "@/types/jornada-automacoes";

// ---------------------------------------------------------------------------
// Tipos de domínio (espelham docs/ARQUITETURA.md §1–§2 — nomes do Glossário)
// ---------------------------------------------------------------------------

export type PapelEquipe = "admin" | "advogada" | "relacionamento" | "assistente";

export type EtapaJornada =
  | "captado"
  | "qualificado"
  | "sessao_contratada"
  | "sessao_agendada"
  | "sessao_realizada"
  | "croqui_contratado"
  | "croqui_apresentado"
  | "holding_contratada";

export type DesfechoJornada = "aberta" | "ganha" | "perdida" | "descartada" | "congelada";
export type OrigemLead = "seminario" | "indicacao" | "organico" | "trafego_pago" | "outro";
export type TrilhaJornada = "seminario" | "preliminar";
export type StatusAgendamento = "agendado" | "confirmado" | "realizado" | "nao_compareceu" | "cancelado" | "remarcado";
export type CanalMensagem = "email" | "whatsapp";
export type StatusMensagem = "pendente" | "enviando" | "enviada" | "falhou" | "cancelada";
export type StatusExecucaoIA = "pendente" | "executando" | "concluida" | "falhou";
export type StatusCroqui = "rascunho" | "pronto" | "apresentado";

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

export interface FormularioDefinicaoPergunta {
  id: string;
  bloco: string;
  tipo: "texto" | "texto_longo" | "unica" | "multipla" | "numero" | "sim_nao";
  rotulo: string;
  opcoes?: string[];
  obrigatoria?: boolean;
  /** Nomes de campo como gravados em `formularios.definicao` (ver seed 0016). */
  condicional?: { depende_de: string; contem?: string; igual?: string };
}

export interface Formulario {
  id: string;
  chave: string;
  versao: number;
  definicao: FormularioDefinicaoPergunta[];
}

export interface FormularioResposta {
  id: string;
  formulario_id: string;
  respostas: Record<string, unknown>;
  origem: "sistema" | "typeform" | "importado";
  respondido_em: string;
}

export interface FormularioComResposta {
  formulario: Formulario;
  resposta: FormularioResposta | null;
}

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

export interface PatrimonioItem {
  id: string;
  tipo: "imovel" | "veiculo" | "investimento" | "previdencia" | "empresa" | "outro";
  descricao: string;
  ano_aquisicao: number | null;
  valor_historico: number | null;
  valor_mercado: number | null;
  destinacao: string | null;
  valor_locacao_mensal: number | null;
  detalhes: Record<string, unknown>;
}

export interface Agendamento {
  id: string;
  sessao_id: string;
  jornada_id?: string;
  pessoa_nome?: string;
  inicio_em: string;
  fim_em: string;
  status: StatusAgendamento;
  origem: "equipe" | "cliente" | "ia";
  observacoes: string | null;
  advogada_id?: string | null;
  /** 0051 (Fase 4). Opcionais: `undefined` = coluna ainda não existe no banco
   * (as telas checam `hasOwnProperty`); `null` = aguardando confirmação do
   * cliente — não confundir com `status='confirmado'` (C23). */
  presenca_confirmada_em?: string | null;
  presenca_confirmada_via?: ViaPresencaConfirmada | null;
}

export interface SessaoViabilidade {
  id: string;
  jornada_id: string;
  advogada_id: string | null;
  link_sala: string | null;
  realizada_em: string | null;
  resultado: "fechou" | "nao_fechou" | "indefinido" | null;
  motivo_resultado: string | null;
  /** 0051 (Fase 4) — opcionais pelo mesmo motivo de `Agendamento.presenca_*`. */
  link_sala_origem?: OrigemLinkSala;
  link_sala_atualizado_em?: string | null;
  sala_solicitada_em?: string | null;
}

export interface RelatorioSessao {
  id: string;
  sessao_id: string;
  [campo: string]: unknown;
}

export interface Documento {
  id: string;
  /** Os 10 valores do CHECK depois da 0065 (radar de documentos, §8.3). */
  tipo: DocumentoTipoRadar;
  nome_arquivo: string;
  mime: string;
  tamanho_bytes: number;
  criado_em: string;
  /**
   * A qual bem/familiar o documento pertence (`patrimonio_itens.id` /
   * `familiares.id`), coluna da 0065. `undefined` quando o payload é de um
   * servidor anterior à migration; `null` quando o documento não tem item.
   */
  item_ref?: string | null;
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

export interface Familiar {
  id: string;
  pessoa_id: string;
  parentesco: string;
  nome: string | null;
  idade: number | null;
  ocupacao: string | null;
  regime_casamento: string | null;
  dependente_financeiro: boolean | null;
  observacoes: string | null;
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

export interface BriefingResumo {
  id: string;
  jornada_id: string;
  versao: number;
  grau_confianca: number | null;
  fontes_usadas: string[];
  atual: boolean;
  criado_em: string;
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

export interface CroquiSlide {
  id: string;
  tipo:
    | "legado"
    | "controle"
    | "familia"
    | "patrimonio"
    | "risco"
    | "alternativas"
    | "celula_1"
    | "celula_2"
    | "celula_3"
    | "controle_arquitetura"
    | "economia"
    | "implementacao"
    | "investimento";
  titulo: string;
  conteudo: string;
  objetivo?: string;
  pergunta_ao_cliente?: string;
  /** Campos ADITIVOS (ARQUITETURA-FASE-3.md §3.3, `SlideCroquiSchema` em
   * `src/server/ia/schema-croqui-slides.ts`, onda 2/agente E — pedido
   * explícito para o agente H editar aqui). Croquis gravados antes desta
   * mudança continuam válidos: chaves ausentes, nunca `undefined`
   * obrigatório. `revisado` ausente conta como `false` no trigger de banco
   * (0043) — nunca `true` por omissão. */
  origem?: "metodo" | "ia" | "humano";
  revisado?: boolean;
  como_apresentar?: string;
  categoria?: "fato_declarado" | "dado_documental" | "inferencia" | "ponto_a_validar";
  fontes?: string[];
  pontos?: string[];
  grafico?: string;
}

export interface Croqui {
  id: string;
  jornada_id: string;
  versao: number;
  titulo: string;
  status: StatusCroqui;
  conteudo: { slides: CroquiSlide[] };
}

export interface IndicadoresEdicao {
  edicao_id: string | null;
  edicao_codigo: string | null;
  edicao_nome: string | null;
  jornadas: number;
  sessoes_contratadas: number;
  sessoes_realizadas: number;
  croquis_contratados: number;
  holdings: number;
  formularios_respondidos: number;
  ligacoes_feitas: number;
}

export interface MembroEquipe {
  id: string;
  nome: string;
  papel: PapelEquipe;
  ativo: boolean;
}

// ---------------------------------------------------------------------------
// Núcleo HTTP
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  status: number;
  codigo?: string;
  /** Payload estruturado do erro (ex.: checklist da porta de completude do Briefing, `erro.detalhe` em `server/ia/erros.ts`). */
  detalhe?: unknown;
  constructor(mensagem: string, status: number, codigo?: string, detalhe?: unknown) {
    super(mensagem);
    this.name = "ApiError";
    this.status = status;
    this.codigo = codigo;
    this.detalhe = detalhe;
  }
}

/** Indica que o recurso não está disponível no backend ainda (contrato assumido). */
export class RecursoIndisponivelError extends ApiError {}

export async function chamar<T>(caminho: string, init?: RequestInit): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(caminho, {
      credentials: "include",
      ...init,
      headers: {
        ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError("Sem conexão com o servidor. Verifique a rede e tente de novo.", 0, "rede");
  }

  const texto = await resposta.text();
  let corpo: unknown = null;
  if (texto) {
    try {
      corpo = JSON.parse(texto);
    } catch {
      corpo = null;
    }
  }

  if (!resposta.ok) {
    // `respostaErro` (server/erros.ts) devolve { erro: <código técnico>, mensagem: <texto humano> }.
    // A mensagem humana tem que vencer — senão a tela mostra o código cru
    // ("nao_encontrado") em vez do texto pensado para o usuário. `objeto.erro`
    // vira o campo `codigo` da ApiError, não o texto exibido. `detalhe` (singular,
    // `POST /api/briefings/gerar`) carrega o checklist da porta de completude.
    // `detalhes` (plural) é o do `respostaErro` genérico (server/erros.ts:135)
    // e passa a ser repassado também (05/09/2026, Fase 5 M4): sem isso, o 409
    // `parametro_ausente` do croqui chegava à tela sem a lista de chaves, e a
    // advogada via "erro ao salvar" no lugar de "falta o ITCMD de MG".
    const objeto = (corpo ?? {}) as {
      erro?: string;
      mensagem?: string;
      codigo?: string;
      detalhe?: unknown;
      detalhes?: unknown;
    };
    const mensagem = objeto.mensagem || `Falha na requisição (${resposta.status})`;
    throw new ApiError(mensagem, resposta.status, objeto.codigo ?? objeto.erro, objeto.detalhe ?? objeto.detalhes);
  }

  return corpo as T;
}

/** Para endpoints assumidos: 404/501 vira "indisponível" em vez de erro fatal. */
async function chamarOpcional<T>(caminho: string, init?: RequestInit): Promise<T | null> {
  try {
    return await chamar<T>(caminho, init);
  } catch (erro) {
    if (erro instanceof ApiError && (erro.status === 404 || erro.status === 501)) {
      return null;
    }
    throw erro;
  }
}

function paraQueryString(params: Record<string, string | number | boolean | undefined>): string {
  const busca = new URLSearchParams();
  for (const [chave, valor] of Object.entries(params)) {
    if (valor !== undefined && valor !== "") busca.set(chave, String(valor));
  }
  const texto = busca.toString();
  return texto ? `?${texto}` : "";
}

// ---------------------------------------------------------------------------
// Esteira / jornadas
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Formulário (POP 02) e Ligação (POP 03)
// ---------------------------------------------------------------------------

export function buscarFormulario(jornadaId: string) {
  return chamar<FormularioComResposta>(`/api/jornadas/${jornadaId}/formulario`);
}

export function salvarFormulario(jornadaId: string, payload: { formulario_id: string; respostas: Record<string, unknown> }) {
  return chamar<{ resposta: FormularioResposta }>(`/api/jornadas/${jornadaId}/formulario`, { method: "PUT", body: JSON.stringify(payload) });
}

/** POST cria a primeira ligação da jornada; PUT atualiza a mais recente (backend não faz upsert). */
export function criarLigacao(jornadaId: string, payload: Partial<LigacaoEstrategica>) {
  return chamar<{ ligacao: LigacaoEstrategica }>(`/api/jornadas/${jornadaId}/ligacao`, { method: "POST", body: JSON.stringify(payload) });
}
export function atualizarLigacao(jornadaId: string, payload: Partial<LigacaoEstrategica>) {
  return chamar<{ ligacao: LigacaoEstrategica }>(`/api/jornadas/${jornadaId}/ligacao`, { method: "PUT", body: JSON.stringify(payload) });
}

// ---------------------------------------------------------------------------
// Patrimônio (admin/advogada apenas — servidor nega o resto)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Composição familiar (operacional — toda a equipe lê, ao contrário do patrimônio)
// ---------------------------------------------------------------------------

export function listarFamiliares(jornadaId: string) {
  return chamar<{ familiares: Familiar[] }>(`/api/jornadas/${jornadaId}/familiares`);
}
export function adicionarFamiliar(jornadaId: string, familiar: Omit<Familiar, "id" | "pessoa_id">) {
  return chamar<{ familiar: Familiar }>(`/api/jornadas/${jornadaId}/familiares`, { method: "POST", body: JSON.stringify(familiar) });
}

export function listarPatrimonio(jornadaId: string) {
  return chamar<{ itens: PatrimonioItem[] }>(`/api/jornadas/${jornadaId}/patrimonio`);
}
export function criarPatrimonio(jornadaId: string, item: Omit<PatrimonioItem, "id">) {
  return chamar<{ item: PatrimonioItem }>(`/api/jornadas/${jornadaId}/patrimonio`, { method: "POST", body: JSON.stringify(item) });
}
export function atualizarPatrimonio(itemId: string, item: Partial<PatrimonioItem>) {
  return chamar<{ item: PatrimonioItem }>(`/api/patrimonio/${itemId}`, { method: "PUT", body: JSON.stringify(item) });
}
export function excluirPatrimonio(itemId: string) {
  return chamar<{ ok: boolean }>(`/api/patrimonio/${itemId}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Briefing Estratégico
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Agenda
// ---------------------------------------------------------------------------

/** ASSUMIDO — F7 exige lista global de próximos agendamentos; §3 só tem criar/atualizar por jornada. */
export function listarProximosAgendamentos(params: { de?: string; ate?: string } = {}) {
  return chamarOpcional<{ itens: Agendamento[] }>(`/api/agendamentos${paraQueryString(params)}`);
}

export function criarAgendamento(jornadaId: string, payload: { inicio_em: string; fim_em: string; advogada_id?: string }) {
  return chamar<{ agendamento: Agendamento }>(`/api/jornadas/${jornadaId}/agendamentos`, { method: "POST", body: JSON.stringify(payload) });
}

export function atualizarAgendamento(id: string, payload: { status?: StatusAgendamento; inicio_em?: string; fim_em?: string }) {
  return chamar<{ agendamento: Agendamento }>(`/api/agendamentos/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}

// ---------------------------------------------------------------------------
// Documentos
// ---------------------------------------------------------------------------

/**
 * Upload de documento sensível. `itemRef` (0065) diz de QUAL bem/familiar é o
 * arquivo — sem ele o radar não casa a matrícula com o imóvel certo e o item
 * fica "a pedir" mesmo com o arquivo no Storage.
 */
export function enviarDocumento(
  pessoaId: string,
  jornadaId: string,
  arquivo: File,
  tipo: Documento["tipo"],
  aoProgredir?: (pct: number) => void,
  itemRef?: string | null,
) {
  return new Promise<{ documento_id: string }>((resolve, reject) => {
    const form = new FormData();
    form.append("arquivo", arquivo);
    form.append("pessoa_id", pessoaId);
    form.append("jornada_id", jornadaId);
    form.append("tipo", tipo);
    if (itemRef) form.append("item_ref", itemRef);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/documentos`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (evento) => {
      if (evento.lengthComputable && aoProgredir) aoProgredir(Math.round((evento.loaded / evento.total) * 100));
    };
    xhr.onload = () => {
      let corpo: { documento_id?: string; erro?: string } = {};
      try {
        corpo = JSON.parse(xhr.responseText || "{}");
      } catch {
        /* resposta sem corpo JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300 && corpo.documento_id) {
        resolve({ documento_id: corpo.documento_id });
      } else {
        reject(new ApiError(corpo.erro || `Falha no envio (${xhr.status})`, xhr.status));
      }
    };
    xhr.onerror = () => reject(new ApiError("Sem conexão com o servidor durante o envio.", 0, "rede"));
    xhr.send(form);
  });
}

export function buscarUrlAssinadaDocumento(id: string) {
  return chamar<{ url: string; expira_em: string }>(`/api/documentos/${id}/url`);
}

// ---------------------------------------------------------------------------
// Relatório da Sessão de Viabilidade
// ---------------------------------------------------------------------------

export function buscarRelatorio(jornadaId: string) {
  return chamar<{ relatorio: Record<string, unknown> | null }>(`/api/jornadas/${jornadaId}/relatorio`);
}
export function salvarRelatorio(jornadaId: string, payload: Record<string, unknown>) {
  return chamar<{ relatorio: Record<string, unknown> }>(`/api/jornadas/${jornadaId}/relatorio`, { method: "PUT", body: JSON.stringify(payload) });
}

// ---------------------------------------------------------------------------
// Croqui
// ---------------------------------------------------------------------------

/**
 * Não existe `GET /api/croquis?jornada_id=` (nem `/api/jornadas/[id]/croqui`,
 * apesar do que diz o §3 do ARQUITETURA.md — gap sinalizado pelo próprio time
 * de IA no código deles). O jeito real de achar o croqui de uma jornada é pelo
 * evento `tipo:'croqui'` que o trigger `app.timeline_croqui()` grava em
 * `eventos_timeline` (dados.croqui_id) — por isso esta função lê a timeline
 * já carregada na Ficha 360 em vez de bater outro endpoint.
 */
export function acharCroquiIdNaTimeline(timeline: EventoTimeline[]): string | null {
  const evento = timeline.find((e) => e.tipo === "croqui");
  const croquiId = evento?.dados?.croqui_id;
  return typeof croquiId === "string" ? croquiId : null;
}

export function buscarCroquiPorId(id: string) {
  return chamar<{ croqui: Croqui }>(`/api/croquis/${id}`);
}

export function criarCroqui(jornadaId: string, payload: { titulo: string; conteudo?: { slides: CroquiSlide[] } }) {
  return chamar<{ croqui: Croqui }>(`/api/croquis`, { method: "POST", body: JSON.stringify({ jornada_id: jornadaId, ...payload }) });
}
export function atualizarCroqui(croquiId: string, payload: { titulo?: string; conteudo?: { slides: CroquiSlide[] }; status?: StatusCroqui }) {
  return chamar<{ croqui: Croqui }>(`/api/croquis/${croquiId}`, { method: "PUT", body: JSON.stringify(payload) });
}
/**
 * Registra a apresentação do croqui. O `encerrar` sai com `keepalive`: ele
 * dispara junto do `router.back()`, e quando a volta é navegação de documento
 * (link aberto direto, aba nova, F5) o navegador cancelaria a requisição no
 * unload — medido no Playwright: `iniciar` gravava, `encerrar` sumia, e era
 * justamente o `encerrar` que avança a etapa `croqui_apresentado`.
 */
export function registrarApresentacaoCroqui(croquiId: string, payload: { acao: "iniciar" | "encerrar"; slides_vistos?: number }) {
  return chamar<{ apresentacao: { id: string } }>(`/api/croquis/${croquiId}/apresentacao`, {
    method: "POST",
    body: JSON.stringify(payload),
    keepalive: payload.acao === "encerrar",
  });
}

// ---------------------------------------------------------------------------
// Indicadores
// ---------------------------------------------------------------------------

export function buscarIndicadores(edicaoId?: string) {
  return chamar<{ itens: IndicadoresEdicao[] }>(`/api/indicadores${paraQueryString({ edicao_id: edicaoId })}`);
}

// ---------------------------------------------------------------------------
// Equipe (para filtros de responsável) e mensagens (fila manual de WhatsApp)
// ---------------------------------------------------------------------------

/** ASSUMIDO — necessário para o filtro "responsável" (F2) mostrar nome, não uuid. */
export function listarEquipe() {
  return chamarOpcional<{ itens: MembroEquipe[] }>("/api/equipe");
}

export function vincularAuth() {
  return chamar<{ vinculado: boolean; papel: PapelEquipe | null }>("/api/auth/vincular", { method: "POST" });
}
