import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cliente admin vem sem generic Database
type ClienteAdmin = SupabaseClient<any, any, any>;

const ON_CONFLICT = "origem,evento_externo_id";

/**
 * Livro-razão `webhooks_eventos` (0011) — a idempotência é do banco (unique
 * `(origem, evento_externo_id)`), nunca de cache em memória. Este módulo é a
 * ÚNICA implementação da reserva do id de evento; Hotmart (fase 1), n8n/sala e
 * n8n/ligacao seguem o mesmo contrato:
 *
 *   - tentativa com assinatura INVÁLIDA fica registrada (sinal de segurança),
 *     mas nunca sobrescreve uma linha existente (`ignoreDuplicates`);
 *   - entrega VÁLIDA de um id que só tinha tentativa inválida SUBSTITUI o bruto
 *     (`assinatura_valida=true`, `processado_em=null`) e segue para processar —
 *     quem adivinha o id_evento antes do provedor não "ocupa" o evento
 *     (pentest fase 4, BAIXO 4; mesma correção que o Hotmart recebeu na fase 1);
 *   - id válido já processado → `ja_processado` (200 reentrega, nada é tocado);
 *   - id válido existente e NÃO processado (falhou antes) → reprocessa.
 */

export interface TentativaInvalida {
  origem: string;
  idEvento: string;
  tipoEvento: string | null;
  bruto: unknown;
  /** Motivo curto (`assinatura_invalida`, `timestamp_fora_da_janela`). */
  erro?: string;
  /** `true` = não aparece como `webhook_falho` em `vw_pendencias_sistema` (processado_em preenchido). */
  encerrar?: boolean;
}

export async function registrarTentativaInvalida(supabaseAdmin: ClienteAdmin, t: TentativaInvalida): Promise<void> {
  await supabaseAdmin.from("webhooks_eventos").upsert(
    {
      origem: t.origem,
      evento_externo_id: t.idEvento,
      tipo_evento: t.tipoEvento,
      assinatura_valida: false,
      bruto: t.bruto,
      erro: t.erro ?? null,
      processado_em: t.encerrar ? new Date().toISOString() : null,
    },
    { onConflict: ON_CONFLICT, ignoreDuplicates: true },
  );
}

export type ReservaEvento =
  | { tipo: "processar"; id: string; reentrega: boolean }
  | { tipo: "ja_processado" }
  | { tipo: "erro"; etapa: "persistir" | "ler_existente" | "substituir_invalido"; erro: unknown };

export interface EventoValido {
  origem: string;
  idEvento: string;
  tipoEvento: string | null;
  bruto: unknown;
}

/** Reserva (ou recupera) a linha do livro-razão para uma entrega VÁLIDA. */
export async function reservarEventoWebhook(supabaseAdmin: ClienteAdmin, e: EventoValido): Promise<ReservaEvento> {
  const { data: inserido, error: erroInsercao } = await supabaseAdmin
    .from("webhooks_eventos")
    .upsert(
      { origem: e.origem, evento_externo_id: e.idEvento, tipo_evento: e.tipoEvento, assinatura_valida: true, bruto: e.bruto },
      { onConflict: ON_CONFLICT, ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle<{ id: string }>();
  if (erroInsercao) return { tipo: "erro", etapa: "persistir", erro: erroInsercao };
  if (inserido) return { tipo: "processar", id: inserido.id, reentrega: false };

  const { data: existente, error: erroExistente } = await supabaseAdmin
    .from("webhooks_eventos")
    .select("id, processado_em, assinatura_valida")
    .eq("origem", e.origem)
    .eq("evento_externo_id", e.idEvento)
    .maybeSingle<{ id: string; processado_em: string | null; assinatura_valida: boolean }>();
  if (erroExistente || !existente) {
    return { tipo: "erro", etapa: "ler_existente", erro: erroExistente ?? new Error("linha do livro-razão sumiu entre o upsert e a leitura") };
  }

  if (existente.processado_em && existente.assinatura_valida) return { tipo: "ja_processado" };

  if (!existente.assinatura_valida) {
    const { error: erroSubstituir } = await supabaseAdmin
      .from("webhooks_eventos")
      .update({ assinatura_valida: true, bruto: e.bruto, tipo_evento: e.tipoEvento, erro: null, processado_em: null })
      .eq("id", existente.id);
    if (erroSubstituir) return { tipo: "erro", etapa: "substituir_invalido", erro: erroSubstituir };
  }

  return { tipo: "processar", id: existente.id, reentrega: true };
}
