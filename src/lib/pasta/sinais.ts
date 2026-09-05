/**
 * Sinais de uma jornada — o contrato de entrada de `derivarProximoPasso()`
 * (`proximo-passo.ts`) e de `derivarPasta()` (`derivar.ts`).
 *
 * Fase 4 §6 (`docs/ARQUITETURA-FASE-4.md`): antes havia quatro fontes com
 * quatro vocabulários para "o que falta e de quem é" (`derivar.ts`,
 * `pendencias.ts`, `vw_pendencias_preparo`, `vw_jornada_kanban`). Agora toda
 * superfície (Esteira, Painel do Dia, Agenda, Ficha 360) converte o payload
 * que JÁ carrega em `Sinais` — sem fetch novo — e passa pela mesma função.
 *
 * REGRA CENTRAL — `null` é "sem informação", nunca "não":
 * cada campo é tri-estado. `false`/`0`/data ausente só entram quando a fonte
 * de fato carrega o campo e ele veio vazio. Se o payload NÃO tem a coluna
 * (ex.: `presenca_confirmada_em` antes da migration 0051/0052 do agente A
 * chegar), o sinal fica `null` e quem deriva o passo NÃO inventa — vai para
 * "sem informação" em vez de gritar "cliente não confirmou".
 *
 * Nada aqui faz I/O. Tudo é função pura de objeto já carregado.
 */
import type { Agendamento, EtapaJornada, Ficha360, JornadaKanban } from "@/lib/api";

export type CroquiStatusSinal = "rascunho" | "pronto" | "apresentado";
export type MaterialEstadoSinal = "nenhum" | "rascunho" | "aprovado";

export interface TarefaAbertaSinal {
  tipo: string;
  /** Papel de quem deve fazer — `null` quando a tarefa não diz. */
  responsavelPapel: string | null;
}

export interface Sinais {
  /** Etapa da esteira. `null` quando a fonte não traz (linha da agenda/painel). */
  etapa: EtapaJornada | null;
  /** 0 = nada pago · 1 = sessão · 2 = croqui · 3 = holding. */
  nivelPago: 0 | 1 | 2 | 3 | null;
  temFormulario: boolean | null;
  temLigacao: boolean | null;
  temBriefing: boolean | null;
  /** Próximo agendamento ativo (`agendado`/`confirmado`). */
  proximaSessaoEm: string | null;
  /**
   * `true`/`false` só quando a fonte carrega `presenca_confirmada_em`
   * (0051, agente A). `null` = coluna ausente = sem informação.
   */
  presencaConfirmada: boolean | null;
  presencaConfirmadaEm: string | null;
  /** `true`/`false` só quando a fonte carrega `link_sala`. */
  temLinkSala: boolean | null;
  sessaoRealizadaEm: string | null;
  temRelatorio: boolean | null;
  /** Estado do croqui mais recente; `"nenhum"` quando a fonte sabe que não há. */
  croquiStatus: CroquiStatusSinal | "nenhum" | null;
  materialEstado: MaterialEstadoSinal | null;
  temDiagnostico: boolean | null;
  temDocumentos: boolean | null;
  ligacaoIaStatus: string | null;
  tarefasAbertas: TarefaAbertaSinal[] | null;
  // --- Fase 5 §8.1 — os três passos novos do trilho (contrato → execução →
  // entrega). Mesma regra tri-estado: `null` = a fonte não carrega o campo.
  // Nenhuma fonte de hoje preenche estes três; ficam `null` até o front
  // (M5) juntar `GET /api/jornadas/[id]/execucao` com `sinaisComExecucao()`.
  /** `contratos_assinaturas` ainda não existe (Onda 3): hoje só via `sinaisComExecucao`. */
  contratoAssinadoEm: string | null;
  /** Marcos de `execucao_jornada_marcos` (0067). `null` = sem informação; `{feitos:0,total:19}` = modelo carregado e nada concluído. */
  marcosExecucao: { feitos: number; total: number } | null;
  /** Data do marco final ("Entrega do Sistema"). */
  entregaEm: string | null;
}

/** Ponto de partida: tudo "sem informação". Cada adaptador preenche o que a fonte tem. */
export function sinaisVazios(): Sinais {
  return {
    etapa: null,
    nivelPago: null,
    temFormulario: null,
    temLigacao: null,
    temBriefing: null,
    proximaSessaoEm: null,
    presencaConfirmada: null,
    presencaConfirmadaEm: null,
    temLinkSala: null,
    sessaoRealizadaEm: null,
    temRelatorio: null,
    croquiStatus: null,
    materialEstado: null,
    temDiagnostico: null,
    temDocumentos: null,
    ligacaoIaStatus: null,
    tarefasAbertas: null,
    contratoAssinadoEm: null,
    marcosExecucao: null,
    entregaEm: null,
  };
}

