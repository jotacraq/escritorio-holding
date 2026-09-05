/**
 * Tipos do banco Postgres do SIC-HF, escritos à mão a partir das migrations
 * (`supabase/migrations/0001-0008, 0014-0016` — domínio deste agente; os demais
 * campos vêm do plano em `docs/ARQUITETURA.md` §2.9-2.13, de propriedade de outro agente).
 *
 * Não é um `Database` gerado pelo Supabase CLI (sem MCP disponível para introspectar
 * o projeto remoto neste ambiente). São interfaces de linha (`Row`) usadas para tipar
 * o retorno de `.select()` via cast explícito — os clientes de
 * `src/lib/supabase/{server,browser}.ts` não são genéricos em `Database`.
 *
 * Manter em sincronia com o schema é responsabilidade de quem migra.
 */

// ---------------------------------------------------------------------------
// Enums (espelham os `create type ... as enum` de 0001)
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

export type TrilhaJornada = "seminario" | "preliminar";

export type OrigemLead = "seminario" | "indicacao" | "organico" | "trafego_pago" | "outro";

export type ProdutoTipo = "sessao_viabilidade" | "croqui_estrutural" | "holding";

export type StatusPagamento =
  | "pendente"
  | "em_analise"
  | "aprovado"
  | "cancelado"
  | "estornado"
  | "reembolsado";

export type TipoBem = "imovel" | "veiculo" | "investimento" | "previdencia" | "empresa" | "outro";

export type StatusAgendamento =
  | "agendado"
  | "confirmado"
  | "realizado"
  | "nao_compareceu"
  | "cancelado"
  | "remarcado";

export type CanalMensagem = "email" | "whatsapp";

export type StatusMensagem = "pendente" | "enviando" | "enviada" | "falhou" | "cancelada";

export type StatusExecucaoIa = "pendente" | "executando" | "concluida" | "falhou";

export type StatusCroqui = "rascunho" | "pronto" | "apresentado";

export type TipoConsentimento =
  | "gravacao_sessao"
  | "tratamento_ia"
  | "comunicacao_email"
  | "comunicacao_whatsapp"
  | "pesquisa_fontes_publicas";

export type OrigemDado = "real" | "exemplo";

// ---------------------------------------------------------------------------
// 0002 — equipe
// ---------------------------------------------------------------------------

export interface PerfilEquipe {
  id: string;
  auth_user_id: string | null;
  email: string;
  nome: string;
  papel: PapelEquipe;
  ativo: boolean;
  criado_em: string;
  atualizado_em: string;
  criado_por: string | null;
  /** 0052 — quando a pessoa dispensou o tour de primeira vez. `null` = ainda não. */
  onboarding_visto_em?: string | null;
}

// ---------------------------------------------------------------------------
// 0003 — pessoas, edições, participações
// ---------------------------------------------------------------------------

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
  ativo: boolean;
  auth_user_id: string | null;
  origem_dado: OrigemDado;
  criado_em: string;
  atualizado_em: string;
  criado_por: string | null;
  atualizado_por: string | null;
}

export interface EdicaoSeminario {
  id: string;
  codigo: string;
  nome: string;
  inicio_em: string;
  fim_em: string;
  ativa: boolean;
  origem_dado: OrigemDado;
  criado_em: string;
  atualizado_em: string;
}

export interface ParticipacaoSeminario {
  id: string;
  pessoa_id: string;
  edicao_id: string;
  origem: OrigemLead;
  dias_assistidos: number | null;
  registrado_em: string;
  criado_em: string;
}

// ---------------------------------------------------------------------------
// 0004 — jornadas e máquina de estados
// ---------------------------------------------------------------------------

export interface EtapaJornadaOrdem {
  etapa: EtapaJornada;
  ordem: number;
  rotulo: string;
  cor: string;
}

export interface TransicaoPermitida {
  de: EtapaJornada;
  para: EtapaJornada;
}

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
  origem_dado: OrigemDado;
  entrou_na_etapa_em: string;
  criado_em: string;
  atualizado_em: string;
  criado_por: string | null;
  atualizado_por: string | null;
}

