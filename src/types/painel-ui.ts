/**
 * Contrato de `GET /api/painel`, do ponto de vista do front (Fase 2, F-1B).
 *
 * Este arquivo é nosso, não do backend — de propósito. `B-1B` está escrevendo
 * a rota em paralelo (ver docs/ARQUITETURA-FASE-2.md §4.6, `0034_painel_dia.sql`)
 * e tipar aqui, contra o desenho das views, evita acoplar a tela a um arquivo
 * que ainda está mudando de forma do outro lado.
 *
 * Regra do painel (CLAUDE.md / brain "Alerta é fila, número é informação"):
 * um bloco com array vazio e validado é BOA NOTÍCIA ("nada pendente"). Um
 * bloco ausente ou malformado é FALHA DE CARGA ("não conseguiu carregar") —
 * nunca a mesma coisa. Por isso cada bloco é validado e degrada sozinho:
 * o resto da tela continua de pé mesmo se um pedaço do contrato mudar.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Bloco 1 — Sessões de hoje (vw_sessoes_do_dia)
// ---------------------------------------------------------------------------

export const StatusSessaoDoDiaSchema = z.enum(["agendado", "confirmado"]);
export type StatusSessaoDoDia = z.infer<typeof StatusSessaoDoDiaSchema>;

export const SessaoDoDiaSchema = z.object({
  jornada_id: z.string(),
  nome: z.string(),
  inicio_em: z.string(),
  fim_em: z.string(),
  status: StatusSessaoDoDiaSchema,
  link_sala: z.string().nullable().optional().default(null),
  advogada_id: z.string().nullable().optional().default(null),
  advogada_nome: z.string().nullable().optional().default(null),
  tem_briefing: z.boolean(),
  /**
   * Fase 4 (0051/0052, agente A): presença confirmada pelo cliente. SEM
   * `.default(null)` de propósito — `undefined` = a view ainda não tem a
   * coluna ("sem informação"); `null` = tem a coluna e ninguém confirmou.
   * `lib/pasta/sinais.ts` depende dessa diferença para não inventar alarme.
   */
  presenca_confirmada_em: z.string().nullable().optional(),
  presenca_confirmada_via: z.string().nullable().optional(),
});
export type SessaoDoDia = z.infer<typeof SessaoDoDiaSchema>;

// ---------------------------------------------------------------------------
// Bloco 2 — Preparo pendente (vw_pendencias_preparo)
// Sessão em <= 7 dias e falta formulário, ligação ou briefing.
// ---------------------------------------------------------------------------

export const PendenciaPreparoSchema = z
  .object({
    jornada_id: z.string(),
    nome: z.string(),
    inicio_em: z.string(),
    falta_formulario: z.boolean().default(false),
    falta_ligacao: z.boolean().default(false),
    falta_briefing: z.boolean().default(false),
  })
  // ao menos uma pendência real precisa estar marcada — não exibimos linha vazia de "tudo ok".
  .refine((v) => v.falta_formulario || v.falta_ligacao || v.falta_briefing, {
    message: "linha sem pendência real",
  });
export type PendenciaPreparo = z.infer<typeof PendenciaPreparoSchema>;

// ---------------------------------------------------------------------------
// Bloco 3 — Pagou e ninguém falou com essa pessoa (vw_pagos_sem_contato)
// O furo que mais dói: se este bloco tem linha, é a coisa mais urgente da tela.
// ---------------------------------------------------------------------------

export const PagoSemContatoSchema = z.object({
  jornada_id: z.string(),
  nome: z.string(),
  pago_em: z.string(),
  dias_desde_pagamento: z.number(),
});
export type PagoSemContato = z.infer<typeof PagoSemContatoSchema>;

// ---------------------------------------------------------------------------
// Bloco 4 — Travado (vw_pendencias_sistema)
// Heterogêneo de propósito: webhook com erro, mensagem que falhou, link
// expirando, material aguardando aprovação. `tipo` decide o rótulo e para
// onde a linha leva — uma linha sem `jornada_id` não vira link inventado.
// ---------------------------------------------------------------------------

/**
 * Tipos conhecidos hoje. A Fase 4 acrescenta `cron_parado`, `sessao_sem_sala`
 * e outros (0051/0052/0053) — por isso o schema aceita QUALQUER string: um
 * tipo novo vindo do banco não pode derrubar o bloco inteiro para
 * "indisponível". A tela rotula o que conhece e mostra o resto humanizado.
 */
export const TIPOS_PENDENCIA_SISTEMA_CONHECIDOS = [
  "webhook_falho",
  "mensagem_falhou",
  "link_expirando",
  "material_aguardando_aprovacao",
  "cron_parado",
  "sessao_sem_sala",
  "ligacao_ia_falhou",
] as const;
export type TipoPendenciaSistemaConhecido = (typeof TIPOS_PENDENCIA_SISTEMA_CONHECIDOS)[number];
export const TipoPendenciaSistemaSchema = z.string().min(1);
export type TipoPendenciaSistema = string;

export const PendenciaSistemaSchema = z.object({
  id: z.string(),
  tipo: TipoPendenciaSistemaSchema,
  titulo: z.string(),
  descricao: z.string().nullable().optional().default(null),
  jornada_id: z.string().nullable().optional().default(null),
  pessoa_nome: z.string().nullable().optional().default(null),
  ocorrido_em: z.string().nullable().optional().default(null),
});
export type PendenciaSistema = z.infer<typeof PendenciaSistemaSchema>;

// ---------------------------------------------------------------------------
// Bloco 5 — Números da semana (vw_indicadores_pop01), leitura, não ação.
// Numerador e denominador SEPARADOS de propósito: o percentual é calculado
// na tela e nunca aparece quando o denominador é zero (campo novo nasce
// vazio, não zero — CLAUDE.md).
// ---------------------------------------------------------------------------

