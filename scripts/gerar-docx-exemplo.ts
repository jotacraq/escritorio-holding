/**
 * Prova de mesa do `.docx` do Relatório do Croqui (M6, Fase 5).
 *
 *   npx tsx scripts/gerar-docx-exemplo.ts
 *
 * Gera DOIS arquivos em `tmp/squad/` (pasta não versionada) a partir de uma
 * fixture 100% sintética — a mesma entrada do bloco A de
 * `scripts/teste-motor-croqui.ts`, sem um único dado de cliente:
 *
 *   1. `relatorio-exemplo.docx`          — cálculo completo.
 *   2. `relatorio-exemplo-faltando.docx` — os mesmos bens com parâmetros
 *      faltando, que é o cenário do teste C: célula sem insumo tem de sair como
 *      travessão, nunca como "R$ 0,00".
 *
 * Depois escreve um manifesto com o texto ESPERADO de cada célula (calculado
 * pelo mesmo `formatarCelula` do motor) e roda um checador em `python-docx` que
 * abre os arquivos de verdade e confere:
 *
 *   - abre sem erro e tem as seções na ordem de §10.1;
 *   - cada célula do documento é exatamente o texto esperado;
 *   - nenhuma célula ausente virou "R$ 0,00";
 *   - o total de "R$ 0,00" no documento é igual ao total de zeros LEGÍTIMOS
 *     (a conta deu zero) — nem um a mais;
 *   - `TEXTO_AUSENTE` aparece no arquivo com parâmetros faltando.
 *
 * Sai com código ≠ 0 se qualquer conferência falhar.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type {
  Celula,
  ChaveTabela,
  EntradaCroqui,
  ParametroCroqui,
  ParametrosCroqui,
  ResultadoCroqui,
  TabelaFaixas,
} from "../src/types/croqui-calculo";
import { calcularCroqui, formatarCelula, formatarValor, TEXTO_AUSENTE } from "../src/server/motor-croqui";
import { chaveMapa } from "../src/server/motor-croqui/contexto";
import { montarDocxCroqui, ORDEM_SECOES, TITULO_TABELA, tipoDaCelula } from "../src/server/exportacao/docx-croqui";

const PYTHON = process.env.PYTHON_BIN ?? "C:\\Users\\João\\AppData\\Local\\Python\\bin\\python.exe";
const SAIDA = resolve(process.cwd(), "tmp", "squad");

// ---------------------------------------------------------------------------
// Fixture sintética (bloco A de scripts/teste-motor-croqui.ts)
// ---------------------------------------------------------------------------

let seq = 0;
function p(chave: string, dados: { valor?: number; faixas?: TabelaFaixas; uf?: string; municipio?: string }): ParametroCroqui {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
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

function parametrosCompletos(): ParametrosCroqui {
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
      p("itcmd.faixas.heranca_reforma", { uf: "SP", faixas: { modo: "faixa_unica", faixas: [{ ordem: 1, ate: null, aliquota: 8 }] } }),
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
      p("itcmd.faixas.doacao_reforma", { uf: "SP", faixas: { modo: "faixa_unica", faixas: [{ ordem: 1, ate: null, aliquota: 8 }] } }),
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
    divergencias: [
      { chave: "membership.mensalidade", valores: [750, 1350, 2000], onde: "contrato × slide 37" },
      { chave: "reforma.ibs_cbs.credito.percentual", valores: [26.5, 36.92], onde: "aba 10 × aba 8" },
    ],
  };
}

/**
 * O segundo cenário: o escritório ainda não cadastrou meia dúzia de chaves. É
 * exatamente aqui que a planilha do processo antigo entregava "R$ 0,00".
 */
function parametrosFaltando(): ParametrosCroqui {
  const base = parametrosCompletos();
  const remover = [
    "cartorio.faixas.notas",
    "cartorio.certidoes.valor",
    "honorarios.inventario.percentual",
    "ir.faixas.ganho_capital",
    "honorarios.hora",
    "itcmd.fixo.celula_3",
    "membership.meses_isentos",
  ];
  const itens = Object.fromEntries(
    Object.entries(base.itens).filter(([, item]) => !remover.includes(item.chave)),
  );
  // Sem a tabela de horas por ato, T15/T16 nascem ausentes e contaminam T7–T9.
  return { ...base, itens, horas_por_ato: [] };
}

