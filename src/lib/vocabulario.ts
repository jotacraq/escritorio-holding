/**
 * Dicionário único de vocabulário da interface (Fase 5, §9.2).
 *
 * A regra do João: **sem sigla no fluxo**. A tela fala a língua de quem usa
 * ("Ligação estratégica", "mensagens automáticas", "caminho do cliente"); a
 * sigla do método (POP 03, DISC, régua, esteira, cron) vira detalhe — vai no
 * `title` do elemento ou no texto de uma `Dica`, onde só encontra quem
 * procura.
 *
 * O `Glossario.md` do brain manda: onde ele define o nome do negócio
 * (Sessão de Viabilidade, Croqui Estrutural, Briefing Estratégico, Arquétipo
 * Patrimonial), o nome fica — traduzir ali seria inventar um segundo
 * vocabulário para a mesma casa.
 *
 * Módulo puro, sem React e sem fetch: serve tela, `title`, `aria-label`,
 * teste de mesa e (na Onda 2) exportação.
 */

export interface Termo {
  /** O que aparece na tela. Rótulo ≤ 3 palavras sempre que couber. */
  humano: string;
  /** A sigla/jargão do método. Vai para `title`, nunca para o fluxo. */
  sigla?: string;
  /** Uma frase para `Dica`/"Como funciona". Nunca renderizada inline. */
  explique?: string;
  /** `true` = termo de infraestrutura: só pode aparecer para admin. */
  soAdmin?: boolean;
}

export const VOCABULARIO = {
  // --- POPs do método -----------------------------------------------------
  pop01: {
    humano: "Indicadores do método",
    sigla: "POP 01",
    explique: "Os três números que o método acompanha por edição do seminário.",
  },
  pop02: {
    humano: "Formulário do cliente",
    sigla: "POP 02",
    explique: "17 perguntas, até 3 minutos, respondidas antes da sessão.",
  },
  pop03: {
    humano: "Ligação estratégica",
    sigla: "POP 03",
    explique: "Ligação humana de até 5 minutos, antes da sessão, feita pelo relacionamento.",
  },

  // --- Nomes do negócio (Glossario.md manda: mantêm) ----------------------
  sessao_viabilidade: {
    humano: "Sessão de Viabilidade",
    sigla: "SV",
    explique: "Reunião técnica paga que diagnostica se a holding serve para aquela família.",
  },
  croqui: {
    humano: "Croqui Estrutural",
    explique: "Estudo técnico pago: a planta baixa da holding, com cenários, custos e impostos.",
  },
  briefing_entregavel: {
    humano: "Briefing Estratégico",
    explique: "O que a IA prepara antes da sessão: perfil de decisão, motivador, objeção provável.",
  },
  arquetipo: {
    humano: "Arquétipo Patrimonial",
    explique: "Construtor, Patriarca, Protetor, Empresário, Planejador, Investidor ou Realizador.",
  },
  holding: { humano: "Holding" },

  // --- Jargão que sai da tela --------------------------------------------
  briefing_etapa: {
    humano: "Preparo da sessão",
    sigla: "briefing",
    explique: "O que precisa estar pronto antes de entrar na sala.",
  },
  regua: {
    humano: "Mensagens automáticas",
    sigla: "régua",
    explique: "A sequência de e-mail e WhatsApp que o sistema dispara sozinho ao longo da jornada.",
  },
  esteira: {
    humano: "Caminho do cliente",
    sigla: "esteira",
    explique: "Do seminário à holding contratada, etapa por etapa.",
  },
  disc: {
    humano: "Perfil de decisão",
    sigla: "DISC",
    explique: "Inferido da linguagem e da velocidade de decisão — nunca da profissão ou da idade.",
  },
  mql: {
    humano: "Acima de R$ 1 milhão",
    sigla: "MQL",
    explique: "O corte de patrimônio declarado que o método usa como interesse comercial.",
  },
  imposto_renda: {
    humano: "Imposto de renda",
    sigla: "IR",
    explique: "A última declaração de imposto de renda da pessoa física — a base de valor do patrimônio.",
  },
  diagnostico: {
    humano: "Diagnóstico",
    sigla: "Diagnóstico da SV",
    explique: "O parecer que a advogada monta depois da Sessão de Viabilidade.",
  },
  quadro: { humano: "Quadro", sigla: "kanban" },
  linha_de_custo: { humano: "Linha de custo", sigla: "rubrica" },
  procedencia: { humano: "De onde veio o número", sigla: "procedência" },

  // --- Infraestrutura: só admin, e sempre em 1 linha ----------------------
  envio_automatico: {
    humano: "Envio automático",
    sigla: "cron da régua",
    explique: "Um serviço externo chama o sistema a cada 5 minutos para soltar as mensagens da vez.",
    soAdmin: true,
  },
  provedor_ligacao: { humano: "Provedor da ligação por IA", sigla: "Vapi", soAdmin: true },
  provedor_whatsapp: { humano: "Central de WhatsApp", sigla: "Chatwoot", soAdmin: true },
  provedor_automacao: { humano: "Automações externas", sigla: "n8n", soAdmin: true },
  provedor_email: { humano: "Provedor de e-mail", sigla: "Resend", soAdmin: true },
  aviso_pagamento: { humano: "Aviso de pagamento", sigla: "webhook", soAdmin: true },
  chave_servidor: {
    humano: "Chave do servidor ausente",
    sigla: "SUPABASE_SERVICE_ROLE_KEY",
    explique: "Sem essa chave o servidor não escreve; a mensagem fica na fila até alguém configurar.",
    soAdmin: true,
  },
  envio_indisponivel: {
    humano: "Envio indisponível agora",
    sigla: "503",
    explique: "O servidor recusou o envio. A mensagem continua na fila e ninguém perde nada.",
  },
} as const satisfies Record<string, Termo>;

