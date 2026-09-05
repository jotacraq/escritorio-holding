/**
 * Tipos da Fase 4 · F2 — ligação por IA (Vapi via n8n), caixa de entrada do
 * WhatsApp (Chatwoot) e estado das integrações (Admin → Integrações).
 * Dono: agente B. Espelham 0053/0054 e os contratos de
 * `docs/integracoes/n8n-ligacao-ia.md`.
 */

// ---------------------------------------------------------------------------
// ligacoes_ia (0053)
// ---------------------------------------------------------------------------

export type StatusLigacaoIa =
  | "na_fila"
  | "discando"
  | "em_ligacao"
  | "concluida"
  | "sem_resposta"
  | "falhou"
  | "cancelada";

export type ResultadoLigacaoIa =
  | "agendou"
  | "recusou"
  | "pediu_retorno"
  | "caixa_postal"
  | "numero_invalido"
  | "manual";

export type ProvedorLigacaoIaNome = "n8n" | "manual";

export interface LigacaoIa {
  id: string;
  jornada_id: string;
  link_id: string | null;
  provedor: ProvedorLigacaoIaNome;
  status: StatusLigacaoIa;
  tentativa: number;
  nao_antes_de: string | null;
  origem: "equipe" | "automatica";
  solicitada_por: string | null;
  telefone: string;
  id_externo: string | null;
  disparada_em: string | null;
  atendida_em: string | null;
  encerrada_em: string | null;
  duracao_segundos: number | null;
  resultado: ResultadoLigacaoIa | null;
  horario_escolhido: string | null;
  agendamento_id: string | null;
  transcricao: string | null;
  resumo: string | null;
  gravacao_url: string | null;
  custo_usd: number | null;
  erro: string | null;
  criado_em: string;
  atualizado_em: string;
}

/** Um horário ofertado à IA — sempre um dos que `agendamentos_sugestoes` guarda para o link. */
export interface HorarioOfertadoIa {
  inicio_em: string; // ISO 8601 com offset
  fim_em: string;
  /** Por extenso em America/Sao_Paulo, ex.: "terça-feira, 10 de setembro, às 15h". */
  rotulo: string;
}

/** Corpo que o SIC-HF manda ao LANCADOR do n8n (saída). */
export interface PayloadLigacaoIaSaida {
  ligacao_id: string;
  tentativa: number;
  nome: string;
  primeiro_nome: string;
  telefone: string;
  assistente_id: string | null;
  melhor_horario: HorarioOfertadoIa;
  alternativas: HorarioOfertadoIa[];
  callback_url: string;
  emitido_em: string;
  teste?: boolean;
}

export type EventoLigacaoIa = "discando" | "em_ligacao" | "concluida" | "sem_resposta" | "falhou";

/** Corpo que o n8n manda a `POST /api/webhooks/n8n/ligacao` (entrada). */
export interface PayloadLigacaoIaEntrada {
  id_evento: string;
  ligacao_id: string;
  evento: EventoLigacaoIa;
  /** Alias aceito: `estado`. */
  estado?: EventoLigacaoIa;
  id_externo?: string | null;
  horario_escolhido?: string | null;
  resultado?: Exclude<ResultadoLigacaoIa, "agendou" | "manual"> | null;
  transcricao?: string | null;
  resumo?: string | null;
  gravacao_url?: string | null;
  custo_usd?: number | null;
  duracao_s?: number | null;
  duracao_segundos?: number | null;
  motivo_falha?: string | null;
}

export interface ResultadoAplicarEvento {
  ligacao_id: string;
  status: StatusLigacaoIa;
  resultado: ResultadoLigacaoIa | null;
  agendamento_id: string | null;
  /** Presente quando o evento foi recebido mas não teve efeito (ligação já encerrada). */
  ignorado?: string;
  /** Presente quando `concluida` trouxe horário fora dos ofertados ou o núcleo recusou. */
  erro?: string;
}

export interface ResultadoProcessarFilaLigacoes {
  processadas: number;
  disparadas: number;
  manuais: number;
  falhas: number;
}

export interface ResultadoReaperLigacoes {
  liberadas: number;
  reenfileiradas: number;
  fallback: number;
}

export interface RespostaListarLigacoesIa {
  itens: LigacaoIa[];
}

export interface RespostaLigacaoIa {
  ligacao: LigacaoIa;
  /** Aviso rotulado quando a ligação virou tarefa humana ou saiu sem link. */
  aviso?: string;
}

// ---------------------------------------------------------------------------
// mensagens_recebidas (0054)
// ---------------------------------------------------------------------------

export interface MensagemRecebida {
  id: string;
  canal: "email" | "whatsapp";
  provedor: "chatwoot";
  conversa_externa_id: string;
  mensagem_externa_id: string;
  telefone: string | null;
  pessoa_id: string | null;
  jornada_id: string | null;
  corpo: string;
  anexos: Array<{ tipo: string | null; url: string | null; nome: string | null }>;
  recebida_em: string;
  vinculada_por: string | null;
  vinculada_em: string | null;
  criado_em: string;
}

// ---------------------------------------------------------------------------
// Admin → Integrações (§2.6)
// ---------------------------------------------------------------------------

export type ChaveIntegracao = "resend" | "hotmart" | "cron" | "ligacao_ia" | "sala" | "chatwoot" | "ia";

export interface IntegracaoEstado {
  chave: ChaveIntegracao;
  rotulo: string;
  configurado: boolean;
  /** NOMES de variáveis/itens que faltam — nunca valor, nunca tamanho. */
  faltam: string[];
  /** Texto exato de pendência (§2.9 / §1.9) para a tela mostrar. */
  pendencia: string | null;
  ultimo_evento_em: string | null;
  /** Toggles que são dado (`configuracoes`), com a chave para o Admin editar. */
  toggles: Array<{ chave: string; valor: unknown; descricao: string }>;
  /** Extras por integração (ex.: hotmart.produtos_sem_id, ligacao_ia.automatica). */
  extras: Record<string, unknown>;
  testavel: boolean;
}

export interface RespostaIntegracoes {
  itens: IntegracaoEstado[];
}

export interface ResultadoTesteIntegracao {
  chave: ChaveIntegracao;
  ok: boolean;
  /** Resultado cru resumido (status HTTP, código de erro) — nunca contém segredo. */
  detalhe: string;
  testado_em: string;
}