/**
 * Junta os dados da sub-esteira de execução (`GET /api/jornadas/[id]/execucao`,
 * 0067) aos sinais que a tela já tem. Existe porque nenhuma view de hoje
 * carrega marco de execução: quem quiser o trilho COMPLETO (9 passos) busca a
 * execução uma vez e passa por aqui. Quem não buscar continua com os três
 * campos em `null` — e o trilho mostra "sem informação", nunca zero.
 *
 * Função pura. `total === 0` (modelo sem marco) vira `null`: contar "0 de 0"
 * seria afirmar progresso que não existe.
 */
export function sinaisComExecucao(
  base: Sinais,
  dados: { feitos: number; total: number; contratoAssinadoEm?: string | null; entregaEm?: string | null },
): Sinais {
  return {
    ...base,
    marcosExecucao: dados.total > 0 ? { feitos: dados.feitos, total: dados.total } : null,
    contratoAssinadoEm: dados.contratoAssinadoEm ?? base.contratoAssinadoEm,
    entregaEm: dados.entregaEm ?? base.entregaEm,
  };
}

// ---------------------------------------------------------------------------
// Leitura tolerante — a coluna pode ainda não existir no payload
// ---------------------------------------------------------------------------

type Bruto = Record<string, unknown>;

function temChave(objeto: Bruto, chave: string): boolean {
  return Object.prototype.hasOwnProperty.call(objeto, chave);
}

/** `true`/`false` se a chave existe (valor truthy/falsy); `null` se a chave não veio. */
function booleanoOuNulo(objeto: Bruto, chave: string): boolean | null {
  if (!temChave(objeto, chave)) return null;
  const valor = objeto[chave];
  if (valor === null || valor === undefined) return false;
  return Boolean(valor);
}

/** String da chave se existir e for string; `null` caso contrário. */
function textoOuNulo(objeto: Bruto, chave: string): string | null {
  if (!temChave(objeto, chave)) return null;
  const valor = objeto[chave];
  return typeof valor === "string" && valor.length > 0 ? valor : null;
}

/** Data-presença: `presencaConfirmada` só é `false` quando a coluna existe e está vazia. */
function lerPresenca(objeto: Bruto): Pick<Sinais, "presencaConfirmada" | "presencaConfirmadaEm"> {
  if (!temChave(objeto, "presenca_confirmada_em")) return { presencaConfirmada: null, presencaConfirmadaEm: null };
  const em = textoOuNulo(objeto, "presenca_confirmada_em");
  return { presencaConfirmada: em !== null, presencaConfirmadaEm: em };
}

function lerCroquiStatus(valor: unknown): Sinais["croquiStatus"] {
  if (valor === "rascunho" || valor === "pronto" || valor === "apresentado") return valor;
  return null;
}

function lerMaterialEstado(valor: unknown): MaterialEstadoSinal | null {
  if (valor === "nenhum" || valor === "rascunho" || valor === "aprovado") return valor;
  return null;
}

function lerTarefas(valor: unknown): TarefaAbertaSinal[] | null {
  if (!Array.isArray(valor)) return null;
  const tarefas: TarefaAbertaSinal[] = [];
  for (const item of valor) {
    if (!item || typeof item !== "object") continue;
    const bruto = item as Bruto;
    const tipo = typeof bruto.tipo === "string" ? bruto.tipo : null;
    if (!tipo) continue;
    const papel = typeof bruto.responsavel_papel === "string" ? bruto.responsavel_papel : typeof bruto.responsavelPapel === "string" ? bruto.responsavelPapel : null;
    tarefas.push({ tipo, responsavelPapel: papel });
  }
  return tarefas;
}

/**
 * Fase 5: colunas de contrato/execução/entrega. Nenhuma view as tem hoje —
 * a leitura é tolerante de propósito, para que a view que as ganhar depois
 * (0067+) passe a alimentar o trilho sem tocar em nenhum adaptador.
 */
function lerExecucao(objeto: Bruto): Pick<Sinais, "contratoAssinadoEm" | "marcosExecucao" | "entregaEm"> {
  let marcos: Sinais["marcosExecucao"] = null;
  const bruto = objeto.marcos_execucao;
  if (bruto && typeof bruto === "object") {
    const registro = bruto as Bruto;
    const feitos = typeof registro.feitos === "number" ? registro.feitos : null;
    const total = typeof registro.total === "number" ? registro.total : null;
    if (feitos !== null && total !== null && total > 0) marcos = { feitos, total };
  }
  return {
    contratoAssinadoEm: textoOuNulo(objeto, "contrato_assinado_em"),
    marcosExecucao: marcos,
    entregaEm: textoOuNulo(objeto, "entrega_em"),
  };
}

