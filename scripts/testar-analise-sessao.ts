/**
 * scripts/testar-analise-sessao.ts
 *
 * Prova, sem chamar nenhuma IA e sem banco, as partes determinísticas da
 * Análise da Sessão de Viabilidade (ARQUITETURA-FASE-3.md §2 e §3, onda 2 —
 * agente E/backend-analise):
 *
 *   1. `CroquiAnaliseV2Schema` (src/server/croqui/schema-analise-v2.ts) aceita
 *      um objeto válido e rejeita um objeto com um `criterios` incompleto
 *      (a arquitetura exige exatamente os 9 critérios do método).
 *   2. `gerarSlidesDaAnalise()` (src/server/croqui/gerar-slides.ts):
 *      a. para `schemaVersao < 2`, devolve a base do método INTOCADA — nunca
 *         inventa correspondência com o `croqui: string[]` solto da v1
 *         (§3.1);
 *      b. para `schemaVersao === 2` com cobertura completa dos 13 tipos,
 *         todo slide vira `origem: 'ia'`, `revisado: false`, com o conteúdo
 *         da análise;
 *      c. para `schemaVersao === 2` com um tipo AUSENTE da análise (13
 *         elementos, mas um tipo duplicado no lugar de outro), o slide do
 *         tipo ausente preserva a mensagem-padrão do método (`origem:
 *         'metodo'`) — nunca fica vazio, nunca é inventado.
 *   3. `proximaVersaoArquivoOrigem()` (src/server/croqui/transcricao.ts) — a
 *      numeração de versão do `arquivo_origem` sintético (`sessao:<id>:v<n>`):
 *      primeira versão, incremento sobre existentes, ignora prefixo de outra
 *      sessão, ignora sufixo não numérico, e fecha o buraco (mais alto + 1,
 *      não contagem).
 *
 * MODO DE USO:
 *   npx tsx scripts/testar-analise-sessao.ts
 *
 * Sem framework de teste no projeto (nenhum vitest/jest no package.json) —
 * script standalone, mesmo padrão de scripts/testar-json-schema-estrito.ts.
 * Sai com código 1 em qualquer falha.
 */
import {
  CroquiAnaliseV2Schema,
  type CroquiAnaliseV2,
  type SlideAnalise,
} from "../src/server/croqui/schema-analise-v2";
import { gerarSlidesDaAnalise } from "../src/server/croqui/gerar-slides";
import { proximaVersaoArquivoOrigem } from "../src/server/croqui/transcricao";
import { CRITERIOS_ARQUITETURA } from "../src/server/ia/schema-croqui-analise";
import { construirSlidesBase, TIPOS_SLIDE_CROQUI, type TipoSlideCroqui } from "../src/server/ia/schema-croqui-slides";

let falhas = 0;