function entradaExemplo(): EntradaCroqui {
  return {
    jornada_id: "00000000-0000-4000-8000-0000000000aa",
    uf: "SP",
    municipio: "São Paulo",
    uf_domicilio_vantajoso: "MS",
    familia: { regime_bens: "Comunhão universal", tem_conjuge: true, filhos: 2, netos: 3, nucleos: 2 },
    bens: [
      { id: "bem-a", classe: "imovel", descricao: "Imóvel A (exemplo)", valor_dirpf: 300000, valor_mercado: 1000000, destinacao: "locacao", valor_locacao_mensal: 20000, ano_aquisicao: 2005 },
      { id: "bem-b", classe: "imovel", descricao: "Imóvel B (exemplo)", valor_dirpf: 200000, valor_mercado: 600000, destinacao: "uso", valor_locacao_mensal: null, ano_aquisicao: 2010, vender_para_levantar: true },
      { id: "bem-c", classe: "veiculo", descricao: "Veículo (exemplo)", valor_dirpf: 50000, valor_mercado: 40000, destinacao: "uso", valor_locacao_mensal: null, ano_aquisicao: 2020 },
      { id: "bem-d", classe: "investimento", descricao: "Investimento (exemplo)", valor_dirpf: 360000, valor_mercado: 360000, destinacao: null, valor_locacao_mensal: null, ano_aquisicao: 2018 },
    ],
    operacional: null,
    modelos: ["inventario", "doacao", "celula_1", "celula_2", "celula_3"],
    overrides: [],
  };
}

const AGORA = new Date("2026-09-05T12:00:00.000Z");

// ---------------------------------------------------------------------------
// Manifesto — o texto esperado de cada célula, pelo MESMO formatador
// ---------------------------------------------------------------------------

interface LinhaManifesto {
  rotulo: string;
  textos: string[];
  /** Quais colunas desta linha têm de sair como travessão. */
  ausentes: number[];
}

interface TabelaManifesto {
  chave: ChaveTabela;
  titulo: string;
  colunas: string[];
  linhas: LinhaManifesto[];
}

interface Manifesto {
  arquivo: string;
  texto_ausente: string;
  /**
   * O zero em reais COMO O FORMATADOR O PRODUZ. `Intl` em pt-BR separa o "R$"
   * do número com NBSP (U+00A0), não com espaço comum: procurar a string ASCII
   * "R$ 0,00" no arquivo NUNCA acha nada e o teste passaria vazio. Medido em
   * 05/09/2026 — a primeira versão desta conferência era teatro por causa disso.
   */
  zero_brl: string;
  /** Títulos de seção (H1 e H2), na ordem em que têm de aparecer. */
  titulos: string[];
  tabelas: TabelaManifesto[];
  tabelas_ausentes: string[];
  celulas_ausentes: number;
  zeros_legitimos: number;
  marca_dagua: string | null;
}

const ehAusente = (c: Celula | undefined): boolean =>
  !c || c.procedencia === "ausente" || c.valor === null || !Number.isFinite(c.valor);

const ZERO_BRL = formatarValor(0, "brl");

function montarManifesto(resultado: ResultadoCroqui, arquivo: string, marcaDagua: string | null): Manifesto {
  const tabelas: TabelaManifesto[] = [];
  const ausentesTabela: string[] = [];
  const titulos: string[] = [];
  let celulasAusentes = 0;
  let zeros = 0;

  for (const chave of ORDEM_SECOES) {
    const tabela = resultado.tabelas[chave];
    if (!tabela) {
      ausentesTabela.push(chave);
      titulos.push(TITULO_TABELA[chave]);
      continue;
    }
    titulos.push(tabela.titulo || TITULO_TABELA[chave]);

    const linhas: LinhaManifesto[] = tabela.linhas.map((l) => {
      const textos: string[] = [];
      const ausentes: number[] = [];
      tabela.colunas.forEach((col, i) => {
        const celula = l.celulas[col.chave];
        const tipo = tipoDaCelula(chave, l.chave, col.chave);
        const texto = celula ? formatarCelula(celula, tipo) : TEXTO_AUSENTE;
        textos.push(texto);
        if (ehAusente(celula)) {
          ausentes.push(i);
          celulasAusentes += 1;
        } else if (texto === ZERO_BRL) {
          zeros += 1;
        }
      });
      return { rotulo: l.rotulo, textos, ausentes };
    });

    tabelas.push({ chave, titulo: tabela.titulo || TITULO_TABELA[chave], colunas: tabela.colunas.map((c) => c.rotulo), linhas });
  }

  return {
    arquivo,
    texto_ausente: TEXTO_AUSENTE,
    zero_brl: ZERO_BRL,
    titulos,
    tabelas,
    tabelas_ausentes: ausentesTabela,
    celulas_ausentes: celulasAusentes,
    zeros_legitimos: zeros,
    marca_dagua: marcaDagua,
  };
}

