import type { NomeIcone } from "./icones";

/**
 * Catálogo único de estados (Fase 8, D19).
 *
 * **Nenhuma tela escolhe `tom` na mão a partir da Fase 8.** O tom é do
 * ESTADO, não da tela: se "reembolsado" é vermelho aqui, é vermelho na Ficha,
 * na lista de Clientes, no Admin e na impressão. Era assim que a mesma
 * situação aparecia âmbar num lugar e cinza no outro.
 *
 * As chaves são os valores REAIS do banco (enum ou `check`), nunca um
 * vocabulário paralelo — quem tem o valor na mão faz `estadoDe("pagamento",
 * linha.status)` e recebe rótulo, glifo e tom prontos. Chave desconhecida
 * devolve `null`, e o `SeloEstado` mostra "Sem informação": estado que o
 * catálogo não conhece nunca vira um rótulo plausível inventado.
 *
 * Módulo puro (sem React, sem fetch) — serve tela, `title`, teste de mesa e
 * exportação.
 */

export type TomEstado = "verde" | "ambar" | "vermelho" | "azul" | "latao" | "neutro";

export interface DefinicaoEstado {
  /** O que aparece na tela. ≤ 4 palavras (lei de texto, DS §2.2). */
  rotulo: string;
  /** Glifo distinto dentro do domínio — é o que sobra em grayscale. */
  icone: NomeIcone;
  tom: TomEstado;
  /** Uma frase para o `title`. Nunca renderizada dentro do fluxo. */
  explique?: string;
}

const CROQUI = {
  /* As seis fases do croqui (ARQUITETURA-FASE-8 §B1). O enum `status_croqui`
     do banco só tem três valores — as outras três fases são derivadas de
     `croqui_calculos`. O catálogo fala a língua da FASE, não a do enum. */
  sem_croqui: { rotulo: "Croqui não iniciado", icone: "vazio", tom: "neutro", explique: "Ainda não existe croqui para este processo." },
  rascunho: { rotulo: "Em rascunho", icone: "lapis", tom: "ambar", explique: "O croqui existe, mas ainda não tem cálculo." },
  calculado: { rotulo: "Calculado", icone: "calculadora", tom: "azul", explique: "O motor já calculou pelo menos uma versão." },
  fixado: { rotulo: "Versão fixada", icone: "alfinete", tom: "azul", explique: "Uma das versões calculadas é a vigente." },
  pronto: { rotulo: "Pronto para apresentar", icone: "check", tom: "verde", explique: "O croqui está fechado e pode ir para a reunião." },
  apresentado: { rotulo: "Apresentado", icone: "apresentacao", tom: "verde", explique: "O croqui já foi apresentado ao cliente." },
} as const;

const CROQUI_FATO = {
  /* Não são fase: são FATOS que acontecem em qualquer fase e ganham chip
     próprio ao lado do selo (§B1). */
  exportado: { rotulo: "Exportado", icone: "download", tom: "neutro", explique: "O documento do croqui já foi baixado." },
  narrado: { rotulo: "Com narrativa", icone: "fala", tom: "neutro", explique: "As notas do apresentador já foram geradas." },
} as const;

const PAGAMENTO = {
  /* Valores do enum `status_pagamento`. Os três últimos entram com a migration
     0083 (Fase 8, frente A) — o rótulo já existe aqui porque quem mostra o
     selo é a tela, e ela não pode ficar sem rótulo no dia em que o primeiro
     boleto chegar. Enquanto a migration não roda, nenhuma linha carrega esses
     valores e nenhum selo aparece. */
  pendente: { rotulo: "Aguardando pagamento", icone: "relogio", tom: "ambar", explique: "A compra foi registrada e o pagamento ainda não confirmou." },
  em_analise: { rotulo: "Em análise", icone: "lupa", tom: "azul", explique: "A operadora ainda está analisando a compra." },
  aprovado: { rotulo: "Pago", icone: "check", tom: "verde", explique: "Pagamento confirmado pela Hotmart." },
  boleto_gerado: { rotulo: "Boleto gerado, não pago", icone: "boleto", tom: "ambar", explique: "O boleto foi emitido; o dinheiro ainda não entrou." },
  atrasado: { rotulo: "Pagamento atrasado", icone: "sino", tom: "ambar", explique: "A operadora avisou que a cobrança está em atraso." },
  expirado: { rotulo: "Boleto vencido", icone: "calendario", tom: "vermelho", explique: "O boleto venceu sem pagamento. Não fecha o processo por si só." },
  cancelado: { rotulo: "Compra cancelada", icone: "x", tom: "vermelho", explique: "A compra foi cancelada antes de se concluir." },
  reembolsado: { rotulo: "Reembolsado", icone: "voltar", tom: "vermelho", explique: "O valor voltou para o cliente. O que já aconteceu não é apagado." },
  estornado: { rotulo: "Estornado", icone: "alerta", tom: "vermelho", explique: "Contestação de cobrança (chargeback/protesto)." },
} as const;

