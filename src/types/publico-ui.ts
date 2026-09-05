/**
 * Contrato da superfície pública — `src/app/(publico)/p/**`, `src/components/publico/**`.
 *
 * Fonte normativa: docs/ARQUITETURA-FASE-2.md §2 (regras duras) e §4.1 (`0028_links_publicos.sql`,
 * `abrir_link_publico`, `responder_formulario_publico`, `escolher_horario_publico`,
 * `registrar_documento_publico`). O backend (B-1A, onda 1) está sendo construído em paralelo —
 * os tipos marcados "ASSUMIDO" seguem o mesmo padrão de `src/lib/api.ts` (tabela de contratos):
 * são o formato mais fiel ao plano que dá para tipar sem o endpoint no ar, e quem ajusta aqui
 * quando o formato final divergir é o F-1A, não o backend.
 *
 * Regra que percorre todo este arquivo (§2.2, regra 3): erro de link é **sempre o mesmo**
 * (`{ erro: 'link_invalido' }`, HTTP 404) para inexistente, expirado, revogado, esgotado ou de
 * jornada fechada. Nunca um campo a mais que distinga os casos — isso é oráculo de existência.
 * Nenhum tipo aqui carrega UUID interno (jornada_id, pessoa_id, documento_id, link_id): a
 * resposta pública só conhece o token da URL e os campos que a RPC devolve (§2.2, regra 4).
 */

import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Núcleo — `abrir_link_publico`
// ---------------------------------------------------------------------------

export type TipoLinkPublico = "formulario" | "agendamento" | "documentos" | "material";
/**
 * `confirmacao` (0050/0051, Fase 4): link que só o SISTEMA emite, no envio da
 * mensagem D-7 — nunca a equipe. Rota pública `/p/c/[token]`. Fora de
 * `TipoLinkPublico` de propósito, espelhando `src/types/publico.ts`.
 */
export type TipoLinkSistema = "confirmacao";
export type TipoLinkQualquer = TipoLinkPublico | TipoLinkSistema;

/**
 * `resolve_link` (§4.1) já filtra expirado/revogado/inexistente/de-jornada-fechada para NULL
 * antes de qualquer resposta chegar aqui — por isso só sobram dois estados possíveis num
 * link que abriu com sucesso. O terminal de cada tipo é lido do próprio `payload`
 * (`respondido_em`, `horario_confirmado`, …), nunca só deste campo — mais resiliente a uma
 * pequena divergência do contrato final.
 */
export type EstadoLinkPublico = "ativo" | "usado";

export interface PerguntaFormularioPublico {
  id: string;
  bloco: string;
  tipo: "texto" | "texto_longo" | "unica" | "multipla" | "numero" | "sim_nao";
  rotulo: string;
  opcoes?: string[];
  obrigatoria?: boolean;
  /** Mesmo formato de `formularios.definicao` usado na tela interna (P11 depende de P10 conter "Imóveis"). */
  condicional?: { depende_de: string; contem?: string; igual?: string };
}

export interface ConsentimentoVigente {
  /** Chave estável do texto de consentimento (ex.: `'tratamento_dados_formulario'`). */
  chave: string;
  titulo: string;
  texto: string;
  versao: number;
}

export interface PayloadFormularioPublico {
  definicao: PerguntaFormularioPublico[];
  /** Respostas já dadas — reedição antes de finalizar (§2.2, regra 4). `null` = nunca respondeu. */
  respostas: Record<string, unknown> | null;
  /** Quando presente, o formulário já foi finalizado: tela vira somente-leitura (§2.3). */
  respondido_em: string | null;
  consentimentos: ConsentimentoVigente[];
}

export interface SlotAgendamentoPublico {
  inicio_em: string;
  fim_em: string;
  /** 1 = "melhor horário" segundo a IA (ordena, não escolhe — CONFLITO C10). */
  posicao: number;
  /** `null` quando a ordem é cronológica pura — a tela não pode falar em "sugestão" nesse caso. */
  motivo_sugestao: string | null;
}

export interface HorarioConfirmadoPublico {
  inicio_em: string;
  fim_em: string;
  /** Se o backend não permitir mais remarcar (já usou a única remarcação — §2.3), este botão some. */
  pode_remarcar: boolean;
}

export interface PayloadAgendamentoPublico {
  slots: SlotAgendamentoPublico[];
  horario_confirmado: HorarioConfirmadoPublico | null;
}

export type TipoDocumentoPublico = "imposto_de_renda" | "contrato_social" | "outro";

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
  /** Extensões aceitas, para dizer ao cliente ANTES de ele tentar (ex.: `["pdf", "jpg", "png"]`). */
  extensoes_aceitas: string[];
}

export type BlocoMaterialPublico =
  | { tipo: "titulo"; texto: string }
  | { tipo: "paragrafo"; texto: string }
  | { tipo: "lista"; itens: string[] }
  | { tipo: "citacao"; texto: string };

export interface PayloadMaterialPublico {
  titulo: string;
  blocos: BlocoMaterialPublico[];
  aprovado_em: string;
  /** 0060: material aprovado atual tem `pdf_caminho`. `undefined` = banco anterior à 0060 (manter a sonda no clique). */
  pdf_disponivel?: boolean;
}

