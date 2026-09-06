/**
 * Núcleo HTTP da camada de acesso à API do SIC-HF.
 *
 * Módulo interno de `@/lib/api`: `chamarOpcional` e `paraQueryString` NÃO são
 * reexportados pelo barril — quem chama a API de fora usa as funções de
 * domínio, nunca o transporte cru.
 */

export class ApiError extends Error {
  status: number;
  codigo?: string;
  /** Payload estruturado do erro (ex.: checklist da porta de completude do Briefing, `erro.detalhe` em `server/ia/erros.ts`). */
  detalhe?: unknown;
  constructor(mensagem: string, status: number, codigo?: string, detalhe?: unknown) {
    super(mensagem);
    this.name = "ApiError";
    this.status = status;
    this.codigo = codigo;
    this.detalhe = detalhe;
  }
}

/** Indica que o recurso não está disponível no backend ainda (contrato assumido). */
export class RecursoIndisponivelError extends ApiError {}

export async function chamar<T>(caminho: string, init?: RequestInit): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(caminho, {
      credentials: "include",
      ...init,
      headers: {
        ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
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
    // `respostaErro` (server/erros.ts) devolve { erro: <código técnico>, mensagem: <texto humano> }.
    // A mensagem humana tem que vencer — senão a tela mostra o código cru
    // ("nao_encontrado") em vez do texto pensado para o usuário. `objeto.erro`
    // vira o campo `codigo` da ApiError, não o texto exibido. `detalhe` (singular,
    // `POST /api/briefings/gerar`) carrega o checklist da porta de completude.
    // `detalhes` (plural) é o do `respostaErro` genérico (server/erros.ts:135)
    // e passa a ser repassado também (05/09/2026, Fase 5 M4): sem isso, o 409
    // `parametro_ausente` do croqui chegava à tela sem a lista de chaves, e a
    // advogada via "erro ao salvar" no lugar de "falta o ITCMD de MG".
    const objeto = (corpo ?? {}) as {
      erro?: string;
      mensagem?: string;
      codigo?: string;
      detalhe?: unknown;
      detalhes?: unknown;
    };
    const mensagem = objeto.mensagem || `Falha na requisição (${resposta.status})`;
    throw new ApiError(mensagem, resposta.status, objeto.codigo ?? objeto.erro, objeto.detalhe ?? objeto.detalhes);
  }

  return corpo as T;
}

/** Para endpoints assumidos: 404/501 vira "indisponível" em vez de erro fatal. */
export async function chamarOpcional<T>(caminho: string, init?: RequestInit): Promise<T | null> {
  try {
    return await chamar<T>(caminho, init);
  } catch (erro) {
    if (erro instanceof ApiError && (erro.status === 404 || erro.status === 501)) {
      return null;
    }
    throw erro;
  }
}

export function paraQueryString(params: Record<string, string | number | boolean | undefined>): string {
  const busca = new URLSearchParams();
  for (const [chave, valor] of Object.entries(params)) {
    if (valor !== undefined && valor !== "") busca.set(chave, String(valor));
  }
  const texto = busca.toString();
  return texto ? `?${texto}` : "";
}
