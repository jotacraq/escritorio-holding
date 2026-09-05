/**
 * `3) RELATÓRIO DO CROQUI.docx` — o documento que o escritório entrega ao
 * cliente, montado a partir do `ResultadoCroqui` do motor (M1) em vez de uma
 * planilha sincronizada à mão.
 *
 * Por que este arquivo existe: o recon do Drive achou um deck REAL entregue ao
 * cliente com "R$ 0,00" no custo do inventário e a frase "a família perde
 * aproximadamente R$ 0,00" — a sincronização Sheets→Slides falhou em silêncio e
 * ninguém viu antes de enviar. Aqui isso é impossível por construção:
 *
 * - **Todo número passa por `formatarCelula`** (do motor). Célula ausente vira
 *   `TEXTO_AUSENTE` ("—"), jamais "R$ 0,00". Este módulo NÃO formata número por
 *   conta própria em nenhuma linha — é a mesma função que a tela e o `/p/m` usam.
 * - **Tabela que não veio no cálculo não some.** Ela aparece com o título dela e
 *   o texto do que faltou. Omissão silenciosa é exatamente o defeito do processo
 *   antigo.
 * - **O que falta fica escrito embaixo da tabela**, com a chave do parâmetro e a
 *   jurisdição — quem lê sabe o que cadastrar.
 *
 * Ordem das seções: §10.1 de `docs/ARQUITETURA-FASE-5.md`, com T10 (`Empresa
 * operacional`) inserida antes de T12 — o §10.1 não a lista, e omitir uma das 19
 * tabelas contradiz a própria regra de não omitir em silêncio.
 *
 * Tipografia: Arial. A Neuetra da marca é embutida no PDF (`material/pdf.ts`),
 * mas `.docx` referencia fonte pelo NOME — o Word do cliente não tem Neuetra e
 * substituiria por qualquer coisa. Cor e hierarquia seguem a identidade; a
 * família, não.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  LevelFormat,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import { formatarCelula, TEXTO_AUSENTE, type TipoValor } from "@/server/motor-croqui";
import {
  CHAVES_TABELA,
  type Celula,
  type ChaveTabela,
  type ColunaTabela,
  type FaltaParametro,
  type LinhaTabela,
  type ResultadoCroqui,
  type Tabela,
} from "@/types/croqui-calculo";
import {
  PASSOS_POR_MODELO,
  TEXTO_CELULAS,
  TEXTO_COMO_LER,
  TEXTO_CONTROLE,
  TEXTO_DIVERGENCIAS,
  TEXTO_EXEMPLO,
  TEXTO_FALTAS,
  TEXTO_GATILHO,
  TEXTO_RODAPE_JURIDICO,
  type BlocoTexto,
} from "./textos-metodo";

// ---------------------------------------------------------------------------
// Contrato
// ---------------------------------------------------------------------------

export interface CabecalhoDocxCroqui {
  /** Nome do cliente como o escritório o escreve na capa. */
  nomeCliente: string;
  /** Quando o cálculo foi gravado (`croqui_calculos.criado_em`). */
  dataCalculo: Date | string;
  /** Quem assina — "Dra. Elaine Montenegro", por exemplo. */
  advogada: string;
  /** `ResultadoCroqui.motor_versao` — carimbo de reprodutibilidade. */
  motorVersao: string;
  /** `croqui_calculos.versao` — qual versão do cálculo virou este arquivo. */
  versaoCalculo?: number | null;
  /** `jornadas.origem_dado`; `'exemplo'` liga a marca d'água em toda página. */
  origemDado?: "real" | "exemplo";
}

// ---------------------------------------------------------------------------
// Identidade
// ---------------------------------------------------------------------------

/** Mesma paleta de `src/server/material/pdf.ts` (Fase 4), sem o `#`. */
const COR = {
  tinta: "141B22",
  texto: "43454F",
  apagada: "6D6A64",
  marca: "FF7400",
  areia: "E8E0D6",
  linha: "D9D4CC",
} as const;

const FONTE = "Arial";

/** A4 em DXA (twentieths of a point): 210 × 297 mm. */
const PAGINA = { largura: 11906, altura: 16838 } as const;
const MARGEM = 1134; // 2 cm
const LARGURA_UTIL = PAGINA.largura - 2 * MARGEM; // 9638

const LISTA_METODO = "lista-metodo";
const LISTA_FALTAS = "lista-faltas";
const LISTA_DIVERGENCIAS = "lista-divergencias";

