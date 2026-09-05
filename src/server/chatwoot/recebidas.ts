import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizarTelefoneE164, variantesTelefone } from "@/server/integracoes/telefone";
import type { MensagemRecebida } from "@/types/integracoes";

/**
 * Persistência de mensagem RECEBIDA (webhook do Chatwoot → `mensagens_recebidas`,
 * 0054). Casa a pessoa pelo telefone E.164; sem match fica `pessoa_id null`
 * ("Sem correspondência" na tela) — nunca casa com a pessoa errada.
 */

/** Forma mínima do `message_created` do Chatwoot que este módulo lê. */
export interface EventoChatwoot {
  event?: string;
  id?: number | string;
  content?: string | null;
  message_type?: string | number;
  private?: boolean;
  created_at?: string | number;
  attachments?: Array<{ file_type?: string; data_url?: string; extension?: string | null }>;
  conversation?: { id?: number | string; inbox_id?: number | string };
  inbox?: { id?: number | string };
  sender?: { id?: number; name?: string | null; phone_number?: string | null; identifier?: string | null };
}

export function eMensagemRecebida(evento: EventoChatwoot): boolean {
  if (evento.event !== "message_created") return false;
  const tipo = evento.message_type;
  if (tipo === "incoming" || tipo === 0) return evento.private !== true;
  return false;
}

export async function resolverPessoaPorTelefone(
  admin: SupabaseClient,
  telefone: string | null,
): Promise<{ pessoaId: string | null; jornadaId: string | null }> {
  if (!telefone) return { pessoaId: null, jornadaId: null };
  const { data: pessoa } = await admin
    .from("pessoas")
    .select("id")
    .in("telefone", variantesTelefone(telefone))
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (!pessoa) return { pessoaId: null, jornadaId: null };
  const { data: jornada } = await admin
    .from("jornadas")
    .select("id")
    .eq("pessoa_id", pessoa.id)
    .eq("desfecho", "aberta")
    .maybeSingle<{ id: string }>();
  return { pessoaId: pessoa.id, jornadaId: jornada?.id ?? null };
}

function instante(valor: string | number | undefined): string {
  if (typeof valor === "number") return new Date(valor < 1e12 ? valor * 1000 : valor).toISOString();
  if (typeof valor === "string") {
    const d = new Date(valor);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

export type ResultadoRegistrarRecebida =
  | { situacao: "gravada"; mensagem: MensagemRecebida }
  | { situacao: "duplicada" }
  | { situacao: "ignorada"; motivo: string };

export async function registrarMensagemRecebida(admin: SupabaseClient, evento: EventoChatwoot): Promise<ResultadoRegistrarRecebida> {
  if (!eMensagemRecebida(evento)) return { situacao: "ignorada", motivo: "evento_nao_e_mensagem_recebida" };

  const mensagemExternaId = evento.id != null ? String(evento.id) : null;
  const conversaExternaId = evento.conversation?.id != null ? String(evento.conversation.id) : null;
  if (!mensagemExternaId || !conversaExternaId) return { situacao: "ignorada", motivo: "sem_id_de_mensagem_ou_conversa" };

  const anexos = (evento.attachments ?? []).slice(0, 20).map((a) => ({
    tipo: a.file_type ?? null,
    url: a.data_url ?? null,
    nome: a.extension ?? null,
  }));
  const corpo = (evento.content ?? "").toString().slice(0, 20_000) || (anexos.length > 0 ? "[anexo]" : "");
  if (!corpo) return { situacao: "ignorada", motivo: "mensagem_vazia" };

  const telefone = normalizarTelefoneE164(evento.sender?.phone_number ?? evento.sender?.identifier ?? null);
  const { pessoaId, jornadaId } = await resolverPessoaPorTelefone(admin, telefone);

  const { data, error } = await admin
    .from("mensagens_recebidas")
    .insert({
      canal: "whatsapp",
      provedor: "chatwoot",
      conversa_externa_id: conversaExternaId,
      mensagem_externa_id: mensagemExternaId,
      telefone,
      pessoa_id: pessoaId,
      jornada_id: jornadaId,
      corpo,
      anexos,
      recebida_em: instante(evento.created_at),
      bruto: evento,
    })
    .select("id, canal, provedor, conversa_externa_id, mensagem_externa_id, telefone, pessoa_id, jornada_id, corpo, anexos, recebida_em, vinculada_por, vinculada_em, criado_em")
    .single();

  if (error) {
    if (error.code === "23505") return { situacao: "duplicada" };
    throw error;
  }
  return { situacao: "gravada", mensagem: data as MensagemRecebida };
}

/**
 * "Vincular a uma pessoa" (tela Comunicação → Sem correspondência). Usa a RPC
 * da 0054 com o cliente de SESSÃO (RLS + papel valem); a jornada é derivada
 * (a aberta da pessoa). Route handler fica com o dono de `/api/mensagens/**`
 * (agente A) ou Onda 2 — este helper é o contrato.
 */
export async function vincularMensagemRecebida(
  supabase: SupabaseClient,
  params: { mensagemId: string; pessoaId: string },
): Promise<MensagemRecebida> {
  const { data, error } = await supabase
    .rpc("vincular_mensagem_recebida", { p_mensagem_id: params.mensagemId, p_pessoa_id: params.pessoaId })
    .single();
  if (error) throw error;
  return data as MensagemRecebida;
}
