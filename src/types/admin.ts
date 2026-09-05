/**
 * Tipos da área Admin (B-2B, `docs/ARQUITETURA-FASE-2.md` §4.6/§5).
 *
 * Cobre tabelas que já existiam antes da Fase 2 (`produtos` 0011,
 * `mensagens_templates` 0013, `prompts_versoes`/`modelos_ia_precos` 0009,
 * `edicoes_seminario` 0003) mais o que a 0027/0033 acrescentaram
 * (`configuracoes`, `tarefas`, `perfis_equipe.convidado_em`/`convite_enviado_em`,
 * as views de custo de IA). Mesma convenção de `src/types/banco.ts`: interface
 * de linha (`Row`), tipada à mão, usada com cast explícito no retorno de
 * `.select()` — não é um `Database` gerado.
 *
 * Import de `EdicaoSeminario`/`PapelEquipe`/`OrigemDado` de `banco.ts` em vez de
 * redefinir: são a mesma tabela/enum, e `banco.ts` é a fonte — só não é dono
 * deste arquivo (fora da fronteira deste agente, mas leitura de tipo é livre).
 */

import type { EdicaoSeminario, OrigemDado, PapelEquipe, ProdutoTipo } from "@/types/banco";

export type { EdicaoSeminario };

// ---------------------------------------------------------------------------
// Equipe (perfis_equipe) — convite (CONFLITO C15)
// ---------------------------------------------------------------------------

export interface PerfilEquipeAdmin {
  id: string;
  auth_user_id: string | null;
  email: string;
  nome: string;
  papel: PapelEquipe;
  ativo: boolean;
  convidado_em: string | null;
  convite_enviado_em: string | null;
  criado_em: string;
  atualizado_em: string;
  criado_por: string | null;
}

/** Resultado da tentativa de envio do e-mail de convite — nunca finge sucesso. */
export type ResultadoConviteEmail =
  | { enviado: true }
  | { enviado: false; motivo: "service_role_ausente" | "erro_provedor" | "erro_inesperado"; detalhe?: string };

// ---------------------------------------------------------------------------
// Produtos (0011)
// ---------------------------------------------------------------------------

export interface ProdutoAdmin {
  id: string;
  tipo: ProdutoTipo;
  nome: string;
  hotmart_produto_id: string | null;
  /** Link de pagamento (só https) — 0051. `null` = a tarefa "enviar link do croqui" sai sem link. */
  url_checkout: string | null;
  ativo: boolean;
  criado_em: string;
}

// ---------------------------------------------------------------------------
// Templates de mensagem (0013) — dado versionado, nunca editado em uso
// ---------------------------------------------------------------------------

export type CanalMensagemAdmin = "email" | "whatsapp";

export interface MensagemTemplateAdmin {
  id: string;
  chave: string;
  canal: CanalMensagemAdmin;
  versao: number;
  assunto: string | null;
  corpo: string;
  ativo: boolean;
  criado_em: string;
}

// ---------------------------------------------------------------------------
// Versões de prompt (0009) — dado versionado, nunca editado em uso
// ---------------------------------------------------------------------------

export type EffortIa = "low" | "medium" | "high" | "xhigh" | "max";

/** Linha completa — só na tela de detalhe/edição (corpo_sistema pode ser longo). */
export interface PromptVersaoAdmin {
  id: string;
  chave: string;
  versao: number;
  titulo: string;
  corpo_sistema: string;
  esquema_saida: unknown | null;
  modelo_padrao: string;
  effort: EffortIa;
  ativo: boolean;
  notas: string | null;
  criado_em: string;
  criado_por: string | null;
}

/** Linha de listagem — sem `corpo_sistema`/`esquema_saida` (payload pesado, sem uso na lista). */
export type PromptVersaoResumo = Omit<PromptVersaoAdmin, "corpo_sistema" | "esquema_saida">;

// ---------------------------------------------------------------------------
// Configurações (0027) — só UPDATE de chave existente; chave nova é migration
// ---------------------------------------------------------------------------

export type ConfiguracaoChave =
  | "link.validade_dias"
  | "link.limite_por_minuto"
  | "link.limite_por_dia"
  | "ia.cooldown_segundos"
  | "ia.teto_execucoes_dia_por_usuario"
  | "agenda.duracao_padrao_minutos"
  | "agenda.slots_ofertados_ao_cliente"
  // Fase 4 (0049, 0052–0057): toggles de integração e do método. Todas nascem por migration.
  | "croqui.exige_revisao_para_pronto"
  | "sala.provedor"
  | "regua.canal_whatsapp"
  | "ligacao_ia.provedor"
  | "ligacao_ia.automatica"
  | "ligacao_ia.max_tentativas"
  | "ligacao_ia.intervalo_retentativa_minutos"
  | "ligacao_ia.timeout_minutos"
  | "material.anexar_pdf"
  | "material.rodape_juridico"
  | "cenario.rubricas";

