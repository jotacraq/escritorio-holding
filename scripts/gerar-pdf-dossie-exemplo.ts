/**
 * scripts/gerar-pdf-dossie-exemplo.ts
 *
 * Bancada do PDF do dossiê do titular (LGPD art. 18 — Fase 7 r3). Mesmo molde
 * de `scripts/gerar-pdf-exemplo.ts`: não toca banco, não chama IA, não precisa
 * de env. Monta um dossiê fixo (com uma seção cheia e várias VAZIAS, que é o
 * caso que a regra da casa cobra) e grava em `tmp/squad/dossie-exemplo.pdf`.
 *
 *   npx tsx scripts/gerar-pdf-dossie-exemplo.ts
 *
 * Falha com exit 1 se o arquivo não começar em %PDF, se o dossiê inventar
 * contagem, ou se a observação sobre a Vapi sumir quando há ligação por IA.
 */
import fs from "node:fs";
import path from "node:path";
import { AVISO_ANOTACOES_INTERNAS, dadosBrutosVazios, montarDossie, OBSERVACAO_VAPI } from "../src/server/lgpd/dossie";
import { INVENTARIO_TITULAR } from "../src/server/lgpd/inventario";
import { gerarPdfDossie } from "../src/server/lgpd/pdf-dossie";
import type { SolicitacaoTitular } from "../src/types/lgpd";

const DESTINO = path.resolve(process.cwd(), "tmp/squad", "dossie-exemplo.pdf");

const solicitacao: SolicitacaoTitular = {
  id: "11111111-2222-4333-8444-555555555555",
  pessoa_id: "99999999-8888-4777-8666-555555555555",
  tipo: "exportacao",
  motivo: "Pedido de acesso do titular recebido por e-mail em 04/09/2026.",
  base_legal: "Art. 18, II — confirmação da existência de tratamento e acesso aos dados",
  canal_pedido: "email",
  solicitado_em: "2026-09-04T13:00:00.000Z",
  executado_em: "2026-09-06T18:00:00.000Z",
  executado_por: "perfil-admin",
  resultado: {},
  criado_em: "2026-09-06T18:00:00.000Z",
};

const dados = dadosBrutosVazios();
dados.pessoa = {
  id: solicitacao.pessoa_id,
  nome: "Marcos Antônio Ribeiro",
  cidade: "Curitiba",
  uf: "PR",
  observacoes: "Prefere ser chamado no fim da tarde.",
};
dados.tabelas.jornadas = [{ id: "j1", etapa: "sessao_realizada", desfecho: "aberta", criado_em: "2026-06-10T12:00:00.000Z" }];
dados.tabelas.ligacoes_ia = [
  { id: "l1", status: "concluida", duracao_segundos: 92, custo_usd: 0.11, gravacao_url: "https://storage.vapi.ai/exemplo.wav" },
];
dados.tabelas.ligacoes_estrategicas = [
  {
    id: "le1",
    jornada_id: "j1",
    expectativa_principal: "Proteger o imóvel da praia",
    objecoes_percebidas: ["acha caro"],
    frases_marcantes: ["não quero briga entre os filhos"],
  },
];
dados.formularios = [
  {
    linha: { id: "fr1", formulario_id: "f2", respondido_em: "2026-06-12T14:20:00.000Z", respostas: { p1: "Marcos Antônio Ribeiro", p9: "ate_500k" } },
    formulario: {
      id: "f2",
      chave: "estrategico",
      versao: 2,
      definicao: [
        { id: "p1", bloco: "Identificação", tipo: "texto", rotulo: "Qual seu nome completo?" },
        {
          id: "p9",
          bloco: "Patrimônio",
          tipo: "unica",
          rotulo: "Qual sua faixa de patrimônio estimado?",
          opcoes: [
            { valor: "ate_500k", rotulo: "Até R$ 500 mil" },
            { valor: "acima_500k", rotulo: "Acima de R$ 500 mil" },
          ],
        },
        { id: "p16", bloco: "Dor", tipo: "texto_longo", rotulo: "O que mais preocupa você hoje?" },
      ],
    },
  },
];

async function main() {
  const dossie = montarDossie(dados, {
    gerado_por: { id: "perfil-admin", nome: "Ana Souza" },
    solicitacao_id: solicitacao.id,
    controlador: null,
    gerado_em: "2026-09-06T18:00:00.000Z",
  });

  const falhas: string[] = [];
  if (!dossie._metadados.observacoes.includes(OBSERVACAO_VAPI)) falhas.push("faltou o aviso da Vapi");
  if (dossie.documentos.length !== 0) falhas.push("documentos deveria estar vazio");
  if (dossie.formularios[0].perguntas.find((p) => p.id === "p9")?.resposta_rotulo !== "Até R$ 500 mil") {
    falhas.push("a opção não saiu com o rótulo humano");
  }
  if (dossie.formularios[0].perguntas.find((p) => p.id === "p16")?.resposta_rotulo !== "") {
    falhas.push("pergunta sem resposta deveria sair vazia, não preenchida");
  }

  // M3: nenhuma tabela do inventário pode ficar de fora do pacote.
  const cobertas = new Set([
    ...dossie.secoes.map((s) => s.tabela),
    ...dossie.anotacoes_internas.secoes.map((s) => s.tabela),
    "formularios_respostas",
    "documentos",
  ]);
  const faltando = INVENTARIO_TITULAR.map((i) => i.tabela).filter((t) => !cobertas.has(t));
  if (faltando.length > 0) falhas.push(`tabela do inventário fora do dossiê: ${faltando.join(", ")}`);

  // B47: as anotações internas saem separadas, com o aviso.
  if (dossie.anotacoes_internas.aviso !== AVISO_ANOTACOES_INTERNAS) falhas.push("faltou o aviso do B47");
  if ("observacoes" in (dossie.pessoa ?? {})) falhas.push("`observacoes` do cadastro vazou para a seção do titular");
  const ligacaoIa = dossie.secoes.find((s) => s.tabela === "ligacoes_ia")?.linhas[0];
  if (String(ligacaoIa?.gravacao_url ?? "").includes("vapi.ai")) falhas.push("a URL da gravação saiu no pacote");

  const { pdf, bytes, paginas, fonte, erroFonte } = await gerarPdfDossie({
    dossie,
    solicitacao,
    nomeTitular: String(dados.pessoa?.nome ?? "titular"),
  });

  fs.mkdirSync(path.dirname(DESTINO), { recursive: true });
  fs.writeFileSync(DESTINO, pdf);

  const cabecalho = pdf.subarray(0, 8).toString("latin1");
  if (!cabecalho.startsWith("%PDF")) falhas.push(`cabeçalho inesperado: ${cabecalho}`);

  console.log(`arquivo:   ${DESTINO}`);
  console.log(`head -c 8: ${JSON.stringify(cabecalho)}`);
  console.log(`tamanho:   ${bytes} bytes`);
  console.log(`paginas:   ${paginas}`);
  console.log(`fonte:     ${fonte}${erroFonte ? ` (fallback: ${erroFonte})` : ""}`);
  console.log(`secoes do inventario: ${dossie.secoes.length} · internas: ${dossie.anotacoes_internas.secoes.length}`);
  console.log(`secoes vazias impressas como "nenhum registro": sim`);

  if (falhas.length > 0) {
    console.error(`FALHOU: ${falhas.join(" ;; ")}`);
    process.exit(1);
  }
  console.log("OK");
}

void main();