export const IndicadorEdicaoSchema = z.object({
  edicao_id: z.string().nullable(),
  edicao_codigo: z.string().nullable().optional().default(null),
  edicao_nome: z.string().nullable().optional().default(null),
  compareceram: z.number(),
  sessoes_com_desfecho: z.number(),
  formularios_respondidos: z.number(),
  clientes_pagantes: z.number(),
  com_decisores: z.number(),
  com_resposta_decisores: z.number(),
});
export type IndicadorEdicao = z.infer<typeof IndicadorEdicaoSchema>;

// ---------------------------------------------------------------------------
// Envelope da resposta
// ---------------------------------------------------------------------------

export const RespostaPainelSchema = z.object({
  gerado_em: z.string().optional(),
  sessoes_do_dia: z.array(SessaoDoDiaSchema).optional(),
  pendencias_preparo: z.array(PendenciaPreparoSchema).optional(),
  pagos_sem_contato: z.array(PagoSemContatoSchema).optional(),
  pendencias_sistema: z.array(PendenciaSistemaSchema).optional(),
  indicadores_semana: z.array(IndicadorEdicaoSchema).optional(),
});
export type RespostaPainel = z.infer<typeof RespostaPainelSchema>;

/** Chaves de bloco do envelope — usado para validar bloco a bloco. */
/**
 * Prova de vida da esteira automática (Fase 4 §1.6): `GET /api/mensagens`
 * passa a devolver `regua: { ultimo_cron_em, cron_atrasado }`. Enquanto o
 * agente A não expõe o bloco, `regua` fica `undefined` e a tela diz "cron
 * ainda não configurado" — nunca um vazio mudo.
 */
export const ReguaProvaDeVidaSchema = z.object({
  ultimo_cron_em: z.string().nullable(),
  cron_atrasado: z.boolean().optional(),
});
export type ReguaProvaDeVida = z.infer<typeof ReguaProvaDeVidaSchema>;

export const MensagemPendenteSchema = z.object({
  id: z.string(),
  agendada_para: z.string(),
  canal: z.string(),
  status: z.string(),
  template_chave: z.string().nullable().optional(),
  pessoa_nome: z.string().nullable().optional(),
});
export type MensagemPendente = z.infer<typeof MensagemPendenteSchema>;

export interface ProvaDeVidaEsteira {
  /** `null` = a API ainda não expõe o bloco `regua` (cron não configurado / A não entregou). */
  regua: ReguaProvaDeVida | null;
  /** Mensagens `pendente` na fila, já ordenadas por `agendada_para`. */
  pendentes: MensagemPendente[];
}

export type ChaveBlocoPainel =
  | "sessoes_do_dia"
  | "pendencias_preparo"
  | "pagos_sem_contato"
  | "pendencias_sistema"
  | "indicadores_semana";

/**
 * Estado de um bloco depois de validar contra o schema esperado.
 * "vazio" só existe quando o array chegou e validou — é dado real de zero
 * linhas, não ausência de dado. "indisponivel" é para quando a chave falta,
 * não é array, ou alguma linha não bate com o schema: aí a tela nunca
 * inventa "0", ela diz que não conseguiu carregar aquele pedaço.
 */
export type EstadoBloco<T> =
  | { situacao: "ok"; itens: T[] }
  | { situacao: "indisponivel" };

function validarBloco<T>(
  valorBruto: unknown,
  schema: z.ZodType<T>,
): EstadoBloco<T> {
  if (!Array.isArray(valorBruto)) return { situacao: "indisponivel" };
  const itens: T[] = [];
  for (const linha of valorBruto) {
    const resultado = schema.safeParse(linha);
    if (!resultado.success) return { situacao: "indisponivel" };
    itens.push(resultado.data);
  }
  return { situacao: "ok", itens };
}

/**
 * Painel do dia já normalizado para a tela: cada bloco isolado no seu
 * próprio sucesso/falha, para um pedaço de contrato mudando não derrubar
 * a tela inteira.
 */
export interface PainelDiaNormalizado {
  geradoEm: string | null;
  sessoesDoDia: EstadoBloco<SessaoDoDia>;
  pendenciasPreparo: EstadoBloco<PendenciaPreparo>;
  pagosSemContato: EstadoBloco<PagoSemContato>;
  pendenciasSistema: EstadoBloco<PendenciaSistema>;
  indicadoresSemana: EstadoBloco<IndicadorEdicao>;
}

/**
 * Ponto único de normalização. Recebe o JSON bruto de `/api/painel` (já
 * confirmado como objeto pelo chamador) e devolve cada bloco isolado.
 * Uma linha de `pendencias_preparo` sem nenhuma pendência real (refine
 * acima) invalida só aquele bloco — nunca finge preparo pendente vazio de
 * propósito, porque isso seria a view mentindo, não ausência de dado.
 */
export function normalizarPainel(bruto: unknown): PainelDiaNormalizado {
  const objeto = bruto && typeof bruto === "object" ? (bruto as Record<string, unknown>) : {};
  const geradoEmBruto = objeto.gerado_em;
  return {
    geradoEm: typeof geradoEmBruto === "string" ? geradoEmBruto : null,
    sessoesDoDia: validarBloco(objeto.sessoes_do_dia, SessaoDoDiaSchema),
    pendenciasPreparo: validarBloco(objeto.pendencias_preparo, PendenciaPreparoSchema),
    pagosSemContato: validarBloco(objeto.pagos_sem_contato, PagoSemContatoSchema),
    pendenciasSistema: validarBloco(objeto.pendencias_sistema, PendenciaSistemaSchema),
    indicadoresSemana: validarBloco(objeto.indicadores_semana, IndicadorEdicaoSchema),
  };
}
