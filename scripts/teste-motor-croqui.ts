/**
 * Testes de mesa do Motor do Croqui (§4.8 de `docs/ARQUITETURA-FASE-5.md`).
 *
 *   npx tsx scripts/teste-motor-croqui.ts
 *   npx tsx scripts/teste-motor-croqui.ts --fixture tmp/squad/fixture-motor-exemplo.json
 *
 * Blocos:
 *   A — exemplo sintético completo (nenhum dado de cliente).
 *   B — ausência e cascata: parcela ausente contamina o total.
 *   C — regressão do deck zerado: nenhuma célula ausente com valor 0, nenhum
 *       "R$ 0,00" saindo do formatador, nenhuma frase de fechamento com null.
 *   D — faixas (isento/faixa/teto) + propriedade (determinismo, não lança).
 *   E — conferência contra a planilha real, se a fixture LOCAL existir. Só o
 *       placar é impresso: nenhum valor de cliente aparece na saída.
 *   F — a ponte com o banco (`servico.ts`) contra um cliente Supabase FALSO:
 *       todos os bens ativos entram na entrada, o bem dado baixa não entra, o
 *       override do Cenário casa rubrica E cenário, e a contagem de consultas
 *       não volta a crescer.
 *
 * Sai com código ≠ 0 se qualquer bloco falhar.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type {
  Celula,
  ChaveTabela,
  EntradaCroqui,
  ParametroCroqui,
  ParametrosCroqui,
  ResultadoCroqui,
  TabelaFaixas,
} from "../src/types/croqui-calculo";
import { aplicarFaixas, calcularCroqui, chavesNecessarias, formatarCelula, podeAfirmar, TEXTO_AUSENTE } from "../src/server/motor-croqui";
import { chaveMapa } from "../src/server/motor-croqui/contexto";
import { calcularParaJornada } from "../src/server/motor-croqui/servico";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let blocoAtual = "";
let falhas = 0;
let total = 0;
const falhasDoBloco: string[] = [];

function bloco(nome: string) {
  if (blocoAtual) fecharBloco();
  blocoAtual = nome;
  falhasDoBloco.length = 0;
}

function fecharBloco() {
  if (!blocoAtual) return;
  if (falhasDoBloco.length === 0) {
    console.log(`PASS  ${blocoAtual}`);
  } else {
    console.log(`FAIL  ${blocoAtual}`);
    for (const f of falhasDoBloco) console.log(`      ↳ ${f}`);
  }
  blocoAtual = "";
}

function ok(nome: string, condicao: boolean, detalhe = "") {
  total += 1;
  if (!condicao) {
    falhas += 1;
    falhasDoBloco.push(`${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}

const arred = (n: number, casas: number) => Math.round(n * 10 ** casas) / 10 ** casas;

/** Compara valor de célula com tolerância, exigindo procedência calculável. */
function valorEh(nome: string, celula: Celula | undefined, esperado: number, casas = 2) {
  if (!celula) return ok(nome, false, "célula inexistente");
  if (celula.valor === null) return ok(nome, false, `ausente (${celula.motivo ?? "sem motivo"})`);
  const bate = arred(celula.valor, casas) === arred(esperado, casas);
  ok(nome, bate, bate ? "" : `esperado ${esperado}, veio ${arred(celula.valor, casas)}`);
}

function ausente(nome: string, celula: Celula | undefined) {
  if (!celula) return ok(nome, false, "célula inexistente");
  ok(
    nome,
    celula.procedencia === "ausente" && celula.valor === null,
    `procedencia=${celula.procedencia} valor=${String(celula.valor)}`,
  );
}

const cel = (r: ResultadoCroqui, tabela: ChaveTabela, linha: string, coluna = "valor"): Celula | undefined =>
  r.tabelas[tabela]?.linhas.find((l) => l.chave === linha)?.celulas[coluna];

