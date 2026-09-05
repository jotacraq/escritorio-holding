import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { BlocoMaterial, ConteudoMaterial, FontePdfMaterial, OrigemDadoMaterial } from "@/types/material";

/**
 * Renderizador do material pós-sessão em PDF (ARQUITETURA-FASE-4.md §3.2/§3.3).
 * `pdfkit` puro-JS — sem Chrome, sem React-PDF. Quatro tipos de bloco
 * (`titulo|paragrafo|lista|citacao`), A4, margens 56 pt.
 *
 * Tipografia: Neuetra 400/700 de `public/fonts/*.woff2` via fontkit (embutido no
 * pdfkit). Se a fonte não carregar no servidor, cai para Helvetica e devolve
 * `fonte: 'helvetica'` + `erroFonte` — QUEM CHAMA registra em `erros_servidor`.
 * Este módulo não conhece banco nem rota; é puro: entrada → Buffer.
 *
 * Identidade (brief da Fase 4): ink `#141b22`, cinza `#43454f`, apagado
 * `#6d6a64`, laranja de marca `#ff7400`, areia `#e8e0d6`. Texto sobre laranja é
 * escuro, nunca claro. Sem imagem, sem tabela.
 */

export interface EntradaPdfMaterial {
  material: ConteudoMaterial;
  /** Só o primeiro nome — mesmo recorte de `/p/m` (regra 4 da 0028). */
  primeiroNome: string;
  aprovadoEm: Date;
  /** `configuracoes['material.rodape_juridico']` — B14. */
  rodapeJuridico: string;
  /** `'exemplo'` → marca d'água de demonstração em toda página. */
  origemDado: OrigemDadoMaterial;
  /** Cabeçalho — quem assina. */
  assinatura?: string;
}

export interface ResultadoPdfMaterial {
  pdf: Buffer;
  bytes: number;
  sha256: string;
  paginas: number;
  fonte: FontePdfMaterial;
  /** Preenchido só quando `fonte === 'helvetica'`. */
  erroFonte: string | null;
}

const COR = {
  tinta: "#141b22",
  texto: "#43454f",
  apagada: "#6d6a64",
  marca: "#ff7400",
  areia: "#e8e0d6",
} as const;

const MARGEM = 56;
const LARGURA_A4 = 595.28;
const ALTURA_A4 = 841.89;
const LARGURA_UTIL = LARGURA_A4 - 2 * MARGEM;
const ASSINATURA_PADRAO = "Time Holding Brasil · Dra. Elaine Montenegro";
const MARCA_DAGUA_EXEMPLO = "EXEMPLO — DEMONSTRAÇÃO";

const FONTE_REGULAR = "Neuetra";
const FONTE_BOLD = "Neuetra-Bold";

interface FontesCarregadas {
  regular: Buffer;
  bold: Buffer;
}

/**
 * A Neuetra do site vive em `public/fonts/*.woff2`. O fontkit LÊ WOFF2, mas não
 * consegue SUBSETAR fonte com tabela `glyf` transformada (a `loca` do WOFF2 é
 * derivada; `TTFSubset._addGlyph` lê bytes crus e estoura —
 * `RangeError: Offset is outside the bounds of the DataView`, medido em
 * 04/09/2026 com fontkit 2.0.4). Por isso as mesmas fontes existem aqui em
 * TTF (conversão 1:1 com fonttools, mesmos 380 glifos), fora de `public/`
 * para não expor um arquivo copiável a mais.
 */
function caminhoFonte(arquivo: string): string {
  return path.join(process.cwd(), "src", "server", "material", "fontes", arquivo);
}

function lerFontes(): FontesCarregadas {
  return {
    regular: fs.readFileSync(caminhoFonte("TBJNeuetra-Regular.ttf")),
    bold: fs.readFileSync(caminhoFonte("TBJNeuetra-Bold.ttf")),
  };
}

type Documento = InstanceType<typeof PDFDocument>;

interface Tipografia {
  regular: string;
  bold: string;
}

/**
 * Tenta abrir o documento já com a Neuetra como fonte padrão (assim a Helvetica
 * nem é tocada quando a fonte carrega). fontkit lança de forma síncrona se não
 * conseguir ler o WOFF2 — é aí que o fallback entra.
 */