// ---------------------------------------------------------------------------
// Adaptadores por fonte
// ---------------------------------------------------------------------------

/**
 * Linha de `vw_jornada_kanban` (`GET /api/jornadas`). Colunas que a 0052 do
 * agente A acrescenta (`sessao_realizada_em`, `tem_relatorio`, `croqui_status`,
 * `material_estado`, `presenca_confirmada_em`, `tem_diagnostico`,
 * `ligacao_ia_status`, `tarefas_abertas`) são lidas se vierem; ausentes → `null`.
 */
export function sinaisDoKanban(linha: JornadaKanban): Sinais {
  const bruto = linha as unknown as Bruto;
  return {
    ...sinaisVazios(),
    etapa: linha.etapa ?? null,
    nivelPago: linha.nivel_pago ?? null,
    temFormulario: booleanoOuNulo(bruto, "tem_formulario"),
    temLigacao: booleanoOuNulo(bruto, "tem_ligacao"),
    temBriefing: booleanoOuNulo(bruto, "tem_briefing"),
    proximaSessaoEm: textoOuNulo(bruto, "proxima_sessao_em"),
    ...lerPresenca(bruto),
    temLinkSala: booleanoOuNulo(bruto, "link_sala") ?? booleanoOuNulo(bruto, "tem_link_sala"),
    sessaoRealizadaEm: textoOuNulo(bruto, "sessao_realizada_em"),
    temRelatorio: booleanoOuNulo(bruto, "tem_relatorio"),
    croquiStatus: temChave(bruto, "croqui_status") ? (lerCroquiStatus(bruto.croqui_status) ?? "nenhum") : null,
    materialEstado: temChave(bruto, "material_estado") ? lerMaterialEstado(bruto.material_estado) : null,
    temDiagnostico: booleanoOuNulo(bruto, "tem_diagnostico"),
    temDocumentos: booleanoOuNulo(bruto, "tem_documentos"),
    ligacaoIaStatus: textoOuNulo(bruto, "ligacao_ia_status"),
    tarefasAbertas: temChave(bruto, "tarefas_abertas") ? lerTarefas(bruto.tarefas_abertas) : null,
    ...lerExecucao(bruto),
  };
}

/**
 * Linha de `vw_sessoes_do_dia` (Painel) ou de `GET /api/agendamentos` (Agenda).
 * Parcial por natureza: não traz etapa nem formulário/ligação — esses ficam
 * `null` e o passo derivado só fala do que a linha sabe (sessão, presença, sala,
 * briefing). Uma sessão marcada implica sessão paga (RPC recusa sem pagamento).
 */
export function sinaisDaSessaoDoDia(linha: {
  inicio_em: string;
  status?: string | null;
  link_sala?: string | null;
  tem_briefing?: boolean | null;
  presenca_confirmada_em?: string | null;
  [outro: string]: unknown;
}): Sinais {
  const bruto = linha as Bruto;
  const ativo = linha.status === undefined || linha.status === null || linha.status === "agendado" || linha.status === "confirmado";
  return {
    ...sinaisVazios(),
    nivelPago: 1,
    proximaSessaoEm: ativo ? linha.inicio_em : null,
    sessaoRealizadaEm: linha.status === "realizado" ? linha.inicio_em : null,
    ...lerPresenca(bruto),
    temLinkSala: booleanoOuNulo(bruto, "link_sala"),
    temBriefing: booleanoOuNulo(bruto, "tem_briefing"),
    temFormulario: booleanoOuNulo(bruto, "tem_formulario"),
    temLigacao: booleanoOuNulo(bruto, "tem_ligacao"),
  };
}

/**
 * Linha de `vw_pendencias_preparo` (Painel, bloco "Preparo pendente"): a view
 * só lista sessão em ≤ 7 dias com algo faltando — `falta_*` vira `tem*`.
 */
export function sinaisDoPreparo(linha: { inicio_em: string; falta_formulario: boolean; falta_ligacao: boolean; falta_briefing: boolean }): Sinais {
  return {
    ...sinaisVazios(),
    nivelPago: 1,
    proximaSessaoEm: linha.inicio_em,
    temFormulario: !linha.falta_formulario,
    temLigacao: !linha.falta_ligacao,
    temBriefing: !linha.falta_briefing,
  };
}