export interface JornadaTransicao {
  id: string;
  jornada_id: string;
  de_etapa: EtapaJornada | null;
  para_etapa: EtapaJornada | null;
  de_desfecho: DesfechoJornada | null;
  para_desfecho: DesfechoJornada | null;
  motivo: string | null;
  ator_perfil_id: string | null;
  ator_tipo: "humano" | "sistema" | "ia";
  ocorrido_em: string;
}

// ---------------------------------------------------------------------------
// 0005 — consentimentos
// ---------------------------------------------------------------------------

export interface Consentimento {
  id: string;
  pessoa_id: string;
  tipo: TipoConsentimento;
  concedido: boolean;
  texto_apresentado: string;
  versao_texto: string;
  canal: string;
  registrado_por: string | null;
  concedido_em: string;
  revogado_em: string | null;
  criado_em: string;
}

// ---------------------------------------------------------------------------
// 0006 — formulário (POP 02) e ligação (POP 03/03-B)
// ---------------------------------------------------------------------------

export interface Formulario {
  id: string;
  chave: string;
  versao: number;
  definicao: unknown; // jsonb — ver PerguntaFormulario para o shape esperado
  ativo: boolean;
  criado_em: string;
}

export interface PerguntaFormulario {
  id: string;
  bloco: string;
  tipo: "texto" | "texto_longo" | "numero" | "unica" | "multipla" | "sim_nao";
  rotulo: string;
  opcoes?: string[];
  condicional?: { depende_de: string; contem?: string };
}

export interface FormularioResposta {
  id: string;
  jornada_id: string;
  formulario_id: string;
  respostas: Record<string, unknown>;
  origem: "sistema" | "typeform" | "importado";
  origem_dado: OrigemDado;
  respondido_em: string;
  criado_em: string;
}

export type Ritmo = "rapido" | "moderado" | "pausado";
export type EstiloResposta = "muito_objetiva" | "objetiva" | "detalhada" | "conta_historias";
export type ProcessoDecisorio =
  | "influenciador"
  | "comunicador"
  | "decisor_conjunto"
  | "decide_sozinho";

export interface LigacaoEstrategica {
  id: string;
  jornada_id: string;
  pop: "03" | "03-B";
  realizada_em: string;
  duracao_segundos: number | null;
  colaborador_id: string | null;
  respostas: Record<string, unknown>;
  expectativa_principal: string | null;
  preocupacao_principal: string | null;
  assunto_atencao_especial: string | null;
  objecoes_percebidas: string[] | null;
  pessoas_mencionadas: string[] | null;
  ritmo: Ritmo | null;
  estilo_resposta: EstiloResposta | null;
  sinais: string[] | null;
  frases_marcantes: string[] | null;
  processo_decisorio: ProcessoDecisorio | null;
  decisores_presentes_na_sessao: boolean | null;
  transcricao: string | null;
  observacoes: string | null;
  origem_dado: OrigemDado;
  criado_em: string;
  atualizado_em: string;
  criado_por: string | null;
  atualizado_por: string | null;
}

// ---------------------------------------------------------------------------
// 0007 — família e patrimônio (PII sensível)
// ---------------------------------------------------------------------------

export interface Familiar {
  id: string;
  pessoa_id: string;
  registrado_na_jornada_id: string | null;
  parentesco: string;
  nome: string | null;
  idade: number | null;
  ocupacao: string | null;
  regime_casamento: string | null;
  ano_casamento: number | null;
  dependente_financeiro: boolean | null;
  observacoes: string | null;
  ativo: boolean;
  criado_em: string;
  atualizado_em: string;
}

export interface PatrimonioItem {
  id: string;
  pessoa_id: string;
  registrado_na_jornada_id: string | null;
  tipo: TipoBem;
  descricao: string;
  ano_aquisicao: number | null;
  valor_historico: number | null;
  valor_mercado: number | null;
  destinacao: string | null;
  valor_locacao_mensal: number | null;
  detalhes: Record<string, unknown>;
  ativo: boolean;
  criado_em: string;
  atualizado_em: string;
  criado_por: string | null;
  atualizado_por: string | null;
}

// ---------------------------------------------------------------------------
// 0008 — sessão, agendamento, relatório
// ---------------------------------------------------------------------------

export type OrigemLinkSala = "manual" | "n8n";