const PROCESSO = {
  /* Valores do enum `desfecho_jornada`. "congelada" aparece na tela como
     **Arquivado** — é a ordem do João e a entrada nova do Glossário. */
  aberta: { rotulo: "Em andamento", icone: "seta", tom: "azul", explique: "O processo está aberto e caminhando." },
  ganha: { rotulo: "Ganho", icone: "check-duplo", tom: "verde", explique: "A holding foi contratada." },
  perdida: { rotulo: "Perdido", icone: "x", tom: "vermelho", explique: "O cliente decidiu não seguir." },
  descartada: { rotulo: "Descartado", icone: "traco", tom: "neutro", explique: "O processo não era elegível ou era duplicado." },
  congelada: { rotulo: "Arquivado", icone: "arquivo", tom: "neutro", explique: "Processo parado, arquivado sem afirmar ganho nem perda. É reversível." },
  /* 0079 — LGPD art. 18: não é veredito comercial, é o encerramento do tratamento a pedido do titular. */
  anonimizada: { rotulo: "Anonimizado", icone: "vazio", tom: "neutro", explique: "O titular exerceu o direito de anonimização. O tratamento foi encerrado." },
} as const;

const PRAZO = {
  /* Derivados por `Prazo`/`classificarPrazo()`, não vêm do banco. Prazo tem
     tom PRÓPRIO, separado do status do andamento (padrão ADVBOX/Astrea). */
  vencido: { rotulo: "Vencido", icone: "alerta", tom: "vermelho", explique: "A data-limite já passou." },
  hoje: { rotulo: "Vence hoje", icone: "sino", tom: "ambar", explique: "A data-limite é hoje." },
  proximo: { rotulo: "Vence em breve", icone: "relogio", tom: "ambar", explique: "Faltam três dias ou menos." },
  futuro: { rotulo: "No prazo", icone: "calendario", tom: "neutro", explique: "Ainda há folga até a data-limite." },
  sem_prazo: { rotulo: "Sem prazo", icone: "traco", tom: "neutro", explique: "Nada foi marcado — não é o mesmo que estar em dia." },
} as const;

const AGENDAMENTO = {
  /* Valores do enum `status_agendamento` — o estado do HORÁRIO.
     A correção da rodada FIX é `confirmado`. A decisão **C23**
     (`docs/ARQUITETURA-FASE-4.md:1047`) diz, com todas as letras:
     *"`status='confirmado'` já significa 'cliente escolheu o horário' (link
     público), não 'cliente confirmou presença'"* — a presença de verdade mora
     na coluna `agendamentos.presenca_confirmada_em`, criada justamente para
     não mudar o sentido do enum. O catálogo dizia "Confirmado · o cliente
     confirmou presença", que é a leitura ERRADA: a Agenda mostraria "horário
     escolhido pelo cliente" e "aguardando confirmação de presença" como se
     fossem a mesma coisa, e uma contradiz a outra. Os rótulos abaixo são os
     que a própria C23 fixou: "Horário marcado" e "Presença confirmada". */
  agendado: { rotulo: "Horário definido", icone: "calendario", tom: "azul", explique: "A equipe marcou o horário; o cliente ainda não escolheu nem confirmou." },
  confirmado: { rotulo: "Horário marcado", icone: "check", tom: "azul", explique: "O cliente escolheu este horário pelo link público (C23). Não é confirmação de presença." },
  realizado: { rotulo: "Realizado", icone: "check-duplo", tom: "verde", explique: "A sessão aconteceu." },
  nao_compareceu: { rotulo: "Não compareceu", icone: "vazio", tom: "vermelho", explique: "O horário passou sem o cliente." },
  cancelado: { rotulo: "Cancelado", icone: "x", tom: "vermelho", explique: "O horário foi cancelado." },
  remarcado: { rotulo: "Remarcado", icone: "repetir", tom: "ambar", explique: "O horário mudou de data." },
} as const;

