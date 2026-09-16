import { ErroSessao } from "@/components/sessao/api";

/** Rótulo humano de cada código de recusa (§ contrato). Cada código tem causa
 * distinta — nunca um "tente novamente" genérico: `timeout_copiloto` convida
 * a tentar de novo, `teto_ia_copiloto_atingido` diz explicitamente que não
 * adianta insistir hoje, `copiloto_ia_nao_ativada` aponta para Admin. */
export const MENSAGENS_RECUSA: Record<string, { titulo: string; descricao: string; podeTentarDeNovo: boolean }> = {
  copiloto_ia_nao_ativada: {
    titulo: "Copiloto de IA ainda não ativado",
    descricao: "O prompt do copiloto está desligado por configuração. A equipe técnica liga isso em Admin — a sessão segue normalmente pelo roteiro.",
    podeTentarDeNovo: false,
  },
  teto_ia_copiloto_atingido: {
    titulo: "Limite de sugestões de hoje atingido",
    descricao: "Esta sessão (ou o dia) já usou o orçamento de chamadas de IA do copiloto. Não adianta tentar de novo agora — o roteiro determinístico continua disponível.",
    podeTentarDeNovo: false,
  },
  timeout_copiloto: {
    titulo: "A sugestão não chegou a tempo",
    descricao: "A IA não respondeu em 8 segundos. Pode tentar de novo.",
    podeTentarDeNovo: true,
  },
  copiloto_ao_vivo_bloqueado: {
    titulo: "Copiloto ao vivo bloqueado",
    descricao: "O copiloto de IA está bloqueado por configuração no servidor. Não é algo que se resolve tentando de novo — fale com a equipe técnica.",
    podeTentarDeNovo: false,
  },
  recusa_ia: {
    titulo: "A IA recusou responder desta vez",
    descricao: "Pode tentar de novo — às vezes é um caso isolado.",
    podeTentarDeNovo: true,
  },
  saida_invalida: {
    titulo: "A resposta da IA não pôde ser validada",
    descricao: "Pode tentar de novo.",
    podeTentarDeNovo: true,
  },
  conteudo_proibido: {
    titulo: "A sugestão foi descartada",
    descricao: "O conteúdo continha algo que o copiloto nunca deve mostrar (ex.: valor em reais). Nada foi exibido.",
    podeTentarDeNovo: false,
  },
};

export function mensagemRecusa(erro: unknown): { titulo: string; descricao: string; podeTentarDeNovo: boolean } {
  if (erro instanceof ErroSessao && erro.codigo && MENSAGENS_RECUSA[erro.codigo]) {
    return MENSAGENS_RECUSA[erro.codigo];
  }
  return {
    titulo: "Não foi possível pedir a sugestão",
    descricao: erro instanceof ErroSessao ? erro.message : "Erro inesperado. Tente de novo em instantes.",
    podeTentarDeNovo: true,
  };
}
