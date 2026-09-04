/**
 * Erros tipados da camada de IA. Local a `src/server/ia/` — não confundir com
 * `src/server/erros.ts` (do BACK-CORE, fora da fronteira deste agente).
 */
export class ErroIa extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly codigo: string,
    /**
     * Payload estruturado opcional (ex.: checklist da porta de completude,
     * ARQUITETURA-FASE-3.md §1.7). A rota que hoje consome `ErroIa`
     * (`src/app/api/briefings/gerar/route.ts`, fora da fronteira deste agente)
     * só repassa `codigo`/`message` — para a tela mostrar o checklist item a
     * item, quem tocar essa rota precisa incluir `erro.detalhe` na resposta.
     */
    public readonly detalhe?: unknown,
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

/**
 * Porta de completude (ARQUITETURA-FASE-3.md §1.7, L4): score de completude
 * abaixo do limiar de `configuracoes.ia.completude_minima_briefing`. `detalhe`
 * carrega o checklist item a item (sinal, peso, atendido) para a tela nunca
 * mostrar "erro" genérico — mostra o que falta e onde preencher. Contorna-se
 * com `forcar_mesmo_assim: true` (admin/advogada) — nunca em silêncio.
 */
export function erroDadosInsuficientes(motivo: string, detalhe: unknown): ErroIa {
  return new ErroIa(motivo, 409, "dados_insuficientes", detalhe);
}

/**
 * Cooldown (`ia.cooldown_segundos`) ou teto diário
 * (`ia.teto_execucoes_dia_por_usuario`) atingidos — `app.pode_executar_ia`,
 * banco desde a 0027, ligado em runtime pela primeira vez nesta onda
 * (ARQUITETURA-FASE-3.md §1.10). 429: o cliente pode tentar de novo mais
 * tarde, diferente de um erro de validação ou de serviço indisponível.
 */
export function erroLimiteIaAtingido(motivo: string): ErroIa {
  return new ErroIa(motivo, 429, "limite_ia_atingido");
}
