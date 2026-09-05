/**
 * Tipos do domínio de agenda (Fase 2, B-1B — `0029_disponibilidade_agenda.sql`
 * / `0034_painel_dia.sql`). Mesmo espírito de `src/types/banco.ts`: interfaces
 * de linha escritas à mão a partir da migration, não geradas.
 *
 * Este arquivo é NOVO e exclusivo deste agente — não depende de
 * `src/types/banco.ts` (fronteira de outro agente) para os tipos de agenda,
 * só reaproveita `PapelEquipe`/`StatusAgendamento` por leitura (sem editar).
 */

import { z } from "zod";
import type { StatusAgendamento } from "./banco";

// ---------------------------------------------------------------------------
// Disponibilidade / bloqueio (linhas de tabela)
// ---------------------------------------------------------------------------

export interface Disponibilidade {
  id: string;
  advogada_id: string;
  dia_semana: number; // 0-6, 0 = domingo (igual extract(dow))
  hora_inicio: string; // "HH:MM:SS" como o Postgres devolve `time`
  hora_fim: string;
  duracao_minutos: number;
  vale_de: string; // date "YYYY-MM-DD"
  vale_ate: string | null;
  ativa: boolean;
  criado_em: string;
  criado_por: string | null;
}

export interface AgendaBloqueio {
  id: string;
  advogada_id: string;
  inicio_em: string;
  fim_em: string;
  motivo: string;
  criado_em: string;
  criado_por: string | null;
  cancelado_em: string | null;
  cancelado_por: string | null;
}

export interface SlotDisponivel {
  inicio_em: string;
  fim_em: string;
}

/**
 * Agendamento como a Agenda (`GET /api/agendamentos`) o vê — o `Agendamento`
 * de `lib/api.ts` (fronteira travada) mais os campos de presença da Fase 4
 * (0051, agente A). Opcionais: `undefined` = a rota ainda não devolve o campo
 * (sem informação); `null` = devolve e o cliente ainda não confirmou.
 */
export type ViaPresenca = "link" | "whatsapp" | "email" | "equipe" | "ligacao_ia";
export interface AgendamentoAgenda {
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
  presenca_confirmada_em?: string | null;
  presenca_confirmada_via?: ViaPresenca | string | null;
  link_sala?: string | null;
}

export interface AgendamentoSugestao {
  id: string;
  link_id: string;
  inicio_em: string;
  fim_em: string;
  posicao: number;
  motivo_sugestao: string | null;
  execucao_ia_id: string | null;
  criado_em: string;
}

// ---------------------------------------------------------------------------
// Corpo de requisição (zod — validação na borda, `src/app/api/disponibilidades/**`)
// ---------------------------------------------------------------------------

const HORA_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/; // "HH:MM", 24h

export const CorpoCriarDisponibilidadeSchema = z
  .object({
    advogada_id: z.string().uuid(),
    dia_semana: z.number().int().min(0).max(6),
    hora_inicio: z.string().regex(HORA_REGEX, 'Use o formato "HH:MM".'),
    hora_fim: z.string().regex(HORA_REGEX, 'Use o formato "HH:MM".'),
    // Sem default aqui de propósito (BLOQUEIO B12): quando ausente, a rota lê
    // `configuracoes.agenda.duracao_padrao_minutos` — nunca uma constante de TS.
    duracao_minutos: z.number().int().positive().max(480).optional(),
    vale_de: z.string().date().optional(),
    vale_ate: z.string().date().nullable().optional(),
  })
  .refine((v) => v.hora_fim > v.hora_inicio, {
    message: "`hora_fim` precisa ser depois de `hora_inicio`.",
    path: ["hora_fim"],
  });
export type CorpoCriarDisponibilidade = z.infer<typeof CorpoCriarDisponibilidadeSchema>;