const MARCA_DAGUA = "EXEMPLO";

// ---------------------------------------------------------------------------
// Títulos das 19 tabelas
// ---------------------------------------------------------------------------

/**
 * Título de tabela que NÃO veio no resultado. Quando ela vem, o título usado é
 * o `tabela.titulo` do motor — este mapa é o espelho, para a seção do que
 * faltou não sair sem nome.
 */
export const TITULO_TABELA: Record<ChaveTabela, string> = {
  composicao_familiar: "Composição familiar",
  formacao_patrimonial: "Mapa patrimonial",
  inventario_atual: "Inventário hoje",
  levantamento_inventario: "Custo da inércia",
  inventario_reforma: "Inventário após a reforma",
  doacao: "Doação em vida",
  celula_1: "Uma célula",
  celula_2: "Duas células",
  celula_3: "Três células",
  operacional_pj: "Empresa operacional",
  payback: "Em quanto tempo se paga",
  operacional_locacao: "Aluguel: pessoa física × holding",
  comparativo_geral: "Comparativo",
  itbi: "Cenário com ITBI",
  horas_por_ato: "Horas de trabalho",
  honorarios: "Honorários",
  deducoes: "Deduções",
  pagamento: "Pagamento",
  membership: "Acompanhamento",
};

/**
 * Ordem de apresentação — §10.1, com `operacional_pj` antes de
 * `operacional_locacao` (as duas tabelas de PJ juntas).
 */
export const ORDEM_SECOES: ChaveTabela[] = [
  "composicao_familiar",
  "formacao_patrimonial",
  // ← textos fixos do método entram aqui
  "inventario_atual",
  "levantamento_inventario",
  "inventario_reforma",
  "doacao",
  "celula_1",
  "celula_2",
  "celula_3",
  "payback",
  "comparativo_geral",
  "itbi",
  "horas_por_ato",
  "honorarios",
  "operacional_pj",
  "operacional_locacao",
  "deducoes",
  "pagamento",
  "membership",
];

/**
 * Trava de manutenção: se o motor ganhar uma 20ª tabela e ninguém a colocar em
 * `ORDEM_SECOES`, ela **não some** — vai para o fim do documento, sob "Outras
 * tabelas". Lançar no import derrubaria a rota inteira por uma questão de
 * ordenação; omitir em silêncio seria repetir o defeito que este módulo existe
 * para consertar.
 */
const FORA_DA_ORDEM: ChaveTabela[] = CHAVES_TABELA.filter((c) => !ORDEM_SECOES.includes(c));

// ---------------------------------------------------------------------------
// Unidade de cada célula (a única coisa que o `Tabela` não carrega)
// ---------------------------------------------------------------------------

/**
 * Que tipo de número é aquela célula. `Tabela` não guarda unidade — a tela do
 * M4 decide igual. As regras saem das tabelas do motor
 * (`src/server/motor-croqui/tabelas/*.ts`), linha por linha; o default é `brl`
 * porque a esmagadora maioria das 19 tabelas é dinheiro.
 */
export function tipoDaCelula(tabela: ChaveTabela, linhaChave: string, colunaChave: string): TipoValor {
  if (tabela === "composicao_familiar") return "numero";
  if (tabela === "horas_por_ato") return "numero";
  if (tabela === "payback") {
    if (linhaChave === "taxa_cdi_mes") return "percentual";
    if (linhaChave === "payback_meses") return "meses";
    return "brl";
  }
  if (tabela === "membership" && linhaChave === "meses_isentos") return "numero";
  if (tabela === "pagamento" && linhaChave === "parcelas") return "numero";
  // T13: as colunas `dif_percentual` e `dif_percentual_reforma` são %.
  if (colunaChave.startsWith("dif_percentual")) return "percentual";
  // T6/T7/T8/T9: a linha "Economia".
  if (linhaChave === "percentual") return "percentual";
  return "brl";
}

// ---------------------------------------------------------------------------
// Blocos de texto
// ---------------------------------------------------------------------------

const texto = (conteudo: string, opcoes: { cor?: string; tamanho?: number; negrito?: boolean; italico?: boolean } = {}) =>
  new TextRun({
    text: conteudo,
    font: FONTE,
    color: opcoes.cor ?? COR.texto,
    size: opcoes.tamanho ?? 20,
    bold: opcoes.negrito ?? false,
    italics: opcoes.italico ?? false,
  });

