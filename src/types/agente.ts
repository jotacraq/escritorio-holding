/**
 * Contrato do agente de WhatsApp de onboarding (Fase 9) — o que o SERVIDOR
 * entrega e o FRONT consome. Este arquivo é do BACK; `src/types/admin.ts` é do
 * FRONT. Nenhum tipo daqui importa de `admin.ts`, e nenhum arquivo aparece nas
 * duas fronteiras.
 *
 * As três formas que a tela precisa:
 *   `AgenteJornada`  → GET  /api/jornadas/[id]/agente-whatsapp   (Ficha 360)
 *   `AgenteAcao`     → POST /api/jornadas/[id]/agente-whatsapp   (assumir/retomar)
 *   `AgenteResumo`   → GET  /api/admin/agente-whatsapp           (Admin)
 */

/** As intenções do catálogo (§C do plano). `desconhecida` NUNCA vira resposta. */
export type IntencaoAgente =
  | "confirmar_horario"
  | "enviar_documento"
  | "o_que_falta"
  | "duvida_uso_sistema"
  | "duvida_juridica"
  | "preco_prazo"
  | "falar_com_humano"
  | "fora_do_tema"
  | "desconhecida";

export type AcaoAgente = "enviar_link" | "nenhuma" | "encaminhar_humano";

/** Uma linha de `agente_whatsapp_respostas` como a tela a lê. */
export interface AgenteResposta {
  id: string;
  /**
   * A mensagem do cliente que gerou esta resposta. É a ligação EXATA entre a
   * fila de Recebidas e o que o agente disse — sem ela a tela reconstruía o
   * par por `conversa_externa_id` + relógio, que erra quando duas mensagens
   * chegam no mesmo minuto.
   */
  mensagem_recebida_id: string;
  jornada_id: string;
  conversa_externa_id: string;
  intencao: IntencaoAgente | null;
  confianca: number | null;
  acao: AcaoAgente | null;
  /**
   * O que o agente montou. `null` = não havia o que dizer (e `erro` diz por
   * quê). Quem diz se a frase SAIU é `enviada_em`: texto preenchido com
   * `enviada_em` nulo = o Chatwoot recusou, e existe tarefa aberta para isso.
   */
  texto: string | null;
  custo_usd: number | null;
  enviada_em: string | null;
  erro: string | null;
  criado_em: string;
}

/** Estado do agente numa jornada (`agente_whatsapp_estado` + derivados). */
export interface AgenteJornada {
  jornada_id: string;
  /**
   * `false` quando `configuracoes['agente_whatsapp.ativo']` está desligado —
   * a tela mostra "desligado", nunca um estado plausível de agente ativo.
   */
  agente_ativo: boolean;
  /** `null` = o agente nunca falou nesta jornada (linha ainda não existe). */
  passo_ultimo: string | null;
  ultima_intencao: IntencaoAgente | null;
  esquivas_seguidas: number;
  humano_respondeu_em: string | null;
  pausado_ate: string | null;
  pausado_por: string | null;
  /**
   * Nome de quem assumiu a conversa. `null` = ninguém assumiu, ou o perfil
   * saiu da equipe. Um id de perfil na tela não diz nada a ninguém.
   */
  pausado_por_nome: string | null;
  /** Derivado de `pausado_ate` no servidor — a tela não recalcula relógio. */
  pausado: boolean;
  /** Soma de `custo_usd` das respostas desta jornada HOJE (America/Sao_Paulo). */
  custo_usd_hoje: number;
  /** Da mais nova para a mais velha, no máximo 20. */
  ultimas_respostas: AgenteResposta[];
  /**
   * Por que o agente NÃO responderia esta jornada agora, em texto para humano.
   * Vazio = nada bloqueia. É o que transforma "o robô está mudo" em diagnóstico.
   */
  impedimentos: string[];
}

/**
 * O que o agente fez com UMA mensagem recebida — o recorte que a fila de
 * Recebidas (`GET /api/mensagens/recebidas`) carrega junto de cada linha.
 *
 * Menor que `AgenteResposta` de propósito: a fila precisa do selo, não do
 * livro-razão. `null` no item = o agente não respondeu àquela mensagem (estava
 * desligado, ou alguma trava do porteiro barrou) — a tela diz isso, não
 * inventa "aguardando".
 *
 * `enviada_em: null` com `texto` preenchido = o agente montou a frase e o
 * Chatwoot recusou; há tarefa aberta para a equipe.
 */
export interface AgenteNaRecebida {
  intencao: IntencaoAgente | null;
  confianca: number | null;
  enviada_em: string | null;
  custo_usd: number | null;
  /** Versão do prompt que redigiu. `null` = texto fixo, ou o papel não vê execução de IA. */
  prompt_versao: number | null;
  texto: string | null;
}

export type AgenteAcao = "assumir" | "devolver";

export interface AgenteAcaoCorpo {
  acao: AgenteAcao;
}

/** Painel do Admin: o interruptor e a conta do dia. */
export interface AgenteResumo {
  ativo: boolean;
  /** Nome das `CHATWOOT_*` que faltam. Vazio = as 5 estão presentes. */
  envs_faltando: string[];
  prompt_chave: string;
  /** `null` = o prompt do agente ainda não existe no banco (0090 não aplicada). */
  prompt_versao: number | null;
  prompt_ativo: boolean;
  silencio_humano_minutos: number;
  esquivas_ate_humano: number;
  intervalo_link_horas: number;
  teto_respostas_hora: number;
  teto_ia_jornada_dia: number;
  teto_ia_dia: number;
  respostas_hoje: number;
  execucoes_ia_hoje: number;
  custo_usd_hoje: number;
  ultimas_respostas: AgenteResposta[];
}