// ---------------------------------------------------------------------------
// Checador em python-docx (escrito ao lado dos arquivos, para reexecução)
// ---------------------------------------------------------------------------

const CHECADOR = String.raw`# -*- coding: utf-8 -*-
"""Confere os .docx do Relatório do Croqui contra o manifesto do motor.

  python checar-docx.py manifesto.json [manifesto2.json ...]

Falha (exit 1) se: o arquivo não abrir, faltar seção, uma célula divergir do
texto esperado, uma célula ausente aparecer como valor, ou o documento tiver
mais "R$ 0,00" do que zeros legítimos.
"""
import json
import sys
from docx import Document

falhas = []


def contar_zeros(textos, zero_brl):
    """Conta o zero em reais nas DUAS grafias: a do Intl (NBSP) e a ASCII.

    Procurar só a ASCII é o erro que faz este teste passar vazio.
    """
    ascii_zero = zero_brl.replace(u" ", " ")
    total = 0
    for t in textos:
        total += t.count(zero_brl)
        if ascii_zero != zero_brl:
            total += t.count(ascii_zero)
    return total


def checar(caminho_manifesto):
    with open(caminho_manifesto, encoding="utf-8") as fh:
        m = json.load(fh)

    nome = m["arquivo"]
    doc = Document(nome)
    print("  abriu: %s" % nome.split("/")[-1])

    # 1. Seções na ordem esperada. O título da tabela pode estar num H1 (quando
    #    a seção tem uma tabela só) ou num H2 — as duas contam.
    h2 = [p.text.strip() for p in doc.paragraphs
          if getattr(p.style, "name", "") in ("Heading 1", "Heading 2") and p.text.strip()]
    esperados = m["titulos"]
    faltando = [t for t in esperados if t not in h2]
    if faltando:
        falhas.append("%s: seções ausentes no documento: %s" % (nome, faltando))
    else:
        pos = [h2.index(t) for t in esperados]
        if pos != sorted(pos):
            falhas.append("%s: seções fora da ordem de §10.1" % nome)
        else:
            print("    seções: %d na ordem esperada (%d tabelas sem cálculo, com o texto da falta)"
                  % (len(esperados), len(m["tabelas_ausentes"])))

    # 2. Célula a célula, contra o texto que o motor formatou.
    tabelas_doc = doc.tables
    if len(tabelas_doc) != len(m["tabelas"]):
        falhas.append("%s: %d tabelas no documento, %d no manifesto"
                      % (nome, len(tabelas_doc), len(m["tabelas"])))
        return

    divergencias = 0
    ausentes_ok = 0
    for tab_doc, tab_man in zip(tabelas_doc, m["tabelas"]):
        linhas_doc = tab_doc.rows[1:]  # a primeira é o cabeçalho
        if len(linhas_doc) != len(tab_man["linhas"]):
            falhas.append("%s / %s: %d linhas no documento, %d no manifesto"
                          % (nome, tab_man["titulo"], len(linhas_doc), len(tab_man["linhas"])))
            continue
        for linha_doc, linha_man in zip(linhas_doc, tab_man["linhas"]):
            celulas = [c.text.strip() for c in linha_doc.cells]
            if celulas[0] != linha_man["rotulo"]:
                falhas.append("%s / %s: rótulo '%s' != '%s'"
                              % (nome, tab_man["titulo"], celulas[0], linha_man["rotulo"]))
            for i, esperado in enumerate(linha_man["textos"]):
                obtido = celulas[i + 1]
                if obtido != esperado:
                    divergencias += 1
                    falhas.append("%s / %s / %s: '%s' != '%s'"
                                  % (nome, tab_man["titulo"], linha_man["rotulo"], obtido, esperado))
                if i in linha_man["ausentes"]:
                    ausentes_ok += 1
                    if obtido != m["texto_ausente"]:
                        falhas.append("%s / %s / %s: célula AUSENTE saiu como '%s'"
                                      % (nome, tab_man["titulo"], linha_man["rotulo"], obtido))

    if divergencias == 0:
        print("    células: todas conferem com formatarCelula()")
    print("    ausentes: %d célula(s) sem insumo, todas como '%s'" % (ausentes_ok, m["texto_ausente"]))
    if ausentes_ok != m["celulas_ausentes"]:
        falhas.append("%s: %d ausentes conferidas, %d no manifesto" % (nome, ausentes_ok, m["celulas_ausentes"]))

    # 3. Contagem global de "R$ 0,00" — nem um a mais que os zeros legítimos.
    texto_todo = [p.text for p in doc.paragraphs]
    for t in doc.tables:
        for r in t.rows:
            for c in r.cells:
                texto_todo.append(c.text)
    zeros = contar_zeros(texto_todo, m["zero_brl"])
    if zeros != m["zeros_legitimos"]:
        falhas.append("%s: %d ocorrência(s) de zero em reais; o motor calculou %d zero(s) legítimo(s)"
                      % (nome, zeros, m["zeros_legitimos"]))
    else:
        print("    zero em reais: %d ocorrência(s), todas de conta que deu zero de verdade" % zeros)

    # 4. TEXTO_AUSENTE presente quando faltou parâmetro.
    if m["celulas_ausentes"] > 0:
        tem = any(m["texto_ausente"] in x for x in texto_todo)
        if not tem:
            falhas.append("%s: manifesto tem ausência, mas '%s' não aparece no documento"
                          % (nome, m["texto_ausente"]))
        else:
            print("    TEXTO_AUSENTE ('%s') presente no documento" % m["texto_ausente"])

    # 5. Marca d'água de demonstração.
    if m["marca_dagua"]:
        cabecalhos = []
        for secao in doc.sections:
            for par in secao.header.paragraphs:
                cabecalhos.append(par.text.strip())
        if m["marca_dagua"] not in cabecalhos:
            falhas.append("%s: marca d'água '%s' não está no cabeçalho" % (nome, m["marca_dagua"]))
        else:
            print("    marca d'água '%s' em toda página" % m["marca_dagua"])


for caminho in sys.argv[1:]:
    checar(caminho)

if falhas:
    print("")
    print("FALHAS (%d):" % len(falhas))
    for f in falhas[:40]:
        print("  - %s" % f)
    sys.exit(1)

print("")
print("Relatório .docx: OK.")
`;

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

