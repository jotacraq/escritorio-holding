/**
 * "Próximo passo e de quem é" — UMA função para todas as telas (Fase 4 §6.2).
 *
 * Entrada: `Sinais` (ver `sinais.ts`) — o que a tela já carrega, sem fetch.
 * Saída: o passo que destrava a jornada agora, quem tem de agir, a urgência e
 * para onde o clique leva (aba da Ficha 360).
 *
 * `dono` é QUEM PRECISA AGIR para o passo acontecer — não quem executa o
 * trabalho por baixo. "Gerar o Briefing" é `equipe` (alguém clica), embora a
 * IA escreva. `sistema` fica só para o que a esteira faz sozinha (régua de
 * mensagens, material pós-sessão automático). `cliente` é o que depende da
 * família (responder o formulário, confirmar presença, mandar documentos) — e
 * a ação da equipe, nesse caso, é reforçar. `ninguem` = nada pendente, ou sem
 * informação suficiente para afirmar (rotulado, nunca vazio mudo).
 *
 * Função pura, sem I/O. A precedência abaixo é a ordem do desenho §6.2, com
 * duas travas da regra "vazio é vazio":
 *  1. Um sinal `null` NUNCA vira alarme. Só `false` explícito dispara "falta".
 *  2. Um item cujo pré-requisito não chegou (ex.: relatório antes da sessão)
 *     não aparece — mesma regra `ainda_nao` de `derivar.ts`.
 *
 * ---------------------------------------------------------------------------
 * Urgência por proximidade da sessão: ≤ 3 dias = hoje · ≤ 7 dias = esta_semana · além = quando_der.
 *
 * TESTES DE MESA (uma linha por etapa da esteira; `s(...)` = sinais vazios +
 * campos listados). Rodar de cabeça ou colar num REPL — o resultado esperado
 * está na coluna da direita.
 *
 * | # | Sinais                                                                        | Esperado (chave · dono · urgência)      |
 * |---|-------------------------------------------------------------------------------|-----------------------------------------|
 * | 1 | s()                                                                           | sem_informacao · ninguem · quando_der   |
 * | 2 | etapa=captado, nivelPago=0                                                    | aguardar_compra · cliente · quando_der  |
 * | 3 | etapa=qualificado, nivelPago=0                                                | aguardar_compra · cliente · quando_der  |
 * | 4 | etapa=sessao_contratada, nivelPago=1, temLigacao=false                        | ligacao · equipe · hoje                 |
 * | 5 | etapa=sessao_contratada, nivelPago=1, temLigacao=true, proximaSessaoEm=null   | sessao (agendar) · equipe · esta_semana |
 * | 6 | etapa=sessao_agendada, sessão em 2 d, presencaConfirmada=false                | confirmar_presenca · cliente · hoje     |
 * | 7 | etapa=sessao_agendada, sessão em 5 d, presencaConfirmada=false                | confirmar_presenca · cliente · esta_semana |
 * | 8 | etapa=sessao_agendada, sessão em 5 d, presencaConfirmada=null (coluna ausente)| NÃO dispara confirmar_presenca (cai na próxima regra) |
 * | 9 | etapa=sessao_agendada, sessão em 10 h, presencaConfirmada=true, temLinkSala=false | colar_link_sala · equipe · hoje     |
 * |10 | etapa=sessao_agendada, sessão em 5 d, presença ok, temFormulario=false        | formulario · cliente · esta_semana      |
 * |11 | etapa=sessao_agendada, sessão em 5 d, tudo ok, temBriefing=false              | briefing · equipe · esta_semana         |
 * |12 | etapa=sessao_agendada, sessão em 5 d, tudo ok, temBriefing=true               | sessao (realizar) · advogada · esta_semana |
 * |13 | etapa=sessao_realizada, temRelatorio=false                                    | relatorio_sv · advogada · esta_semana   |
 * |14 | etapa=sessao_realizada, temRelatorio=true, materialEstado=nenhum              | material (gerar) · sistema · esta_semana|
 * |15 | etapa=sessao_realizada, temRelatorio=true, materialEstado=rascunho            | material (aprovar) · advogada · esta_semana |
 * |16 | etapa=sessao_realizada, materialEstado=aprovado, tarefasAbertas=[enviar_link_croqui] | enviar_link_croqui · advogada · hoje |
 * |17 | etapa=sessao_realizada, materialEstado=aprovado, tarefasAbertas=[]            | aguardar_croqui · cliente · quando_der  |
 * |18 | etapa=croqui_contratado, temDocumentos=false                                  | documentos · cliente · esta_semana      |
 * |19 | etapa=croqui_contratado, temDocumentos=true, croquiStatus=nenhum              | croqui (iniciar) · advogada · esta_semana |
 * |20 | etapa=croqui_contratado, temDocumentos=true, croquiStatus=rascunho            | croqui (concluir) · advogada · esta_semana |
 * |21 | etapa=croqui_contratado, temDocumentos=true, croquiStatus=pronto              | croqui (apresentar) · advogada · esta_semana |
 * |22 | etapa=croqui_apresentado                                                      | aguardar_holding · cliente · quando_der |
 * |23 | etapa=holding_contratada                                                      | concluido · ninguem · quando_der        |
 * |24 | (linha da agenda) etapa=null, nivelPago=1, sessão em 1 d, presencaConfirmada=false, temLinkSala=false | confirmar_presenca · cliente · hoje (presença vem antes da sala) |
 * |25 | (linha da agenda) etapa=null, sessão em 1 d, presencaConfirmada=null, temLinkSala=false | colar_link_sala · equipe · hoje |
 * |26 | (linha da agenda) etapa=null, sessão em 2 d, presencaConfirmada=null, temLinkSala=null, temBriefing=null | sessao (realizar) · advogada · hoje |
 * |27 | (pago sem contato) nivelPago=1, temLigacao=false                              | ligacao · equipe · hoje                 |
 * ---------------------------------------------------------------------------
 */
