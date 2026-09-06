/**
 * As 4 RPCs públicas nunca lançam exceção para um "caso ruim" esperado — elas devolvem
 * `jsonb` com uma chave `erro`. Isto existe para que a rota NÃO precise decidir status
 * a partir de mensagem de exceção (frágil) e para manter o mesmo caminho de código para
 * todo caso de token inválido (regra dura 3, §2.2: erro único, sem oráculo).
 */
import type { ErroPublico } from "@/types/publico";

export function statusParaErroPublico(codigo: string): number {
  switch (codigo) {
    case "link_invalido":
      return 404;
    case "limite_excedido":
      return 429;
    case "origem_nao_autorizada":
      return 403;
    case "servico_indisponivel":
    case "envio_indisponivel":
      return 503;
    case "arquivo_invalido":
    case "respostas_invalidas":
    // 0081/0082: o corpo é sintaticamente válido, mas não satisfaz a definição
    // ATIVA do formulário — 422 (entidade não processável), nunca 409. 409
    // seria "estado do servidor conflita"; aqui quem precisa mudar é o corpo,
    // e a resposta diz exatamente qual pergunta mudar.
    case "resposta_obrigatoria":
    case "opcao_invalida":
      return 422;
    // Demais são regra de negócio legítima e não vazam nada sobre outra jornada/pessoa
    // (ex.: horario_indisponivel, limite_arquivos_atingido, arquivo_duplicado,
    // limite_remarcacoes, agendamento_indisponivel, formulario_indisponivel) — 409.
    default:
      return 409;
  }
}

export function ehRespostaDeErro(valor: unknown): valor is { erro: string; pergunta?: unknown } {
  return typeof valor === "object" && valor !== null && "erro" in valor && typeof (valor as { erro: unknown }).erro === "string";
}

/**
 * Monta o corpo que a rota devolve a partir do `{erro, ...}` da RPC.
 *
 * A RPC anexa `pergunta` a `resposta_obrigatoria`/`opcao_invalida` (0081/0082)
 * e a rota tem de repassar: sem isso a tela do cliente sabe que falhou e não
 * sabe onde — vira "tente de novo em instantes" para um erro que nunca vai
 * passar sozinho. Só esta chave a mais atravessa, e só quando é `string`: o
 * resto do jsonb da RPC não é contrato público e não vaza.
 */
export function corpoDeErroPublico(dados: { erro: string; pergunta?: unknown }): ErroPublico {
  const corpo: ErroPublico = { erro: dados.erro as ErroPublico["erro"] };
  if (typeof dados.pergunta === "string" && dados.pergunta.length > 0) corpo.pergunta = dados.pergunta;
  return corpo;
}
