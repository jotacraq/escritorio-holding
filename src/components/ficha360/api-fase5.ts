/**
 * Cliente das três rotas da Fase 5 na Ficha do cliente (M2, §8.2–§8.3):
 * automações, radar de documentos e sub-esteira de execução.
 *
 * O que este arquivo existe para resolver: **"indisponível" não é "vazio"**.
 * Enquanto a migration correspondente não estiver aplicada, a rota responde
 * 503 rotulado; mostrar uma lista vazia diria "o sistema não fez nada" — que
 * é mentira. Por isso toda busca devolve um envelope com três estados
 * possíveis: `ok` (tem dado), `indisponivel` (a rota disse que não dá) e
 * `erro` (falhou de verdade). A tela decide o que dizer em cada um.
 */
import { ApiError } from "@/lib/api";
import type {
  CorpoRadarPedir,
  RespostaAutomacoes,
  RespostaExecucao,
  RespostaRadar,
  RespostaRadarPedir,
} from "@/types/jornada-automacoes";

export type Envelope<T> = { estado: "ok"; dados: T } | { estado: "indisponivel"; motivo: string } | { estado: "erro"; motivo: string };

async function buscar<T>(caminho: string): Promise<Envelope<T>> {
  let resposta: Response;
  try {
    resposta = await fetch(caminho, { credentials: "include" });
  } catch {
    return { estado: "erro", motivo: "Sem conexão com o servidor." };
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
    const motivo = objeto.mensagem || `Falha na requisição (${resposta.status})`;
    // 503 é o "ainda não existe neste banco" que o M2 rotulou; 403/404 é
    // recorte de papel. Nenhum dos dois é erro de rede — não peça "tente de
    // novo" para quem não pode resolver clicando.
    if (resposta.status === 503 || resposta.status === 403 || resposta.status === 404) return { estado: "indisponivel", motivo };
    return { estado: "erro", motivo };
  }
  return { estado: "ok", dados: corpo as T };
}

export function buscarAutomacoes(jornadaId: string) {
  return buscar<RespostaAutomacoes>(`/api/jornadas/${jornadaId}/automacoes`);
}

export function buscarRadar(jornadaId: string) {
  return buscar<RespostaRadar>(`/api/jornadas/${jornadaId}/radar`);
}

export function buscarExecucao(jornadaId: string) {
  return buscar<RespostaExecucao>(`/api/jornadas/${jornadaId}/execucao`);
}

/**
 * "Pedir agora" — grava `documentos_pedidos` e enfileira UMA mensagem com o
 * link `/p/d`. `enfileiradas: 0` com `motivo` preenchido é caso normal (já
 * pedido hoje, idempotência da 0013): quem chama mostra o motivo, não um erro.
 */
export async function pedirDocumentos(jornadaId: string, chaves: string[]): Promise<RespostaRadarPedir> {
  const corpo: CorpoRadarPedir = { chaves };
  const resposta = await fetch(`/api/jornadas/${jornadaId}/radar/pedir`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  const texto = await resposta.text();
  let dados: unknown = null;
  if (texto) {
    try {
      dados = JSON.parse(texto);
    } catch {
      dados = null;
    }
  }
  if (!resposta.ok) {
    const objeto = (dados ?? {}) as { erro?: string; mensagem?: string; codigo?: string };
    throw new ApiError(objeto.mensagem || `Falha ao pedir (${resposta.status})`, resposta.status, objeto.codigo ?? objeto.erro);
  }
  return dados as RespostaRadarPedir;
}
