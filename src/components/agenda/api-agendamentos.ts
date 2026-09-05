/**
 * Cliente HTTP dos agendamentos vistos pela Agenda (Fase 4). `lib/api.ts` é
 * fronteira travada: o `Agendamento` de lá não conhece `presenca_confirmada_em`
 * nem o `PATCH {presenca_confirmada: true}` (0051, agente A). Tudo que é novo
 * vive aqui; `atualizarAgendamento` (status/remarcar) continua vindo de lá.
 */
import { ApiError } from "@/lib/api";
import type { AgendamentoAgenda } from "@/types/agenda";

export { ApiError };

async function chamar<T>(caminho: string, init?: RequestInit): Promise<{ status: number; corpo: T | null }> {
  let resposta: Response;
  try {
    resposta = await fetch(caminho, {
      credentials: "include",
      ...init,
      headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
    });
  } catch {
    throw new ApiError("Sem conexão com o servidor. Verifique a rede e tente de novo.", 0, "rede");
  }
  const texto = await resposta.text();
  let corpo: unknown = null;
  if (texto) {
    try {
      corpo = JSON.parse(texto);
    } catch {
      corpo = null;
    }
  }
  if (!resposta.ok) {
    const objeto = (corpo ?? {}) as { erro?: string; mensagem?: string };
    throw new ApiError(objeto.mensagem || objeto.erro || `Falha na requisição (${resposta.status})`, resposta.status, objeto.erro);
  }
  return { status: resposta.status, corpo: corpo as T };
}

function paraQueryString(params: Record<string, string | undefined>): string {
  const busca = new URLSearchParams();
  for (const [chave, valor] of Object.entries(params)) if (valor) busca.set(chave, valor);
  const texto = busca.toString();
  return texto ? `?${texto}` : "";
}

/**
 * `GET /api/agendamentos` — próximos agendamentos ativos, ordenados por
 * início. Devolve `null` se a rota não existir (404/501): a tela mostra
 * "indisponível", não "vazio".
 */
export async function listarAgendamentos(params: { de?: string; ate?: string } = {}): Promise<{ itens: AgendamentoAgenda[] } | null> {
  try {
    const { corpo } = await chamar<{ itens: AgendamentoAgenda[] }>(`/api/agendamentos${paraQueryString(params)}`);
    return corpo;
  } catch (erro) {
    if (erro instanceof ApiError && (erro.status === 404 || erro.status === 501)) return null;
    throw erro;
  }
}

/**
 * Confirmação de presença pela equipe (fallback do WhatsApp, B34):
 * `PATCH /api/agendamentos/[id] {presenca_confirmada: true}` — contrato do
 * agente A. Enquanto a rota não aceitar o campo, ela responde 400/422 e o
 * toast diz que ainda não está disponível.
 */
export async function confirmarPresencaPelaEquipe(id: string): Promise<AgendamentoAgenda> {
  const { corpo } = await chamar<{ agendamento: AgendamentoAgenda }>(`/api/agendamentos/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ presenca_confirmada: true }),
  });
  if (!corpo?.agendamento) throw new ApiError("O servidor respondeu sem o agendamento atualizado.", 200, "contrato");
  return corpo.agendamento;
}
