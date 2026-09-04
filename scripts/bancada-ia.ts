/**
 * scripts/bancada-ia.ts
 *
 * Protocolo de medição do Briefing Estratégico (ARQUITETURA-FASE-3.md §1.9).
 * Prova, com número medido — não com dedução — se as alavancas de custo (L1
 * effort, L2 orçamento de escrita + L3 enums via prompt v2) economizam sem
 * derrubar qualidade. Roda sobre o MESMO caminho de produção
 * (`gerarBriefingSemGravar()`, `src/server/ia/briefing.ts`) para que a medida
 * signifique alguma coisa — não um caminho paralelo que não bate com o que o
 * cliente vai receber.
 *
 * MODO DE USO:
 *   npx tsx scripts/bancada-ia.ts                    # mede, imprime tabela, NÃO promove
 *   npx tsx scripts/bancada-ia.ts --promover=effort_low
 *   npx tsx scripts/bancada-ia.ts --promover=prompt_v2
 *   npx tsx scripts/bancada-ia.ts --promover=prompt_v2_low
 *
 * Fixtures: `tmp/bancada/fixtures.json` (fora do versionamento — cita
 * `jornada_id` de clientes reais). Formato:
 *   [{ "jornada_id": "uuid", "rotulo": "curto", "faixa": "pobre"|"media"|"rica" }]
 * Cobrir as 3 faixas de completude é o que dá ao gate poder de decisão sobre
 * o intervalo inteiro, não só o caso feliz.
 *
 * Custa dinheiro de propósito — roda IA em laço. Duas travas:
 *  1. `isentoCooldown: true` (só este script; nenhuma rota HTTP tem este
 *     parâmetro) — senão o cooldown de 600s entre execuções na MESMA jornada
 *     (ligado nesta onda, §1.10) bloquearia a 2ª repetição de cada fixture.
 *  2. Teto de gasto TOTAL da rodada (`ORCAMENTO_MAXIMO_USD`, abaixo) — aborta
 *     se o acumulado ultrapassar, mesmo isento do teto por usuário.
 *
 * NUNCA imprime conteúdo de briefing nem grava em `briefings` — só números
 * agregados (§1.9, achado do pentest: "confirmar que a bancada não grava
 * briefings, não escreve conteúdo em log/stdout").
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { gerarBriefingSemGravar } from "../src/server/ia/briefing";
import type { EffortIa } from "../src/server/ia/cliente";

// ===========================================================================
// Config
// ===========================================================================

const REPETICOES = 3;
/** Teto de gasto de UMA rodada inteira da bancada — abortar antes de estourar. */
const ORCAMENTO_MAXIMO_USD = 5;
const DIR_BANCADA = path.resolve(process.cwd(), "tmp/bancada");
const CAMINHO_FIXTURES = path.join(DIR_BANCADA, "fixtures.json");

interface Fixture {
  jornada_id: string;
  rotulo: string;
  faixa: "pobre" | "media" | "rica";
}

interface DefinicaoVariante {
  variante: string;
  versaoPrompt?: number;
  effortOverride?: EffortIa;
  /**
   * Mapeia o `UPDATE prompts_versoes` que promove esta variante para produção
   * — só executado com `--promover=<variante>` e só se o gate passar.
   */
  promover(supabaseAdmin: ReturnType<typeof criarClienteAdmin>): Promise<void>;
}

const CHAVE_PROMPT = "protocolo_01_briefing";

const VARIANTES: DefinicaoVariante[] = [
  {
    variante: "baseline",
    async promover() {
      throw new Error("baseline não é promovível — é a configuração já ativa.");
    },
  },
  {
    variante: "effort_medium",
    effortOverride: "medium",
    async promover(supabaseAdmin) {
      await supabaseAdmin
        .from("prompts_versoes")
        .update({ effort: "medium" })
        .eq("chave", CHAVE_PROMPT)
        .eq("ativo", true);
    },
  },
  {
    variante: "effort_low",
    effortOverride: "low",
    async promover(supabaseAdmin) {
      await supabaseAdmin.from("prompts_versoes").update({ effort: "low" }).eq("chave", CHAVE_PROMPT).eq("ativo", true);
    },
  },
  {
    variante: "prompt_v2",
    versaoPrompt: 2,
    async promover(supabaseAdmin) {
      await supabaseAdmin.from("prompts_versoes").update({ ativo: false }).eq("chave", CHAVE_PROMPT).eq("versao", 1);
      await supabaseAdmin.from("prompts_versoes").update({ ativo: true }).eq("chave", CHAVE_PROMPT).eq("versao", 2);
    },
  },
  {
    variante: "prompt_v2_low",
    versaoPrompt: 2,
    effortOverride: "low",
    async promover(supabaseAdmin) {
      await supabaseAdmin.from("prompts_versoes").update({ ativo: false }).eq("chave", CHAVE_PROMPT).eq("versao", 1);
      await supabaseAdmin
        .from("prompts_versoes")
        .update({ ativo: true, effort: "low" })
        .eq("chave", CHAVE_PROMPT)
        .eq("versao", 2);
    },
  },
];

