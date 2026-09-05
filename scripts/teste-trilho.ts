/**
 * scripts/teste-trilho.ts
 *
 * Teste de mesa do trilho de 9 passos (`src/lib/pasta/trilho.ts`,
 * `docs/ARQUITETURA-FASE-5.md` §8.1) e do radar de documentos
 * (`src/lib/radar/derivar.ts`, §8.3). As 6 bordas do §8.1 são os casos A–F;
 * os demais cobrem o caminho normal da esteira e as regras do radar.
 *
 * MODO DE USO:
 *   npx tsx scripts/teste-trilho.ts
 *
 * Sem framework de teste no projeto (nenhum vitest/jest no package.json) —
 * script standalone, mesmo padrão de `scripts/testar-json-schema-estrito.ts`.
 * Sai com código 1 em qualquer falha.
 *
 * As duas funções sob teste são PURAS: nenhum acesso a banco, nenhuma variável
 * de ambiente, `agora` injetado. O que falhar aqui falha igual em produção.
 */
import { derivarTrilho, passoAtual, progressoDoTrilho, type ChaveTrilho, type EstadoPasso, type PassoTrilho } from "../src/lib/pasta/trilho";
import { sinaisComExecucao, sinaisDaFicha, sinaisVazios, type Sinais } from "../src/lib/pasta/sinais";
import type { EventoTimeline, Ficha360 } from "../src/lib/api";
import { derivarRadarDocumentos, resumoDoRadar } from "../src/lib/radar/derivar";

const AGORA = Date.parse("2026-09-05T12:00:00Z");
const EM_5_DIAS = new Date(AGORA + 5 * 24 * 60 * 60 * 1000).toISOString();
const HA_10_DIAS = new Date(AGORA - 10 * 24 * 60 * 60 * 1000).toISOString();

let falhas = 0;
let passaram = 0;

function conferir(nome: string, ok: boolean, detalhe: string): void {
  if (ok) {
    passaram += 1;
    console.log(`  PASS  ${nome}`);
  } else {
    falhas += 1;
    console.log(`  FAIL  ${nome} — ${detalhe}`);
  }
}

function s(campos: Partial<Sinais>): Sinais {
  return { ...sinaisVazios(), ...campos };
}

function estado(passos: PassoTrilho[], chave: ChaveTrilho): EstadoPasso {
  const passo = passos.find((p) => p.chave === chave);
  if (!passo) throw new Error(`passo ausente: ${chave}`);
  return passo.estado;
}

function mapa(passos: PassoTrilho[]): string {
  return passos.map((p) => `${p.chave}=${p.estado}`).join(" ");
}

console.log("\n=== TRILHO — 6 bordas do §8.1 ===\n");

// ---------------------------------------------------------------------------
// (a) Tudo `null` → 9 `futuro`, nenhum `atual`.
// ---------------------------------------------------------------------------
{
  const passos = derivarTrilho(s({}), AGORA);
  conferir("A · tudo null → 9 passos", passos.length === 9, `${passos.length}`);
  conferir("A · todos futuro", passos.every((p) => p.estado === "futuro"), mapa(passos));
  conferir("A · nenhum atual", passoAtual(passos) === null, mapa(passos));
}

// ---------------------------------------------------------------------------
// (b) Jornada completa até a entrega → 9 `feito`, nenhum `atual`.
// ---------------------------------------------------------------------------
{
  const base = s({
    etapa: "holding_contratada",
    nivelPago: 3,
    temLigacao: true,
    proximaSessaoEm: HA_10_DIAS,
    presencaConfirmada: true,
    presencaConfirmadaEm: HA_10_DIAS,
    sessaoRealizadaEm: HA_10_DIAS,
    croquiStatus: "apresentado",
  });
  const passos = derivarTrilho(
    sinaisComExecucao(base, { feitos: 19, total: 19, contratoAssinadoEm: HA_10_DIAS, entregaEm: HA_10_DIAS }),
    AGORA,
  );
  conferir("B · 9 feito", passos.every((p) => p.estado === "feito"), mapa(passos));
  conferir("B · nenhum atual", passoAtual(passos) === null, mapa(passos));
  conferir("B · progresso 9 de 9", progressoDoTrilho(passos).feitos === 9, JSON.stringify(progressoDoTrilho(passos)));
}