/**
 * Nome antigo do domínio acima, mantido como ALIAS.
 *
 * Ele nasceu chamado `presenca` na Rodada 0, e o nome estava errado desde o
 * começo: estas chaves são o estado do HORÁRIO (`status_agendamento`), e a
 * presença de verdade é outra informação, na coluna `presenca_confirmada_em`
 * (é a C23 inteira). A Agenda do UX3 já consome `dominio="presenca"` e tem o
 * próprio `SeloPresenca` para a coluna — trocar a string na tela dele é uma
 * palavra, mas é arquivo de outro dono nesta rodada. Alias resolve hoje sem
 * quebrar ninguém: `presenca` e `agendamento` são o MESMO objeto, então não
 * há como divergirem. **Em código novo, use `agendamento`.**
 */
const PRESENCA = AGENDAMENTO;

const INTEGRACAO = {
  /* O que Admin → Integrações realmente emite hoje (`IntegracaoEstado`,
     `types/integracoes.ts:195`, e `IntegracoesAba.tsx:96,102,164`). Não é
     enum de banco: é derivado de `configurado` + `pendencia` + o teste de
     conexão. Os quatro primeiros substituem `<Selo tom="verde">Ligada</Selo>`
     e companhia, escolhidos na mão em quatro pontos da aba. */
  ligada: { rotulo: "Ligada", icone: "check", tom: "verde", explique: "Configurada no servidor e sem pendência." },
  parcial: { rotulo: "Ligada, com pendência", icone: "alerta", tom: "ambar", explique: "As variáveis existem, mas falta algo para ela funcionar de ponta a ponta." },
  desligada: { rotulo: "Falta configurar", icone: "traco", tom: "ambar", explique: "Faltam variáveis no servidor. Nada é enviado nem recebido por aqui." },
  erro: { rotulo: "Não respondeu", icone: "x", tom: "vermelho", explique: "O teste de conexão falhou. Configurada, mas o outro lado não respondeu." },
  desconhecida: { rotulo: "Estado desconhecido", icone: "interrogacao", tom: "neutro", explique: "O servidor está sem a chave que lê o estado — não é o mesmo que estar desligada." },
} as const;

const MENSAGEM = {
  /* Valores do enum `status_mensagem`. */
  pendente: { rotulo: "Na fila", icone: "relogio", tom: "neutro", explique: "Vai sair no horário programado." },
  enviando: { rotulo: "Enviando", icone: "aviao", tom: "azul", explique: "O envio começou agora." },
  enviada: { rotulo: "Enviada", icone: "check", tom: "verde", explique: "O provedor aceitou a mensagem." },
  falhou: { rotulo: "Falhou", icone: "alerta", tom: "vermelho", explique: "O envio não foi aceito. A mensagem continua registrada." },
  cancelada: { rotulo: "Cancelada", icone: "x", tom: "neutro", explique: "O envio foi cancelado antes de sair." },
} as const;

export const ESTADOS = {
  croqui: CROQUI,
  croqui_fato: CROQUI_FATO,
  pagamento: PAGAMENTO,
  processo: PROCESSO,
  prazo: PRAZO,
  agendamento: AGENDAMENTO,
  /** @deprecated alias de `agendamento` — ver o comentário de `PRESENCA`. */
  presenca: PRESENCA,
  mensagem: MENSAGEM,
  integracao: INTEGRACAO,
} as const satisfies Record<string, Record<string, DefinicaoEstado>>;

export type DominioEstado = keyof typeof ESTADOS;
export type ChaveEstado<D extends DominioEstado> = keyof (typeof ESTADOS)[D] & string;

/** O selo mostrado quando o valor não existe ou o catálogo não o conhece. */
export const ESTADO_SEM_INFORMACAO: DefinicaoEstado = {
  rotulo: "Sem informação",
  icone: "interrogacao",
  tom: "neutro",
  explique: "O sistema ainda não sabe este estado — campo vazio não é o mesmo que estado neutro.",
};

/**
 * Traduz o valor do banco para o selo. `null` quando o domínio não conhece a
 * chave: quem chama decide entre não mostrar nada ou mostrar
 * `ESTADO_SEM_INFORMACAO` (é o que o `SeloEstado` faz).
 *
 * `Object.hasOwn`: `constructor`/`__proto__` vindos de um valor de banco
 * inesperado não podem cair no protótipo (mesma trava de `rotuloOpcao`).
 */