function verificar(condicao: boolean, descricao: string): void {
  if (condicao) {
    console.log(`OK — ${descricao}`);
  } else {
    falhas++;
    console.error(`FALHOU — ${descricao}`);
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function slideAnalise(tipo: TipoSlideCroqui, sufixo: string): SlideAnalise {
  return {
    tipo,
    conteudo: `Conteúdo do slide ${tipo} (${sufixo}), preso a evidência.`,
    pontos: [`Ponto 1 — ${sufixo}`, `Ponto 2 — ${sufixo}`],
    como_apresentar: `Como apresentar o slide ${tipo} (${sufixo}).`,
    categoria: "fato_declarado",
    fontes: ["formulário estratégico"],
  };
}

function analiseV2Completa(): CroquiAnaliseV2 {
  return {
    resumo_executivo: "Família construtora, patrimônio concentrado em uma operação, sem estrutura hoje.",
    historia: [{ texto: "Fundou a empresa em 1998.", categoria: "fato_declarado" }],
    familia: [{ texto: "Casado, dois filhos maiores.", categoria: "fato_declarado" }],
    patrimonio: [{ texto: "Empresa operacional + dois imóveis.", categoria: "dado_documental" }],
    empresas: [{ texto: "Uma empresa operacional relevante.", categoria: "fato_declarado" }],
    objetivos: [{ texto: "Proteger a operação de risco pessoal.", categoria: "inferencia" }],
    riscos: [{ texto: "Concentração em um único bem.", categoria: "inferencia" }],
    disc: [{ decisor: "Cliente principal", perfil_predominante: "D", evidencias: ["fala rápido, decide sozinho"], confianca: 70 }],
    arquitetura: {
      recomendacao: "2_celulas",
      criterios: CRITERIOS_ARQUITETURA.map((criterio) => ({
        criterio,
        resposta: { texto: `Resposta para ${criterio}.`, categoria: "inferencia" as const },
        peso_na_decisao: "médio",
      })),
      justificativa_geral: "Separar patrimônio de controle reduz risco sem complexidade desnecessária.",
      alocacao: [{ celula: "cofre", item: "Imóvel comercial", categoria: "dado_documental" }],
    },
    croqui: TIPOS_SLIDE_CROQUI.map((tipo) => slideAnalise(tipo, "completo")),
    perguntas: [{ pergunta: "Há sócios minoritários?", motivo: "Afeta a composição do veículo." }],
    objecoes: [{ objecao: "Custo de manutenção", resposta_recomendada: "Comparar com o custo de não agir." }],
    fechamento: "Apresentar a estrutura de 2 células como resposta direta ao risco identificado.",
    grau_confianca: 65,
    lacunas: ["Sem confirmação do regime de bens do segundo filho."],
  };
}

// ---------------------------------------------------------------------------
// 1) CroquiAnaliseV2Schema
// ---------------------------------------------------------------------------

const analiseValida = analiseV2Completa();
const resultadoValido = CroquiAnaliseV2Schema.safeParse(analiseValida);
verificar(resultadoValido.success, "CroquiAnaliseV2Schema aceita um objeto completo e válido");

const analiseComCriteriosIncompletos = {
  ...analiseValida,
  arquitetura: { ...analiseValida.arquitetura, criterios: analiseValida.arquitetura.criterios.slice(0, 3) },
};
const resultadoInvalido = CroquiAnaliseV2Schema.safeParse(analiseComCriteriosIncompletos);
verificar(
  !resultadoInvalido.success,
  `CroquiAnaliseV2Schema rejeita arquitetura.criterios com menos de ${CRITERIOS_ARQUITETURA.length} itens`,
);

const analiseComCroquiIncompleto = { ...analiseValida, croqui: analiseValida.croqui.slice(0, 12) };
verificar(
  !CroquiAnaliseV2Schema.safeParse(analiseComCroquiIncompleto).success,
  `CroquiAnaliseV2Schema rejeita croqui com menos de ${TIPOS_SLIDE_CROQUI.length} slides`,
);

// ---------------------------------------------------------------------------
// 2) gerarSlidesDaAnalise
// ---------------------------------------------------------------------------

const base = construirSlidesBase();

// (a) schemaVersao 1 — nunca inventa correspondência com o formato v1 solto.
const resultadoV1 = gerarSlidesDaAnalise(["frase solta 1", "frase solta 2"], 1, base);
verificar(
  JSON.stringify(resultadoV1) === JSON.stringify(base),
  "gerarSlidesDaAnalise(schemaVersao=1) devolve a base do método intocada",
);

// (b) schemaVersao 2, cobertura completa.
const resultadoV2Completo = gerarSlidesDaAnalise(analiseValida, 2, base);
verificar(
  resultadoV2Completo.slides.length === 13,
  "gerarSlidesDaAnalise(schemaVersao=2, completo) devolve os 13 slides",
);
verificar(
  resultadoV2Completo.slides.every((slide) => slide.origem === "ia" && slide.revisado === false),
  "gerarSlidesDaAnalise(schemaVersao=2, completo) marca todo slide como origem='ia' e revisado=false",
);
verificar(
  resultadoV2Completo.slides.every((slide) => slide.conteudo.includes("completo")),
  "gerarSlidesDaAnalise(schemaVersao=2, completo) usa o conteúdo vindo da análise, não a mensagem-padrão",
);

// (c) schemaVersao 2, um tipo ausente da análise (duplica 'legado' no lugar
// de 'investimento' — ainda 13 elementos, mas 'investimento' nunca aparece).
const croquiComTipoAusente: SlideAnalise[] = TIPOS_SLIDE_CROQUI.filter((tipo) => tipo !== "investimento").map(
  (tipo) => slideAnalise(tipo, "parcial"),
);
croquiComTipoAusente.push(slideAnalise("legado", "duplicado"));
const analiseParcial: CroquiAnaliseV2 = { ...analiseValida, croqui: croquiComTipoAusente };

verificar(
  CroquiAnaliseV2Schema.safeParse(analiseParcial).success,
  "fixture 'analiseParcial' é válida contra o schema (13 elementos, mas 'investimento' ausente)",
);

const resultadoV2Parcial = gerarSlidesDaAnalise(analiseParcial, 2, base);
const slideInvestimento = resultadoV2Parcial.slides.find((slide) => slide.tipo === "investimento");
verificar(
  slideInvestimento?.origem === "metodo" && slideInvestimento.revisado === false,
  "gerarSlidesDaAnalise(schemaVersao=2, parcial) preserva o slide 'investimento' como origem='metodo' quando a análise não o cobre",
);
verificar(
  slideInvestimento?.conteudo === base.slides.find((slide) => slide.tipo === "investimento")?.conteudo,
  "gerarSlidesDaAnalise(schemaVersao=2, parcial) não inventa conteúdo para o slide não coberto — mantém a mensagem-padrão do método",
);

// (d) conteúdo inválido explode (nunca falha em silêncio, nunca devolve dado
// meio-parseado).
let lancouParaConteudoInvalido = false;
try {
  gerarSlidesDaAnalise({ nao: "é uma análise v2" }, 2, base);
} catch {
  lancouParaConteudoInvalido = true;
}
verificar(lancouParaConteudoInvalido, "gerarSlidesDaAnalise(schemaVersao=2) lança quando o conteúdo não bate com CroquiAnaliseV2Schema");

// ---------------------------------------------------------------------------
// 3) proximaVersaoArquivoOrigem
// ---------------------------------------------------------------------------

const sessaoId = "11111111-1111-1111-1111-111111111111";
const outraSessaoId = "22222222-2222-2222-2222-222222222222";

verificar(
  proximaVersaoArquivoOrigem(sessaoId, []) === `sessao:${sessaoId}:v1`,
  "proximaVersaoArquivoOrigem: primeira versão é v1 quando não há nenhuma existente",
);
verificar(
  proximaVersaoArquivoOrigem(sessaoId, [`sessao:${sessaoId}:v1`, `sessao:${sessaoId}:v2`]) === `sessao:${sessaoId}:v3`,
  "proximaVersaoArquivoOrigem: incrementa sobre a maior versão existente",
);
verificar(
  proximaVersaoArquivoOrigem(sessaoId, [`sessao:${outraSessaoId}:v1`, `sessao:${outraSessaoId}:v2`]) ===
    `sessao:${sessaoId}:v1`,
  "proximaVersaoArquivoOrigem: ignora arquivo_origem de outra sessão",
);
verificar(
  proximaVersaoArquivoOrigem(sessaoId, [`sessao:${sessaoId}:vabc`, `sessao:${sessaoId}:v`]) === `sessao:${sessaoId}:v1`,
  "proximaVersaoArquivoOrigem: ignora sufixo não numérico",
);
verificar(
  proximaVersaoArquivoOrigem(sessaoId, [`sessao:${sessaoId}:v1`, `sessao:${sessaoId}:v5`]) === `sessao:${sessaoId}:v6`,
  "proximaVersaoArquivoOrigem: fecha o buraco pela MAIOR versão (não pela contagem) — v1,v5 vira v6, não v3",
);

// ---------------------------------------------------------------------------
if (falhas > 0) {
  console.error(`\n${falhas} verificação(ões) falharam.`);
  process.exit(1);
}
console.log("\nTodas as verificações passaram.");