/** `app.payload_link_confirmacao` (0051). `ja_confirmada_em` não-nulo = tela "já confirmado", sem botão. */
export interface PayloadConfirmacaoPublico {
  inicio_em: string;
  fim_em: string;
  ja_confirmada_em: string | null;
}

export interface AberturaLinkPublico<TPayload> {
  tipo: TipoLinkQualquer;
  /** Só o primeiro nome — nunca o nome completo (§2.2, regra 4). */
  primeiro_nome: string;
  expira_em: string;
  estado: EstadoLinkPublico;
  payload: TPayload;
}

export type AberturaFormularioPublico = AberturaLinkPublico<PayloadFormularioPublico>;
export type AberturaAgendamentoPublico = AberturaLinkPublico<PayloadAgendamentoPublico>;
export type AberturaDocumentosPublico = AberturaLinkPublico<PayloadDocumentosPublico>;
export type AberturaMaterialPublico = AberturaLinkPublico<PayloadMaterialPublico>;
export type AberturaConfirmacaoPublico = AberturaLinkPublico<PayloadConfirmacaoPublico>;

// ---------------------------------------------------------------------------
// Erros públicos — todos os casos ruins devolvem um destes formatos, nunca mais que isso.
// ---------------------------------------------------------------------------

/**
 * `link_invalido` cobre inexistente/expirado/revogado/esgotado/jornada-fechada — de propósito,
 * o mesmo texto para os cinco (§2.2, regra 3). Os demais são erros públicos legítimos que NÃO
 * vazam nada sobre outra pessoa (ex.: horário ocupado por outra jornada não diz de quem é).
 */
export type CodigoErroPublico =
  | "link_invalido"
  | "limite_excedido"
  | "horario_indisponivel"
  | "envio_indisponivel"
  | "arquivo_invalido"
  | "erro_desconhecido"
  /** Casos de borda que o backend (`src/types/publico.ts`) já nomeia — alinhados aqui em 05/09. */
  | "respostas_invalidas"
  | "formulario_indisponivel"
  | "limite_remarcacoes"
  /** `/p/c`: o agendamento do link foi remarcado/cancelado — a equipe manda link novo (409). */
  | "agendamento_indisponivel"
  | "limite_arquivos_atingido"
  | "arquivo_duplicado"
  /** `/p/m`: material aprovado sem arquivo PDF gerado (409) — a página continua com `window.print()`. */
  | "pdf_indisponivel";

export interface ErroPublico {
  erro: CodigoErroPublico;
}

// ---------------------------------------------------------------------------
// Corpos de requisição / resposta das rotas de escrita — ASSUMIDO (B-1A ainda em onda 1)
// ---------------------------------------------------------------------------

export interface CorpoResponderFormularioPublico {
  respostas: Record<string, unknown>;
  /** Uma entrada por item de `PayloadFormularioPublico.consentimentos`, todas aceitas. */
  consentimentos: { chave: string; versao: number }[];
  /**
   * Honeypot (§2.5): campo invisível ao humano. Preenchido = bot. A rota descarta e devolve
   * 200 de sucesso falso-positivo (não é este tipo que decide isso — é o Next route, que lê
   * o corpo inteiro; este campo só precisa chegar vazio no tráfego legítimo).
   */
  verificacao: string;
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

/** `POST /api/publico/[token]/confirmar` — sem corpo; um toque. Idempotente: a 2ª chamada devolve a mesma `confirmada_em`. */
export interface RespostaConfirmarPresencaPublico {
  ok: true;
  inicio_em: string;
  fim_em: string;
  confirmada_em: string;
}

/**
 * Resultado de `baixarPdfMaterialPublico` (`GET /api/publico/[token]/material-pdf`).
 * `disponivel` = a rota respondeu 302 (URL assinada). `pdf_indisponivel` (409) e
 * `envio_indisponivel` (503) são estados esperados — a tela mantém a impressão
 * como caminho, nunca finge que o botão funcionou.
 */
export type EstadoPdfMaterialPublico = "disponivel" | "pdf_indisponivel" | "envio_indisponivel" | "limite_excedido" | "link_invalido" | "erro_desconhecido";

// ---------------------------------------------------------------------------
// Modo apresentação genérico (`src/components/croqui/Apresentacao.tsx`) —
// contrato compartilhado entre o Croqui (13 slides) e o Diagnóstico da SV
// (agente H, `jornadas/[id]/diagnostico/**`).
// ---------------------------------------------------------------------------

export interface SlideApresentacao {
  /** Chave estável (React `key` + âncora). */
  id: string;
  /** Título grande do slide — o que a família lê. */
  titulo: string;
  /** Rótulo pequeno em caixa alta acima do título (ex.: "03 · Família"). Omitido = "NN de TOTAL". */
  rotulo?: string;
  /** Corpo do slide (texto, pontos, gráfico). Quem monta decide o que a família vê. */
  corpo: ReactNode;
  /** Notas do apresentador — só aparecem no painel lateral (tecla N), nunca no corpo. */
  notas?: string;
}

// ---------------------------------------------------------------------------
// Rascunho local do formulário (§ regras duras: "nada de localStorage com dado do cliente
// além de rascunho do próprio formulário no aparelho dele"). Vive só no navegador do cliente,
// nunca é enviado a lugar nenhum além da própria finalização normal do formulário.
// ---------------------------------------------------------------------------

export interface RascunhoFormularioPublico {
  respostas: Record<string, unknown>;
  atualizado_em: string;
}