function* todasAsCelulas(r: ResultadoCroqui): Generator<{ tabela: ChaveTabela; linha: string; coluna: string; celula: Celula }> {
  for (const tabela of Object.values(r.tabelas)) {
    if (!tabela) continue;
    for (const linha of tabela.linhas) {
      for (const [coluna, celula] of Object.entries(linha.celulas)) {
        yield { tabela: tabela.chave, linha: linha.chave, coluna, celula };
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Construtores de parâmetro (fixture sintética)
// ---------------------------------------------------------------------------

let seqParametro = 0;
function p(
  chave: string,
  dados: { valor?: number; faixas?: TabelaFaixas; uf?: string; municipio?: string },
): ParametroCroqui {
  seqParametro += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seqParametro).padStart(12, "0")}`,
    chave,
    versao: 1,
    unidade: dados.faixas ? "faixas" : "brl",
    valor: dados.valor ?? null,
    faixas: dados.faixas ?? null,
    uf: dados.uf ?? null,
    municipio: dados.municipio ?? null,
    base_legal: "fixture de teste — sem valor de cliente",
  };
}

const mapear = (itens: ParametroCroqui[]): Record<string, ParametroCroqui> =>
  Object.fromEntries(itens.map((i) => [chaveMapa(i.chave, i.uf, i.municipio), i]));

const IRPF_MENSAL: TabelaFaixas = {
  modo: "faixa_unica",
  faixas: [
    { ordem: 1, ate: 2259.2, aliquota: 0, deduzir: 0 },
    { ordem: 2, ate: 2826.65, aliquota: 7.5, deduzir: 169.44 },
    { ordem: 3, ate: 3751.05, aliquota: 15, deduzir: 381.44 },
    { ordem: 4, ate: 4664.68, aliquota: 22.5, deduzir: 662.77 },
    { ordem: 5, ate: null, aliquota: 27.5, deduzir: 896 },
  ],
};

const GANHO_CAPITAL: TabelaFaixas = {
  modo: "progressivo",
  isento_ate: 35000,
  faixas: [
    { ordem: 1, ate: 5000000, aliquota: 15 },
    { ordem: 2, ate: 10000000, aliquota: 17.5 },
    { ordem: 3, ate: 30000000, aliquota: 20 },
    { ordem: 4, ate: null, aliquota: 22.5 },
  ],
};

/** Tabela de notas de SP: valores FIXOS por faixa, com teto na última. */
const NOTAS_SP: TabelaFaixas = {
  modo: "valor_fixo",
  faixas: [
    { ordem: 1, ate: 50000, valor: 550 },
    { ordem: 2, ate: 200000, valor: 1650 },
    { ordem: 3, ate: 700000, valor: 2950 },
    { ordem: 4, ate: null, valor: 17800 },
  ],
};

const HORAS = [
  { ato: "Sessão de viabilidade e croqui", horas: { celula_1: 20, celula_2: 18, celula_3: 12 } },
  { ato: "Minutas e constituição", horas: { celula_1: 20, celula_2: 19, celula_3: 15 } },
  { ato: "Integralização e registros", horas: { celula_1: 10, celula_2: 10, celula_3: 8 } },
];

function parametrosA(): ParametrosCroqui {
  return {
    itens: mapear([
      p("itcmd.faixas.heranca", {
        uf: "SP",
        faixas: {
          modo: "faixa_unica",
          isento_ate: 400000,
          faixas: [
            { ordem: 1, ate: 4000000, aliquota: 2 },
            { ordem: 2, ate: 10000000, aliquota: 4 },
            { ordem: 3, ate: null, aliquota: 6 },
          ],
        },
      }),
      p("itcmd.faixas.heranca_reforma", {
        uf: "SP",
        faixas: { modo: "faixa_unica", faixas: [{ ordem: 1, ate: null, aliquota: 8 }] },
      }),
      p("itcmd.faixas.doacao", {
        uf: "SP",
        faixas: {
          modo: "faixa_unica",
          isento_ate: 92500,
          faixas: [
            { ordem: 1, ate: 370200, aliquota: 2 },
            { ordem: 2, ate: 3146700, aliquota: 4 },
            { ordem: 3, ate: null, aliquota: 6 },
          ],
        },
      }),
      p("itcmd.faixas.doacao_reforma", {
        uf: "SP",
        faixas: { modo: "faixa_unica", faixas: [{ ordem: 1, ate: null, aliquota: 8 }] },
      }),
      p("cartorio.faixas.notas", { uf: "SP", faixas: NOTAS_SP }),
      p("cartorio.imoveis.percentual_fallback", { uf: "SP", valor: 0.5 }),
      p("cartorio.certidoes.valor", { valor: 7000 }),
      p("honorarios.inventario.percentual", { uf: "SP", valor: 7 }),
      p("ir.faixas.ganho_capital", { faixas: GANHO_CAPITAL }),
      p("ir.faixas.irpf_mensal", { faixas: IRPF_MENSAL }),
      p("venda_forcada.desagio.percentual", { valor: 20 }),
      p("itbi.aliquota", { uf: "SP", municipio: "São Paulo", valor: 3 }),
      p("itcmd.aliquota.domicilio_vantajoso", { uf: "MS", valor: 2 }),
      p("itcmd.fixo.celula_3", { uf: "SP", valor: 4000 }),
      p("holding.junta_comercial.celula_1", { valor: 3577 }),
      p("holding.junta_comercial.celula_2", { valor: 3500 }),
      p("holding.junta_comercial.celula_3", { valor: 4599 }),
      p("holding.contabilidade.celula_1", { valor: 2133 }),
      p("holding.contabilidade.celula_2", { valor: 3555 }),
      p("holding.contabilidade.celula_3", { valor: 4266 }),
      p("honorarios.hora", { valor: 1800 }),
      p("honorarios.operacional.percentual", { valor: 10 }),
      p("honorarios.sv.padrao", { valor: 2000 }),
      p("incentivo.resolvedor.sv", { valor: 2400 }),
      p("honorarios.croqui.incentivo", { valor: 4500 }),
      p("incentivo.resolvedor.croqui", { valor: 2700 }),
      p("incentivo.resolvedor.saldo.percentual", { valor: 10 }),
      p("pagamento.sinal.percentual", { valor: 10 }),
      p("pagamento.parcelas.max", { valor: 5 }),
      p("membership.meses_isentos", { valor: 6 }),
      p("payback.cdi_anual.percentual", { valor: 10 }),
      p("locacao.pj.presumido.percentual", { valor: 3.65 }),
      p("reforma.irpj_csll.percentual", { valor: 7.68 }),
      p("reforma.ibs_cbs.debito.percentual", { valor: 15.9 }),
      p("operacional.risco_bloqueio.meses", { valor: 6 }),
    ]),
    horas_por_ato: HORAS,
    sinal_modelo_referencia: "celula_3",
    // membership.mensalidade e reforma.ibs_cbs.credito.percentual seguem em
    // divergência: o motor trava as tabelas, não escolhe um dos valores.
    divergencias: [
      { chave: "membership.mensalidade", valores: [750, 1350, 2000], onde: "contrato × slide 37" },
      { chave: "reforma.ibs_cbs.credito.percentual", valores: [26.5, 36.92], onde: "aba 10 × aba 8" },
    ],
  };
}

function entradaA(): EntradaCroqui {
  return {
    jornada_id: "00000000-0000-4000-8000-0000000000aa",
    uf: "SP",
    municipio: "São Paulo",
    uf_domicilio_vantajoso: "MS",
    familia: { regime_bens: "Comunhão universal", tem_conjuge: true, filhos: 2, netos: 3, nucleos: 2 },
    bens: [
      {
        id: "bem-a",
        classe: "imovel",
        descricao: "Imóvel A (exemplo)",
        valor_dirpf: 300000,
        valor_mercado: 1000000,
        destinacao: "locacao",
        valor_locacao_mensal: 20000,
        ano_aquisicao: 2005,
      },
      {
        id: "bem-b",
        classe: "imovel",
        descricao: "Imóvel B (exemplo)",
        valor_dirpf: 200000,
        valor_mercado: 600000,
        destinacao: "uso",
        valor_locacao_mensal: null,
        ano_aquisicao: 2010,
        vender_para_levantar: true,
      },
      {
        id: "bem-c",
        classe: "veiculo",
        descricao: "Veículo (exemplo)",
        valor_dirpf: 50000,
        valor_mercado: 40000,
        destinacao: "uso",
        valor_locacao_mensal: null,
        ano_aquisicao: 2020,
      },
      {
        id: "bem-d",
        classe: "investimento",
        descricao: "Investimento (exemplo)",
        valor_dirpf: 360000,
        valor_mercado: 360000,
        destinacao: null,
        valor_locacao_mensal: null,
        ano_aquisicao: 2018,
      },
    ],
    operacional: null,
    modelos: ["inventario", "doacao", "celula_1", "celula_2", "celula_3"],
    overrides: [],
  };
}

const AGORA = new Date("2026-09-05T12:00:00.000Z");

// ---------------------------------------------------------------------------
// A — exemplo sintético completo
// ---------------------------------------------------------------------------

function testeA(): ResultadoCroqui {
  bloco("A · exemplo sintético completo (14 assertivas do §4.8)");
  const r = calcularCroqui(entradaA(), parametrosA(), AGORA);

  // Totais do patrimônio
  valorEh("T2 total DIRPF = 910.000", cel(r, "formacao_patrimonial", "total", "dirpf"), 910000);
  valorEh("T2 total mercado = 2.000.000", cel(r, "formacao_patrimonial", "total", "mercado"), 2000000);
  valorEh("T2 tributação do aluguel = 4.604", cel(r, "formacao_patrimonial", "bem-a", "tributacao"), 4604);

  // T3 — inventário hoje
  valorEh("T3 ITCMD (faixa 2%) = 40.000", cel(r, "inventario_atual", "itcmd"), 40000);
  valorEh("T3 notas (teto da tabela SP) = 17.800", cel(r, "inventario_atual", "notas"), 17800);
  valorEh("T3 certidões = 7.000", cel(r, "inventario_atual", "certidoes"), 7000);
  valorEh("T3 imóveis (0,5% de fallback) = 10.000", cel(r, "inventario_atual", "imoveis"), 10000);
  valorEh("T3 honorários (7%) = 140.000", cel(r, "inventario_atual", "honorarios"), 140000);
  valorEh("T3 subtotal = 214.800", cel(r, "inventario_atual", "subtotal"), 214800);
  ok(
    "T3 notas veio da tabela da UF",
    cel(r, "inventario_atual", "notas")?.fonte === "tabela_uf",
    `fonte=${cel(r, "inventario_atual", "notas")?.fonte}`,
  );
  ok(
    "T3 imóveis declara o fallback",
    cel(r, "inventario_atual", "imoveis")?.fonte === "percentual_fallback",
    `fonte=${cel(r, "inventario_atual", "imoveis")?.fonte}`,
  );

  // T4 — custo da inércia
  valorEh("T4 deságio = 120.000", cel(r, "levantamento_inventario", "desagio"), 120000);
  valorEh("T4 ganho de capital = 280.000", cel(r, "levantamento_inventario", "ganho"), 280000);
  valorEh("T4 IR progressivo = 36.750", cel(r, "levantamento_inventario", "ir"), 36750);
  valorEh("T4 custo da inércia = 371.550", cel(r, "levantamento_inventario", "custo_da_inercia"), 371550);
  ausente("T4 risco de bloqueio ausente (sem PJ)", cel(r, "levantamento_inventario", "risco_bloqueio"));

  // T5 — inventário pós-reforma
  valorEh("T5 ITCMD teto 8% = 160.000", cel(r, "inventario_reforma", "itcmd"), 160000);
  valorEh("T5 subtotal = 334.800", cel(r, "inventario_reforma", "subtotal"), 334800);
  valorEh("T5 custo = 491.550", cel(r, "inventario_reforma", "custo"), 491550);

  // T6 — doação
  valorEh("T6 imóveis pela base DIRPF = 2.500", cel(r, "doacao", "imoveis"), 2500);
  valorEh("T6 ITCMD doação 4% = 80.000", cel(r, "doacao", "itcmd"), 80000);
  valorEh("T6 total = 107.300", cel(r, "doacao", "total"), 107300);
  valorEh("T6 diferença = 264.250", cel(r, "doacao", "diferenca"), 264250);
  valorEh("T6 economia = 71,1%", cel(r, "doacao", "percentual"), 71.1, 1);

  // T7 / T8 / T9 — as três células
  valorEh("T7 imóveis = 8.000", cel(r, "celula_1", "imoveis"), 8000);
  valorEh("T7 ITCMD 4% = 80.000", cel(r, "celula_1", "itcmd"), 80000);
  valorEh("T7 honorários = 90.000", cel(r, "celula_1", "honorarios"), 90000);
  valorEh("T7 total = 183.710", cel(r, "celula_1", "total"), 183710);
  valorEh("T7 economia = 50,6%", cel(r, "celula_1", "percentual"), 50.6, 1);

  valorEh("T8 ITCMD 2% (domicílio vantajoso) = 40.000", cel(r, "celula_2", "itcmd"), 40000);
  valorEh("T8 honorários = 84.600", cel(r, "celula_2", "honorarios"), 84600);
  valorEh("T8 total = 139.655", cel(r, "celula_2", "total"), 139655);
  valorEh("T8 economia = 62,4%", cel(r, "celula_2", "percentual"), 62.4, 1);

  valorEh("T9 base = Σd = 910.000", cel(r, "celula_3", "base"), 910000);
  valorEh("T9 ITCMD fixo = 4.000", cel(r, "celula_3", "itcmd"), 4000);
  valorEh("T9 honorários = 63.000", cel(r, "celula_3", "honorarios"), 63000);
  valorEh("T9 total = 83.865", cel(r, "celula_3", "total"), 83865);
  valorEh("T9 economia = 77,4%", cel(r, "celula_3", "percentual"), 77.4, 1);

  // T14 — ITBI
  valorEh("T14 ITBI possível = 33.000", cel(r, "itbi", "itbi_possivel"), 33000);
  valorEh("T14 1 célula com ITBI = 216.710", cel(r, "itbi", "celula_1"), 216710);

  // T11 — payback
  valorEh("T11 capital salvo = 287.685", cel(r, "payback", "capital_salvo"), 287685);
  valorEh("T11 economia de aluguel/mês = 2.338,00", cel(r, "payback", "economia_aluguel_mes"), 2338);
  valorEh("T11 taxa CDI/mês = 0,79741%", cel(r, "payback", "taxa_cdi_mes"), 0.79741, 5);
  // O §4.8 traz 2.294,03 e 4.632,03: são a taxa do CDI arredondada a 5 casas
  // ANTES da multiplicação. O motor guarda a precisão cheia e só arredonda na
  // apresentação — daí o centavo de diferença. Conferência com 1 casa.
  valorEh("T11 rendimento/mês ≈ 2.294,0", cel(r, "payback", "rendimento_mes"), 2294.04, 1);
  valorEh("T11 benefício/mês ≈ 4.632,0", cel(r, "payback", "beneficio_mes"), 4632.04, 1);
  valorEh("T11 payback = 18,1 meses", cel(r, "payback", "payback_meses"), 18.1, 1);

  // T16 / T17 / T18 / T19 — honorários, deduções, pagamento, membership
  valorEh("T16 preço total (1 célula) = 90.000", cel(r, "honorarios", "preco_total", "celula_1"), 90000);
  valorEh("T16 total (1 célula) = 99.000", cel(r, "honorarios", "total", "celula_1"), 99000);
  valorEh("T16 total (2 células) = 93.060", cel(r, "honorarios", "total", "celula_2"), 93060);
  valorEh("T16 total (3 células) = 69.300", cel(r, "honorarios", "total", "celula_3"), 69300);
  valorEh("T17 total a deduzir = 11.600", cel(r, "deducoes", "total_deducoes", "celula_1"), 11600);
  valorEh("T17 saldo (1 célula) = 87.400", cel(r, "deducoes", "saldo", "celula_1"), 87400);
  valorEh("T17 incentivo 10% = 8.740", cel(r, "deducoes", "incentivo_resolvedor", "celula_1"), 8740);
  valorEh("T17 novo saldo (1 célula) = 78.660", cel(r, "deducoes", "novo_saldo", "celula_1"), 78660);
  valorEh("T17 novo saldo (3 células) = 51.930", cel(r, "deducoes", "novo_saldo", "celula_3"), 51930);
  valorEh("T18 sinal (10% do saldo de 3 células) = 5.193", cel(r, "pagamento", "sinal", "celula_1"), 5193);
  valorEh("T18 saldo à vista (1 célula) = 73.467", cel(r, "pagamento", "saldo_a_vista", "celula_1"), 73467);
  valorEh("T18 5× (1 célula) = 14.693,40", cel(r, "pagamento", "parcela_5", "celula_1"), 14693.4);
  ausente("T19 mensalidade ausente (divergência de plano)", cel(r, "membership", "mensalidade"));
  ok(
    "T19 motivo cita a divergência",
    (cel(r, "membership", "mensalidade")?.motivo ?? "").includes("divergência"),
    cel(r, "membership", "mensalidade")?.motivo,
  );

  // Estrutura
  ok("T10 fora do resultado (sem PJ)", r.tabelas.operacional_pj === undefined);
  // 18 das 19: só T10 (empresa operacional) fica de fora — este cliente não tem PJ.
  ok("18 tabelas publicadas (T10 não se aplica)", Object.keys(r.tabelas).length === 18, `${Object.keys(r.tabelas).length} tabelas`);
  return r;
}

// ---------------------------------------------------------------------------
// B — ausência e cascata
// ---------------------------------------------------------------------------

function entradaB(): EntradaCroqui {
  return {
    jornada_id: "00000000-0000-4000-8000-0000000000bb",
    uf: "MG",
    municipio: "Belo Horizonte",
    uf_domicilio_vantajoso: null,
    familia: { regime_bens: null, tem_conjuge: false, filhos: 1, netos: null, nucleos: 1 },
    bens: [
      {
        id: "bem-imovel",
        classe: "imovel",
        descricao: "Imóvel único (exemplo)",
        valor_dirpf: 500000,
        valor_mercado: 500000,
        destinacao: "uso",
        valor_locacao_mensal: null,
        ano_aquisicao: 2001,
      },
      {
        id: "bem-empresa",
        classe: "empresa",
        descricao: "Participação societária (exemplo)",
        valor_dirpf: 1000000,
        valor_mercado: null, // ← o buraco que contamina tudo que usa mercado
        destinacao: "operacional",
        valor_locacao_mensal: null,
        ano_aquisicao: 1998,
      },
    ],
    operacional: null,
    modelos: ["inventario", "doacao", "celula_1", "celula_2", "celula_3"],
    overrides: [],
  };
}

function parametrosB(): ParametrosCroqui {
  return {
    itens: mapear([
      // MG tem o percentual de aproximação, mas NÃO tem tabela de emolumentos.
      p("cartorio.notas.percentual_fallback", { uf: "MG", valor: 0.8 }),
      p("cartorio.imoveis.percentual_fallback", { uf: "MG", valor: 0.5 }),
      p("cartorio.certidoes.valor", { valor: 7000 }),
      p("honorarios.inventario.percentual", { uf: "MG", valor: 7 }),
      p("itcmd.faixas.heranca", {
        uf: "MG",
        faixas: { modo: "faixa_unica", faixas: [{ ordem: 1, ate: null, aliquota: 5 }] },
      }),
      p("ir.faixas.ganho_capital", { faixas: GANHO_CAPITAL }),
      p("ir.faixas.irpf_mensal", { faixas: IRPF_MENSAL }),
      p("venda_forcada.desagio.percentual", { valor: 20 }),
      p("itbi.aliquota", { uf: "MG", municipio: "Belo Horizonte", valor: 3 }),
      p("holding.junta_comercial.celula_3", { valor: 4599 }),
      p("holding.contabilidade.celula_3", { valor: 4266 }),
      p("honorarios.hora", { valor: 1800 }),
      p("honorarios.operacional.percentual", { valor: 10 }),
      // itcmd.faixas.doacao de MG e itcmd.fixo.celula_3 NÃO cadastrados.
    ]),
    horas_por_ato: HORAS,
    sinal_modelo_referencia: "celula_3",
    divergencias: [],
  };
}

function testeB(): ResultadoCroqui {
  bloco("B · ausência e cascata (parcela ausente contamina o total)");
  const r = calcularCroqui(entradaB(), parametrosB(), AGORA);

  const totalMercado = cel(r, "formacao_patrimonial", "total", "mercado");
  ausente("T2 total de mercado ausente", totalMercado);
  ok(
    "T2 motivo nomeia o bem que falta",
    (totalMercado?.motivo ?? "").includes("Participação societária"),
    totalMercado?.motivo,
  );
  valorEh("T2 total DIRPF segue calculado = 1.500.000", cel(r, "formacao_patrimonial", "total", "dirpf"), 1500000);

  ausente("T3 base ausente em cascata", cel(r, "inventario_atual", "base"));
  ausente("T3 subtotal ausente", cel(r, "inventario_atual", "subtotal"));
  ausente("T4 custo da inércia ausente", cel(r, "levantamento_inventario", "custo_da_inercia"));
  ausente("T5 custo ausente", cel(r, "inventario_reforma", "custo"));
  ausente("T6 total ausente", cel(r, "doacao", "total"));
  ausente("T7 total ausente (base é mercado)", cel(r, "celula_1", "total"));
  ausente("T8 total ausente (base é mercado)", cel(r, "celula_2", "total"));
  ausente("T13 economia da doação ausente", cel(r, "comparativo_geral", "doacao", "dif_percentual"));

  // A 3ª célula usa DIRPF: a base sobrevive, o ITCMD não (MG sem a chave).
  valorEh("T9 base = Σd = 1.500.000 (DIRPF)", cel(r, "celula_3", "base"), 1500000);
  const itcmd3 = cel(r, "celula_3", "itcmd");
  ausente("T9 ITCMD ausente", itcmd3);
  ok(
    "T9 ITCMD aponta a chave e a UF que faltam",
    (itcmd3?.falta ?? []).some((f) => f.chave === "itcmd.fixo.celula_3" && f.uf === "MG"),
    JSON.stringify(itcmd3?.falta),
  );
  ausente("T9 total ausente por causa do ITCMD (invariante de propagação)", cel(r, "celula_3", "total"));

  // Cartório: sem tabela da UF, o motor usa o percentual e DIZ que usou.
  const imoveis3 = cel(r, "celula_3", "imoveis");
  valorEh("T9 imóveis pelo fallback = 2.500", imoveis3, 2500);
  ok("T9 imóveis declara percentual_fallback", imoveis3?.fonte === "percentual_fallback", `fonte=${imoveis3?.fonte}`);
  ok(
    "T9 fórmula avisa que a tabela da UF não está cadastrada",
    (imoveis3?.formula ?? "").includes("não está cadastrada"),
    imoveis3?.formula,
  );

  // Zero É resultado: mercado == DIRPF, então não há ITBI a pagar.
  const itbi = cel(r, "itbi", "itbi_possivel");
  valorEh("T14 ITBI possível = 0 (mercado == DIRPF)", itbi, 0);
  ok("T14 ITBI é calculado, não ausente", itbi?.procedencia === "calculado", `procedencia=${itbi?.procedencia}`);

  ok("T10 fora do resultado (sem PJ)", r.tabelas.operacional_pj === undefined);
  ok("T12 fora do resultado (sem locação)", r.tabelas.operacional_locacao === undefined);

  // As faltas agregadas nomeiam a chave e as tabelas que ela trava.
  const falta = r.faltas.find((f) => f.chave === "itcmd.faixas.doacao");
  ok("faltas agregadas listam itcmd.faixas.doacao", Boolean(falta), JSON.stringify(r.faltas.map((f) => f.chave)));
  ok(
    "e dizem quais tabelas ela trava",
    (falta?.tabelas ?? []).length > 0,
    JSON.stringify(falta?.tabelas),
  );

  // chavesNecessarias devolve só o que ESTE cliente exige.
  const necessarias = chavesNecessarias(entradaB());
  ok(
    "chavesNecessarias não pede parâmetro de operação inexistente",
    !necessarias.includes("operacional.risco_bloqueio.meses"),
    necessarias.join(", "),
  );
  ok("chavesNecessarias pede o ITCMD da 3ª célula", necessarias.includes("itcmd.fixo.celula_3"));
  return r;
}

// ---------------------------------------------------------------------------
// C — regressão do deck zerado
// ---------------------------------------------------------------------------

function testeC(resultados: ResultadoCroqui[]) {
  bloco('C · regressão do deck zerado (nenhum "R$ 0,00" no lugar de ausência)');

  // O caso do Drive: o ITCMD some no meio do cálculo.
  const parametros = parametrosA();
  delete parametros.itens[chaveMapa("itcmd.faixas.heranca", "SP", null)];
  const r = calcularCroqui(entradaA(), parametros, AGORA);
  const todos = [...resultados, r];

  ausente("T4 custo da inércia vira null quando o ITCMD some", cel(r, "levantamento_inventario", "custo_da_inercia"));
  ok(
    "e a frase de fechamento não pode ser montada",
    !podeAfirmar(cel(r, "levantamento_inventario", "custo_da_inercia") as Celula),
  );

  let zeroFantasma = 0;
  let valorEmAusente = 0;
  let formatouZero = 0;
  let semMotivo = 0;
  for (const resultado of todos) {
    for (const { celula } of todasAsCelulas(resultado)) {
      if (celula.procedencia === "ausente") {
        if (celula.valor === 0) zeroFantasma += 1;
        if (celula.valor !== null) valorEmAusente += 1;
        if (!celula.motivo) semMotivo += 1;
        const texto = formatarCelula(celula);
        if (texto.includes("0,00") || texto !== TEXTO_AUSENTE) formatouZero += 1;
      }
    }
  }
  ok("nenhuma célula ausente com valor 0", zeroFantasma === 0, `${zeroFantasma} célula(s)`);
  ok("nenhuma célula ausente com valor não nulo", valorEmAusente === 0, `${valorEmAusente} célula(s)`);
  ok("toda célula ausente tem motivo em português", semMotivo === 0, `${semMotivo} sem motivo`);
  ok(`o formatador devolve "${TEXTO_AUSENTE}" para toda ausência`, formatouZero === 0, `${formatouZero} formatada(s) como número`);

  // E o contrário: zero calculado continua sendo zero na tela.
  const zeroReal = cel(testeCZeroCalculado(), "itbi", "itbi_possivel") as Celula;
  // Intl usa espaço não separável entre o símbolo e o número.
  const semNbsp = (s: string) => s.replace(/ /g, " ");
  ok("zero calculado é formatado como R$ 0,00", semNbsp(formatarCelula(zeroReal)) === "R$ 0,00", formatarCelula(zeroReal));
}

function testeCZeroCalculado(): ResultadoCroqui {
  return calcularCroqui(entradaB(), parametrosB(), AGORA);
}

// ---------------------------------------------------------------------------
// D — faixas e propriedade
// ---------------------------------------------------------------------------

function testeD() {
  bloco("D · faixas (isento/faixa/teto) e propriedade (determinismo, não lança)");

  const itcmdSp: TabelaFaixas = {
    modo: "faixa_unica",
    isento_ate: 400000,
    faixas: [
      { ordem: 1, ate: 4000000, aliquota: 2 },
      { ordem: 2, ate: 10000000, aliquota: 4 },
      { ordem: 3, ate: null, aliquota: 6 },
    ],
  };
  ok("faixa_unica · isento devolve 0 calculado", aplicarFaixas(399999, itcmdSp).valor === 0);
  ok("faixa_unica · faixa 1 = 2%", aplicarFaixas(2000000, itcmdSp).valor === 40000);
  ok("faixa_unica · faixa 2 = 4%", aplicarFaixas(5000000, itcmdSp).valor === 200000);
  ok("faixa_unica · faixa 3 = 6%", aplicarFaixas(20000000, itcmdSp).valor === 1200000);
  ok("faixa_unica · ordem da faixa vem carimbada", aplicarFaixas(5000000, itcmdSp).faixa_aplicada === 2);

  const comTeto: TabelaFaixas = { ...itcmdSp, teto: 100000 };
  ok("teto limita o valor calculado", aplicarFaixas(20000000, comTeto).valor === 100000);
  ok("teto aparece na fórmula", aplicarFaixas(20000000, comTeto).formula.includes("teto"));

  ok("progressivo · isento até 35.000", aplicarFaixas(35000, GANHO_CAPITAL).valor === 0);
  ok("progressivo · 280.000 → 36.750", arred(aplicarFaixas(280000, GANHO_CAPITAL).valor, 2) === 36750);
  ok(
    "progressivo · atravessa duas faixas",
    arred(aplicarFaixas(6000000, GANHO_CAPITAL).valor, 2) === arred((5000000 - 35000) * 0.15 + 1000000 * 0.175, 2),
  );

  ok("valor_fixo · faixa 1 = 550", aplicarFaixas(40000, NOTAS_SP).valor === 550);
  ok("valor_fixo · última faixa (teto de tabela) = 17.800", aplicarFaixas(9000000, NOTAS_SP).valor === 17800);

  ok("IRPF mensal aplica a parcela a deduzir", arred(aplicarFaixas(20000, IRPF_MENSAL).valor, 2) === 4604);

  // Monotonicidade: alíquota não decresce entre faixas ⇒ valor não decresce.
  let monotonica = true;
  for (const tabela of [itcmdSp, GANHO_CAPITAL, NOTAS_SP, IRPF_MENSAL]) {
    let anterior = -1;
    for (let base = 0; base <= 12000000; base += 50000) {
      const v = aplicarFaixas(base, tabela).valor;
      if (v + 1e-9 < anterior) monotonica = false;
      anterior = v;
    }
  }
  ok("aplicarFaixas é monotônica na base", monotonica);

  // Determinismo e robustez em 200 entradas aleatórias.
  const aleatorio = criarAleatorio(20260905);
  let lancou = 0;
  let divergiu = 0;
  let inconsistente = 0;
  for (let i = 0; i < 200; i += 1) {
    const entrada = entradaAleatoria(aleatorio, i);
    const parametros = i % 3 === 0 ? parametrosB() : parametrosA();
    try {
      const um = calcularCroqui(entrada, parametros, AGORA);
      const dois = calcularCroqui(entrada, parametros, AGORA);
      if (JSON.stringify(um) !== JSON.stringify(dois)) divergiu += 1;
      for (const { celula } of todasAsCelulas(um)) {
        if (celula.procedencia === "ausente" && celula.valor !== null) inconsistente += 1;
        if (celula.procedencia !== "ausente" && !Number.isFinite(celula.valor as number)) inconsistente += 1;
      }
    } catch {
      lancou += 1;
    }
  }
  ok("200 entradas aleatórias: nunca lança", lancou === 0, `${lancou} exceção(ões)`);
  ok("200 entradas aleatórias: determinístico", divergiu === 0, `${divergiu} divergência(s)`);
  ok("200 entradas aleatórias: procedência coerente com o valor", inconsistente === 0, `${inconsistente} célula(s)`);
}

/** PRNG determinístico (mulberry32) — teste de propriedade precisa ser reproduzível. */
function criarAleatorio(semente: number) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function entradaAleatoria(rnd: () => number, i: number): EntradaCroqui {
  const classes = ["imovel", "veiculo", "investimento", "previdencia", "empresa", "outro"] as const;
  const ufs = ["SP", "MG", "RJ", null];
  const quantos = Math.floor(rnd() * 6);
  return {
    jornada_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    uf: ufs[Math.floor(rnd() * ufs.length)],
    municipio: rnd() > 0.5 ? "São Paulo" : null,
    uf_domicilio_vantajoso: rnd() > 0.5 ? "MS" : null,
    familia: {
      regime_bens: rnd() > 0.5 ? "Comunhão parcial" : null,
      tem_conjuge: rnd() > 0.5,
      filhos: rnd() > 0.2 ? Math.floor(rnd() * 5) : null,
      netos: rnd() > 0.5 ? Math.floor(rnd() * 8) : null,
      nucleos: rnd() > 0.5 ? Math.floor(rnd() * 4) : null,
    },
    bens: Array.from({ length: quantos }, (_, j) => ({
      id: `bem-${i}-${j}`,
      classe: classes[Math.floor(rnd() * classes.length)],
      descricao: `Bem sintético ${j}`,
      valor_dirpf: rnd() > 0.2 ? Math.floor(rnd() * 5_000_000) : null,
      valor_mercado: rnd() > 0.2 ? Math.floor(rnd() * 9_000_000) : null,
      destinacao: null,
      valor_locacao_mensal: rnd() > 0.6 ? Math.floor(rnd() * 60000) : null,
      ano_aquisicao: 1990 + Math.floor(rnd() * 35),
      vender_para_levantar: rnd() > 0.9,
    })),
    operacional:
      rnd() > 0.6
        ? {
            faturamento_mensal: rnd() > 0.2 ? Math.floor(rnd() * 2_000_000) : null,
            custo_operacional_mensal: rnd() > 0.5 ? Math.floor(rnd() * 500_000) : null,
          }
        : null,
    modelos: ["inventario", "doacao", "celula_1", "celula_2", "celula_3"],
    cdi_anual: rnd() > 0.7 ? Math.floor(rnd() * 20) : null,
    overrides: [],
  };
}

// ---------------------------------------------------------------------------
// E — conferência contra a planilha real (LOCAL, nunca versionada)
// ---------------------------------------------------------------------------

interface Fixture {
  entrada: EntradaCroqui;
  parametros: ParametrosCroqui;
  /** { tabela: { linha: { coluna: valorEsperado } } } */
  esperado: Record<string, Record<string, Record<string, number | null>>>;
}

function testeE(caminho: string) {
  if (!existsSync(caminho)) {
    console.log(`SKIP  E · conferência contra a planilha (fixture local ausente: ${caminho})`);
    return;
  }
  bloco("E · conferência contra a planilha real (placar; nenhum valor impresso)");
  let fixture: Fixture;
  try {
    fixture = JSON.parse(readFileSync(caminho, "utf8")) as Fixture;
  } catch (erro) {
    ok("fixture legível", false, erro instanceof Error ? erro.message : String(erro));
    return;
  }

  const r = calcularCroqui(fixture.entrada, fixture.parametros, AGORA);
  for (const [tabela, linhas] of Object.entries(fixture.esperado)) {
    let bateram = 0;
    let divergiram = 0;
    let ausentes = 0;
    for (const [linha, colunas] of Object.entries(linhas)) {
      for (const [coluna, esperado] of Object.entries(colunas)) {
        const c = cel(r, tabela as ChaveTabela, linha, coluna);
        if (esperado === null) {
          if (c && c.procedencia === "ausente") bateram += 1;
          else divergiram += 1;
          continue;
        }
        if (!c || c.valor === null) {
          ausentes += 1;
          continue;
        }
        if (arred(c.valor, 2) === arred(esperado, 2)) bateram += 1;
        else divergiram += 1;
      }
    }
    // Placar apenas — nenhum valor vai para a saída, só a contagem.
    const passou = divergiram === 0 && ausentes === 0;
    console.log(
      `      ${passou ? "PASS" : "FAIL"}  ${tabela.padEnd(24)} ${bateram} bateram · ${divergiram} divergiram · ${ausentes} ausentes`,
    );
    ok(`${tabela}: ${divergiram} divergência(s), ${ausentes} ausente(s)`, passou);
  }
}


// ---------------------------------------------------------------------------
// F — a ponte com o banco: `calcularParaJornada` contra um Supabase FALSO
//
// Existe porque dois bugs desta fase moravam AQUI, não no motor puro:
//   (a) uma jornada com 10 bens na Ficha entregava `entrada.bens.length === 1`;
//   (b) `croqui.mapa_rubricas` preenchido sobrescrevia a célula do cenário
//       ERRADO, porque o casamento era só pelo nome da rubrica — e o `itcmd` do
//       cenário de doação e o do de inventário são a mesma palavra.
// Nenhum dos dois aparece em teste do motor puro: o motor recebe a entrada
// pronta e calcula certo em cima de uma entrada errada.
// ---------------------------------------------------------------------------

interface ChamadaFalsa {
  tabela: string;
}

/**
 * Cliente Supabase mínimo: encadeia `select/eq/in/order`, resolve como promessa
 * (lista) ou por `maybeSingle()` (primeira linha), e ANOTA cada `from()`. A
 * anotação é o que transforma "reduzi as idas ao banco" em número.
 */
function criarClienteFalso(fontes: Record<string, unknown>, chamadas: ChamadaFalsa[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const from = (tabela: string): any => {
    chamadas.push({ tabela });
    const alvo = fontes[tabela] ?? [];
    const primeira = Array.isArray(alvo) ? (alvo[0] ?? null) : alvo;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api: any = {
      select: () => api,
      eq: () => api,
      in: () => api,
      order: () => api,
      returns: () => api,
      maybeSingle: async () => ({ data: primeira, error: null }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      then: (aceitar: any, recusar: any) => Promise.resolve({ data: alvo, error: null }).then(aceitar, recusar),
    };
    return api;
  };
  return { from };
}

const JORNADA_F = "11111111-1111-4111-8111-111111111111";
const PESSOA_F = "22222222-2222-4222-8222-222222222222";

/** 10 bens ativos + 1 dado baixa, cobrindo classe, DIRPF, mercado e locação. */
function bensDaFicha() {
  const classes = [
    "imovel", "imovel", "imovel", "veiculo", "veiculo",
    "investimento", "previdencia", "empresa", "outro", "imovel",
  ];
  const itens = classes.map((tipo, i) => ({
    id: `bem-${i + 1}`,
    pessoa_id: PESSOA_F,
    tipo,
    descricao: `Bem ${i + 1}`,
    ano_aquisicao: 2010 + i,
    valor_historico: 100_000 + i * 1_000,
    valor_mercado: 200_000 + i * 2_000,
    destinacao: i % 3 === 0 ? "locacao" : "residencia",
    valor_locacao_mensal: i % 3 === 0 ? 2_000 + i * 10 : null,
    detalhes: tipo === "empresa" ? { faturamento_mensal: 50_000, custo_operacional_mensal: 20_000 } : {},
    ativo: true,
    criado_em: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
  }));
  itens.push({
    id: "bem-baixado",
    pessoa_id: PESSOA_F,
    tipo: "imovel",
    descricao: "Imóvel vendido no ano passado",
    ano_aquisicao: 2001,
    valor_historico: 999_999,
    valor_mercado: 999_999,
    destinacao: "residencia",
    valor_locacao_mensal: null,
    detalhes: {},
    ativo: false,
    criado_em: "2026-01-20T00:00:00Z",
  });
  return itens;
}

function fontesF(mapaRubricas: Record<string, unknown>) {
  return {
    jornadas: [
      {
        id: JORNADA_F,
        pessoa_id: PESSOA_F,
        pessoas: {
          uf: "SP",
          cidade: "São Paulo",
          patrimonio_itens: bensDaFicha(),
          familiares: [
            { id: "fam-1", pessoa_id: PESSOA_F, parentesco: "conjuge", nome: "C", regime_casamento: "comunhao parcial", ativo: true, criado_em: "2026-01-01T00:00:00Z" },
            { id: "fam-2", pessoa_id: PESSOA_F, parentesco: "filho", nome: "F1", ativo: true, criado_em: "2026-01-02T00:00:00Z" },
            { id: "fam-3", pessoa_id: PESSOA_F, parentesco: "filho", nome: "F2", ativo: false, criado_em: "2026-01-03T00:00:00Z" },
          ],
        },
      },
    ],
    configuracoes: [
      { chave: "croqui.uf_domicilio_vantajoso", valor: "mg" },
      { chave: "croqui.mapa_rubricas", valor: mapaRubricas },
      { chave: "croqui.horas_por_ato", valor: [] },
      { chave: "croqui.sinal_modelo_referencia", valor: "celula_3" },
      { chave: "parametros.divergencias", valor: [] },
    ],
    cenario_rubricas: [
      { id: "rub-doacao", rubrica: "itcmd", valor: 111, procedencia: "digitado", cenarios_patrimoniais: { jornada_id: JORNADA_F, cenario: "doacao" } },
      { id: "rub-inventario", rubrica: "itcmd", valor: 222, procedencia: "digitado", cenarios_patrimoniais: { jornada_id: JORNADA_F, cenario: "inventario" } },
    ],
    parametros_metodo: [],
  };
}

async function testeF() {
  bloco("F · ponte com o banco (bens da ficha e override por cenário)");

  // (a) todos os bens ativos entram — o bug era `entrada.bens.length === 1`.
  const chamadas: ChamadaFalsa[] = [];
  const cliente = criarClienteFalso(
    fontesF({ "doacao.itcmd": { tabela: "doacao", linha: "itcmd", coluna: "valor" } }),
    chamadas,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const calculo = await calcularParaJornada(cliente as any, JORNADA_F);
  const bens = calculo.entrada.bens;
  const classes = new Set(bens.map((b) => b.classe));

  ok("10 bens ativos entram na entrada (o bem dado baixa não entra)", bens.length === 10, `veio ${bens.length}`);
  ok("nenhum bem perde a classe", bens.every((b) => typeof b.classe === "string" && b.classe.length > 0));
  ok("as 6 classes de `tipo_bem` sobrevivem ao mapeamento", classes.size === 6, `${classes.size} classes`);
  ok("todo bem traz DIRPF e valor de mercado", bens.every((b) => b.valor_dirpf !== null && b.valor_mercado !== null));
  ok(
    "bem de locação traz o aluguel",
    bens.filter((b) => b.destinacao === "locacao").every((b) => b.valor_locacao_mensal !== null),
  );
  ok("são 4 bens de locação", bens.filter((b) => b.destinacao === "locacao").length === 4);
  ok("o bem dado baixa ficou de fora", !bens.some((b) => b.descricao.includes("vendido")));
  ok("empresa alimenta o operacional", calculo.entrada.operacional?.faturamento_mensal === 50_000);
  ok("familiar dado baixa não conta", calculo.entrada.familia.filhos === 1, `filhos=${calculo.entrada.familia.filhos}`);
  ok("uf vantajosa da configuração entra em maiúscula", calculo.entrada.uf_domicilio_vantajoso === "MG");
  ok("T2 lista os 10 bens", (calculo.resultado.tabelas.formacao_patrimonial?.linhas.length ?? 0) >= 10);

  // (b) o override casa rubrica E cenário.
  const overrides = calculo.entrada.overrides;
  ok("mapa 'doacao.itcmd' produz UM override", overrides.length === 1, `veio ${overrides.length}`);
  ok("e é a rubrica do cenário de doação, não a do inventário", overrides[0]?.rubrica_id === "rub-doacao", `veio ${overrides[0]?.rubrica_id}`);
  ok("o valor é o do cenário certo", overrides[0]?.valor === 111);

  // (c) chave sem cenário não casa mais — é o que impedia a 0066 de semear o mapa.
  const chamadas2: ChamadaFalsa[] = [];
  const cliente2 = criarClienteFalso(fontesF({ itcmd: { tabela: "doacao", linha: "itcmd", coluna: "valor" } }), chamadas2);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const semCenario = await calcularParaJornada(cliente2 as any, JORNADA_F);
  ok(
    "mapa só com o nome da rubrica não sobrescreve nada",
    semCenario.entrada.overrides.length === 0,
    `veio ${semCenario.entrada.overrides.length}`,
  );

  // (d) mapa vazio nem consulta `cenario_rubricas`.
  const chamadas3: ChamadaFalsa[] = [];
  const cliente3 = criarClienteFalso(fontesF({}), chamadas3);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await calcularParaJornada(cliente3 as any, JORNADA_F);
  const tabelas3 = chamadas3.map((c) => c.tabela);
  ok("mapa vazio não consulta `cenario_rubricas`", !tabelas3.includes("cenario_rubricas"));
  ok(
    "3 consultas no caminho normal (jornadas, configuracoes, parametros_metodo)",
    chamadas3.length === 3,
    `foram ${chamadas3.length}: ${tabelas3.join(", ")}`,
  );
  ok("`jornadas` é consultada UMA vez", tabelas3.filter((t) => t === "jornadas").length === 1);
  ok("`configuracoes` é consultada UMA vez", tabelas3.filter((t) => t === "configuracoes").length === 1);
  ok(
    "com mapa preenchido são 4 (a quarta é `cenario_rubricas`)",
    chamadas.length === 4,
    `foram ${chamadas.length}: ${chamadas.map((c) => c.tabela).join(", ")}`,
  );
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const arg = process.argv.indexOf("--fixture");
  const caminhoFixture = resolve(
    process.cwd(),
    arg >= 0 && process.argv[arg + 1] ? process.argv[arg + 1] : "tmp/squad/fixture-motor-exemplo.json",
  );

  console.log("Motor do Croqui — testes de mesa (§4.8)\n");
  const a = testeA();
  const b = testeB();
  testeC([a, b]);
  testeD();
  fecharBloco();
  testeE(caminhoFixture);
  fecharBloco();
  await testeF();
  fecharBloco();

  console.log(`\n${total - falhas}/${total} assertivas passaram.`);
  if (falhas > 0) {
    console.log(`${falhas} FALHA(S).`);
    process.exit(1);
  }
  console.log("Motor do Croqui: OK.");
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
