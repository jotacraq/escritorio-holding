/**
 * Radar de documentos (`src/lib/radar/derivar.ts`,
 * `docs/ARQUITETURA-FASE-5.md` §8.3).
 *
 * Convertido de `scripts/teste-trilho.ts` (Fase 7 · rodada 2) — mesmos casos,
 * mesmos números, agora sob `npm test` / CI.
 *
 * `derivarRadarDocumentos` e `resumoDoRadar` são PURAS: nenhum banco, nenhuma
 * env, `agora` injetado.
 */
import { describe, expect, it } from "vitest";

import { derivarRadarDocumentos, resumoDoRadar } from "@/lib/radar/derivar";

const AGORA = Date.parse("2026-09-05T12:00:00Z");
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

secao("RADAR DE DOCUMENTOS (§8.3)");

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
publicar();
