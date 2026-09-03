/**
 * As 4 RPCs públicas nunca lançam exceção para um "caso ruim" esperado — elas devolvem
 * `jsonb` com uma chave `erro`. Isto existe para que a rota NÃO precise decidir status
 * a partir de mensagem de exceção (frágil) e para manter o mesmo caminho de código para
 * todo caso de token inválido (regra dura 3, §2.2: erro único, sem oráculo).
 */
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
      return 422;
    // Demais são regra de negócio legítima e não vazam nada sobre outra jornada/pessoa
    // (ex.: horario_indisponivel, limite_arquivos_atingido, arquivo_duplicado,
    // limite_remarcacoes, agendamento_indisponivel, formulario_indisponivel) — 409.
    default:
      return 409;
  }
}

export function ehRespostaDeErro(valor: unknown): valor is { erro: string } {
  return typeof valor === "object" && valor !== null && "erro" in valor && typeof (valor as { erro: unknown }).erro === "string";
}