export type ChaveVocabulario = keyof typeof VOCABULARIO;

/** O que vai na tela. Sempre o nome humano — nunca a sigla. */
export function rotulo(chave: ChaveVocabulario): string {
  return VOCABULARIO[chave].humano;
}

/**
 * O que vai no atributo `title` (e só ali): a sigla do método, para quem
 * procura o termo antigo. `undefined` quando o termo não tem sigla — assim o
 * JSX pode passar `title={titleDe(...)}` sem checar.
 */
export function titleDe(chave: ChaveVocabulario): string | undefined {
  const termo: Termo = VOCABULARIO[chave];
  return termo.sigla;
}

/** A frase de `Dica`/"Como funciona". Nunca renderizada dentro do fluxo. */
export function explicacaoDe(chave: ChaveVocabulario): string | undefined {
  const termo: Termo = VOCABULARIO[chave];
  return termo.explique;
}

/** `true` quando o termo é de infraestrutura e não pode aparecer a não-admin. */
export function ehTermoDeSistema(chave: ChaveVocabulario): boolean {
  const termo: Termo = VOCABULARIO[chave];
  return termo.soAdmin === true;
}

/* -------------------------------------------------------------------------- */
/* Rótulo que vem do BANCO                                                     */
/* -------------------------------------------------------------------------- */

const CHAVES_COM_SIGLA: ChaveVocabulario[] = (Object.keys(VOCABULARIO) as ChaveVocabulario[]).filter(
  (chave) => titleDe(chave) !== undefined,
);

/**
 * Traduz um rótulo vindo de tabela de catálogo do banco (hoje
 * `etapas_jornada_ordem.rotulo`, ex.: **"Qualificado (MQL)"**) para a língua da
 * tela, sem migration: a sigla entre parênteses sai do fluxo e vira `title`,
 * como manda o §9.2 ("sem sigla no fluxo").
 *
 * Por que no cliente e não no seed: o rótulo do banco é dado de catálogo que o
 * Admin pode editar, e `etapas_jornada_ordem` alimenta relatório e API além da
 * tela. Reescrever a linha mudaria o nome da etapa para todo mundo — inclusive
 * para quem exporta. Aqui só a apresentação muda.
 *
 * Casa apenas a forma ` (SIGLA)`, e apenas siglas que o dicionário conhece:
 * um rótulo novo que ninguém mapeou passa intacto (nunca some texto do banco).
 */
export function rotuloDeEtapa(rotuloDoBanco: string): { rotulo: string; title?: string } {
  let texto = rotuloDoBanco;
  const detalhes: string[] = [];

  for (const chave of CHAVES_COM_SIGLA) {
    const sigla = titleDe(chave);
    if (!sigla) continue;
    const marcado = ` (${sigla})`;
    if (!texto.includes(marcado)) continue;
    texto = texto.replace(marcado, "");
    const explicacao = explicacaoDe(chave);
    detalhes.push(explicacao ? `${sigla} · ${explicacao}` : sigla);
  }

  const limpo = texto.trim();
  return {
    rotulo: limpo.length > 0 ? limpo : rotuloDoBanco,
    title: detalhes.length > 0 ? detalhes.join(" · ") : undefined,
  };
}