// ---------------------------------------------------------------------------
// (c) Croqui comprado sem sessão nenhuma → agendou/confirmou/sessao `pulado`.
// ---------------------------------------------------------------------------
{
  const passos = derivarTrilho(s({ etapa: "croqui_contratado", nivelPago: 2, temLigacao: true, croquiStatus: "nenhum", temDocumentos: true }), AGORA);
  conferir("C · agendou pulado", estado(passos, "agendou") === "pulado", mapa(passos));
  conferir("C · confirmou pulado", estado(passos, "confirmou") === "pulado", mapa(passos));
  conferir("C · sessao pulado", estado(passos, "sessao") === "pulado", mapa(passos));
  conferir("C · croqui atual", estado(passos, "croqui") === "atual", mapa(passos));
}

// ---------------------------------------------------------------------------
// (d) Sessão realizada e `temLigacao === false` → ligacao `pulado`, não futuro.
// ---------------------------------------------------------------------------
{
  const passos = derivarTrilho(s({ etapa: "sessao_realizada", nivelPago: 1, temLigacao: false, sessaoRealizadaEm: HA_10_DIAS, temRelatorio: false }), AGORA);
  conferir("D · ligacao pulado", estado(passos, "ligacao") === "pulado", mapa(passos));
  conferir("D · sessao feito", estado(passos, "sessao") === "feito", mapa(passos));
}

// ---------------------------------------------------------------------------
// (e) `presencaConfirmada === null` (coluna ausente) → confirmou `futuro`.
// ---------------------------------------------------------------------------
{
  const passos = derivarTrilho(s({ etapa: "sessao_agendada", nivelPago: 1, temLigacao: true, proximaSessaoEm: EM_5_DIAS, temFormulario: true, temBriefing: true }), AGORA);
  conferir("E · confirmou futuro (nunca pulado)", estado(passos, "confirmou") === "futuro", mapa(passos));
  conferir("E · agendou feito", estado(passos, "agendou") === "feito", mapa(passos));
  conferir("E · sessao atual", estado(passos, "sessao") === "atual", mapa(passos));
}

// ---------------------------------------------------------------------------
// (f) 4 de 15 marcos → execucao `atual` com progresso (rótulo "4 de 15").
// ---------------------------------------------------------------------------
{
  const base = s({
    etapa: "holding_contratada",
    nivelPago: 3,
    temLigacao: true,
    proximaSessaoEm: HA_10_DIAS,
    presencaConfirmada: true,
    presencaConfirmadaEm: HA_10_DIAS,
    sessaoRealizadaEm: HA_10_DIAS,
    croquiStatus: "apresentado",
  });
  const passos = derivarTrilho(sinaisComExecucao(base, { feitos: 4, total: 15, contratoAssinadoEm: HA_10_DIAS }), AGORA);
  const execucao = passos.find((p) => p.chave === "execucao");
  conferir("F · execucao atual", execucao?.estado === "atual", mapa(passos));
  conferir("F · progresso 4 de 15", execucao?.progresso?.feitos === 4 && execucao?.progresso?.total === 15, JSON.stringify(execucao?.progresso));
  conferir("F · contrato feito", estado(passos, "contrato") === "feito", mapa(passos));
  conferir("F · entrega futuro", estado(passos, "entrega") === "futuro", mapa(passos));
}

console.log("\n=== TRILHO — caminho normal da esteira ===\n");

// Pagou e ninguém ligou: o furo que mais dói.
{
  const passos = derivarTrilho(s({ etapa: "sessao_contratada", nivelPago: 1, temLigacao: false }), AGORA);
  conferir("G · pagou feito", estado(passos, "pagou") === "feito", mapa(passos));
  conferir("G · ligacao atual", estado(passos, "ligacao") === "atual", mapa(passos));
  conferir("G · ligacao não é pulado sem sessão", estado(passos, "ligacao") !== "pulado", mapa(passos));
}

// Lead sem compra: o passo aceso é o primeiro.
{
  const passos = derivarTrilho(s({ etapa: "captado", nivelPago: 0 }), AGORA);
  conferir("H · pagou atual", estado(passos, "pagou") === "atual", mapa(passos));
  conferir("H · nenhum feito", passos.every((p) => p.estado !== "feito"), mapa(passos));
}