function abrirDocumento(
  entrada: EntradaPdfMaterial,
  forcarHelvetica: boolean,
): { doc: Documento; tipografia: Tipografia; fonte: FontePdfMaterial; erroFonte: string | null } {
  const opcoesBase = {
    size: "A4" as const,
    margins: { top: MARGEM, bottom: MARGEM, left: MARGEM, right: MARGEM },
    bufferPages: true,
    info: {
      Title: entrada.material.titulo,
      Author: entrada.assinatura ?? ASSINATURA_PADRAO,
      Subject: "Material educativo pós-Sessão de Viabilidade",
      Creator: "SIC-HF",
    },
    pdfVersion: "1.5" as const,
  };

  if (!forcarHelvetica) {
    try {
      const fontes = lerFontes();
      // `font` aceita Buffer em runtime (PDFFontFactory.open) — @types/pdfkit só
      // declara string. Passar a fonte aqui evita carregar a Helvetica à toa.
      const doc = new PDFDocument({ ...opcoesBase, font: fontes.regular as unknown as string });
      doc.registerFont(FONTE_REGULAR, fontes.regular);
      doc.registerFont(FONTE_BOLD, fontes.bold);
      // Força o parse das duas agora — se o bold estiver corrompido, cai inteiro
      // para Helvetica em vez de quebrar no meio da renderização.
      doc.font(FONTE_BOLD);
      doc.font(FONTE_REGULAR);
      return { doc, tipografia: { regular: FONTE_REGULAR, bold: FONTE_BOLD }, fonte: "neuetra", erroFonte: null };
    } catch (erro) {
      const mensagem = erro instanceof Error ? `${erro.name}: ${erro.message}` : String(erro);
      const doc = new PDFDocument(opcoesBase);
      return { doc, tipografia: { regular: "Helvetica", bold: "Helvetica-Bold" }, fonte: "helvetica", erroFonte: mensagem };
    }
  }

  const doc = new PDFDocument(opcoesBase);
  return { doc, tipografia: { regular: "Helvetica", bold: "Helvetica-Bold" }, fonte: "helvetica", erroFonte: null };
}

function desenharCabecalho(doc: Documento, tipografia: Tipografia, entrada: EntradaPdfMaterial) {
  const { x, y } = doc;
  const assinatura = entrada.assinatura ?? ASSINATURA_PADRAO;
  const data = format(entrada.aprovadoEm, "d 'de' MMMM 'de' yyyy", { locale: ptBR });
  const direita = entrada.primeiroNome ? `Para ${entrada.primeiroNome} · ${data}` : data;

  doc.font(tipografia.bold).fontSize(8).fillColor(COR.apagada);
  doc.text(assinatura.toUpperCase(), MARGEM, 24, { width: LARGURA_UTIL * 0.6, lineBreak: false, characterSpacing: 0.6 });
  doc.font(tipografia.regular).fontSize(8).fillColor(COR.apagada);
  doc.text(direita, MARGEM + LARGURA_UTIL * 0.6, 24, { width: LARGURA_UTIL * 0.4, align: "right", lineBreak: false });

  doc
    .moveTo(MARGEM, 38)
    .lineTo(LARGURA_A4 - MARGEM, 38)
    .lineWidth(0.6)
    .strokeColor(COR.areia)
    .stroke();

  doc.x = x;
  doc.y = y;
}

function desenharMarcaDagua(doc: Documento, tipografia: Tipografia) {
  // `text()` em posição explícita move o cursor (doc.y) — sem restaurar, a
  // página nova começaria no meio (medido: 3 páginas em vez de 2).
  const { x, y } = doc;
  doc.save();
  doc.opacity(0.09);
  doc.rotate(-32, { origin: [LARGURA_A4 / 2, ALTURA_A4 / 2] });
  doc.font(tipografia.bold).fontSize(54).fillColor(COR.marca);
  doc.text(MARCA_DAGUA_EXEMPLO, 0, ALTURA_A4 / 2 - 30, { width: LARGURA_A4, align: "center", lineBreak: false });
  doc.restore();
  doc.x = x;
  doc.y = y;
}

/** Rodapé + numeração, escritos DEPOIS de todo o conteúdo (bufferPages) — por isso sabe o total. */
function desenharRodapes(doc: Documento, tipografia: Tipografia, entrada: EntradaPdfMaterial) {
  const { start, count } = doc.bufferedPageRange();
  for (let i = start; i < start + count; i += 1) {
    doc.switchToPage(i);
    // Escrever abaixo da margem inferior faria o pdfkit abrir página nova — o
    // truque documentado é zerar a margem só durante o rodapé.
    const margemInferior = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    doc
      .moveTo(MARGEM, ALTURA_A4 - 46)
      .lineTo(LARGURA_A4 - MARGEM, ALTURA_A4 - 46)
      .lineWidth(0.6)
      .strokeColor(COR.areia)
      .stroke();

    doc.font(tipografia.regular).fontSize(7.5).fillColor(COR.apagada);
    doc.text(entrada.rodapeJuridico, MARGEM, ALTURA_A4 - 40, { width: LARGURA_UTIL - 60, lineGap: 1 });
    doc.text(`Página ${i - start + 1} de ${count}`, LARGURA_A4 - MARGEM - 60, ALTURA_A4 - 40, {
      width: 60,
      align: "right",
      lineBreak: false,
    });

    doc.page.margins.bottom = margemInferior;
  }
}

function garantirEspaco(doc: Documento, alturaNecessaria: number) {
  const limite = doc.page.height - doc.page.margins.bottom;
  if (doc.y + alturaNecessaria > limite) doc.addPage();
}