import type { EtapaJornada } from "@/lib/api";
import { rotulo, titleDe } from "@/lib/vocabulario";
import type { ChaveItemPasta } from "./catalogo";
import type { Sinais } from "./sinais";

export type DonoPasso = "equipe" | "advogada" | "cliente" | "sistema" | "ninguem";
export type UrgenciaPasso = "hoje" | "esta_semana" | "quando_der";

export type ChavePasso =
  | ChaveItemPasta
  | "confirmar_presenca"
  | "colar_link_sala"
  | "enviar_link_croqui"
  | "aguardar_compra"
  | "aguardar_croqui"
  | "aguardar_holding"
  | "concluido"
  | "sem_informacao";

export interface ProximoPasso {
  chave: ChavePasso;
  /**
   * O verbo, curto e humano — o que fazer ("Ligar para o cliente").
   *
   * Fase 5, lei de texto (§2 + §9.2): **≤ 4 palavras e nenhuma sigla.** A
   * frase inteira ("Ligação Estratégica", "Imposto de renda e contrato
   * social", "Sessão de Viabilidade") vive em `title` — que o `Chip`, o
   * `Trilho` e as filas do Painel põem no `title` do elemento, nunca no fluxo.
   * Este texto aparece em até 6 cartões por tela na Esteira: cada palavra aqui
   * é multiplicada por 6.
   */
  passo: string;
  /** A frase inteira por trás do verbo — SÓ para `title`. */
  title?: string;
  dono: DonoPasso;
  urgencia: UrgenciaPasso;
  /**
   * Fragmento de rota dentro da Ficha 360 (`#aba`) ou `null` quando não há
   * para onde ir. Use `hrefDoPasso(jornadaId, passo)` para montar o link.
   */
  rota: string | null;
}

export const ROTULO_DONO: Record<DonoPasso, string> = {
  equipe: "Equipe",
  advogada: "Advogada",
  cliente: "Cliente",
  sistema: "Sistema",
  ninguem: "Ninguém",
};

export const ROTULO_URGENCIA: Record<UrgenciaPasso, string> = {
  hoje: "Hoje",
  esta_semana: "Esta semana",
  quando_der: "Quando der",
};

const ORDEM_ETAPA: Record<EtapaJornada, number> = {
  captado: 0,
  qualificado: 1,
  sessao_contratada: 2,
  sessao_agendada: 3,
  sessao_realizada: 4,
  croqui_contratado: 5,
  croqui_apresentado: 6,
  holding_contratada: 7,
};

const HORA_MS = 60 * 60 * 1000;

function horasAte(iso: string | null, agora: number): number | null {
  if (!iso) return null;
  const alvo = Date.parse(iso);
  if (Number.isNaN(alvo)) return null;
  return (alvo - agora) / HORA_MS;
}

function urgenciaPorProximidade(horas: number | null): UrgenciaPasso {
  if (horas === null) return "quando_der";
  if (horas <= 3 * 24) return "hoje";
  if (horas <= 7 * 24) return "esta_semana";
  return "quando_der";
}

