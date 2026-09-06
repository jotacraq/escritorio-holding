import PDFDocument from "pdfkit";
import {
  ALTURA_A4,
  COR,
  FONTE_BOLD,
  FONTE_REGULAR,
  LARGURA_A4,
  LARGURA_UTIL,
  MARGEM,
  TIPOGRAFIA_HELVETICA,
  TIPOGRAFIA_NEUETRA,
  lerFontes,
  type Tipografia,
} from "@/server/pdf/base";
import type { DossieTitular, SolicitacaoTitular } from "@/types/lgpd";

/**
 * Dossiê do titular em PDF legível (LGPD art. 18, II). O JSON é a portabilidade
 * por máquina; este é o documento que a Dra. Elaine entrega e assina.
 *
 * Reusa a paleta e o carregamento de fonte de `src/server/pdf/base.ts` — os
 * mesmos do PDF do material pós-sessão. Sem dependência nova.
 *
 * Regra: seção sem registro imprime "nenhum registro", NUNCA "0" e nunca some
 * da lista — quem lê precisa saber que a seção foi verificada e estava vazia.
 */

type Documento = InstanceType<typeof PDFDocument>;

export interface EntradaPdfDossie {
  dossie: DossieTitular;
  solicitacao: SolicitacaoTitular;
  /** Nome como está no cadastro no momento da exportação. */
  nomeTitular: string;
}

export interface ResultadoPdfDossie {
  pdf: Buffer;
  bytes: number;
  paginas: number;
  fonte: "neuetra" | "helvetica";
  erroFonte: string | null;
}

function abrirDocumento(): {
  doc: Documento;
  tipografia: Tipografia;
  fonte: "neuetra" | "helvetica";
  erroFonte: string | null;
} {
  const opcoes = {
    size: "A4" as const,
    margins: { top: MARGEM, bottom: MARGEM, left: MARGEM, right: MARGEM },
    bufferPages: true,
    info: {
      // SEM o nome do titular (achado L4 do pentest r3): o pdfkit escreve o
      // `info` no XMP sem escape de XML, e o nome apareceria nas propriedades
      // do arquivo — que sobrevivem a qualquer encaminhamento. A capa já o traz,
      // onde ele é o conteúdo do documento, e não metadado colável.
      Title: "Dossiê do titular",
      Author: "SIC-HF",
      Subject: "Dossiê de dados do titular — LGPD art. 18",
      Creator: "SIC-HF",
    },
    pdfVersion: "1.5" as const,
  };

  try {
    const fontes = lerFontes();
    // `font` aceita Buffer em runtime (PDFFontFactory.open); @types/pdfkit só declara string.
    const doc = new PDFDocument({ ...opcoes, font: fontes.regular as unknown as string });
    doc.registerFont(FONTE_REGULAR, fontes.regular);
    doc.registerFont(FONTE_BOLD, fontes.bold);
    doc.font(FONTE_BOLD);
    doc.font(FONTE_REGULAR);
    return { doc, tipografia: TIPOGRAFIA_NEUETRA, fonte: "neuetra", erroFonte: null };
  } catch (erro) {
    const mensagem = erro instanceof Error ? `${erro.name}: ${erro.message}` : String(erro);
    return { doc: new PDFDocument(opcoes), tipografia: TIPOGRAFIA_HELVETICA, fonte: "helvetica", erroFonte: mensagem };
  }
}

function dataLegivel(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

/** Uma linha do dossiê em texto — chave: valor, sem inventar formatação. */
function achatar(linha: Record<string, unknown>): string {
  return Object.entries(linha)
    .filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => {
      const valor =
        typeof v === "object" ? JSON.stringify(v) : typeof v === "string" && /\d{4}-\d{2}-\d{2}T/.test(v) ? dataLegivel(v) : String(v);
      return `${k}: ${valor.length > 400 ? `${valor.slice(0, 400)}…` : valor}`;
    })
    .join(" · ");
}

function titulo(doc: Documento, t: Tipografia, texto: string) {
  if (doc.y > ALTURA_A4 - MARGEM - 80) doc.addPage();
  doc.moveDown(0.8);
  doc.font(t.bold).fontSize(12).fillColor(COR.tinta).text(texto, { width: LARGURA_UTIL });
  doc.moveDown(0.2);
}

function paragrafo(doc: Documento, t: Tipografia, texto: string, tamanho = 9.5) {
  doc.font(t.regular).fontSize(tamanho).fillColor(COR.texto).text(texto, { width: LARGURA_UTIL, lineGap: 1.5 });
}

function secao(doc: Documento, t: Tipografia, nome: string, linhas: Record<string, unknown>[]) {
  titulo(doc, t, nome);
  if (linhas.length === 0) {
    doc.font(t.regular).fontSize(9.5).fillColor(COR.apagada).text("nenhum registro", { width: LARGURA_UTIL });
    return;
  }
  linhas.forEach((linha, i) => {
    paragrafo(doc, t, `${i + 1}. ${achatar(linha)}`);
    doc.moveDown(0.2);
  });
}

/** Mesmo padrão de `material/pdf.ts`: o Buffer só existe depois do `end`. */
function coletarBuffer(doc: Documento): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = [];
    doc.on("data", (parte: Buffer) => partes.push(parte));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(partes)));
    doc.end();
  });
}