export interface SessaoViabilidade {
  id: string;
  jornada_id: string;
  advogada_id: string | null;
  link_sala: string | null;
  realizada_em: string | null;
  gravacao_url: string | null;
  resultado: "fechou" | "nao_fechou" | "indefinido" | null;
  motivo_resultado: string | null;
  criado_em: string;
  atualizado_em: string;
  /** 0051 — de onde veio `link_sala`. */
  link_sala_origem: OrigemLinkSala;
  link_sala_atualizado_em: string | null;
  /** 0051 — quando o cron pediu a sala ao n8n pela última vez. */
  sala_solicitada_em: string | null;
}

/** 0051 — como a presença foi confirmada (fato sobre o agendamento, não status). */
export type ViaPresencaConfirmada = "link" | "whatsapp" | "email" | "equipe" | "ligacao_ia";

export interface AgendamentoSessao {
  id: string;
  sessao_id: string;
  inicio_em: string;
  fim_em: string;
  status: StatusAgendamento;
  origem: "equipe" | "cliente" | "ia";
  observacoes: string | null;
  advogada_id: string | null;
  criado_em: string;
  atualizado_em: string;
  criado_por: string | null;
  /** 0051 — `null` = aguardando confirmação do cliente (C23: não confundir com `status='confirmado'`). */
  presenca_confirmada_em: string | null;
  presenca_confirmada_via: ViaPresencaConfirmada | null;
}

export interface RelatorioSessao {
  id: string;
  sessao_id: string;
  acompanhado: boolean | null;
  quem_acompanha: string | null;
  acompanhante_decide: boolean | null;
  acompanhante_assistiu: boolean | null;
  data_contratacao: string | null;
  valor_pago_sessao: number | null;
  parcelas: number | null;
  motivacao_cliente: string | null;
  receita_familiar_mensal: number | null;
  ideia_custo_inventario: string | null;
  reserva_ou_seguro: string | null;
  ciente_itcmd: boolean | null;
  preocupacao_predominante: string | null;
  como_deseja_organizar: string | null;
  motiva_evitar_inventario: string | null;
  interesse_imediato: string | null;
  relacao_filhos_terceiros: string | null;
  porque_nos_procurou: string | null;
  falta_planejamento_preocupa: string | null;
  resultado_sessao: string | null;
  tributos: Record<string, unknown>;
  consideracoes_apresentacao_croqui: string | null;
  criado_em: string;
  atualizado_em: string;
  criado_por: string | null;
  atualizado_por: string | null;
}

// ---------------------------------------------------------------------------
// 0014 — timeline
// ---------------------------------------------------------------------------

export type TipoEventoTimeline =
  | "etapa"
  | "pagamento"
  | "formulario"
  | "ligacao"
  | "briefing"
  | "agendamento"
  | "documento"
  | "mensagem"
  // `croqui` é o canal EXCLUSIVO do trigger `app.timeline_croqui` (0014):
  // todo evento deste tipo carrega `dados.status` (rascunho/pronto/apresentado),
  // e `sinaisDaFicha()` (lib/pasta/sinais.ts) deriva dele o estado do croqui na
  // Pasta e no trilho. Quem registra OUTRO fato do croqui usa um tipo próprio —
  // ver `croqui_calculo` e `croqui_exportacao` abaixo (0070).
  | "croqui"
  /** Versão do motor determinístico gravada em `croqui_calculos` (trigger `app.timeline_croqui_calculo`, 0063/0070). Sem `status`: NÃO é estado de croqui. */
  | "croqui_calculo"
  /** Relatório do croqui baixado em `.docx` (`api/croquis/[id]/docx`, 0070). Sem `status`: NÃO é estado de croqui. */
  | "croqui_exportacao"
  /** Narrativa v3 da IA gravada em `croqui_narrativas` (trigger `app.timeline_croqui_narrativa`, 0070). */
  | "croqui_narrativa"
  | "patrimonio"
  | "familia"
  | "relatorio"
  | "nota"
  | "importacao"
  | "cenario"
  | "diagnostico";

export interface EventoTimeline {
  id: string;
  jornada_id: string;
  tipo: TipoEventoTimeline;
  titulo: string;
  descricao: string | null;
  dados: Record<string, unknown>;
  ator_perfil_id: string | null;
  ator_tipo: "humano" | "sistema" | "ia";
  ocorrido_em: string;
}

// ---------------------------------------------------------------------------
// 0015 — views
// ---------------------------------------------------------------------------