function renderizarBloco(doc: Documento, tipografia: Tipografia, bloco: BlocoMaterial) {
  switch (bloco.tipo) {
    case "titulo": {
      doc.font(tipografia.bold).fontSize(16).fillColor(COR.tinta);
      garantirEspaco(doc, doc.heightOfString(bloco.texto, { width: LARGURA_UTIL }) + 30);
      doc.moveDown(0.9);
      doc.text(bloco.texto, { width: LARGURA_UTIL, lineGap: 2 });
      doc.moveDown(0.35);
      return;
    }
    case "paragrafo": {
      doc.font(tipografia.regular).fontSize(11).fillColor(COR.texto);
      doc.text(bloco.texto, { width: LARGURA_UTIL, lineGap: 3.5, align: "left" });
      doc.moveDown(0.6);
      return;
    }
    case "lista": {
      doc.font(tipografia.regular).fontSize(11).fillColor(COR.texto);
      for (const item of bloco.itens) {
        const altura = doc.heightOfString(item, { width: LARGURA_UTIL - 18, lineGap: 3 });
        garantirEspaco(doc, altura + 4);
        const y = doc.y;
        doc.circle(MARGEM + 4, y + 6.5, 2).fill(COR.marca);
        doc.fillColor(COR.texto).text(item, MARGEM + 18, y, { width: LARGURA_UTIL - 18, lineGap: 3 });
        doc.x = MARGEM;
        doc.moveDown(0.25);
      }
      doc.moveDown(0.5);
      return;
    }
    case "citacao": {
      doc.font(tipografia.regular).fontSize(12).fillColor(COR.tinta);
      const larguraTexto = LARGURA_UTIL - 22;
      const altura = doc.heightOfString(bloco.texto, { width: larguraTexto, lineGap: 3 });
      garantirEspaco(doc, altura + 16);
      doc.moveDown(0.3);
      const y = doc.y;
      doc.rect(MARGEM, y - 2, 3, altura + 6).fill(COR.marca);
      doc.fillColor(COR.tinta).text(bloco.texto, MARGEM + 22, y, { width: larguraTexto, lineGap: 3 });
      doc.x = MARGEM;
      doc.moveDown(0.9);
      return;
    }
    default:
      return;
  }
}

function coletarBuffer(doc: Documento): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = [];
    doc.on("data", (parte: Buffer) => partes.push(parte));
    doc.on("end", () => resolve(Buffer.concat(partes)));
    doc.on("error", reject);
    doc.end();
  });
}

/**
 * `gerarPdfMaterial(entrada) → Promise<ResultadoPdfMaterial>` — o Buffer vem em
 * `.pdf`, junto de bytes, sha256, páginas e qual fonte saiu. Assíncrono porque
 * o pdfkit é um stream; nunca toca disco além de ler as fontes.
 *
 * `opcoes.forcarHelvetica` existe só para a bancada (`scripts/gerar-pdf-exemplo.ts
 * --helvetica`) provar que o caminho de fallback também produz PDF válido.
 */
export async function gerarPdfMaterial(
  entrada: EntradaPdfMaterial,
  opcoes: { forcarHelvetica?: boolean } = {},
): Promise<ResultadoPdfMaterial> {
  const { doc, tipografia, fonte, erroFonte } = abrirDocumento(entrada, opcoes.forcarHelvetica === true);
  const exemplo = entrada.origemDado === "exemplo";

  const decorarPagina = () => {
    if (exemplo) desenharMarcaDagua(doc, tipografia);
    desenharCabecalho(doc, tipografia, entrada);
  };

  decorarPagina();
  doc.on("pageAdded", decorarPagina);

  // Rótulo pequeno em caixa alta + título grande — a hierarquia do seminário.
  doc.x = MARGEM;
  doc.y = MARGEM + 8;
  doc.font(tipografia.bold).fontSize(8).fillColor(COR.marca);
  doc.text("MATERIAL EDUCATIVO · SESSÃO DE VIABILIDADE", { width: LARGURA_UTIL, characterSpacing: 0.8 });
  doc.moveDown(0.5);
  doc.font(tipografia.bold).fontSize(24).fillColor(COR.tinta);
  doc.text(entrada.material.titulo, { width: LARGURA_UTIL, lineGap: 2 });
  doc.moveDown(0.8);

  for (const bloco of entrada.material.blocos) {
    renderizarBloco(doc, tipografia, bloco);
  }

  doc.removeListener("pageAdded", decorarPagina);
  desenharRodapes(doc, tipografia, entrada);
  const paginas = doc.bufferedPageRange().count;

  const pdf = await coletarBuffer(doc);
  const sha256 = crypto.createHash("sha256").update(pdf).digest("hex");

  return { pdf, bytes: pdf.length, sha256, paginas, fonte, erroFonte };
}

/** Nome do arquivo que o cliente vê ao baixar — sem nome completo, sem id. */
export const NOME_ARQUIVO_PDF_MATERIAL = "material-sessao-de-viabilidade.pdf";
