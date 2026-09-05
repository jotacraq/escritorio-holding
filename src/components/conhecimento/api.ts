import type {
  CasoComTranscricoes,
  CasoConhecimentoLinha,
  ContagemDesfecho,
  DesfechoObservado,
  ResultadoBusca,
  TipoTranscricao,
  Transcricao,
} from "@/types/conhecimento";

/** Erro de API do domínio de conhecimento, com o status para a tela decidir o que dizer. */
export class ErroConhecimento extends Error {
  constructor(
    mensagem: string,
    readonly status: number,
  ) {
    super(mensagem);
    this.name = "ErroConhecimento";
  }
}

async function pegar<T>(url: string, signal?: AbortSignal): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(url, { headers: { Accept: "application/json" }, signal });
  } catch (erro) {
    if (erro instanceof DOMException && erro.name === "AbortError") throw erro;
    throw new ErroConhecimento("Sem conexão com o servidor. Confira a internet e tente de novo.", 0);
  }
  const corpo = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    const objeto = (corpo ?? {}) as { erro?: string; mensagem?: string };
    throw new ErroConhecimento(
      objeto.mensagem || objeto.erro || `Falha na requisição (${resposta.status})`,
      resposta.status,
    );
  }
  return corpo as T;
}

export function ehCancelamento(erro: unknown): boolean {
  return erro instanceof DOMException && erro.name === "AbortError";
}

export interface FiltroBusca {
  termo: string;
  tipo?: TipoTranscricao;
  desfecho?: DesfechoObservado;
}

/** Busca full-text; `signal` cancela a chamada anterior quando a pessoa continua digitando. */
export async function buscarNoConhecimento(filtro: FiltroBusca, signal?: AbortSignal): Promise<ResultadoBusca[]> {
  const params = new URLSearchParams({ termo: filtro.termo, limite: "40" });
  if (filtro.tipo) params.set("tipo", filtro.tipo);
  if (filtro.desfecho) params.set("desfecho", filtro.desfecho);
  const dados = await pegar<{ resultados: ResultadoBusca[] }>(`/api/conhecimento/busca?${params.toString()}`, signal);
  return dados.resultados ?? [];
}

export interface ListaCasos {
  casos: CasoConhecimentoLinha[];
  contagem_por_desfecho: ContagemDesfecho[];
}

export async function listarCasos(desfecho?: DesfechoObservado): Promise<ListaCasos> {
  const params = new URLSearchParams({ limite: "200" });
  if (desfecho) params.set("desfecho", desfecho);
  const dados = await pegar<ListaCasos>(`/api/conhecimento/casos?${params.toString()}`);
  return { casos: dados.casos ?? [], contagem_por_desfecho: dados.contagem_por_desfecho ?? [] };
}

export async function lerCaso(id: string): Promise<CasoComTranscricoes> {
  return pegar<CasoComTranscricoes>(`/api/conhecimento/casos/${id}`);
}

export async function lerTranscricao(id: string): Promise<Transcricao> {
  const dados = await pegar<{ transcricao: Transcricao }>(`/api/conhecimento/transcricoes/${id}`);
  return dados.transcricao;
}
