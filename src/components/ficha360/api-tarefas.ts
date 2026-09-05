/**
 * Tarefas (0027 + `tipo` 0051, agente A) — `GET/PATCH /api/tarefas/[id]` e
 * `POST /api/tarefas/[id]/mensagem`. Usado pelo cartão "Enviar link do
 * croqui" da aba Sessão (Fase 4 §1.4).
 */
import { chamar } from "./api";
import type { Tarefa } from "@/types/banco";

export type PendenciaMensagemCroqui = "url_checkout_ausente" | "oferta_ausente" | "data_apresentacao_ausente" | "link_documentos_ausente" | "template_ausente";

export interface MensagemCroquiPronta {
  canal: "whatsapp";
  corpo: string;
  pendencias: PendenciaMensagemCroqui[];
  valor_croqui: number | null;
}

export interface RespostaTarefa {
  tarefa: Tarefa;
  mensagem_pronta: MensagemCroquiPronta | null;
}

export function buscarTarefa(id: string): Promise<RespostaTarefa> {
  return chamar<RespostaTarefa>(`/api/tarefas/${id}`);
}

/** Re-renderiza a mensagem pronta com o link `/p/d` que a tela acabou de emitir. */
export function renderizarMensagemTarefa(id: string, linkDocumentos?: string): Promise<MensagemCroquiPronta> {
  return chamar<{ mensagem_pronta: MensagemCroquiPronta }>(`/api/tarefas/${id}/mensagem`, {
    method: "POST",
    body: JSON.stringify(linkDocumentos ? { link_documentos: linkDocumentos } : {}),
  }).then((d) => d.mensagem_pronta);
}

/** "Marquei como enviado" — conclui a tarefa; o banco carimba quem/quando. */
export function concluirTarefa(id: string, nota?: string): Promise<Tarefa> {
  return chamar<{ tarefa: Tarefa }>(`/api/tarefas/${id}`, {
    method: "PATCH",
    body: JSON.stringify(nota ? { concluida: true, nota } : { concluida: true }),
  }).then((d) => d.tarefa);
}