// ===========================================================================
// Medição por execução
// ===========================================================================

interface MedidaExecucao {
  fixture: string;
  faixa: string;
  variante: string;
  repeticao: number;
  ok: boolean;
  erro?: string;
  custo_usd: number | null;
  tokens_entrada: number | null;
  tokens_saida: number | null;
  tokens_raciocinio: number | null;
  latencia_ms: number | null;
  grau_confianca: number | null;
  completude_score: number | null;
  cobertura_evidencia: number | null;
  ancoragem: number | null;
  frases_nao_localizadas: number | null;
}

interface LinhaExecucaoIa {
  tokens_entrada: number | null;
  tokens_saida: number | null;
  tokens_raciocinio: number | null;
  latencia_ms: number | null;
}

function criarClienteAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes — a bancada precisa de acesso direto ao banco (não é rota HTTP).",
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

async function medirUmaExecucao(
  supabaseAdmin: ReturnType<typeof criarClienteAdmin>,
  fixture: Fixture,
  def: DefinicaoVariante,
  repeticao: number,
): Promise<MedidaExecucao> {
  const base: Omit<MedidaExecucao, "ok" | "erro" | "custo_usd" | "tokens_entrada" | "tokens_saida" | "tokens_raciocinio" | "latencia_ms" | "grau_confianca" | "completude_score" | "cobertura_evidencia" | "ancoragem" | "frases_nao_localizadas"> = {
    fixture: fixture.rotulo,
    faixa: fixture.faixa,
    variante: def.variante,
    repeticao,
  };

  try {
    const resultado = await gerarBriefingSemGravar(supabaseAdmin, {
      jornadaId: fixture.jornada_id,
      criadoPor: null,
      forcarMesmoAssim: true, // a bancada mede TODAS as faixas de completude de propósito, inclusive "pobre"
      versaoPrompt: def.versaoPrompt,
      effortOverride: def.effortOverride,
      variante: def.variante,
      isentoCooldown: true,
    });

    const { data: linhaExecucao } = await supabaseAdmin
      .from("execucoes_ia")
      .select("tokens_entrada, tokens_saida, tokens_raciocinio, latencia_ms")
      .eq("id", resultado.execucaoId)
      .maybeSingle<LinhaExecucaoIa>();

    return {
      ...base,
      ok: true,
      custo_usd: resultado.custoUsd,
      tokens_entrada: linhaExecucao?.tokens_entrada ?? null,
      tokens_saida: linhaExecucao?.tokens_saida ?? null,
      tokens_raciocinio: linhaExecucao?.tokens_raciocinio ?? null,
      latencia_ms: linhaExecucao?.latencia_ms ?? null,
      grau_confianca: resultado.briefing.grau_confianca,
      completude_score: resultado.completude.score,
      cobertura_evidencia: resultado.verificacao.cobertura_evidencia_media,
      ancoragem: resultado.verificacao.ancoragem,
      frases_nao_localizadas: resultado.verificacao.frases_nao_localizadas,
    };
  } catch (erro) {
    return {
      ...base,
      ok: false,
      erro: erro instanceof Error ? erro.message : String(erro),
      custo_usd: null,
      tokens_entrada: null,
      tokens_saida: null,
      tokens_raciocinio: null,
      latencia_ms: null,
      grau_confianca: null,
      completude_score: null,
      cobertura_evidencia: null,
      ancoragem: null,
      frases_nao_localizadas: null,
    };
  }
}

// ===========================================================================
// Agregação e gate (§1.9)
// ===========================================================================

function media(valores: number[]): number | null {
  const validos = valores.filter((v) => Number.isFinite(v));
  if (validos.length === 0) return null;
  return validos.reduce((a, b) => a + b, 0) / validos.length;
}

