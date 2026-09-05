/**
 * Contrato TypeScript da superfície pública, lado servidor — espelha as 6 RPCs de
 * `supabase/migrations/0028_links_publicos.sql` (as 4 públicas + `emitir_link_publico`/
 * `revogar_link_publico`, de uso interno). Fonte normativa: docs/ARQUITETURA-FASE-2.md
 * §2 e §4.1.
 *
 * ATENÇÃO — este arquivo é a FORMA REAL que o banco devolve. `src/types/publico-ui.ts`
 * (dono: F-1A, fora da minha fronteira) foi escrito em paralelo a partir do mesmo §4.1 e
 * diverge em alguns pontos — documentados aqui e no relatório de entrega, não corrigidos
 * lá. Resumo das divergências (o backend segue o que está documentado NESTE arquivo):
 *
 *   - Honeypot: o campo chama `verificacao` (publico-ui.ts já usa esse nome — igual).
 *   - Consentimentos do formulário: 3 chaves granulares reais
 *     (`tratamento_ia` | `comunicacao_email` | `comunicacao_whatsapp`, o enum
 *     `tipo_consentimento` do banco), não uma chave genérica única. `versao` é
 *     STRING (mesmo formato de `consentimentos.versao_texto`, ex. `'formulario-publico-v1'`),
 *     nunca `number`.
 *   - Tipo de documento: os valores reais do `check` de `documentos.tipo` são
 *     `'imposto_renda' | 'contrato_social' | 'matricula_imovel' | 'outro'` — SEM "de" em
 *     "imposto_renda", e COM `matricula_imovel` (que `publico-ui.ts` não lista).
 *   - Códigos de erro: além de `link_invalido` | `limite_excedido` | `horario_indisponivel`
 *     | `envio_indisponivel` | `arquivo_invalido` | `erro_desconhecido` (que batem com
 *     `publico-ui.ts`), o backend pode devolver `respostas_invalidas`,
 *     `formulario_indisponivel`, `limite_remarcacoes`, `agendamento_indisponivel`,
 *     `limite_arquivos_atingido`, `arquivo_duplicado` — casos de borda reais que o enum
 *     do F-1A ainda não nomeia. Ver relatório de entrega para a recomendação de rotear.
 */

/** Os 4 tipos que a EQUIPE emite (`POST /api/jornadas/[id]/links`). */
export type TipoLinkPublico = "formulario" | "agendamento" | "documentos" | "material";
/**
 * `confirmacao` (0050/0051, Fase 4): emitido SÓ pelo sistema no envio da D-7
 * (`emitir_link_confirmacao_sistema`), nunca pela equipe. Rota pública `/p/c/[token]`.
 * Fica fora de `TipoLinkPublico` de propósito: os `Record<TipoLinkPublico, …>` das telas
 * de emissão continuam exaustivos sobre o que a equipe pode pedir.
 */
export type TipoLinkSistema = "confirmacao";
export type TipoLinkQualquer = TipoLinkPublico | TipoLinkSistema;
export type EstadoLinkPublico = "ativo" | "usado" | "expirado" | "revogado";

/** Os únicos três tipos coletáveis pelo formulário público (enum `tipo_consentimento` do banco). */
export type ChaveConsentimentoPublico = "tratamento_ia" | "comunicacao_email" | "comunicacao_whatsapp";

/** Valor real do `check` de `documentos.tipo` (0012) — não confundir com o subconjunto de `publico-ui.ts`. */
export type TipoDocumentoPublico = "imposto_renda" | "contrato_social" | "matricula_imovel" | "outro";

// ---------------------------------------------------------------------------
// Payload de `abrir_link_publico`, por tipo
// ---------------------------------------------------------------------------

export interface ConsentimentoTextoPublico {
  chave: ChaveConsentimentoPublico;
  titulo: string;
  texto: string;
  /** String, não número — mesmo formato de `consentimentos.versao_texto` (ex.: 'formulario-publico-v1'). */
  versao: string;
}

export interface PayloadFormularioPublico {
  definicao: unknown[];
  respostas: Record<string, unknown> | null;
  /** Não-nulo = já finalizado (somente-leitura). */
  respondido_em: string | null;
  consentimentos: ConsentimentoTextoPublico[];
}

export interface SlotAgendamentoPublico {
  inicio_em: string;
  fim_em: string;
  posicao: number;
  motivo_sugestao: string | null;
}

export interface HorarioConfirmadoPublico {
  inicio_em: string;
  fim_em: string;
  pode_remarcar: boolean;
}

export interface PayloadAgendamentoPublico {
  slots: SlotAgendamentoPublico[];
  horario_confirmado: HorarioConfirmadoPublico | null;
}

export interface DocumentoPedidoPublico {
  chave: TipoDocumentoPublico;
  rotulo: string;
  obrigatorio: boolean;
}

export interface DocumentoRecebidoPublico {
  tipo: TipoDocumentoPublico;
  nome_arquivo: string;
  enviado_em: string;
}

export interface PayloadDocumentosPublico {
  tipos_pedidos: DocumentoPedidoPublico[];
  recebidos: DocumentoRecebidoPublico[];
  limite_arquivos: number;
  tamanho_maximo_mb: number;
  extensoes_aceitas: string[];
}

