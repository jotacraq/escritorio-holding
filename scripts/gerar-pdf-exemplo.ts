/**
 * scripts/gerar-pdf-exemplo.ts
 *
 * Bancada do renderizador de PDF do material pós-sessão (ARQUITETURA-FASE-4.md
 * §3, entrega do agente C). Não toca banco, não chama IA, não precisa de env:
 * roda `gerarPdfMaterial` sobre um material fixo com os 4 tipos de bloco e
 * grava em `tmp/squad/material-exemplo.pdf`.
 *
 * MODO DE USO:
 *   npx tsx scripts/gerar-pdf-exemplo.ts               # Neuetra (fallback automático se falhar)
 *   npx tsx scripts/gerar-pdf-exemplo.ts --helvetica   # força o caminho de fallback
 *   npx tsx scripts/gerar-pdf-exemplo.ts --real        # sem marca d'água (origem_dado='real')
 *
 * Também roda os testes de mesa de `escolherModeloMaterial` (função pura).
 *
 * Imprime: 8 primeiros bytes (tem que começar em %PDF), tamanho, páginas,
 * fonte usada e sha256. Falha com exit 1 se qualquer invariante quebrar.
 */
import fs from "node:fs";
import path from "node:path";
import { gerarPdfMaterial } from "../src/server/material/pdf";
import { escolherModeloMaterial, type ModeloMaterialCatalogo } from "../src/server/material/escolher";
import type { ConteudoMaterial } from "../src/types/material";

const forcarHelvetica = process.argv.includes("--helvetica");
const semMarca = process.argv.includes("--real");

const DESTINO = path.resolve(process.cwd(), "tmp/squad", forcarHelvetica ? "material-exemplo-helvetica.pdf" : "material-exemplo.pdf");

const material: ConteudoMaterial = {
  titulo: "Inventário: o que costuma ser avaliado antes de decidir",
  blocos: [
    {
      tipo: "paragrafo",
      texto:
        "Obrigado por participar da sua Sessão de Viabilidade. Um dos temas que você trouxe foi a " +
        "preocupação com o processo de inventário — e este material reúne, de forma resumida, o que " +
        "costuma ser avaliado quando esse é o ponto de partida.",
    },
    { tipo: "titulo", texto: "O que torna um inventário mais demorado ou mais custoso" },
    {
      tipo: "lista",
      itens: [
        "Quantidade de bens e de herdeiros envolvidos no processo.",
        "Existência de imóveis em mais de um estado ou município.",
        "Divergência entre herdeiros sobre partilha ou avaliação de bens.",
        "Tributos incidentes (ITCMD) e taxas cartorárias apurados só depois do falecimento.",
      ],
    },
    { tipo: "titulo", texto: "O que uma estrutura de organização patrimonial pode evitar" },
    {
      tipo: "paragrafo",
      texto:
        "Uma arquitetura patrimonial bem desenhada organiza, ainda em vida, quem recebe o quê e em que " +
        "condições — o que pode simplificar significativamente o processo sucessório e reduzir a " +
        "exposição a divergência entre herdeiros. O quanto isso se aplica ao seu caso depende do " +
        "retrato patrimonial completo da família, que é o que a Sessão de Viabilidade levanta.",
    },
    {
      tipo: "citacao",
      texto:
        "Planejamento sucessório não é sobre evitar a morte do assunto — é sobre decidir, com clareza, " +
        "enquanto ainda dá para decidir.",
    },
    { tipo: "titulo", texto: "Acentuação e caracteres do português" },
    {
      tipo: "paragrafo",
      texto:
        "Ação, coração, ünico, Ângela, ÇÃO, ÊÉÈ, ÕÔÓ — “aspas curvas”, travessão — e reticências… " +
        "Este parágrafo existe para provar que a fonte embutida cobre o alfabeto que o material usa.",
    },
    // Repete blocos para forçar a segunda página (prova de cabeçalho/rodapé/numeração).
    ...Array.from({ length: 4 }, (_, i) => [
      { tipo: "titulo" as const, texto: `Seção de preenchimento ${i + 1}` },
      {
        tipo: "paragrafo" as const,
        texto:
          "Vale reunir, com calma, um retrato do que existe hoje: imóveis, participações societárias, " +
          "investimentos e o regime de bens de cada núcleo familiar. É esse retrato que permite avaliar, " +
          "com precisão, se e qual arquitetura faz sentido para o seu caso. ".repeat(3),
      },
    ]).flat(),
    { tipo: "citacao", texto: "Holding é ferramenta, não finalidade." },
  ],
};