function desvioPadrao(valores: number[]): number | null {
  const validos = valores.filter((v) => Number.isFinite(v));
  if (validos.length < 2) return null;
  const m = media(validos) as number;
  const variancia = validos.reduce((soma, v) => soma + (v - m) ** 2, 0) / (validos.length - 1);
  return Math.sqrt(variancia);
}

interface AgregadoVariante {
  variante: string;
  execucoes: number;
  falhas: number;
  custo_usd_medio: number | null;
  tokens_saida_medio: number | null;
  tokens_raciocinio_medio: number | null;
  latencia_ms_media: number | null;
  grau_confianca_medio: number | null;
  cobertura_evidencia_media: number | null;
  ancoragem_media: number | null;
  frases_nao_localizadas_total: number;
}

function agregarPorVariante(medidas: MedidaExecucao[], variante: string): AgregadoVariante {
  const doGrupo = medidas.filter((m) => m.variante === variante);
  const ok = doGrupo.filter((m) => m.ok);
  return {
    variante,
    execucoes: doGrupo.length,
    falhas: doGrupo.length - ok.length,
    custo_usd_medio: media(ok.map((m) => m.custo_usd ?? NaN)),
    tokens_saida_medio: media(ok.map((m) => m.tokens_saida ?? NaN)),
    tokens_raciocinio_medio: media(ok.map((m) => m.tokens_raciocinio ?? NaN)),
    latencia_ms_media: media(ok.map((m) => m.latencia_ms ?? NaN)),
    grau_confianca_medio: media(ok.map((m) => m.grau_confianca ?? NaN)),
    cobertura_evidencia_media: media(ok.map((m) => m.cobertura_evidencia ?? NaN)),
    ancoragem_media: media(ok.map((m) => m.ancoragem ?? NaN)),
    frases_nao_localizadas_total: ok.reduce((soma, m) => soma + (m.frases_nao_localizadas ?? 0), 0),
  };
}

interface VereditoGate {
  variante: string;
  promovivel: boolean;
  motivos: string[];
}

/**
 * Gate de promoção (§1.9): custo médio cai; cobertura de evidência e
 * ancoragem não caem além da variância medida do baseline; frases não
 * localizadas não aumentam; grau de confiança médio não cai.
 */
function avaliarGate(baseline: AgregadoVariante, variante: AgregadoVariante, desvioCoberturaBaseline: number, desvioAncoragemBaseline: number): VereditoGate {
  const motivos: string[] = [];

  if (baseline.custo_usd_medio == null || variante.custo_usd_medio == null) {
    motivos.push("custo médio indisponível (execução falhou?) — não dá para avaliar");
  } else if (variante.custo_usd_medio >= baseline.custo_usd_medio) {
    motivos.push(`custo não caiu (baseline US$ ${baseline.custo_usd_medio.toFixed(4)} → variante US$ ${variante.custo_usd_medio.toFixed(4)})`);
  }

  const margemCobertura = Math.max(desvioCoberturaBaseline, 0.02); // piso pequeno p/ baseline com variância ~0
  if (
    baseline.cobertura_evidencia_media != null &&
    variante.cobertura_evidencia_media != null &&
    variante.cobertura_evidencia_media < baseline.cobertura_evidencia_media - margemCobertura
  ) {
    motivos.push("cobertura de evidência caiu além da variância do baseline");
  }

  const margemAncoragem = Math.max(desvioAncoragemBaseline, 0.02);
  if (
    baseline.ancoragem_media != null &&
    variante.ancoragem_media != null &&
    variante.ancoragem_media < baseline.ancoragem_media - margemAncoragem
  ) {
    motivos.push("ancoragem (frases de fechamento localizadas) caiu além da variância do baseline");
  }

  if (variante.frases_nao_localizadas_total > baseline.frases_nao_localizadas_total) {
    motivos.push(
      `frases não localizadas aumentaram (baseline ${baseline.frases_nao_localizadas_total} → variante ${variante.frases_nao_localizadas_total})`,
    );
  }

  if (
    baseline.grau_confianca_medio != null &&
    variante.grau_confianca_medio != null &&
    variante.grau_confianca_medio < baseline.grau_confianca_medio
  ) {
    motivos.push(`grau de confiança médio caiu (baseline ${baseline.grau_confianca_medio.toFixed(1)} → variante ${variante.grau_confianca_medio.toFixed(1)})`);
  }

  if (variante.falhas > 0) {
    motivos.push(`${variante.falhas} execução(ões) falharam — não promovível enquanto houver falha`);
  }

  return { variante: variante.variante, promovivel: motivos.length === 0, motivos };
}