const paragrafo = (conteudo: string, opcoes: Parameters<typeof texto>[1] & { espacoDepois?: number } = {}) =>
  new Paragraph({
    spacing: { after: opcoes.espacoDepois ?? 120 },
    children: [texto(conteudo, opcoes)],
  });

const titulo1 = (conteudo: string) =>
  new Paragraph({ heading: HeadingLevel.HEADING_1, children: [texto(conteudo, { cor: COR.tinta, tamanho: 28, negrito: true })] });

const titulo2 = (conteudo: string) =>
  new Paragraph({ heading: HeadingLevel.HEADING_2, children: [texto(conteudo, { cor: COR.tinta, tamanho: 24, negrito: true })] });

function blocoDeTexto(bloco: BlocoTexto, comLista = false): Paragraph[] {
  const corpo = comLista
    ? bloco.paragrafos.map(
        (p) =>
          new Paragraph({
            numbering: { reference: LISTA_METODO, level: 0 },
            spacing: { after: 80 },
            children: [texto(p)],
          }),
      )
    : bloco.paragrafos.map((p) => paragrafo(p));
  return [titulo2(bloco.titulo), ...corpo];
}

// ---------------------------------------------------------------------------
// Tabela
// ---------------------------------------------------------------------------

const BORDA = { style: BorderStyle.SINGLE, size: 1, color: COR.linha };
const BORDAS = { top: BORDA, bottom: BORDA, left: BORDA, right: BORDA };