/** Linha de `vw_pagos_sem_contato`: pagou, e não há ligação nem mensagem registrada. */
export function sinaisDoPagoSemContato(): Sinais {
  return { ...sinaisVazios(), nivelPago: 1, temLigacao: false };
}

function agendamentoAtivo(a: Agendamento): boolean {
  return a.status === "agendado" || a.status === "confirmado";
}

/**
 * Ficha 360 (`GET /api/jornadas/[id]`) — a fonte mais completa. Campos novos da
 * Fase 4 (`diagnosticoAtual`, `ligacaoIaAtual`, `tarefasAbertas`, presença nos
 * agendamentos) são lidos se existirem no payload; ausentes → `null`.
 * `patrimonio`/`familiares`/`documentos` NÃO entram como sinal de próximo passo
 * além de "tem documentos" — quem não vê patrimônio recebe `null`, e o passo
 * nunca denuncia a existência de item que o papel não pode ver.
 */
export function sinaisDaFicha(ficha: Ficha360): Sinais {
  const bruto = ficha as unknown as Bruto;
  const proximo = ficha.agendamentos
    .filter(agendamentoAtivo)
    .sort((a, b) => a.inicio_em.localeCompare(b.inicio_em))[0];
  const proximoBruto = proximo ? (proximo as unknown as Bruto) : null;

  // SÓ evento `croqui` que carrega `dados.status` legível conta. O trigger
  // `app.timeline_croqui` (0014) é o único escritor que promete esse campo —
  // ele grava `jsonb_build_object('croqui_id', …, 'status', new.status)` a cada
  // INSERT/UPDATE de `croquis`.
  //
  // A regra antiga (`?? "pronto"`) tratava evento SEM status como "croqui
  // pronto". Enquanto o único escritor era aquele trigger, a suposição nunca
  // era exercida; a Fase 5 criou dois escritores novos com o mesmo `tipo` e sem
  // `status` (o trigger de `croqui_calculos` e o registro de exportação do
  // `.docx`), e a timeline vem em ordem decrescente (`server/jornadas.ts`) —
  // então fixar uma versão de cálculo ou baixar o relatório fazia a Pasta e o
  // trilho anunciarem "croqui pronto — apresentar" com o croqui em rascunho, ou
  // sem croqui nenhum. A 0070 devolve tipo próprio àqueles dois eventos; esta
  // leitura é o outro lado da trava: escritor novo que esqueça o `status` é
  // ignorado, e a busca continua no evento anterior em vez de inventar estado.
  const croquiStatus =
    ficha.timeline
      .filter((e) => e.tipo === "croqui")
      .map((e) => lerCroquiStatus(e.dados?.status))
      .find((status) => status !== null) ?? "nenhum";

  const material = ficha.materialAtual ?? null;
  const materialEstado: MaterialEstadoSinal = !material ? "nenhum" : material.aprovado_em ? "aprovado" : "rascunho";

  const documentosVisiveis = Array.isArray(ficha.documentos) ? ficha.documentos : null;

  const ligacaoIa = temChave(bruto, "ligacaoIaAtual") ? (bruto.ligacaoIaAtual as Bruto | null) : null;
  const diagnostico = temChave(bruto, "diagnosticoAtual") ? bruto.diagnosticoAtual : undefined;

  return {
    etapa: ficha.jornada.etapa,
    nivelPago: ficha.jornada.nivel_pago ?? null,
    temFormulario: Boolean(ficha.formulario),
    temLigacao: Boolean(ficha.ligacao?.realizada_em),
    temBriefing: Boolean(ficha.briefingAtual),
    proximaSessaoEm: proximo?.inicio_em ?? null,
    ...(proximoBruto ? lerPresenca(proximoBruto) : { presencaConfirmada: null, presencaConfirmadaEm: null }),
    temLinkSala: ficha.sessao ? Boolean(ficha.sessao.link_sala) : null,
    sessaoRealizadaEm: ficha.sessao?.realizada_em ?? null,
    temRelatorio: Boolean(ficha.relatorio),
    croquiStatus,
    materialEstado,
    temDiagnostico: diagnostico === undefined ? null : Boolean(diagnostico),
    temDocumentos: documentosVisiveis ? documentosVisiveis.length > 0 : null,
    ligacaoIaStatus: ligacaoIa && typeof ligacaoIa.status === "string" ? ligacaoIa.status : null,
    tarefasAbertas: temChave(bruto, "tarefasAbertas") ? lerTarefas(bruto.tarefasAbertas) : null,
    // A Ficha 360 ainda não carrega execução (rota própria, `GET .../execucao`).
    ...lerExecucao(bruto),
  };
}
