/**
 * Cliente de "Arquivar processo" e do Desfazer (Fase 8, D15–D17).
 *
 * Módulo por feature, ao lado do componente que o consome — o `chamar` de
 * `src/lib/api.ts` não é exportado e aquele módulo está travado (§6 regra 1).
 * Mesmo padrão de `api-analise.ts` e `components/sessao/api.ts`: um wrapper
 * fino de `fetch`, com uma classe de erro própria no formato de `ApiError`.
 *
 * O código do erro importa mais que a mensagem: `jornada_aberta_existente` é o
 * único caso em que o Desfazer falha por uma razão que a pessoa PODE resolver
 * (fechar o outro processo), e a tela precisa distinguir isso de uma falha de
 * rede para dizer o que fazer.
 */

export class ErroArquivamento extends Error {
  constructor(
    mensagem: string,
    readonly status: number,
    readonly codigo?: string,
  ) {
    super(mensagem);
    this.name = "ErroArquivamento";
  }
}

/** O que a RPC devolve, contado — a tela mostra estes números, nunca estima. */
export interface ResultadoArquivamento {
  jornada_id: string;
  desfecho: string;
  motivo?: string;
  mensagens_canceladas?: number;
  ligacoes_canceladas?: number;
  links_revogados?: number;
  mensagens_reagendadas?: number;
  ligacoes_nao_refeitas?: number;
}

/** O formato de `respostaErro` (`src/server/erros.ts`): `{ erro, mensagem }`. */
interface CorpoErro {
  erro?: string;
  mensagem?: string;
}

async function postar(url: string, corpo?: unknown): Promise<ResultadoArquivamento> {
  const resposta = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
  });

  const texto = await resposta.text();
  let dados: unknown = null;
  try {
    dados = texto ? JSON.parse(texto) : null;
  } catch {
    dados = null;
  }

  if (!resposta.ok) {
    const erro = (dados ?? {}) as CorpoErro;
    // Sem mensagem legível do servidor, a tela NÃO inventa diagnóstico: diz
    // que não deu e mantém o estado anterior visível.
    throw new ErroArquivamento(
      erro.mensagem ?? "Não foi possível concluir. O processo continua como estava.",
      resposta.status,
      erro.erro,
    );
  }

  const corpoOk = (dados ?? {}) as { resultado?: ResultadoArquivamento };
  if (!corpoOk.resultado) {
    throw new ErroArquivamento("O servidor respondeu sem o resultado da ação.", resposta.status);
  }
  return corpoOk.resultado;
}

export function arquivarProcesso(jornadaId: string, params: { motivo: string; revogarLinks: boolean }) {
  return postar(`/api/jornadas/${jornadaId}/arquivar`, { motivo: params.motivo, revogarLinks: params.revogarLinks });
}

export function desarquivarProcesso(jornadaId: string) {
  return postar(`/api/jornadas/${jornadaId}/desarquivar`);
}

/**
 * A frase do toast, montada só com o que a RPC contou. Zero é dito por
 * extenso ("nada estava agendado") em vez de omitido: "arquivado" sozinho
 * deixa a pessoa sem saber se a régua parou ou se não havia régua.
 */
export function resumoDoArquivamento(r: ResultadoArquivamento): string {
  const partes: string[] = [];
  const msgs = r.mensagens_canceladas ?? 0;
  const ligs = r.ligacoes_canceladas ?? 0;
  const links = r.links_revogados ?? 0;

  partes.push(msgs === 0 ? "nenhuma mensagem estava agendada" : msgs === 1 ? "1 mensagem cancelada" : `${msgs} mensagens canceladas`);
  if (ligs > 0) partes.push(ligs === 1 ? "1 ligação tirada da fila" : `${ligs} ligações tiradas da fila`);
  if (links > 0) partes.push(links === 1 ? "1 link revogado" : `${links} links revogados`);

  return partes.join(" · ");
}

/** A frase do toast do Desfazer, na mesma régua. */
export function resumoDoDesarquivamento(r: ResultadoArquivamento): string {
  const partes: string[] = [];
  const msgs = r.mensagens_reagendadas ?? 0;
  const ligs = r.ligacoes_nao_refeitas ?? 0;

  partes.push(msgs === 0 ? "nenhuma mensagem voltou para a fila" : msgs === 1 ? "1 mensagem voltou para a fila" : `${msgs} mensagens voltaram para a fila`);
  if (ligs > 0) {
    partes.push(ligs === 1 ? "1 ligação por IA não foi refeita" : `${ligs} ligações por IA não foram refeitas`);
  }
  if (r.desfecho === "ganha") {
    // A máquina de estados manda: processo em "Holding contratada" volta como
    // Ganho, não como Em andamento. Dizer isso evita a impressão de bug.
    partes.push("o processo voltou como Ganho (holding já contratada)");
  }
  return partes.join(" · ");
}