export function estadoDe(dominio: DominioEstado, chave: string | null | undefined): DefinicaoEstado | null {
  if (typeof chave !== "string" || chave.length === 0) return null;
  const tabela: Record<string, DefinicaoEstado> = ESTADOS[dominio];
  if (!Object.hasOwn(tabela, chave)) return null;
  return tabela[chave];
}

/** Só o rótulo — para `title`, `aria-label` e texto corrido. */
export function rotuloEstado(dominio: DominioEstado, chave: string | null | undefined): string {
  return (estadoDe(dominio, chave) ?? ESTADO_SEM_INFORMACAO).rotulo;
}

/* -------------------------------------------------------------------------- */
/* Integração                                                                  */
/* -------------------------------------------------------------------------- */

export type ClasseIntegracao = ChaveEstado<"integracao">;

/**
 * Traduz o que a API de Integrações devolve para uma chave do catálogo.
 *
 * Recebe primitivos (e não `IntegracaoEstado`) de propósito: `lib/estados` é
 * um dicionário de apresentação e não deve depender do tipo de uma API — o
 * dia em que a rota ganhar um campo, o catálogo não precisa saber.
 *
 * A ordem das perguntas é a ordem da gravidade, e `desconhecida` vem primeiro:
 * sem a chave do servidor o Admin **não sabe** o estado, e "não sei" jamais
 * pode ser mostrado como "desligada" (regra "vazio é vazio" do DS §7).
 */
export function classificarIntegracao(entrada: {
  /** `null`/`undefined` = o servidor não informou (sem `SUPABASE_SERVICE_ROLE_KEY`). */
  configurado: boolean | null | undefined;
  /** Texto de pendência que a própria API manda; vazio/`null` = nenhuma. */
  pendencia?: string | null;
  /** Resultado do último teste de conexão, quando houve teste. */
  testeOk?: boolean | null;
}): ClasseIntegracao {
  if (entrada.configurado === null || entrada.configurado === undefined) return "desconhecida";
  if (entrada.testeOk === false) return "erro";
  if (!entrada.configurado) return "desligada";
  if (typeof entrada.pendencia === "string" && entrada.pendencia.trim().length > 0) return "parcial";
  return "ligada";
}

/* -------------------------------------------------------------------------- */
/* Prazo                                                                       */
/* -------------------------------------------------------------------------- */

export type ClassePrazo = ChaveEstado<"prazo">;

/**
 * Classifica uma data-limite contra "hoje". Compara por DIA no fuso local
 * (não por instante): um prazo que vence hoje às 8h não pode virar "vencido"
 * às 9h — para o advogado, o prazo é do dia.
 *
 * `agora` é injetável para o teste não depender do relógio.
 */
export function classificarPrazo(vence: Date | string | null | undefined, agora: Date = new Date()): ClassePrazo {
  if (vence === null || vence === undefined || vence === "") return "sem_prazo";
  const data = vence instanceof Date ? vence : interpretarData(vence);
  if (!data || Number.isNaN(data.getTime())) return "sem_prazo";
  const dias = diferencaEmDias(data, agora);
  if (dias < 0) return "vencido";
  if (dias === 0) return "hoje";
  if (dias <= 3) return "proximo";
  return "futuro";
}

/**
 * `2026-09-07` (um `date` do Postgres) não pode passar pelo `new Date()`
 * direto: a string sem hora é lida como UTC e, em São Paulo (UTC−3), vira o
 * dia ANTERIOR às 21h. Prazo de hoje apareceria vencido. Data pura é montada
 * como data local; timestamp com hora segue o caminho normal.
 */
function interpretarData(texto: string): Date | null {
  const soData = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (soData) return new Date(Number(soData[1]), Number(soData[2]) - 1, Number(soData[3]));
  const d = new Date(texto);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Diferença em dias de calendário (não em múltiplos de 24h). */
export function diferencaEmDias(alvo: Date, referencia: Date): number {
  const a = Date.UTC(alvo.getFullYear(), alvo.getMonth(), alvo.getDate());
  const b = Date.UTC(referencia.getFullYear(), referencia.getMonth(), referencia.getDate());
  return Math.round((a - b) / 86_400_000);
}