// Sessão marcada, cliente não confirmou (coluna presente).
{
  const passos = derivarTrilho(
    s({ etapa: "sessao_agendada", nivelPago: 1, temLigacao: true, proximaSessaoEm: EM_5_DIAS, presencaConfirmada: false }),
    AGORA,
  );
  conferir("I · confirmou atual", estado(passos, "confirmou") === "atual", mapa(passos));
  conferir("I · confirmou não é pulado (sessão no futuro)", estado(passos, "confirmou") !== "pulado", mapa(passos));
}

// Sessão passou sem confirmação: aí sim é pulado.
{
  const passos = derivarTrilho(
    s({ etapa: "sessao_realizada", nivelPago: 1, temLigacao: true, proximaSessaoEm: HA_10_DIAS, presencaConfirmada: false, sessaoRealizadaEm: HA_10_DIAS, temRelatorio: true, materialEstado: "aprovado" }),
    AGORA,
  );
  conferir("J · confirmou pulado depois da sessão", estado(passos, "confirmou") === "pulado", mapa(passos));
  conferir("J · sessao feito", estado(passos, "sessao") === "feito", mapa(passos));
}

// A data do passo vem do sinal, nunca inventada.
{
  const passos = derivarTrilho(s({ nivelPago: 1, proximaSessaoEm: EM_5_DIAS }), AGORA);
  const agendou = passos.find((p) => p.chave === "agendou");
  conferir("K · quando do agendou = data da sessão", agendou?.quando === EM_5_DIAS, String(agendou?.quando));
  conferir("K · quando do pagou é null (não há data)", passos.find((p) => p.chave === "pagou")?.quando === null, "pagou.quando");
}

// Execução sem informação nenhuma não vira 0%.
{
  const passos = derivarTrilho(s({ nivelPago: 3, croquiStatus: "apresentado" }), AGORA);
  const execucao = passos.find((p) => p.chave === "execucao");
  conferir("L · execucao sem marcos não traz progresso", execucao?.progresso === undefined, JSON.stringify(execucao));
  conferir("L · contrato atual (holding fechada, contrato pendente)", estado(passos, "contrato") === "atual", mapa(passos));
}

console.log("\n=== RADAR DE DOCUMENTOS (§8.3) ===\n");

const BENS = [
  { id: "bem-1", tipo: "imovel" as const, descricao: "Apartamento na praia" },
  { id: "bem-2", tipo: "imovel" as const, descricao: "Casa da família" },
  { id: "bem-3", tipo: "empresa" as const, descricao: "Transportadora" },
  { id: "bem-4", tipo: "veiculo" as const, descricao: "Caminhonete" },
];
const FAMILIA = [
  { id: "fam-1", parentesco: "conjuge", nome: "Cônjuge" },
  { id: "fam-2", parentesco: "filho", nome: "Filho mais velho" },
];

{
  const itens = derivarRadarDocumentos(BENS, FAMILIA, "celula_3", [], []);
  const coleta = itens.filter((i) => i.lado === "coleta");
  const entrega = itens.filter((i) => i.lado === "entrega");
  conferir("M · lista nasce toda a_pedir", itens.every((i) => i.estado === "a_pedir"), itens.map((i) => i.estado).join(","));
  conferir("M · uma matrícula por imóvel", coleta.filter((i) => i.tipo === "matricula_imovel").length === 2, String(coleta.length));
  conferir("M · empresa pede contrato social e balanço", coleta.some((i) => i.tipo === "contrato_social") && coleta.some((i) => i.tipo === "balanco"), "");
  conferir("M · cônjuge pede IR e certidão de casamento", coleta.filter((i) => i.tipo === "imposto_renda").length === 2 && coleta.some((i) => i.tipo === "certidao_casamento"), "");
  conferir("M · filho pede certidão de nascimento", coleta.some((i) => i.tipo === "certidao_nascimento"), "");
  conferir("M · 3 células pedem comprovante de residência", coleta.some((i) => i.tipo === "comprovante_residencia"), "");
  conferir("M · entrega tem carta, sumário, acordo e 4 por célula", entrega.length === 3 + 3 * 4, String(entrega.length));
  conferir("M · toda chave é única", new Set(itens.map((i) => i.chave)).size === itens.length, String(itens.length));
}

