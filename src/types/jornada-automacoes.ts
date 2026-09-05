/**
 * Formas de resposta das três rotas novas da Fase 5 na Ficha do cliente
 * (`docs/ARQUITETURA-FASE-5.md` §8.2–§8.3, §11.4):
 *
 *   GET  /api/jornadas/[id]/automacoes → RespostaAutomacoes
 *   GET  /api/jornadas/[id]/radar      → RespostaRadar
 *   POST /api/jornadas/[id]/radar/pedir → RespostaRadarPedir
 *   GET  /api/jornadas/[id]/execucao   → RespostaExecucao
 *
 * Regra que atravessa o arquivo: **ausência é ausência**. Nenhum campo aqui
 * usa `0`/`""` para dizer "não sei" — quem não sabe manda `null` e a tela
 * mostra a falta (CLAUDE.md, "nada de dado inventado na tela").
 */

// ---------------------------------------------------------------------------
// Automações — "o que o sistema fez" (view `vw_automacoes_jornada`, 0064)
// ---------------------------------------------------------------------------

/** De onde a linha veio. `marco` = fato da jornada (pagamento), não automação de envio. */
export type TipoAutomacao = "mensagem" | "ligacao_ia" | "confirmacao" | "marco";

/**
 * Resultado humano da automação. `aguardando` = está na fila e ainda não deu
 * hora; `agendado` = tem hora marcada no futuro; `sem_resposta` = tentou e
 * ninguém atendeu (ligação) — diferente de `falhou` (erro técnico).
 */
export type EstadoAutomacao = "agendado" | "enviado" | "falhou" | "sem_resposta" | "concluido" | "aguardando";

export interface LinhaAutomacao {
  jornada_id: string;
  tipo: TipoAutomacao;
  /** Identificador estável da automação (`chave` do template, `provedor` da ligação, `origem` do pagamento). */
  chave: string;
  /** Nome humano da fonte, sem sigla (lei de texto §2). */
  rotulo_fonte: string;
  /** `email` | `whatsapp` | `telefone` | `null` quando não há canal. */
  canal: string | null;
  estado: EstadoAutomacao;
  /** Quando aconteceu (ou vai acontecer, quando `agendado`). ISO. */
  quando: string | null;
  /** Uma linha de resultado ("Entregue", "Cliente confirmou", "Caixa postal"). `null` = ainda sem desfecho. */
  resultado: string | null;
  /** Ordem de leitura na tela: 1 = mais recente. */
  ordem: number;
}

export interface RespostaAutomacoes {
  itens: LinhaAutomacao[];
}

// ---------------------------------------------------------------------------
// Radar de documentos — coleta e entrega (§8.3)
// ---------------------------------------------------------------------------

/**
 * `documentos.tipo` depois da 0065. Os cinco últimos são os que a 0065
 * acrescenta ao CHECK — antes dela, gravar qualquer um deles levanta 23514.
 */
export type DocumentoTipoRadar =
  | "imposto_renda"
  | "contrato_social"
  | "matricula_imovel"
  | "certidao_casamento"
  | "certidao_nascimento"
  | "crlv"
  | "extrato_investimento"
  | "balanco"
  | "comprovante_residencia"
  | "outro";

/**
 * Chave de tabela do `ResultadoCroqui` (M1, `src/types/croqui-calculo.ts`).
 * Fica como `string` até a Onda 2: duplicar a união das 19 chaves aqui criaria
 * duas fontes de verdade para a mesma lista. Quando o arquivo do M1 existir,
 * trocar por `import type { ChaveTabela }`.
 */
export type ChaveTabelaCroqui = string;

/** Modelo do croqui em jogo — mesma união do `ModeloCroqui` do M1 (§4.2). */
export type ModeloCroquiRadar = "inventario" | "doacao" | "celula_1" | "celula_2" | "celula_3";

/**
 * `a_pedir` é o quarto estado, e é deliberado (§11.5, CONFLITO 11): a lista do
 * radar é DERIVADA do patrimônio e da família, então ela nasce sem pedido
 * nenhum. Chamar isso de "pedido" mentiria na tela.
 */
export type EstadoItemRadar = "a_pedir" | "pedido" | "recebido" | "conferido";

export interface ItemRadar {
  /** Estável e única na jornada: `{lado}:{tipo}:{item_ref ?? '-'}`. É o que o POST /pedir recebe. */
  chave: string;
  tipo: DocumentoTipoRadar;
  /** Rótulo humano curto, com a descrição do bem quando houver ("Matrícula · Apartamento"). */
  rotulo: string;
  /** `patrimonio_itens.id` / `familiares.id` / marco de execução a que o documento pertence. */
  item_ref: string | null;
  lado: "coleta" | "entrega";
  estado: EstadoItemRadar;
  pedido_em: string | null;
  recebido_em: string | null;
  obrigatorio: boolean;
  /** Tabelas do croqui que ficam sem insumo enquanto o documento não chega. */
  trava: ChaveTabelaCroqui[];
}

export interface RespostaRadar {
  itens: ItemRadar[];
  modelo: ModeloCroquiRadar | null;
  /**
   * `false` quando a 0065 ainda não foi aplicada: a lista continua sendo
   * derivada e mostrada, mas nenhum pedido pode ser gravado. A tela precisa
   * saber disso para não oferecer um botão que sempre falha.
   */
  pedidos_disponiveis: boolean;
}

export interface CorpoRadarPedir {
  chaves: string[];
}

export interface RespostaRadarPedir {
  /** Quantos pedidos foram gravados agora (não conta os que já existiam). */
  pedidos: number;
  /** 1 quando a mensagem entrou na fila; 0 quando a idempotência barrou (mesmo dia) ou não havia como enviar. */
  enfileiradas: number;
  /** Por que nada foi enfileirado, quando for o caso. `null` = mensagem na fila. */
  motivo: string | null;
}

// ---------------------------------------------------------------------------
// Execução — a sub-esteira de 60 dias (0067)
// ---------------------------------------------------------------------------

export type FaseExecucao = "contratacoes" | "executoria" | "paralela" | "entrega";

export interface MarcoExecucao {
  id: string;
  ordem: number;
  rotulo: string;
  fase: FaseExecucao;
  /** Prazo em dias do cronograma do escritório. `null` = marco sem prazo próprio. */
  prazo_dias: number | null;
  /** Ids dos marcos que precisam terminar antes deste. */
  depende_de: string[];
  /** `true` = corre ao lado da cadeia principal, não a bloqueia. */
  paralelo: boolean;
  /** `null` = ainda não concluído. Nunca `false`, nunca data inventada. */
  concluido_em: string | null;
  nota: string | null;
}

export interface RespostaExecucao {
  /** Chave do modelo de execução (ex.: `holding_3_celulas`). `null` = nenhum modelo ativo. */
  modelo: string | null;
  marcos: MarcoExecucao[];
  feitos: number;
  total: number;
  /** Data do marco final ("Entrega do Sistema") quando concluído. */
  entrega_em: string | null;
}