export interface JornadaKanbanLinha {
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
  origem_dado: OrigemDado;
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
  // --- 0052: sinais de "próximo passo" (F6 §6.2). Campo ausente = view antiga; nunca inventar. ---
  /** Presença do PRÓXIMO agendamento ativo (o mesmo de `proxima_sessao_em`). */
  presenca_confirmada_em?: string | null;
  sessao_realizada_em?: string | null;
  tem_relatorio?: boolean;
  croqui_status?: StatusCroqui | null;
  material_estado?: EstadoMaterialKanban;
  tarefas_abertas?: TarefaAbertaKanban[];
}

export type EstadoMaterialKanban = "nenhum" | "rascunho" | "aprovado";

export interface TarefaAbertaKanban {
  tipo: string | null;
  responsavel_papel: PapelEquipe | null;
}

export interface IndicadorEsteiraLinha {
  edicao_id: string | null;
  sessoes_contratadas: number;
  sessoes_realizadas: number;
  croquis_contratados: number;
  holdings: number;
  formularios_respondidos: number;
  ligacoes_feitas: number;
}

// ---------------------------------------------------------------------------
// Tabelas de outro agente (0009-0013) — shape mínimo, só o que a Ficha 360 lê.
// Fonte da verdade real é o agente de IA/produto; manter isto em sincronia é
// responsabilidade de quem tocar aquelas migrations.
// ---------------------------------------------------------------------------

export interface BriefingResumo {
  id: string;
  jornada_id: string;
  execucao_id: string;
  versao: number;
  conteudo: Record<string, unknown>;
  grau_confianca: number | null;
  fontes_usadas: string[];
  atual: boolean;
  criado_em: string;
}

export interface CroquiResumo {
  id: string;
  jornada_id: string;
  versao: number;
  titulo: string;
  status: StatusCroqui;
  criado_em: string;
  atualizado_em: string;
}

export interface DocumentoMetadado {
  id: string;
  pessoa_id: string;
  jornada_id: string | null;
  tipo: "imposto_renda" | "contrato_social" | "matricula_imovel" | "outro";
  nome_arquivo: string;
  mime: string;
  tamanho_bytes: number;
  criado_em: string;
}

// ---------------------------------------------------------------------------
// 0027 + 0051 — tarefas (POP 07 + tarefa assistida "Enviar link do croqui")
// ---------------------------------------------------------------------------

/** Chaves de máquina conhecidas; `tipo` no banco é texto livre `^[a-z_]{3,60}$` (outros agentes podem criar as suas). */
export type TipoTarefaConhecido = "enviar_link_croqui" | "ligar_para_agendar";

export interface Tarefa {
  id: string;
  jornada_id: string;
  tipo: string | null;
  titulo: string;
  descricao: string | null;
  responsavel_id: string | null;
  vence_em: string | null;
  concluida_em: string | null;
  concluida_por: string | null;
  origem: "manual" | "sistema";
  criado_em: string;
  criado_por: string | null;
}

// ---------------------------------------------------------------------------
// Tabelas de OUTROS agentes da Fase 4 (podem não existir ainda no banco) —
// shape mínimo que a Ficha 360 lê. `montarFicha360` é tolerante: tabela
// ausente vira `null`/`[]`, nunca derruba a ficha.
// ---------------------------------------------------------------------------

/** `ligacoes_ia` (0053, agente B) — só o que a Ficha mostra; sem transcrição. */
export interface LigacaoIaResumo {
  id: string;
  jornada_id: string;
  provedor: "n8n" | "manual";
  status: "na_fila" | "discando" | "em_ligacao" | "concluida" | "sem_resposta" | "falhou" | "cancelada";
  tentativa: number;
  resultado: "agendou" | "recusou" | "pediu_retorno" | "caixa_postal" | "numero_invalido" | "manual" | null;
  horario_escolhido: string | null;
  agendamento_id: string | null;
  disparada_em: string | null;
  encerrada_em: string | null;
  resumo: string | null;
  erro: string | null;
  criado_em: string;
}

/**
 * `diagnosticos_sv` (0058) e Cenário Patrimonial (0057) são do agente D: os
 * tipos vivem em `src/types/cenario.ts` (`DiagnosticoSv`, `CenarioPatrimonial`,
 * `CenarioRubrica`, `CenarioTotais`) — `Ficha360` importa de lá.
 */
