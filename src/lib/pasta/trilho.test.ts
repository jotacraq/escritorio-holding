/**
 * Trilho de 9 passos (`src/lib/pasta/trilho.ts`, `docs/ARQUITETURA-FASE-5.md`
 * §8.1), a espinha das 3 sessões (Fase 6 §1.2) e `sinaisDaFicha`
 * (`src/lib/pasta/sinais.ts`).
 *
 * Convertido de `scripts/teste-trilho.ts` (Fase 7 · rodada 2): os mesmos casos,
 * os mesmos números, agora dentro do `npm test` que o CI do GitHub roda em todo
 * PR. O radar de documentos saiu para `src/lib/radar/derivar.test.ts`, onde o
 * código testado mora.
 *
 * As funções sob teste são PURAS: nenhum banco, nenhuma env, `agora` injetado.
 * O que falhar aqui falha igual em produção.
 */
import { describe, expect, it } from "vitest";

import {
  agruparPorSessao,
  derivarTrilho,
  passoAtual,
  progressoDoTrilho,
  ROTULO_SESSAO,
  SESSAO_POR_PASSO,
  type BlocoSessao,
  type ChaveSessao,
  type ChaveTrilho,
  type EstadoPasso,
  type PassoTrilho,
} from "@/lib/pasta/trilho";
import { CATALOGO_PASTA, SESSAO_POR_ITEM } from "@/lib/pasta/catalogo";
import { sinaisComExecucao, sinaisDaFicha, sinaisVazios, type Sinais } from "@/lib/pasta/sinais";
import type { EventoTimeline, Ficha360 } from "@/lib/api";

const AGORA = Date.parse("2026-09-05T12:00:00Z");
const EM_5_DIAS = new Date(AGORA + 5 * 24 * 60 * 60 * 1000).toISOString();
const HA_10_DIAS = new Date(AGORA - 10 * 24 * 60 * 60 * 1000).toISOString();

// ---------------------------------------------------------------------------
// Harness — cada `conferir` do script original vira um `it` do vitest.
//
// As condições são avaliadas na COLETA (código puro, síncrono) e asseguradas
// dentro do `it`: o placar por caso é o mesmo do script, mas quem reporta é
// o vitest — e o CI reprova o PR.
// ---------------------------------------------------------------------------
interface Caso {
  secao: string;
  nome: string;
  ok: boolean;
  detalhe: string;
}

const casos: Caso[] = [];
let secaoAtual = "geral";

function secao(nome: string): void {
  secaoAtual = nome;
}

function conferir(nome: string, ok: boolean, detalhe: string): void {
  casos.push({ secao: secaoAtual, nome, ok, detalhe });
}