export async function gerarPdfDossie(entrada: EntradaPdfDossie): Promise<ResultadoPdfDossie> {
  const { dossie, solicitacao, nomeTitular } = entrada;
  const { doc, tipografia: t, fonte, erroFonte } = abrirDocumento();

  // ---- capa: o registro do pedido, que é o que dá legitimidade ao documento
  doc.font(t.bold).fontSize(9).fillColor(COR.marca).text("SIC-HF · LGPD ART. 18", { characterSpacing: 0.6 });
  doc.moveDown(0.4);
  doc.font(t.bold).fontSize(22).fillColor(COR.tinta).text("Dossiê de dados do titular", { width: LARGURA_UTIL });
  doc.moveDown(0.3);
  doc.font(t.regular).fontSize(12).fillColor(COR.texto).text(nomeTitular, { width: LARGURA_UTIL });
  doc.moveDown(0.8);

  doc
    .moveTo(MARGEM, doc.y)
    .lineTo(LARGURA_A4 - MARGEM, doc.y)
    .lineWidth(0.75)
    .strokeColor(COR.areia)
    .stroke();
  doc.moveDown(0.8);

  paragrafo(doc, t, `Controlador: ${dossie._metadados.controlador ?? "não informado no sistema"}`);
  paragrafo(doc, t, `Gerado em: ${dataLegivel(dossie._metadados.gerado_em)} por ${dossie._metadados.gerado_por.nome}`);
  paragrafo(doc, t, `Pedido recebido por ${solicitacao.canal_pedido} em ${dataLegivel(solicitacao.solicitado_em)}`);
  paragrafo(doc, t, `Base legal declarada: ${solicitacao.base_legal}`);
  paragrafo(doc, t, `Motivo: ${solicitacao.motivo}`);
  paragrafo(doc, t, `Registro da solicitação: ${solicitacao.id}`);

  titulo(doc, t, "O que este pacote não inclui");
  dossie._metadados.observacoes.forEach((o) => {
    paragrafo(doc, t, `• ${o}`);
    doc.moveDown(0.1);
  });

  titulo(doc, t, "Tabelas verificadas");
  paragrafo(doc, t, dossie._metadados.tabelas_incluidas.join(" · "), 8.5);

  // ---- o conteúdo
  secao(doc, t, "Cadastro", dossie.pessoa ? [dossie.pessoa] : []);

  titulo(doc, t, "Formulário estratégico");
  if (dossie.formularios.length === 0) {
    doc.font(t.regular).fontSize(9.5).fillColor(COR.apagada).text("nenhum registro", { width: LARGURA_UTIL });
  } else {
    dossie.formularios.forEach((f) => {
      paragrafo(doc, t, `Versão ${f.versao} da chave "${f.chave}", respondido em ${dataLegivel(f.respondido_em)}`);
      doc.moveDown(0.2);
      f.perguntas.forEach((p) => {
        doc.font(t.bold).fontSize(9.5).fillColor(COR.tinta).text(p.rotulo, { width: LARGURA_UTIL });
        doc
          .font(t.regular)
          .fontSize(9.5)
          .fillColor(p.resposta_rotulo ? COR.texto : COR.apagada)
          .text(p.resposta_rotulo || "sem resposta", { width: LARGURA_UTIL });
        doc.moveDown(0.25);
      });
    });
  }

  secao(doc, t, "Arquivos enviados", dossie.documentos as unknown as Record<string, unknown>[]);

  // Uma seção por tabela do inventário, na ordem do inventário. Nenhuma some da
  // lista quando está vazia: quem lê precisa saber que ela foi verificada.
  dossie.secoes.forEach((s) => secao(doc, t, s.rotulo, s.linhas));

  // ---- BLOQUEIO B47: o trabalho interno do escritório, separado e rotulado.
  titulo(doc, t, "Anotações internas do escritório");
  paragrafo(doc, t, dossie.anotacoes_internas.aviso);
  doc.moveDown(0.3);
  if (dossie.anotacoes_internas.secoes.every((s) => s.linhas.length === 0)) {
    doc.font(t.regular).fontSize(9.5).fillColor(COR.apagada).text("nenhum registro", { width: LARGURA_UTIL });
  } else {
    dossie.anotacoes_internas.secoes.forEach((s) => secao(doc, t, s.rotulo, s.linhas));
  }

  // ---- rodapé com paginação
  const faixa = doc.bufferedPageRange();
  for (let i = faixa.start; i < faixa.start + faixa.count; i += 1) {
    doc.switchToPage(i);
    doc
      .moveTo(MARGEM, ALTURA_A4 - 46)
      .lineTo(LARGURA_A4 - MARGEM, ALTURA_A4 - 46)
      .lineWidth(0.5)
      .strokeColor(COR.areia)
      .stroke();
    doc.font(t.regular).fontSize(7.5).fillColor(COR.apagada);
    doc.text(`Documento gerado pelo SIC-HF · solicitação ${solicitacao.id}`, MARGEM, ALTURA_A4 - 40, {
      width: LARGURA_UTIL - 60,
      lineBreak: false,
    });
    doc.text(`Página ${i - faixa.start + 1} de ${faixa.count}`, LARGURA_A4 - MARGEM - 60, ALTURA_A4 - 40, {
      width: 60,
      align: "right",
      lineBreak: false,
    });
  }

  const pdf = await coletarBuffer(doc);
  return { pdf, bytes: pdf.length, paginas: faixa.count, fonte, erroFonte };
}
