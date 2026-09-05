/**
 * Cliente de API da tela Comunicação (`/comunicacao`). Rotas de
 * `/api/mensagens/**` (agente A + recebidas desta onda) e o bloco
 * `pendencias_sistema` de `/api/painel` (única rota de `vw_pendencias_sistema`
 * aberta a todo interno — a de Admin é só admin).
 *
 * Núcleo HTTP compartilhado com o Admin (`components/admin/http.ts`).
 * `src/lib/api.ts` tem um `listarMensagens` mais antigo, sem `regua` nem
 * `template_chave` — esta camada substitui aquele uso nesta tela.
 */

import type { CanalMensagem, StatusMensagem } from "@/lib/api";
import type { MensagemRecebidaItem, RespostaMensagensRecebidas } from "@/app/api/mensagens/recebidas/route";
import type { EstadoRegua } from "@/app/api/mensagens/route";
import type { PendenciaSistemaLinha } from "@/types/agenda";
import { chamar, chamarBruto, erroDaResposta } from "@/components/admin/http";

export type { CanalMensagem, StatusMensagem, EstadoRegua, MensagemRecebidaItem, RespostaMensagensRecebidas };

/** Item de `GET /api/mensagens` (forma do agente A, 0051). */
export interface MensagemDaFila {
  id: string;
  jornada_id: string;
  agendamento_id: string | null;
  pessoa_nome?: string;
  canal: CanalMensagem;
  destinatario: string;
  agendada_para: string;
  status: StatusMensagem;
  corpo_renderizado: string | null;
  /** Ainda tem `{{link_*}}` — chamar `preparar` antes de copiar. */
  precisa_preparar: boolean;
  erro: string | null;
  enviada_em: string | null;
  tentativas: number;
  proxima_tentativa_em: string | null;
  template_chave: string | null;
}

export interface RespostaMensagens {
  itens: MensagemDaFila[];
  regua: EstadoRegua;
}

export function listarMensagens(params: { status?: StatusMensagem; canal?: CanalMensagem } = {}) {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.canal) query.set("canal", params.canal);
  const sufixo = query.toString();
  return chamar<RespostaMensagens>(`/api/mensagens${sufixo ? `?${sufixo}` : ""}`);
}

export type ResultadoPreparar =
  | { situacao: "pronta"; corpo: string; preparada: boolean }
  /** 409 `sessao_sem_sala` e afins — dado que falta, não erro. */
  | { situacao: "falta_dado"; codigo: string; mensagem: string }
  /** 503 — servidor sem `SUPABASE_SERVICE_ROLE_KEY`. */
  | { situacao: "indisponivel"; mensagem: string };

/**
 * POST /api/mensagens/[id]/preparar — resolve `{{link_*}}` e congela o texto.
 * 409/503 são resultados esperados da operação (a tela explica o que fazer),
 * por isso não viram `ApiError`.
 */
export async function prepararMensagem(id: string): Promise<ResultadoPreparar> {
  const { status, corpo } = await chamarBruto<{ corpo?: string; preparada?: boolean; erro?: string; mensagem?: string }>(
    `/api/mensagens/${id}/preparar`,
    { method: "POST" },
  );
  if (status === 409) {
    return { situacao: "falta_dado", codigo: corpo?.erro ?? "conflito", mensagem: corpo?.mensagem ?? "Falta um dado para montar esta mensagem." };
  }
  if (status === 503) {
    return { situacao: "indisponivel", mensagem: corpo?.mensagem ?? "Envio indisponível: falta SUPABASE_SERVICE_ROLE_KEY no servidor." };
  }
  if (status < 200 || status >= 300) throw erroDaResposta(status, corpo);
  return { situacao: "pronta", corpo: corpo?.corpo ?? "", preparada: corpo?.preparada ?? false };
}

/** PATCH /api/mensagens/[id] {status:'enviada'} — "enviei à mão" (RPC `marcar_mensagem_manual`, 0019). */
export function marcarMensagemEnviada(id: string) {
  return chamar<{ mensagem: MensagemDaFila }>(`/api/mensagens/${id}`, { method: "PATCH", body: JSON.stringify({ status: "enviada" }) });
}

// ---------------------------------------------------------------------------
// Recebidas (Chatwoot, 0054)
// ---------------------------------------------------------------------------

export function listarMensagensRecebidas(params: { semVinculo?: boolean; limite?: number } = {}) {
  const query = new URLSearchParams();
  if (params.semVinculo) query.set("sem_vinculo", "true");
  if (params.limite) query.set("limite", String(params.limite));
  const sufixo = query.toString();
  return chamar<RespostaMensagensRecebidas>(`/api/mensagens/recebidas${sufixo ? `?${sufixo}` : ""}`);
}

export function vincularMensagemRecebida(id: string, pessoaId: string) {
  return chamar<{ mensagem: MensagemRecebidaItem }>(`/api/mensagens/recebidas/${id}/vincular`, {
    method: "POST",
    body: JSON.stringify({ pessoa_id: pessoaId }),
  });
}

// ---------------------------------------------------------------------------
// Pendências do sistema (vw_pendencias_sistema via /api/painel — interno)
// ---------------------------------------------------------------------------

export type PendenciaSistemaComunicacao = PendenciaSistemaLinha;

/** Só o bloco `pendencias_sistema` do Painel do Dia; o resto da resposta é descartado. */
export async function buscarPendenciasSistema(): Promise<PendenciaSistemaComunicacao[]> {
  const resposta = await chamar<{ pendencias_sistema?: PendenciaSistemaLinha[] }>("/api/painel");
  return resposta.pendencias_sistema ?? [];
}