function testarEscolha() {
  const modelos: ModeloMaterialCatalogo[] = [
    { id: "p", chave: "padrao", conteudo: material, dores: [], arquetipos: [], prioridade: 100, origem_dado: "real" },
    { id: "i", chave: "inventario", conteudo: material, dores: ["inventário", "herdeiro"], arquetipos: [], prioridade: 10, origem_dado: "real" },
    { id: "t", chave: "itcmd", conteudo: material, dores: ["itcmd", "imposto"], arquetipos: ["conservador"], prioridade: 20, origem_dado: "real" },
  ];
  const casos: Array<[string, Parameters<typeof escolherModeloMaterial>[0], string, number]> = [
    ["dor principal casa", { dorPrincipal: "tenho medo do INVENTÁRIO", arquetipo: null, preocupacaoPredominante: null, riscos: [] }, "inventario", 3],
    ["só preocupação", { dorPrincipal: null, arquetipo: null, preocupacaoPredominante: "imposto alto", riscos: [] }, "itcmd", 1],
    ["dor vence risco", { dorPrincipal: "inventário", arquetipo: null, preocupacaoPredominante: null, riscos: ["imposto"] }, "inventario", 3],
    ["empate → prioridade", { dorPrincipal: "herdeiro e imposto", arquetipo: null, preocupacaoPredominante: null, riscos: [] }, "inventario", 3],
    ["arquétipo pesa 2", { dorPrincipal: null, arquetipo: "Conservador", preocupacaoPredominante: null, riscos: [] }, "itcmd", 2],
    ["nada casa → padrao", { dorPrincipal: "quero viajar", arquetipo: null, preocupacaoPredominante: null, riscos: [] }, "padrao", 0],
  ];
  let falhas = 0;
  for (const [nome, sinais, esperado, pontos] of casos) {
    const { motivo_modelo } = escolherModeloMaterial(sinais, modelos);
    const ok = motivo_modelo.chave === esperado && motivo_modelo.pontos === pontos;
    if (!ok) falhas += 1;
    console.log(`${ok ? "ok " : "FALHOU"} escolha: ${nome} → ${motivo_modelo.chave} (${motivo_modelo.pontos}) [${motivo_modelo.casou_em.join(",")}]`);
  }
  return falhas;
}

async function main() {
  const falhasEscolha = testarEscolha();

  const resultado = await gerarPdfMaterial(
    {
      material,
      primeiroNome: "Exemplo",
      aprovadoEm: new Date(),
      rodapeJuridico:
        "Material educativo elaborado pela equipe do Time Holding Brasil. Não constitui parecer jurídico nem promessa de resultado. Cada caso exige análise individual.",
      origemDado: semMarca ? "real" : "exemplo",
    },
    { forcarHelvetica },
  );

  fs.mkdirSync(path.dirname(DESTINO), { recursive: true });
  fs.writeFileSync(DESTINO, resultado.pdf);

  const cabeca = resultado.pdf.subarray(0, 8);
  const comecaEmPdf = cabeca.subarray(0, 4).toString("latin1") === "%PDF";
  const fonteEmbutida = resultado.pdf.includes("FontFile2") || resultado.pdf.includes("FontFile3");

  console.log(`arquivo:   ${DESTINO}`);
  console.log(`head -c 8: ${JSON.stringify(cabeca.toString("latin1"))}  (hex ${cabeca.toString("hex")})`);
  console.log(`tamanho:   ${resultado.bytes} bytes`);
  console.log(`paginas:   ${resultado.paginas}`);
  console.log(`fonte:     ${resultado.fonte}${resultado.erroFonte ? ` (erro: ${resultado.erroFonte})` : ""}`);
  console.log(`embutida:  ${fonteEmbutida ? "sim (FontFile no PDF)" : "nao"}`);
  console.log(`sha256:    ${resultado.sha256}`);

  const problemas: string[] = [];
  if (!comecaEmPdf) problemas.push("os 4 primeiros bytes nao sao %PDF");
  if (resultado.paginas < 1) problemas.push("menos de 1 pagina");
  if (!forcarHelvetica && resultado.fonte !== "neuetra") problemas.push("Neuetra nao carregou (caiu para Helvetica)");
  if (!forcarHelvetica && !fonteEmbutida) problemas.push("fonte nao embutida");
  if (falhasEscolha > 0) problemas.push(`${falhasEscolha} teste(s) de escolha falharam`);

  if (problemas.length > 0) {
    console.error(`FALHOU: ${problemas.join("; ")}`);
    process.exit(1);
  }
  console.log("OK");
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