function passo(
  chave: ChavePasso,
  texto: string,
  dono: DonoPasso,
  urgencia: UrgenciaPasso,
  rota: string | null,
  title?: string,
): ProximoPasso {
  return { chave, passo: texto, dono, urgencia, rota, title };
}

/**
 * @param sinais  ver `sinais.ts`
 * @param agora   injetável para teste; default `Date.now()`
 */
export function derivarProximoPasso(sinais: Sinais, agora: number = Date.now()): ProximoPasso {
  const ordem = sinais.etapa ? ORDEM_ETAPA[sinais.etapa] : null;
  const passouDe = (etapa: EtapaJornada) => ordem !== null && ordem >= ORDEM_ETAPA[etapa];

  // "Pagou" pode vir de três lugares; se nenhum sabe, fica `null` e não afirma.
  const pagou: boolean | null =
    sinais.nivelPago !== null ? sinais.nivelPago >= 1 : ordem !== null ? passouDe("sessao_contratada") : sinais.proximaSessaoEm || sinais.sessaoRealizadaEm ? true : null;

  const sessaoRealizada = Boolean(sinais.sessaoRealizadaEm) || passouDe("sessao_realizada");
  const croquiContratado = (sinais.nivelPago !== null && sinais.nivelPago >= 2) || passouDe("croqui_contratado");
  const horas = horasAte(sinais.proximaSessaoEm, agora);
  const sessaoMarcada = horas !== null;

  // 23 — jornada fechada com holding: nada pendente.
  if (sinais.etapa === "holding_contratada" || (sinais.nivelPago !== null && sinais.nivelPago >= 3)) {
    return passo("concluido", "Jornada concluída", "ninguem", "quando_der", null, "Holding contratada — nada pendente.");
  }

  // 2/3 — lead/MQL ainda sem compra: quem move é o cliente.
  if (pagou === false) {
    return passo("aguardar_compra", "Aguardando a compra", "cliente", "quando_der", null, `Aguardando a compra da ${rotulo("sessao_viabilidade")}.`);
  }

  // ---- Antes da sessão (só enquanto ela não aconteceu) ----------------------
  if (!sessaoRealizada) {
    // 4/27 — pagou e ninguém ligou: o furo que mais dói.
    if (pagou === true && sinais.temLigacao === false) {
      return passo("ligacao", "Ligar para o cliente", "equipe", "hoje", "#ligacao", `${rotulo("pop03")} · ${titleDe("pop03")}`);
    }
    // 5 — pagou, já ligou, e não há horário marcado.
    if (pagou === true && !sessaoMarcada && sinais.proximaSessaoEm === null && sinais.etapa !== null) {
      return passo("sessao", "Agendar a sessão", "equipe", "esta_semana", "#sessao", rotulo("sessao_viabilidade"));
    }
    // 6/7/24 — sessão em ≤ 7 dias e o cliente ainda não confirmou (só com a coluna presente).
    if (sessaoMarcada && horas !== null && horas <= 7 * 24 && sinais.presencaConfirmada === false) {
      return passo("confirmar_presenca", "Confirmar presença", "cliente", horas <= 3 * 24 ? "hoje" : "esta_semana", "#sessao", "O cliente ainda não confirmou — reforçar por WhatsApp.");
    }
    // 9/25 — sessão em < 24 h sem link da sala.
    if (sessaoMarcada && horas !== null && horas <= 24 && sinais.temLinkSala === false) {
      return passo("colar_link_sala", "Colar link da sala", "equipe", "hoje", "#sessao", "A sessão é em menos de 24 h e ainda não tem link de sala.");
    }
    // 10 — formulário estratégico ainda não respondido.
    if (pagou === true && sinais.temFormulario === false) {
      return passo("formulario", "Responder o formulário", "cliente", sessaoMarcada ? urgenciaPorProximidade(horas) : "quando_der", "#formulario", `${rotulo("pop02")} · ${titleDe("pop02")}`);
    }
    // 11 — sessão marcada e sem briefing.
    if (sessaoMarcada && sinais.temBriefing === false) {
      return passo("briefing", "Gerar o Briefing", "equipe", urgenciaPorProximidade(horas), "#briefing", rotulo("briefing_entregavel"));
    }
    // 12/26 — tudo pronto: é conduzir a sessão.
    if (sessaoMarcada) {
      return passo("sessao", "Conduzir a sessão", "advogada", urgenciaPorProximidade(horas), "#sessao", rotulo("sessao_viabilidade"));
    }
    // Pagou, mas a fonte não diz nem ligação nem agendamento — não inventa.
    if (pagou === true) {
      return passo("sem_informacao", "Sem informação", "ninguem", "quando_der", null, "Sem informação suficiente sobre o preparo da sessão.");
    }
  }

  // ---- Depois da sessão ------------------------------------------------------
  if (sessaoRealizada && !croquiContratado) {
    // 13 — relatório da SV é da advogada.
    if (sinais.temRelatorio === false) {
      return passo("relatorio_sv", "Preencher o relatório", "advogada", "esta_semana", "#relatorio", `Relatório da ${rotulo("sessao_viabilidade")}`);
    }
    // 14/15 — material pós-sessão: gerar (sistema) ou aprovar (advogada).
    if (sinais.materialEstado === "nenhum") {
      return passo("material", "Gerar o material", "sistema", "esta_semana", "#material", "Material pós-sessão");
    }
    if (sinais.materialEstado === "rascunho") {
      return passo("material", "Aprovar o material", "advogada", "esta_semana", "#material", "Material pós-sessão");
    }
    // 16 — tarefa assistida "enviar link do croqui" (Dra. Elaine envia pessoalmente).
    if (sinais.tarefasAbertas?.some((t) => t.tipo === "enviar_link_croqui")) {
      return passo("enviar_link_croqui", "Enviar link de pagamento", "advogada", "hoje", "#sessao", `Link de pagamento do ${rotulo("croqui")}`);
    }
    // 17 — tudo entregue: a decisão é da família.
    if (sinais.temRelatorio === true || sinais.materialEstado === "aprovado") {
      return passo("aguardar_croqui", "Aguardando o croqui", "cliente", "quando_der", null, `Aguardando a contratação do ${rotulo("croqui")}.`);
    }
    return passo("sem_informacao", "Sem informação", "ninguem", "quando_der", null, "Sem informação suficiente sobre o pós-sessão.");
  }

  // ---- Croqui contratado -----------------------------------------------------
  if (croquiContratado && sinais.etapa !== "croqui_apresentado") {
    // 18 — IR e contrato social ainda não chegaram.
    if (sinais.temDocumentos === false) {
      return passo("documentos", "Enviar documentos", "cliente", "esta_semana", "#documentos", `${rotulo("imposto_renda")} e contrato social`);
    }
    // 19/20/21 — o croqui em si.
    if (sinais.croquiStatus === "nenhum") {
      return passo("croqui", "Iniciar o croqui", "advogada", "esta_semana", "#croqui", rotulo("croqui"));
    }
    if (sinais.croquiStatus === "rascunho") {
      return passo("croqui", "Concluir o croqui", "advogada", "esta_semana", "#croqui", rotulo("croqui"));
    }
    if (sinais.croquiStatus === "pronto") {
      return passo("croqui", "Apresentar o croqui", "advogada", "esta_semana", "#croqui", rotulo("croqui"));
    }
    if (sinais.croquiStatus === "apresentado") {
      return passo("aguardar_holding", "Aguardando decisão", "cliente", "quando_der", null, "Aguardando a decisão da família sobre a holding.");
    }
    return passo("sem_informacao", "Sem informação", "ninguem", "quando_der", null, `Sem informação suficiente sobre o ${rotulo("croqui")}.`);
  }

  // 22 — croqui apresentado: a decisão é da família.
  if (sinais.etapa === "croqui_apresentado") {
    return passo("aguardar_holding", "Aguardando decisão", "cliente", "quando_der", null, "Aguardando a decisão da família sobre a holding.");
  }

  // 1 — nada se sabe.
  return passo("sem_informacao", "Sem informação", "ninguem", "quando_der", null, "Sem informação suficiente sobre esta jornada.");
}

/** Link para a Ficha 360 na aba do passo (ou a raiz da Pasta quando não há aba). */
export function hrefDoPasso(jornadaId: string, proximo: ProximoPasso): string {
  return `/jornadas/${jornadaId}${proximo.rota ?? ""}`;
}

/** Dias inteiros até uma data (para "sessão em N dias"); `null` sem data. */
export function diasAte(iso: string | null, agora: number = Date.now()): number | null {
  const h = horasAte(iso, agora);
  if (h === null) return null;
  return Math.ceil(h / 24);
}