function celulaTexto(
  conteudo: string,
  largura: number,
  opcoes: { cabecalho?: boolean; destaque?: boolean; direita?: boolean } = {},
): TableCell {
  return new TableCell({
    borders: BORDAS,
    width: { size: largura, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    ...(opcoes.cabecalho
      ? { shading: { fill: COR.areia, type: ShadingType.CLEAR, color: "auto" } }
      : {}),
    children: [
      new Paragraph({
        alignment: opcoes.direita ? AlignmentType.RIGHT : AlignmentType.LEFT,
        spacing: { before: 20, after: 20 },
        children: [
          texto(conteudo, {
            negrito: opcoes.cabecalho === true || opcoes.destaque === true,
            cor: opcoes.cabecalho ? COR.tinta : COR.texto,
            tamanho: 18,
          }),
        ],
      }),
    ],
  });
}

/** Larguras: a primeira coluna (rótulo) leva ~38%, o resto divide o que sobra. */
function largurasDe(colunas: number): number[] {
  const rotulo = Math.round(LARGURA_UTIL * (colunas === 1 ? 0.6 : 0.38));
  const restante = Math.floor((LARGURA_UTIL - rotulo) / colunas);
  return [rotulo, ...Array.from({ length: colunas }, () => restante)];
}

/** Texto que vai para a célula do documento — SEMPRE via `formatarCelula`. */
function textoDaCelula(tabela: ChaveTabela, linha: LinhaTabela, coluna: ColunaTabela): string {
  const celula: Celula | undefined = linha.celulas[coluna.chave];
  if (!celula) return TEXTO_AUSENTE;
  return formatarCelula(celula, tipoDaCelula(tabela, linha.chave, coluna.chave));
}

function montarGrade(tabela: Tabela): Table {
  const larguras = largurasDe(tabela.colunas.length);

  const cabecalho = new TableRow({
    tableHeader: true,
    children: [
      celulaTexto("Item", larguras[0], { cabecalho: true }),
      ...tabela.colunas.map((c, i) => celulaTexto(c.rotulo, larguras[i + 1], { cabecalho: true, direita: true })),
    ],
  });

  const linhas = tabela.linhas.map(
    (l) =>
      new TableRow({
        children: [
          celulaTexto(l.rotulo, larguras[0], { destaque: l.destaque }),
          ...tabela.colunas.map((c, i) =>
            celulaTexto(textoDaCelula(tabela.chave, l, c), larguras[i + 1], {
              destaque: l.destaque,
              direita: true,
            }),
          ),
        ],
      }),
  );

  return new Table({
    columnWidths: larguras,
    width: { size: LARGURA_UTIL, type: WidthType.DXA },
    margins: { top: 60, bottom: 60, left: 120, right: 120 },
    rows: [cabecalho, ...linhas],
  });
}

/** "chave (SP · São Paulo)" — o que cadastrar e onde. */
function descreverFalta(falta: FaltaParametro): string {
  const jurisdicao = [falta.uf, falta.municipio].filter(Boolean).join(" · ");
  return jurisdicao ? `${falta.chave} (${jurisdicao})` : falta.chave;
}

/**
 * Nota de pé de tabela: o que faltou, e quando um valor veio do percentual
 * aproximado em vez da tabela de emolumentos da UF. O escritório hoje não sabe
 * distinguir os dois — o `.docx` passa a dizer.
 */
function notasDaTabela(tabela: Tabela): Paragraph[] {
  const notas: Paragraph[] = [];

  if (tabela.nota) {
    notas.push(paragrafo(tabela.nota, { cor: COR.apagada, tamanho: 16, italico: true, espacoDepois: 60 }));
  }

  const ausentes = tabela.linhas.flatMap((l) =>
    Object.entries(l.celulas)
      .filter(([, c]) => c.procedencia === "ausente")
      .map(([, c]) => `${l.rotulo}: ${c.motivo ?? "sem insumo para esta linha"}`),
  );
  const unicas = Array.from(new Set(ausentes));
  if (unicas.length > 0) {
    notas.push(
      paragrafo(`${TEXTO_AUSENTE} nesta tabela significa:`, {
        cor: COR.apagada,
        tamanho: 16,
        negrito: true,
        espacoDepois: 40,
      }),
    );
    for (const item of unicas) {
      notas.push(
        new Paragraph({
          numbering: { reference: LISTA_FALTAS, level: 0 },
          spacing: { after: 20 },
          children: [texto(item, { cor: COR.apagada, tamanho: 16 })],
        }),
      );
    }
  }

  const fallback = tabela.linhas
    .filter((l) => Object.values(l.celulas).some((c) => c.fonte === "percentual_fallback"))
    .map((l) => l.rotulo);
  if (fallback.length > 0) {
    notas.push(
      paragrafo(
        `Calculado por percentual aproximado, e não pela tabela de emolumentos da unidade da federação: ${Array.from(new Set(fallback)).join(", ")}.`,
        { cor: COR.apagada, tamanho: 16, italico: true, espacoDepois: 60 },
      ),
    );
  }

  if (tabela.falta.length > 0) {
    notas.push(
      paragrafo(`Falta cadastrar: ${tabela.falta.map(descreverFalta).join("; ")}.`, {
        cor: COR.apagada,
        tamanho: 16,
        espacoDepois: 160,
      }),
    );
  }

  return notas;
}

/** Seção de tabela que o motor NÃO montou — nunca some do documento. */
function secaoTabelaAusente(chave: ChaveTabela, resultado: ResultadoCroqui, tituloDaSecao?: string): Paragraph[] {
  const faltas = resultado.faltas.filter((f) => f.tabelas.includes(chave));
  const motivo =
    faltas.length > 0
      ? `Esta tabela não pôde ser calculada. Falta cadastrar: ${faltas.map(descreverFalta).join("; ")}.`
      : "Esta tabela não entrou neste cálculo: o modelo não foi escolhido para este cliente ou a Ficha ainda não tem o dado que a alimenta.";
  return [
    // Repetir o H1 logo abaixo dele é ruído (lei de texto, §2): quando o título
    // da seção JÁ é o nome da tabela, a tabela entra sem repetir o nome.
    ...(tituloDaSecao === TITULO_TABELA[chave] ? [] : [titulo2(TITULO_TABELA[chave])]),
    paragrafo(motivo, { cor: COR.apagada, espacoDepois: 160 }),
  ];
}

function secaoTabela(
  chave: ChaveTabela,
  resultado: ResultadoCroqui,
  tituloDaSecao?: string,
): (Paragraph | Table)[] {
  const tabela = resultado.tabelas[chave];
  if (!tabela) return secaoTabelaAusente(chave, resultado, tituloDaSecao);
  const titulo = tabela.titulo || TITULO_TABELA[chave];
  return [
    ...(tituloDaSecao === titulo ? [] : [titulo2(titulo)]),
    montarGrade(tabela),
    new Paragraph({ spacing: { after: 60 }, children: [] }),
    ...notasDaTabela(tabela),
  ];
}

// ---------------------------------------------------------------------------
// Capa, rodapé e marca d'água
// ---------------------------------------------------------------------------

function formatarData(valor: Date | string): string {
  const data = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(data.getTime())) return TEXTO_AUSENTE;
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(data);
}