// ===========================================================================
// Relatório (markdown, tmp/bancada/ — gitignored, nunca conteúdo de briefing)
// ===========================================================================

function formatarNumero(valor: number | null, casas = 4): string {
  return valor == null ? "—" : valor.toFixed(casas);
}

function gerarRelatorioMarkdown(
  medidas: MedidaExecucao[],
  agregadosPorFixtureEVariante: Array<{ fixture: string; faixa: string; agregado: AgregadoVariante }>,
  veredito: VereditoGate[],
): string {
  const linhas: string[] = [];
  linhas.push(`# Bancada de IA — Briefing Estratégico`);
  linhas.push(``);
  linhas.push(`Gerado em ${new Date().toISOString()}. ${REPETICOES} repetições por (fixture, variante).`);
  linhas.push(``);
  linhas.push(`## Por fixture e variante`);
  linhas.push(``);
  linhas.push(
    `| fixture | faixa | variante | execuções | falhas | custo US$ médio | tokens saída médio | tokens raciocínio médio | %saída raciocínio | latência s média | grau confiança médio | cobertura evidência | ancoragem | frases não localizadas |`,
  );
  linhas.push(`|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|`);
  for (const { fixture, faixa, agregado: a } of agregadosPorFixtureEVariante) {
    const pctRaciocinio =
      a.tokens_saida_medio && a.tokens_raciocinio_medio ? (a.tokens_raciocinio_medio / a.tokens_saida_medio) * 100 : null;
    linhas.push(
      `| ${fixture} | ${faixa} | ${a.variante} | ${a.execucoes} | ${a.falhas} | ${formatarNumero(a.custo_usd_medio)} | ${formatarNumero(a.tokens_saida_medio, 0)} | ${formatarNumero(a.tokens_raciocinio_medio, 0)} | ${pctRaciocinio == null ? "—" : pctRaciocinio.toFixed(1) + "%"} | ${formatarNumero(a.latencia_ms_media ? a.latencia_ms_media / 1000 : null, 1)} | ${formatarNumero(a.grau_confianca_medio, 1)} | ${formatarNumero(a.cobertura_evidencia_media, 2)} | ${formatarNumero(a.ancoragem_media, 2)} | ${a.frases_nao_localizadas_total} |`,
    );
  }
  linhas.push(``);
  linhas.push(`## Gate de promoção (§1.9) — agregado de todas as fixtures`);
  linhas.push(``);
  linhas.push(`| variante | promovível | motivos |`);
  linhas.push(`|---|---|---|`);
  for (const v of veredito) {
    linhas.push(`| ${v.variante} | ${v.promovivel ? "SIM" : "não"} | ${v.motivos.length ? v.motivos.join("; ") : "—"} |`);
  }
  linhas.push(``);
  linhas.push(`## Execuções com falha`);
  linhas.push(``);
  const falhas = medidas.filter((m) => !m.ok);
  if (falhas.length === 0) {
    linhas.push(`Nenhuma.`);
  } else {
    linhas.push(`| fixture | variante | repetição | erro |`);
    linhas.push(`|---|---|---|---|`);
    for (const f of falhas) {
      linhas.push(`| ${f.fixture} | ${f.variante} | ${f.repeticao} | ${f.erro} |`);
    }
  }
  linhas.push(``);
  return linhas.join("\n");
}

// ===========================================================================
// Main
// ===========================================================================

function lerFixtures(): Fixture[] {
  if (!fs.existsSync(CAMINHO_FIXTURES)) {
    throw new Error(
      `Fixtures não encontradas em ${CAMINHO_FIXTURES}. Crie o arquivo (fora do versionamento — ver §1.9) com ` +
        `[{ "jornada_id": "uuid", "rotulo": "curto", "faixa": "pobre"|"media"|"rica" }, ...], cobrindo as 3 faixas. ` +
        `Nenhuma fixture deve citar jornada com transcrição consentida (B3/B13 — nenhuma das 70 tem consentimento hoje).`,
    );
  }
  const bruto = JSON.parse(fs.readFileSync(CAMINHO_FIXTURES, "utf-8"));
  if (!Array.isArray(bruto) || bruto.length === 0) {
    throw new Error("fixtures.json vazio ou não é um array.");
  }
  return bruto as Fixture[];
}