export const CorpoAtualizarDisponibilidadeSchema = z
  .object({
    hora_inicio: z.string().regex(HORA_REGEX, 'Use o formato "HH:MM".').optional(),
    hora_fim: z.string().regex(HORA_REGEX, 'Use o formato "HH:MM".').optional(),
    duracao_minutos: z.number().int().positive().max(480).optional(),
    vale_ate: z.string().date().nullable().optional(),
    ativa: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Corpo vazio: nada para atualizar." });
export type CorpoAtualizarDisponibilidade = z.infer<typeof CorpoAtualizarDisponibilidadeSchema>;

export const CorpoCriarBloqueioSchema = z
  .object({
    advogada_id: z.string().uuid(),
    inicio_em: z.string().datetime({ offset: true }),
    fim_em: z.string().datetime({ offset: true }),
    motivo: z.string().trim().min(1).max(500),
  })
  .refine((v) => new Date(v.fim_em) > new Date(v.inicio_em), {
    message: "`fim_em` precisa ser depois de `inicio_em`.",
    path: ["fim_em"],
  });
export type CorpoCriarBloqueio = z.infer<typeof CorpoCriarBloqueioSchema>;

export const ParametroSlotsSchema = z.object({
  advogada_id: z.string().uuid(),
  de: z.string().datetime({ offset: true }).optional(),
  ate: z.string().datetime({ offset: true }).optional(),
});
export type ParametroSlots = z.infer<typeof ParametroSlotsSchema>;

// ---------------------------------------------------------------------------
// Contrato de saída de `GET /api/painel` — espelha `src/types/painel-ui.ts`
// (F-1B, arquivo deles) do lado do servidor. Mantido como cópia deliberada,
// mesmo racional do comentário de topo daquele arquivo: os dois lados não
// devem se importar um ao outro, para uma mudança de forma não acoplar front
// e back num arquivo compartilhado que nenhum dos dois é dono sozinho.
// ---------------------------------------------------------------------------

export interface SessaoDoDiaLinha {
  jornada_id: string;
  nome: string;
  inicio_em: string;
  fim_em: string;
  status: Extract<StatusAgendamento, "agendado" | "confirmado">;
  link_sala: string | null;
  advogada_id: string | null;
  advogada_nome: string | null;
  tem_briefing: boolean;
  /** 0051/0052 (agente A) — opcional até a view ganhar a coluna. */
  presenca_confirmada_em?: string | null;
  presenca_confirmada_via?: string | null;
}

export interface PendenciaPreparoLinha {
  jornada_id: string;
  nome: string;
  inicio_em: string;
  falta_formulario: boolean;
  falta_ligacao: boolean;
  falta_briefing: boolean;
}

export interface PagoSemContatoLinha {
  jornada_id: string;
  nome: string;
  pago_em: string;
  dias_desde_pagamento: number;
}

export type TipoPendenciaSistema =
  | "webhook_falho"
  | "mensagem_falhou"
  | "link_expirando"
  | "material_aguardando_aprovacao"
  | "cron_parado"
  | "sessao_sem_sala"
  | "ligacao_ia_falhou"
  | (string & {});

export interface PendenciaSistemaLinha {
  id: string;
  tipo: TipoPendenciaSistema;
  titulo: string;
  descricao: string | null;
  jornada_id: string | null;
  pessoa_nome: string | null;
  ocorrido_em: string | null;
}

export interface IndicadorEdicaoLinha {
  edicao_id: string | null;
  edicao_codigo: string | null;
  edicao_nome: string | null;
  compareceram: number;
  sessoes_com_desfecho: number;
  formularios_respondidos: number;
  clientes_pagantes: number;
  com_decisores: number;
  com_resposta_decisores: number;
}

export interface RespostaPainel {
  gerado_em: string;
  sessoes_do_dia: SessaoDoDiaLinha[];
  pendencias_preparo: PendenciaPreparoLinha[];
  pagos_sem_contato: PagoSemContatoLinha[];
  pendencias_sistema: PendenciaSistemaLinha[];
  indicadores_semana: IndicadorEdicaoLinha[];
}