function capa(cabecalho: CabecalhoDocxCroqui, resultado: ResultadoCroqui): Paragraph[] {
  const blocos: Paragraph[] = [
    new Paragraph({
      spacing: { after: 60 },
      children: [texto("RELATÓRIO DO CROQUI", { cor: COR.marca, tamanho: 20, negrito: true })],
    }),
    new Paragraph({
      heading: HeadingLevel.TITLE,
      spacing: { after: 240 },
      children: [texto(cabecalho.nomeCliente, { cor: COR.tinta, tamanho: 44, negrito: true })],
    }),
    paragrafo(`Cálculo de ${formatarData(cabecalho.dataCalculo)}`, { cor: COR.apagada, espacoDepois: 40 }),
    paragrafo(cabecalho.advogada, { cor: COR.apagada, espacoDepois: 40 }),
    paragrafo(
      `Motor ${cabecalho.motorVersao}${cabecalho.versaoCalculo ? ` · versão ${cabecalho.versaoCalculo} do cálculo` : ""}`,
      { cor: COR.apagada, espacoDepois: 240 },
    ),
  ];

  if (cabecalho.origemDado === "exemplo") {
    blocos.push(paragrafo(TEXTO_EXEMPLO, { cor: COR.marca, negrito: true, espacoDepois: 240 }));
  }

  blocos.push(...blocoDeTexto(TEXTO_COMO_LER));

  if (resultado.divergencias.length > 0) {
    blocos.push(...blocoDeTexto(TEXTO_DIVERGENCIAS));
    for (const d of resultado.divergencias) {
      blocos.push(
        new Paragraph({
          numbering: { reference: LISTA_DIVERGENCIAS, level: 0 },
          spacing: { after: 40 },
          children: [texto(`${d.chave}: ${d.valores.join(" × ")} (${d.onde})`, { cor: COR.apagada, tamanho: 16 })],
        }),
      );
    }
  }

  return blocos;
}

function secaoFaltas(resultado: ResultadoCroqui): Paragraph[] {
  if (resultado.faltas.length === 0) {
    return [titulo1(TEXTO_FALTAS.titulo), paragrafo("Nada. Todas as linhas deste relatório foram calculadas.")];
  }
  return [
    titulo1(TEXTO_FALTAS.titulo),
    ...TEXTO_FALTAS.paragrafos.map((p) => paragrafo(p)),
    ...resultado.faltas.map(
      (f) =>
        new Paragraph({
          numbering: { reference: LISTA_FALTAS, level: 0 },
          spacing: { after: 40 },
          children: [
            texto(`${descreverFalta(f)} — afeta: ${f.tabelas.map((t) => TITULO_TABELA[t]).join(", ")}`, {
              cor: COR.texto,
              tamanho: 18,
            }),
          ],
        }),
    ),
  ];
}

function rodape(cabecalho: CabecalhoDocxCroqui): Footer {
  const versao = cabecalho.versaoCalculo ? `versão ${cabecalho.versaoCalculo} do cálculo` : "cálculo sem versão gravada";
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 120, after: 0 },
        children: [
          texto(
            `gerado por SIC-HF · ${cabecalho.motorVersao} · ${versao} · ${formatarData(cabecalho.dataCalculo)}`,
            { cor: COR.apagada, tamanho: 14 },
          ),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 0 },
        children: [
          texto(TEXTO_RODAPE_JURIDICO, { cor: COR.apagada, tamanho: 12 }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          texto("", { cor: COR.apagada, tamanho: 14 }),
          new TextRun({ children: [PageNumber.CURRENT], font: FONTE, size: 14, color: COR.apagada }),
          texto(" / ", { cor: COR.apagada, tamanho: 14 }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONTE, size: 14, color: COR.apagada }),
        ],
      }),
    ],
  });
}

/**
 * Marca d'água de demonstração. `docx` não expõe watermark de fundo (é VML no
 * cabeçalho, XML cru); um cabeçalho em caixa alta, em toda página, cumpre o
 * mesmo papel — e, ao contrário da VML, aparece em qualquer leitor.
 */
function cabecalhoPagina(origemDado: "real" | "exemplo"): Header | undefined {
  if (origemDado !== "exemplo") return undefined;
  return new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [texto(MARCA_DAGUA, { cor: COR.areia, tamanho: 40, negrito: true })],
      }),
    ],
  });
}

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------

/**
 * Monta o `.docx` do relatório. **Puro**: entrada → `Buffer`. Não fala com
 * banco e não conhece rota — quem devolve o arquivo é `api/croquis/[id]/docx`.
 */