/** Chaves que só o sistema escreve (cron, jobs). A tela mostra, nunca edita. */
export type ConfiguracaoChaveSomenteLeitura = "regua.ultimo_cron_em";

export interface ConfiguracaoAdmin<T = unknown> {
  chave: string;
  valor: T;
  descricao: string;
  atualizado_em: string;
  atualizado_por: string | null;
}

export interface ValidadeLinksDias {
  formulario: number;
  agendamento: number;
  documentos: number;
  material: number;
}

// ---------------------------------------------------------------------------
// Custo de IA (execucoes_ia + views de 0033) — só admin/advogada (ve_patrimonio)
// ---------------------------------------------------------------------------

export type ModoExecucaoIa = "real" | "demonstracao";

export interface CustoIaMensal {
  mes: string; // timestamptz truncado no mês, ISO
  modo: ModoExecucaoIa;
  execucoes: number;
  custo_usd_total: number;
  tokens_entrada_total: number;
  tokens_saida_total: number;
}

export interface CustoIaPorPrompt {
  prompt_versao_id: string;
  chave: string;
  versao: number;
  versao_ativa: boolean;
  modo: ModoExecucaoIa;
  execucoes: number;
  custo_usd_total: number;
}

export interface CustoIaPorJornada {
  jornada_id: string;
  modo: ModoExecucaoIa;
  execucoes: number;
  custo_usd_total: number;
  ultima_execucao_em: string;
}

export interface ResumoCustoIa {
  custo_real_total_usd: number;
  custo_demonstracao_total_usd: number;
  execucoes_reais: number;
  execucoes_demonstracao: number;
}

export interface CustoIaResposta {
  resumo: ResumoCustoIa;
  por_mes: CustoIaMensal[];
  por_prompt: CustoIaPorPrompt[];
  por_jornada: CustoIaPorJornada[];
}

// ---------------------------------------------------------------------------
// Pendências — Admin consome `vw_pendencias_sistema` (0034, B-1B), não duplica.
// ---------------------------------------------------------------------------

/**
 * Tipos de `vw_pendencias_sistema`: 0031 (3 primeiros), 0052 (`sessao_sem_sala`,
 * `cron_parado`), 0053 (`ligacao_ia_falhou`). Tipo novo vindo do banco nunca
 * derruba a aba: a tela rotula o que conhece e humaniza o resto.
 */
export type TipoPendenciaSistema =
  | "webhook_falho"
  | "mensagem_falhou"
  | "link_expirando"
  | "material_aguardando_aprovacao"
  | "sessao_sem_sala"
  | "cron_parado"
  | "ligacao_ia_falhou";

export interface PendenciaSistema {
  id: string;
  tipo: TipoPendenciaSistema | (string & {});
  titulo: string;
  descricao: string | null;
  jornada_id: string | null;
  pessoa_nome: string | null;
  /** `null` em `cron_parado` quando o cron nunca rodou. */
  ocorrido_em: string | null;
}

/**
 * `materiais_aguardando_aprovacao` não é implementável nesta migration — a
 * tabela `materiais_pos_sessao` só nasce em `0031` (ONDA 3, B-3B, ainda não
 * escrita). Stub explícito em vez de dado inventado ou lista sempre vazia
 * disfarçada de "nada pendente".
 */
export interface PendenciaIndisponivel {
  disponivel: false;
  motivo: string;
}

export interface PendenciasResposta {
  sistema: PendenciaSistema[];
  materiais_aguardando_aprovacao: PendenciaIndisponivel;
}

// ---------------------------------------------------------------------------
// Decisões jurídicas (0048) — substitui o boolean solto de
// configuracoes['conhecimento.analise_ia_habilitada']. Só um escopo hoje;
// escopo novo é migration (mesmo raciocínio de ConfiguracaoChave acima).
// ---------------------------------------------------------------------------

export type EscopoDecisaoJuridica = "conhecimento.analise_ia_transcricoes";

export interface DecisaoJuridicaAdmin {
  id: string;
  escopo: EscopoDecisaoJuridica;
  descricao: string;
  base_legal: string;
  subprocessador: string;
  decidido_por: string;
  decidido_em: string;
  revogada_em: string | null;
  revogada_por: string | null;
  motivo_revogacao: string | null;
  criado_em: string;
}

// ---------------------------------------------------------------------------
// Reexport de conveniência
// ---------------------------------------------------------------------------

export type { OrigemDado, PapelEquipe, ProdutoTipo };
