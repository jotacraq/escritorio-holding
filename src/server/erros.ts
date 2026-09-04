import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { ZodError } from "zod";

/**
 * Erro de API com contexto explícito: código semântico + status HTTP.
 * Toda rota deve lançar isto (ou deixar propagar um erro inesperado, que
 * `respostaErro` trata como 500) em vez de devolver `NextResponse` solto
 * espalhado pelo meio da lógica de negócio.
 */
export class ErroApi extends Error {
  readonly status: number;
  readonly codigo: string;
  readonly detalhes?: unknown;

  constructor(status: number, codigo: string, mensagem: string, detalhes?: unknown) {
    super(mensagem);
    this.name = "ErroApi";
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

export const erroNaoAutenticado = (mensagem = "Não autenticado.") =>
  new ErroApi(401, "nao_autenticado", mensagem);

export const erroSemPermissao = (mensagem = "Sem permissão para este recurso.") =>
  new ErroApi(403, "sem_permissao", mensagem);

export const erroNaoEncontrado = (mensagem = "Recurso não encontrado.") =>
  new ErroApi(404, "nao_encontrado", mensagem);

export const erroConflito = (codigo: string, mensagem: string, detalhes?: unknown) =>
  new ErroApi(409, codigo, mensagem, detalhes);

export const erroValidacao = (detalhes: unknown, mensagem = "Corpo da requisição inválido.") =>
  new ErroApi(422, "validacao_invalida", mensagem, detalhes);

/**
 * Grava o erro em lugar consultável (stdout estruturado — o Node App da Hostinger
 * não tem Sentry integrado neste MVP; server-only, nunca expõe stack ao cliente).
 * Todo `catch` do projeto deve passar por aqui. Nunca `catch {}`.
 */
export function registrarErro(contexto: string, erro: unknown, extra?: Record<string, unknown>) {
  const id = randomUUID();
  const detalhe =
    erro instanceof Error
      ? { nome: erro.name, mensagem: erro.message, stack: erro.stack }
      : { valor: erro };

  console.error(
    JSON.stringify({
      nivel: "error",
      id_erro: id,
      contexto,
      ...detalhe,
      ...extra,
      ocorrido_em: new Date().toISOString(),
    }),
  );

  persistirErro(id, contexto, detalhe, extra);

  return id;
}

/**
 * Grava o mesmo erro em `erros_servidor` (0046), com o MESMO id que a resposta
 * HTTP devolve ao cliente.
 *
 * Existe porque o stdout do Node App da Hostinger não é consultável de fora do
 * painel: dois 500 desta base já custaram horas de adivinhação por isso. Quem
 * recebe "Contate o suporte, id X" agora vira uma linha localizável.
 *
 * Regras que este caminho NUNCA pode quebrar:
 * - **Não bloqueia.** É fire-and-forget: quem falhou já está falhando, não pode
 *   esperar por um INSERT nem falhar de novo por causa dele.
 * - **Não lança.** Todo erro daqui morre aqui. Chamar `registrarErro` de dentro
 *   deste catch criaria recursão infinita — por isso o `console.error` cru.
 * - **Não trava sem service_role.** Sem a chave, só o stdout registra, como antes.
 */
function persistirErro(
  id: string,
  contexto: string,
  detalhe: Record<string, unknown>,
  extra?: Record<string, unknown>,
) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) return;

  void (async () => {
    try {
      const { criarClienteAdmin } = await import("@/lib/supabase/admin");
      const { perfil_id: perfilId, ...restoExtra } = (extra ?? {}) as Record<string, unknown>;
      await criarClienteAdmin()
        .from("erros_servidor")
        .insert({
          id,
          contexto,
          nome: typeof detalhe.nome === "string" ? detalhe.nome : null,
          mensagem:
            typeof detalhe.mensagem === "string"
              ? detalhe.mensagem
              : detalhe.valor === undefined
                ? null
                : String(detalhe.valor),
          pilha: typeof detalhe.stack === "string" ? detalhe.stack : null,
          extra: Object.keys(restoExtra).length > 0 ? restoExtra : null,
          perfil_id: typeof perfilId === "string" ? perfilId : null,
        });
    } catch (falhaAoGravar) {
      // Deliberadamente cru: registrarErro() aqui dentro seria recursão.
      console.error(
        JSON.stringify({
          nivel: "error",
          contexto: "server/erros.persistirErro",
          id_erro_original: id,
          mensagem: falhaAoGravar instanceof Error ? falhaAoGravar.message : String(falhaAoGravar),
        }),
      );
    }
  })();
}

/**
 * Converte qualquer erro capturado numa rota em `NextResponse` semântica,
 * sem nunca vazar stack trace ou id interno de linha para o cliente.
 */
export function respostaErro(contexto: string, erro: unknown, extra?: Record<string, unknown>) {
  if (erro instanceof ErroApi) {
    if (erro.status >= 500) {
      registrarErro(contexto, erro, extra);
    }
    return NextResponse.json(
      { erro: erro.codigo, mensagem: erro.message, detalhes: erro.detalhes },
      { status: erro.status },
    );
  }

  if (erro instanceof ZodError) {
    return NextResponse.json(
      { erro: "validacao_invalida", mensagem: "Corpo da requisição inválido.", detalhes: erro.issues },
      { status: 422 },
    );
  }

  const idErro = registrarErro(contexto, erro, extra);
  return NextResponse.json(
    { erro: "erro_interno", mensagem: "Erro interno. Contate o suporte.", id_erro: idErro },
    { status: 500 },
  );
}