function publicar(): void {
  for (const nome of [...new Set(casos.map((c) => c.secao))]) {
    describe(nome, () => {
      for (const caso of casos.filter((c) => c.secao === nome)) {
        it(caso.nome, () => {
          expect(caso.ok, caso.detalhe || caso.nome).toBe(true);
        });
      }
    });
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

secao("TRILHO — 6 bordas do §8.1");


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
secao("ESPINHA — as 3 sessões (Fase 6 §1.2)");


function sessao(blocos: BlocoSessao[], chave: ChaveSessao): BlocoSessao {
  const b = blocos.find((x) => x.chave === chave);
  if (!b) throw new Error(`sessão ausente: ${chave}`);
  return b;
}

function mapaSessoes(blocos: BlocoSessao[]): string {
  return blocos.map((b) => `${b.chave}=${b.estado}(${b.resumo})`).join(" ");
}

// Estrutura: os 9 passos cabem nas 3 sessões, 5/1/3, sem sobra e sem repetição.
{
  const blocos = agruparPorSessao(derivarTrilho(s({}), AGORA));
  conferir("S1 · 3 sessões, na ordem", blocos.map((b) => b.chave).join(",") === "viabilidade,croqui,entrega", mapaSessoes(blocos));
  conferir("S1 · 5 / 1 / 3 passos", blocos.map((b) => b.passos.length).join(",") === "5,1,3", mapaSessoes(blocos));
  conferir(
    "S1 · nenhum passo se perde nem se repete",
    blocos.reduce((n, b) => n + b.passos.length, 0) === 9,
    mapaSessoes(blocos),
  );
  conferir("S1 · rótulos vêm de ROTULO_SESSAO", blocos.every((b) => b.rotulo === ROTULO_SESSAO[b.chave]), mapaSessoes(blocos));
}

// (novo 1) Tudo `null` → NENHUMA sessão atual. Sem passo aceso não se inventa
// posição: é a borda `a` do §8.1 propagada para o agrupamento.
{
  const blocos = agruparPorSessao(derivarTrilho(s({}), AGORA));
  conferir("S2 · nenhuma sessão atual (tudo null)", blocos.every((b) => b.estado !== "atual"), mapaSessoes(blocos));
  conferir("S2 · nenhuma sessão feito", blocos.every((b) => b.estado === "futuro"), mapaSessoes(blocos));
  conferir("S2 · resumo 0 de N", blocos.map((b) => b.resumo).join(" · ") === "0 de 5 · 0 de 1 · 0 de 3", mapaSessoes(blocos));
}

// (novo 2) Jornada completa → as 3 sessões `feito`, nenhuma atual.
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
  const blocos = agruparPorSessao(
    derivarTrilho(sinaisComExecucao(base, { feitos: 19, total: 19, contratoAssinadoEm: HA_10_DIAS, entregaEm: HA_10_DIAS }), AGORA),
  );
  conferir("S3 · 3 sessões feito", blocos.every((b) => b.estado === "feito"), mapaSessoes(blocos));
  conferir("S3 · nenhuma atual", blocos.every((b) => b.estado !== "atual"), mapaSessoes(blocos));
  conferir("S3 · resumo 5 de 5 · 1 de 1 · 3 de 3", blocos.map((b) => b.resumo).join(" · ") === "5 de 5 · 1 de 1 · 3 de 3", mapaSessoes(blocos));
}

// (novo 3) Croqui comprado sem sessão nenhuma → sessão 1 resolvida com passos
// `pulado` (logo `feito`, não `atual`) e sessão 2 `atual`.
{
  const passos = derivarTrilho(s({ etapa: "croqui_contratado", nivelPago: 2, temLigacao: true, croquiStatus: "nenhum", temDocumentos: true }), AGORA);
  const blocos = agruparPorSessao(passos);
  conferir("S4 · viabilidade resolvida (feito)", sessao(blocos, "viabilidade").estado === "feito", mapaSessoes(blocos));
  conferir(
    "S4 · e ela tem passos pulados — o resumo não mente",
    sessao(blocos, "viabilidade").passos.filter((p) => p.estado === "pulado").length === 3 &&
      sessao(blocos, "viabilidade").resumo === "2 de 5",
    mapaSessoes(blocos),
  );
  conferir("S4 · croqui atual", sessao(blocos, "croqui").estado === "atual", mapaSessoes(blocos));
  conferir("S4 · entrega futuro", sessao(blocos, "entrega").estado === "futuro", mapaSessoes(blocos));
  conferir("S4 · uma e só uma sessão atual", blocos.filter((b) => b.estado === "atual").length === 1, mapaSessoes(blocos));
}

// A espinha é exaustiva dos dois lados: nenhum passo e nenhum item da Pasta
// fica sem sessão. É o que substitui a lista MOMENTOS duplicada.
{
  const passos = derivarTrilho(s({ etapa: "sessao_agendada", nivelPago: 1, temLigacao: true, proximaSessaoEm: EM_5_DIAS }), AGORA);
  conferir("S5 · todo passo tem sessão", passos.every((p) => SESSAO_POR_PASSO[p.chave] !== undefined), mapa(passos));
  conferir(
    "S5 · todo item da Pasta tem sessão",
    CATALOGO_PASTA.every((i) => SESSAO_POR_ITEM[i.chave] !== undefined),
    CATALOGO_PASTA.map((i) => `${i.chave}=${SESSAO_POR_ITEM[i.chave]}`).join(" "),
  );
  conferir(
    "S5 · nenhum item da Pasta cai em `entrega` (a 3ª sessão vem de execucao_marcos)",
    CATALOGO_PASTA.every((i) => SESSAO_POR_ITEM[i.chave] !== "entrega"),
    "",
  );
}

// B5 — o rótulo do passo virou "Contato"; a CHAVE continua `ligacao`.
{
  const passos = derivarTrilho(s({ etapa: "sessao_contratada", nivelPago: 1, temLigacao: false }), AGORA);
  const ligacao = passos.find((p) => p.chave === "ligacao");
  conferir("S6 · rótulo do passo é 'Contato'", ligacao?.rotulo === "Contato", String(ligacao?.rotulo));
  conferir("S6 · a chave `ligacao` não mudou", passos.some((p) => p.chave === "ligacao"), mapa(passos));
}
secao("TRILHO — caminho normal da esteira");


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
secao("SINAIS DA FICHA — croquiStatus só sai de evento com status");


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
publicar();