async function main() {
  const argPromover = process.argv.find((a) => a.startsWith("--promover="))?.split("=")[1];

  const supabaseAdmin = criarClienteAdmin();
  const fixtures = lerFixtures();

  console.log(`Bancada — ${fixtures.length} fixture(s), ${VARIANTES.length} configuração(ões), ${REPETICOES} repetições.`);
  console.log(`Teto de gasto desta rodada: US$ ${ORCAMENTO_MAXIMO_USD}.`);

  const medidas: MedidaExecucao[] = [];
  let gastoAcumulado = 0;

  for (const fixture of fixtures) {
    for (const def of VARIANTES) {
      for (let repeticao = 1; repeticao <= REPETICOES; repeticao++) {
        if (gastoAcumulado >= ORCAMENTO_MAXIMO_USD) {
          console.error(
            `ABORTADO — teto de gasto da rodada (US$ ${ORCAMENTO_MAXIMO_USD}) atingido em US$ ${gastoAcumulado.toFixed(4)}. ` +
              `Resultado parcial ainda é gravado.`,
          );
          break;
        }
        process.stdout.write(`  ${fixture.rotulo} / ${def.variante} / ${repeticao}... `);
        const medida = await medirUmaExecucao(supabaseAdmin, fixture, def, repeticao);
        medidas.push(medida);
        gastoAcumulado += medida.custo_usd ?? 0;
        console.log(medida.ok ? `US$ ${formatarNumero(medida.custo_usd)}` : `FALHOU (${medida.erro})`);
      }
    }
  }

  console.log(`\nGasto total medido: US$ ${gastoAcumulado.toFixed(4)}.`);

  // Agregado por (fixture, variante) — para a tabela.
  const agregadosPorFixtureEVariante = fixtures.flatMap((fixture) =>
    VARIANTES.map((def) => ({
      fixture: fixture.rotulo,
      faixa: fixture.faixa,
      agregado: agregarPorVariante(
        medidas.filter((m) => m.fixture === fixture.rotulo),
        def.variante,
      ),
    })),
  );

  // Gate — agregado de TODAS as fixtures juntas (visão de conjunto, não por fixture isolada).
  const agregadoGeralPorVariante = new Map(VARIANTES.map((def) => [def.variante, agregarPorVariante(medidas, def.variante)]));
  const baselineGeral = agregadoGeralPorVariante.get("baseline")!;
  const desvioCoberturaBaseline = desvioPadrao(medidas.filter((m) => m.variante === "baseline" && m.ok).map((m) => m.cobertura_evidencia ?? NaN)) ?? 0;
  const desvioAncoragemBaseline = desvioPadrao(medidas.filter((m) => m.variante === "baseline" && m.ok).map((m) => m.ancoragem ?? NaN)) ?? 0;

  const veredito: VereditoGate[] = VARIANTES.filter((def) => def.variante !== "baseline").map((def) =>
    avaliarGate(baselineGeral, agregadoGeralPorVariante.get(def.variante)!, desvioCoberturaBaseline, desvioAncoragemBaseline),
  );

  const relatorio = gerarRelatorioMarkdown(medidas, agregadosPorFixtureEVariante, veredito);
  fs.mkdirSync(DIR_BANCADA, { recursive: true });
  const caminhoRelatorio = path.join(DIR_BANCADA, `resultado-${Date.now()}.md`);
  fs.writeFileSync(caminhoRelatorio, relatorio, "utf-8");
  console.log(`\nRelatório: ${caminhoRelatorio}`);

  for (const v of veredito) {
    console.log(`  ${v.variante}: ${v.promovivel ? "PROMOVÍVEL" : "não promovível"}${v.motivos.length ? " — " + v.motivos.join("; ") : ""}`);
  }

  if (argPromover) {
    const def = VARIANTES.find((v) => v.variante === argPromover);
    if (!def) {
      console.error(`--promover=${argPromover}: variante desconhecida. Opções: ${VARIANTES.map((v) => v.variante).join(", ")}.`);
      process.exit(1);
    }
    const v = veredito.find((x) => x.variante === argPromover);
    if (!v?.promovivel) {
      console.error(`--promover=${argPromover}: gate NÃO passou (${v?.motivos.join("; ") ?? "sem dados"}). Promoção recusada.`);
      process.exit(1);
    }
    console.log(`Promovendo ${argPromover}...`);
    await def.promover(supabaseAdmin);
    console.log(`Promovido. Reversão: UPDATE prompts_versoes SET ativo = (versao = 1) WHERE chave = '${CHAVE_PROMPT}'; (e, se aplicável, SET effort de volta a 'high').`);
  }
}

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
