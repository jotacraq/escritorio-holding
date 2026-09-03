/**
 * Erros tipados da camada de IA. Local a `src/server/ia/` — não confundir com
 * `src/server/erros.ts` (do BACK-CORE, fora da fronteira deste agente).
 */
export class ErroIa extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly codigo: string,
  ) {
    super(message);
    this.name = "ErroIa";
  }
}

export function erroServicoIndisponivel(motivo: string): ErroIa {
  return new ErroIa(motivo, 503, "servico_indisponivel");
}

export function erroNaoEncontrado(motivo: string): ErroIa {
  return new ErroIa(motivo, 404, "nao_encontrado");
}

export function erroValidacao(motivo: string): ErroIa {
  return new ErroIa(motivo, 400, "validacao");
}

/**
 * ALTO 2 (pentest 03/09/2026): sem `tem_consentimento(pessoa,'tratamento_ia')`,
 * a Agente do Croqui não pode rodar — diferente do Briefing (§4.4), aqui não
 * existe modo reduzido: a análise só faz sentido sobre transcrição e valores
 * reais de patrimônio, e mandar isso à Anthropic sem consentimento registrado
 * é o cenário que a trava do Briefing já existe para evitar.
 */
export function erroConsentimentoAusente(motivo: string): ErroIa {
  return new ErroIa(motivo, 409, "consentimento_ausente");
}