// Documento solto NÃO resolve item específico — o chute é proibido.
{
  const documentos = [{ id: "doc-1", tipo: "matricula_imovel", criado_em: HA_10_DIAS, item_ref: null }];
  const itens = derivarRadarDocumentos(BENS, [], "celula_1", documentos, []);
  const matriculas = itens.filter((i) => i.tipo === "matricula_imovel");
  conferir("N · matrícula solta não marca imóvel nenhum", matriculas.every((i) => i.estado === "a_pedir"), matriculas.map((i) => i.estado).join(","));
}

// Documento com item_ref resolve exatamente aquele item.
{
  const documentos = [{ id: "doc-2", tipo: "matricula_imovel", criado_em: HA_10_DIAS, item_ref: "bem-2" }];
  const itens = derivarRadarDocumentos(BENS, [], "celula_1", documentos, []);
  const doBem2 = itens.find((i) => i.item_ref === "bem-2" && i.tipo === "matricula_imovel");
  const doBem1 = itens.find((i) => i.item_ref === "bem-1" && i.tipo === "matricula_imovel");
  conferir("O · casamento exato marca recebido", doBem2?.estado === "recebido", String(doBem2?.estado));
  conferir("O · o outro imóvel segue a_pedir", doBem1?.estado === "a_pedir", String(doBem1?.estado));
  conferir("O · recebido_em vem do documento", doBem2?.recebido_em === HA_10_DIAS, String(doBem2?.recebido_em));
}

// Pedido, conferência e dispensa.
{
  const chaveIr = "coleta:imposto_renda:-";
  const pedidos = [
    { chave: chaveIr, tipo: "imposto_renda", item_ref: null, pedido_em: HA_10_DIAS, conferido_em: null, dispensado_em: null },
    { chave: "coleta:crlv:bem-4", tipo: "crlv", item_ref: "bem-4", pedido_em: HA_10_DIAS, conferido_em: null, dispensado_em: HA_10_DIAS },
  ];
  const itens = derivarRadarDocumentos(BENS, [], null, [], pedidos);
  conferir("P · pedido sem documento fica 'pedido'", itens.find((i) => i.chave === chaveIr)?.estado === "pedido", "");
  conferir("P · dispensado sai da lista", !itens.some((i) => i.chave === "coleta:crlv:bem-4"), "");
  conferir("P · sem modelo não há lado de entrega", itens.every((i) => i.lado === "coleta"), "");
}

// Conferido ganha do recebido.
{
  const chave = "coleta:imposto_renda:-";
  const itens = derivarRadarDocumentos([], [], null, [{ id: "d", tipo: "imposto_renda", criado_em: HA_10_DIAS, item_ref: null }], [
    { chave, tipo: "imposto_renda", item_ref: null, pedido_em: HA_10_DIAS, conferido_em: HA_10_DIAS, dispensado_em: null },
  ]);
  conferir("Q · conferido prevalece sobre recebido", itens[0]?.estado === "conferido", String(itens[0]?.estado));
  conferir("Q · resumo conta conferido como pronto", resumoDoRadar(itens, "coleta").prontos === 1, JSON.stringify(resumoDoRadar(itens, "coleta")));
}

// ---------------------------------------------------------------------------
// R–U · `sinaisDaFicha()` e o croquiStatus derivado da timeline
//
// A regressão que a Fase 5 quase publicou: `sinaisDaFicha` lia o evento
// `tipo='croqui'` MAIS RECENTE e, quando ele não trazia `dados.status`,
// assumia "pronto". A fase criou dois escritores novos daquele tipo SEM
// status — o trigger de `croqui_calculos` ("Croqui calculado (vN)") e o
// registro de exportação do `.docx` ("Relatório exportado"). Como a timeline
// vem em ordem decrescente, fixar uma versão ou baixar o relatório fazia a
// Pasta e o trilho dizerem "croqui pronto — apresentar" com o croqui em
// rascunho, e regredia "apresentado" para "pronto".
//
// A 0070 deu tipo próprio aos dois eventos (`croqui_calculo` /
// `croqui_exportacao`); estes casos travam o OUTRO lado: mesmo que um escritor
// futuro erre o tipo, evento sem `status` legível é ignorado e a leitura segue
// para o anterior — nunca inventa estado.
// ---------------------------------------------------------------------------
console.log("\n=== SINAIS DA FICHA — croquiStatus só sai de evento com status ===\n");