async function gerar(
  nome: string,
  parametros: ParametrosCroqui,
  origemDado: "real" | "exemplo",
): Promise<{ docx: string; manifesto: string; resultado: ResultadoCroqui }> {
  const resultado = calcularCroqui(entradaExemplo(), parametros, AGORA);
  const bytes = await montarDocxCroqui(resultado, {
    nomeCliente: "Família Exemplo",
    dataCalculo: AGORA,
    advogada: "Time Holding Brasil · Dra. Elaine Montenegro",
    motorVersao: resultado.motor_versao,
    versaoCalculo: 1,
    origemDado,
  });

  const docx = resolve(SAIDA, `${nome}.docx`);
  const manifesto = resolve(SAIDA, `${nome}.manifesto.json`);
  // O `ResultadoCroqui` cru também fica em disco: é a fixture que M4 pode usar
  // na tela e a que a prova de campo da rota grava em `croqui_calculos`.
  const bruto = resolve(SAIDA, `${nome}.resultado.json`);
  mkdirSync(dirname(docx), { recursive: true });
  writeFileSync(docx, bytes);
  writeFileSync(bruto, JSON.stringify(resultado, null, 2), "utf8");
  writeFileSync(
    manifesto,
    JSON.stringify(montarManifesto(resultado, docx.replace(/\\/g, "/"), origemDado === "exemplo" ? "EXEMPLO" : null), null, 2),
    "utf8",
  );

  const tabelasVindas = Object.keys(resultado.tabelas).length;
  console.log(
    `  ${nome}.docx — ${(bytes.byteLength / 1024).toFixed(1)} kB · ${tabelasVindas}/19 tabelas calculadas · ${resultado.faltas.length} falta(s) de parâmetro`,
  );
  return { docx, manifesto, resultado };
}

async function main() {
  console.log("Relatório do Croqui em .docx — geração e conferência\n");

  const completo = await gerar("relatorio-exemplo", parametrosCompletos(), "exemplo");
  const faltando = await gerar("relatorio-exemplo-faltando", parametrosFaltando(), "real");

  const checador = resolve(SAIDA, "checar-docx.py");
  writeFileSync(checador, CHECADOR, "utf8");

  console.log("\nConferência com python-docx:");
  try {
    const saida = execFileSync(PYTHON, [checador, completo.manifesto, faltando.manifesto], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      // Sem isto o Python escreve em cp1252 no Windows e todo acento da saída
      // vira interrogação — a conferência fica ilegível no relatório.
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    process.stdout.write(saida);
  } catch (erro) {
    const e = erro as { stdout?: string; stderr?: string };
    if (e.stdout) process.stdout.write(e.stdout);
    if (e.stderr) process.stderr.write(e.stderr);
    console.error("\nConferência FALHOU.");
    process.exit(1);
  }
}

void main();