/**
 * `app.payload_link_material` (0031 + 0060): `{titulo, blocos, aprovado_em,
 * pdf_disponivel}` — a forma de tela completa está em `src/types/publico-ui.ts`.
 * `pdf_disponivel` só existe com a 0060 aplicada (`undefined` = sondar no clique).
 */
export interface PayloadMaterialPublico {
  titulo: string;
  blocos: unknown[];
  aprovado_em: string;
  pdf_disponivel?: boolean;
}

/** `app.payload_link_confirmacao` (0051). `ja_confirmada_em` não-nulo = tela "já confirmado". */
export interface PayloadConfirmacaoPublico {
  inicio_em: string;
  fim_em: string;
  ja_confirmada_em: string | null;
}

export type PayloadLinkPublico =
  | PayloadFormularioPublico
  | PayloadAgendamentoPublico
  | PayloadDocumentosPublico
  | PayloadMaterialPublico
  | PayloadConfirmacaoPublico;

export interface AberturaLinkPublico<TPayload = PayloadLinkPublico> {
  tipo: TipoLinkPublico;
  primeiro_nome: string;
  expira_em: string;
  estado: EstadoLinkPublico;
  payload: TPayload;
}

/** `GET /api/publico/[token]` para um link `/p/c` — mesma forma, `tipo='confirmacao'` (0051). */
export interface AberturaLinkConfirmacaoPublico {
  tipo: TipoLinkSistema;
  primeiro_nome: string;
  expira_em: string;
  estado: EstadoLinkPublico;
  payload: PayloadConfirmacaoPublico;
}

// ---------------------------------------------------------------------------
// Erros públicos
// ---------------------------------------------------------------------------

/**
 * Primeiros 6 códigos batem com `CodigoErroPublico` de `src/types/publico-ui.ts`.
 * Os últimos 6 são casos de borda reais que aquele enum não nomeia ainda — ver
 * cabeçalho deste arquivo e o relatório de entrega.
 */
export type CodigoErroPublico =
  | "link_invalido"
  | "limite_excedido"
  | "horario_indisponivel"
  | "envio_indisponivel"
  | "arquivo_invalido"
  | "erro_desconhecido"
  | "respostas_invalidas"
  | "formulario_indisponivel"
  | "limite_remarcacoes"
  | "agendamento_indisponivel"
  | "limite_arquivos_atingido"
  | "arquivo_duplicado"
  /** Fase 4 (agente C): material aprovado sem PDF gerado — `GET /api/publico/[token]/material-pdf`. */
  | "pdf_indisponivel";

export interface ErroPublico {
  erro: CodigoErroPublico;
}

export type RespostaRpcPublica<T extends object> = ({ ok: true } & T) | { erro: string };

// ---------------------------------------------------------------------------
// Corpos de requisição das rotas de escrita
// ---------------------------------------------------------------------------

export interface CorpoResponderFormularioPublico {
  respostas: Record<string, unknown>;
  /** Só as chaves ACEITAS — recusar é não incluir. `versao` é ignorada pelo servidor de propósito. */
  consentimentos: { chave: ChaveConsentimentoPublico; versao?: string }[];
  /** Honeypot (§2.5): campo invisível ao humano. Preenchido = bot. */
  verificacao?: string;
}

export interface RespostaResponderFormularioPublico {
  ok: true;
  respondido_em: string;
}

export interface CorpoEscolherHorarioPublico {
  inicio_em: string;
}

export interface RespostaEscolherHorarioPublico {
  ok: true;
  horario_confirmado: HorarioConfirmadoPublico;
}

export interface RespostaRegistrarDocumentoPublico {
  ok: true;
  documento: DocumentoRecebidoPublico;
}

/** `POST /api/publico/[token]/confirmar` — sem corpo; um toque. Idempotente: segunda chamada devolve a mesma `confirmada_em`. */
export interface RespostaConfirmarPresencaPublico {
  ok: true;
  inicio_em: string;
  fim_em: string;
  confirmada_em: string;
}

// ---------------------------------------------------------------------------
// Emissão / revogação de link — rotas internas (equipe autenticada)
// ---------------------------------------------------------------------------

export interface LinkPublicoResumo {
  id: string;
  tipo: TipoLinkPublico;
  estado: EstadoLinkPublico;
  token_prefixo: string;
  expira_em: string;
  usos: number;
  criado_em: string;
  revogado_em: string | null;
}

export interface CorpoEmitirLinkPublico {
  tipo: TipoLinkPublico;
}

export interface RespostaEmitirLinkPublico {
  link: LinkPublicoResumo & {
    /** Só nesta resposta, uma única vez — depois só `token_prefixo` (§4.1). */
    url: string;
  };
  /**
   * Quantos horários o link de agendamento está ofertando ao cliente. Zero é um
   * resultado legítimo (agenda sem disponibilidade aberta) e a tela precisa dizer
   * isso — um link de agendamento sem horário abre uma página vazia para o cliente.
   */
  horarios_ofertados?: number;
  /** Motivo, em português, quando o link foi criado mas ficou sem horário para ofertar. */
  aviso?: string;
}

export interface RespostaListarLinksPublicos {
  itens: LinkPublicoResumo[];
}

export interface RespostaRevogarLinkPublico {
  link: LinkPublicoResumo;
}