function evento(tipo: string, titulo: string, dados: Record<string, unknown>): EventoTimeline {
  return { id: `ev-${titulo}`, tipo, titulo, descricao: null, dados, ator_tipo: "sistema", ocorrido_em: HA_10_DIAS };
}

/** Ficha 360 mínima: só o que `sinaisDaFicha` lê. O resto é `null`/`[]`. */
function ficha(timeline: EventoTimeline[]): Ficha360 {
  return {
    jornada: { etapa: "croqui_contratado", nivel_pago: 2 },
    agendamentos: [],
    documentos: [],
    timeline,
    formulario: null,
    ligacao: null,
    briefingAtual: null,
    sessao: null,
    relatorio: null,
    materialAtual: null,
    tarefasAbertas: [],
  } as unknown as Ficha360;
}

// R · o caso do Fable: croqui em rascunho + "Croqui calculado" no topo.
{
  const sinais = sinaisDaFicha(
    ficha([
      evento("croqui", "Croqui calculado (v3)", { calculo_id: "c3", versao: 3, croqui_id: null }),
      evento("croqui", "Croqui rascunho (v1)", { croqui_id: "cr-1", status: "rascunho" }),
    ]),
  );
  conferir("R · evento de cálculo não vira 'pronto'", sinais.croquiStatus === "rascunho", String(sinais.croquiStatus));
}

// S · o mesmo com o tipo já corrigido pela 0070 — tem de dar igual.
{
  const sinais = sinaisDaFicha(
    ficha([
      evento("croqui_calculo", "Croqui calculado (v3)", { calculo_id: "c3", versao: 3, croqui_id: null }),
      evento("croqui", "Croqui rascunho (v1)", { croqui_id: "cr-1", status: "rascunho" }),
    ]),
  );
  conferir("S · tipo próprio dá o mesmo resultado", sinais.croquiStatus === "rascunho", String(sinais.croquiStatus));
}

// T · "Relatório exportado" numa jornada SEM croqui → nenhum, nunca "pronto".
{
  const sinais = sinaisDaFicha(
    ficha([evento("croqui", "Relatório exportado", { croqui_id: "cr-9", destino: "download", versao_calculo: 2 })]),
  );
  conferir("T · exportação sem croqui não inventa estado", sinais.croquiStatus === "nenhum", String(sinais.croquiStatus));
}

// U · exportação DEPOIS de apresentar não regride o estado.
{
  const sinais = sinaisDaFicha(
    ficha([
      evento("croqui", "Relatório exportado", { croqui_id: "cr-1", destino: "drive", versao_calculo: 2 }),
      evento("croqui", "Croqui apresentado (v1)", { croqui_id: "cr-1", status: "apresentado" }),
    ]),
  );
  conferir("U · 'apresentado' não regride para 'pronto'", sinais.croquiStatus === "apresentado", String(sinais.croquiStatus));
}

// V · o caminho feliz continua igual: evento com status manda.
{
  const sinais = sinaisDaFicha(ficha([evento("croqui", "Croqui pronto (v2)", { croqui_id: "cr-1", status: "pronto" })]));
  conferir("V · evento com status legível é respeitado", sinais.croquiStatus === "pronto", String(sinais.croquiStatus));
}

// W · sem evento de croqui nenhum → "nenhum".
{
  const sinais = sinaisDaFicha(ficha([evento("pagamento", "Pagamento confirmado", {})]));
  conferir("W · sem evento de croqui → nenhum", sinais.croquiStatus === "nenhum", String(sinais.croquiStatus));
}

console.log(`\n${falhas === 0 ? "PASS" : "FAIL"} — ${passaram} conferências ok, ${falhas} falhas.\n`);
process.exit(falhas === 0 ? 0 : 1);