export async function montarDocxCroqui(
  resultado: ResultadoCroqui,
  cabecalho: CabecalhoDocxCroqui,
): Promise<Buffer> {
  const origemDado = cabecalho.origemDado ?? "real";

  const corpo: (Paragraph | Table)[] = [...capa(cabecalho, resultado)];

  corpo.push(titulo1("A família e o patrimônio"));
  corpo.push(...secaoTabela("composicao_familiar", resultado));
  corpo.push(...secaoTabela("formacao_patrimonial", resultado));

  corpo.push(titulo1("O método"));
  corpo.push(...blocoDeTexto(TEXTO_CELULAS, true));
  corpo.push(...blocoDeTexto(TEXTO_GATILHO));
  corpo.push(...blocoDeTexto(TEXTO_CONTROLE));

  corpo.push(titulo1("O custo de não fazer nada"));
  corpo.push(...secaoTabela("inventario_atual", resultado));
  corpo.push(...secaoTabela("levantamento_inventario", resultado));
  corpo.push(...secaoTabela("inventario_reforma", resultado));

  corpo.push(titulo1("Doação em vida"));
  corpo.push(...secaoTabela("doacao", resultado, "Doação em vida"));

  corpo.push(titulo1("As arquiteturas possíveis"));
  for (const modelo of ["celula_1", "celula_2", "celula_3"] as const) {
    corpo.push(...blocoDeTexto(PASSOS_POR_MODELO[modelo], true));
    corpo.push(...secaoTabela(modelo, resultado));
  }

  corpo.push(titulo1("Em quanto tempo se paga"));
  corpo.push(...secaoTabela("payback", resultado, "Em quanto tempo se paga"));

  corpo.push(titulo1("Comparativo"));
  corpo.push(...secaoTabela("comparativo_geral", resultado, "Comparativo"));
  corpo.push(...secaoTabela("itbi", resultado));

  corpo.push(titulo1("Trabalho e honorários"));
  corpo.push(...secaoTabela("horas_por_ato", resultado));
  corpo.push(...secaoTabela("honorarios", resultado));

  corpo.push(titulo1("Empresa operacional e aluguéis"));
  corpo.push(...secaoTabela("operacional_pj", resultado));
  corpo.push(...secaoTabela("operacional_locacao", resultado));

  corpo.push(titulo1("Condições"));
  corpo.push(...secaoTabela("deducoes", resultado));
  corpo.push(...secaoTabela("pagamento", resultado));
  corpo.push(...secaoTabela("membership", resultado));

  if (FORA_DA_ORDEM.length > 0) {
    corpo.push(titulo1("Outras tabelas"));
    for (const chave of FORA_DA_ORDEM) corpo.push(...secaoTabela(chave, resultado));
  }

  corpo.push(...secaoFaltas(resultado));

  const header = cabecalhoPagina(origemDado);

  const documento = new Document({
    creator: "SIC-HF",
    title: `Relatório do Croqui — ${cabecalho.nomeCliente}`,
    description: `Gerado por SIC-HF com ${cabecalho.motorVersao}`,
    styles: {
      default: { document: { run: { font: FONTE, size: 20, color: COR.texto } } },
      paragraphStyles: [
        {
          id: "Title",
          name: "Title",
          basedOn: "Normal",
          run: { size: 44, bold: true, color: COR.tinta, font: FONTE },
          paragraph: { spacing: { before: 0, after: 240 } },
        },
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { size: 28, bold: true, color: COR.tinta, font: FONTE },
          paragraph: { spacing: { before: 360, after: 180 }, outlineLevel: 0 },
        },
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { size: 24, bold: true, color: COR.tinta, font: FONTE },
          paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 },
        },
      ],
    },
    numbering: {
      config: [LISTA_METODO, LISTA_FALTAS, LISTA_DIVERGENCIAS].map((reference) => ({
        reference,
        levels: [
          {
            level: 0,
            format: LevelFormat.BULLET,
            text: "•",
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 480, hanging: 240 } } },
          },
        ],
      })),
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGINA.largura, height: PAGINA.altura },
            margin: { top: MARGEM, right: MARGEM, bottom: MARGEM, left: MARGEM },
          },
        },
        ...(header ? { headers: { default: header } } : {}),
        footers: { default: rodape(cabecalho) },
        children: corpo,
      },
    ],
  });

  return Packer.toBuffer(documento);
}

export const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
