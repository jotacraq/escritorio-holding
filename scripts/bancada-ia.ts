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
 *   npx tsx scripts/bancada-ia.ts --so-bytes         # SÓ mede bytes de contexto antes/depois (Fase 4) — ZERO chamada de IA
 *   npx tsx scripts/bancada-ia.ts --variantes=baseline,v3_fontes   # restringe a matriz (gasto menor)
 *   npx tsx scripts/bancada-ia.ts --promover=effort_low
 *   npx tsx scripts/bancada-ia.ts --promover=prompt_v2
 *   npx tsx scripts/bancada-ia.ts --promover=prompt_v2_low
 *   npx tsx scripts/bancada-ia.ts --variantes=baseline,v3_fontes --promover=v3_fontes   # Fase 4, §5.3
 *
 * FASE 4 (ARQUITETURA-FASE-4.md §5.2/§5.3): a mesma bancada mede
 *   (1) bytes do contexto ANTES (sem seminário/CNPJ/ligação IA/L7) e DEPOIS
 *       (todas as fontes) por fixture — `montarContextoBriefing(...,
 *       {fontesEstendidas:false|true})`, sem IA, custo zero. Meta do §5.2:
 *       crescimento ≤ 25 % com todas as fontes presentes;
 *   (2) as variantes `v3_fontes` (prompt v3 da 0059, inativo) e
 *       `v3_fontes_low` contra o `baseline` (prompt ativo). O gate é o mesmo
 *       do §1.9; para a v3 a leitura honesta é: custo médio ≤ US$ 0,045 e
 *       `expressoes_nao_localizadas` = 0 (toda expressão literal achada no
 *       material). Custo estimado da rodada mínima (3 fixtures × 2 variantes ×
 *       3 repetições × ~US$ 0,045) ≈ US$ 0,81 — abaixo do teto de US$ 5.
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
import { montarContextoBriefing } from "../src/server/ia/contexto-briefing";
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
  // Fase 4 (0059): v3 = todas as fontes + `linguagem_do_cliente`. Nasce
  // inativa; promover = desativar TODAS as outras versões da chave (índice
  // único `uniq_prompt_ativo`) e ativar a 3. `effort` da v3 na migration é
  // 'low' (o ponto de operação medido em 04/09) — `v3_fontes_low` só existe
  // para medir a v3 com effort forçado caso alguém tenha subido o da linha.
  {
    variante: "v3_fontes",
    versaoPrompt: 3,
    async promover(supabaseAdmin) {
      await supabaseAdmin.from("prompts_versoes").update({ ativo: false }).eq("chave", CHAVE_PROMPT).neq("versao", 3);
      await supabaseAdmin.from("prompts_versoes").update({ ativo: true }).eq("chave", CHAVE_PROMPT).eq("versao", 3);
    },
  },
  {
    variante: "v3_fontes_low",
    versaoPrompt: 3,
    effortOverride: "low",
    async promover(supabaseAdmin) {
      await supabaseAdmin.from("prompts_versoes").update({ ativo: false }).eq("chave", CHAVE_PROMPT).neq("versao", 3);
      await supabaseAdmin
        .from("prompts_versoes")
        .update({ ativo: true, effort: "low" })
        .eq("chave", CHAVE_PROMPT)
        .eq("versao", 3);
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
  /** Fase 4: expressões de `linguagem_do_cliente` não achadas no material (v3); 0 em v1/v2. */
  expressoes_nao_localizadas: number | null;
  /** `JSON.stringify(contexto).length` da execução — entrada real que foi para o modelo. */
  bytes_contexto: number | null;
  prompt_versao: number | null;
}

/** Fase 4 §5.2 — bytes do contexto por fixture, sem IA. */
interface MedidaBytesContexto {
  fixture: string;
  faixa: string;
  bytes_antes: number;
  bytes_depois: number;
  crescimento_pct: number;
  fontes_depois: string[];
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
  const base: Pick<MedidaExecucao, "fixture" | "faixa" | "variante" | "repeticao"> = {
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
      expressoes_nao_localizadas: resultado.verificacao.expressoes_nao_localizadas,
      bytes_contexto: resultado.bytesContexto,
      prompt_versao: resultado.promptVersao,
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
      expressoes_nao_localizadas: null,
      bytes_contexto: null,
      prompt_versao: null,
    };
  }
}

/**
 * Fase 4 §5.2 — bytes do contexto ANTES/DEPOIS das fontes novas, por fixture.
 * Só leitura de banco; ZERO chamada de IA. É o número que vai no comentário
 * da 0059 ("entrada não cresce mais de 25 % com todas as fontes presentes").
 */
async function medirBytesContexto(
  supabaseAdmin: ReturnType<typeof criarClienteAdmin>,
  fixture: Fixture,
): Promise<MedidaBytesContexto> {
  const antes = await montarContextoBriefing(supabaseAdmin, fixture.jornada_id, { fontesEstendidas: false });
  const depois = await montarContextoBriefing(supabaseAdmin, fixture.jornada_id, { fontesEstendidas: true });
  const bytesAntes = JSON.stringify(antes.contexto).length;
  const bytesDepois = JSON.stringify(depois.contexto).length;
  return {
    fixture: fixture.rotulo,
    faixa: fixture.faixa,
    bytes_antes: bytesAntes,
    bytes_depois: bytesDepois,
    crescimento_pct: bytesAntes > 0 ? ((bytesDepois - bytesAntes) / bytesAntes) * 100 : 0,
    fontes_depois: depois.fontesUsadas,
  };
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
  expressoes_nao_localizadas_total: number;
  bytes_contexto_medio: number | null;
  tokens_entrada_medio: number | null;
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
    expressoes_nao_localizadas_total: ok.reduce((soma, m) => soma + (m.expressoes_nao_localizadas ?? 0), 0),
    bytes_contexto_medio: media(ok.map((m) => m.bytes_contexto ?? NaN)),
    tokens_entrada_medio: media(ok.map((m) => m.tokens_entrada ?? NaN)),
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
  bytesContexto: MedidaBytesContexto[],
): string {
  const linhas: string[] = [];
  linhas.push(`# Bancada de IA — Briefing Estratégico`);
  linhas.push(``);
  linhas.push(`Gerado em ${new Date().toISOString()}. ${REPETICOES} repetições por (fixture, variante).`);
  linhas.push(``);
  linhas.push(`## Bytes do contexto — antes/depois das fontes da Fase 4 (sem IA; meta §5.2: ≤ +25 %)`);
  linhas.push(``);
  linhas.push(`| fixture | faixa | bytes antes | bytes depois | crescimento | fontes depois |`);
  linhas.push(`|---|---|---:|---:|---:|---|`);
  for (const b of bytesContexto) {
    linhas.push(
      `| ${b.fixture} | ${b.faixa} | ${b.bytes_antes} | ${b.bytes_depois} | ${b.crescimento_pct.toFixed(1)}% | ${b.fontes_depois.join(", ") || "—"} |`,
    );
  }
  linhas.push(``);
  if (medidas.length === 0) return linhas.join("\n");
  linhas.push(`## Por fixture e variante`);
  linhas.push(``);
  linhas.push(
    `| fixture | faixa | variante | prompt v | execuções | falhas | custo US$ médio | tokens entrada médio | tokens saída médio | tokens raciocínio médio | %saída raciocínio | latência s média | grau confiança médio | cobertura evidência | ancoragem | frases não localizadas | expressões não localizadas | bytes contexto |`,
  );
  linhas.push(`|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|`);
  for (const { fixture, faixa, agregado: a } of agregadosPorFixtureEVariante) {
    const pctRaciocinio =
      a.tokens_saida_medio && a.tokens_raciocinio_medio ? (a.tokens_raciocinio_medio / a.tokens_saida_medio) * 100 : null;
    const promptVersao = medidas.find((m) => m.variante === a.variante && m.ok)?.prompt_versao ?? null;
    linhas.push(
      `| ${fixture} | ${faixa} | ${a.variante} | ${promptVersao ?? "—"} | ${a.execucoes} | ${a.falhas} | ${formatarNumero(a.custo_usd_medio)} | ${formatarNumero(a.tokens_entrada_medio, 0)} | ${formatarNumero(a.tokens_saida_medio, 0)} | ${formatarNumero(a.tokens_raciocinio_medio, 0)} | ${pctRaciocinio == null ? "—" : pctRaciocinio.toFixed(1) + "%"} | ${formatarNumero(a.latencia_ms_media ? a.latencia_ms_media / 1000 : null, 1)} | ${formatarNumero(a.grau_confianca_medio, 1)} | ${formatarNumero(a.cobertura_evidencia_media, 2)} | ${formatarNumero(a.ancoragem_media, 2)} | ${a.frases_nao_localizadas_total} | ${a.expressoes_nao_localizadas_total} | ${formatarNumero(a.bytes_contexto_medio, 0)} |`,
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
  const argVariantes = process.argv.find((a) => a.startsWith("--variantes="))?.split("=")[1];
  const soBytes = process.argv.includes("--so-bytes");

  // `--variantes=a,b` restringe a matriz (menos gasto). `baseline` entra
  // sempre: sem ele não há gate. Nome desconhecido aborta antes de gastar.
  const nomesPedidos = argVariantes ? argVariantes.split(",").map((v) => v.trim()).filter(Boolean) : null;
  if (nomesPedidos) {
    const desconhecidas = nomesPedidos.filter((n) => !VARIANTES.some((v) => v.variante === n));
    if (desconhecidas.length > 0) {
      console.error(`--variantes: desconhecida(s): ${desconhecidas.join(", ")}. Opções: ${VARIANTES.map((v) => v.variante).join(", ")}.`);
      process.exit(1);
    }
  }
  const variantes = nomesPedidos
    ? VARIANTES.filter((v) => v.variante === "baseline" || nomesPedidos.includes(v.variante))
    : VARIANTES;

  const supabaseAdmin = criarClienteAdmin();
  const fixtures = lerFixtures();

  // Fase 4 §5.2 — sempre, e sem IA: bytes de contexto antes/depois por fixture.
  console.log(`Bytes do contexto (sem IA) — ${fixtures.length} fixture(s):`);
  const bytesContexto: MedidaBytesContexto[] = [];
  for (const fixture of fixtures) {
    const b = await medirBytesContexto(supabaseAdmin, fixture);
    bytesContexto.push(b);
    console.log(`  ${b.fixture} (${b.faixa}): ${b.bytes_antes} → ${b.bytes_depois} bytes (${b.crescimento_pct >= 0 ? "+" : ""}${b.crescimento_pct.toFixed(1)}%) · fontes: ${b.fontes_depois.join(", ") || "—"}`);
  }

  if (soBytes) {
    const relatorioBytes = gerarRelatorioMarkdown([], [], [], bytesContexto);
    fs.mkdirSync(DIR_BANCADA, { recursive: true });
    const caminho = path.join(DIR_BANCADA, `bytes-contexto-${Date.now()}.md`);
    fs.writeFileSync(caminho, relatorioBytes, "utf-8");
    console.log(`\n--so-bytes: nenhuma chamada de IA feita. Relatório: ${caminho}`);
    return;
  }

  console.log(`\nBancada — ${fixtures.length} fixture(s), ${variantes.length} configuração(ões) [${variantes.map((v) => v.variante).join(", ")}], ${REPETICOES} repetições.`);
  console.log(`Teto de gasto desta rodada: US$ ${ORCAMENTO_MAXIMO_USD}.`);

  const medidas: MedidaExecucao[] = [];
  let gastoAcumulado = 0;

  for (const fixture of fixtures) {
    for (const def of variantes) {
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
    variantes.map((def) => ({
      fixture: fixture.rotulo,
      faixa: fixture.faixa,
      agregado: agregarPorVariante(
        medidas.filter((m) => m.fixture === fixture.rotulo),
        def.variante,
      ),
    })),
  );

  // Gate — agregado de TODAS as fixtures juntas (visão de conjunto, não por fixture isolada).
  const agregadoGeralPorVariante = new Map(variantes.map((def) => [def.variante, agregarPorVariante(medidas, def.variante)]));
  const baselineGeral = agregadoGeralPorVariante.get("baseline")!;
  const desvioCoberturaBaseline = desvioPadrao(medidas.filter((m) => m.variante === "baseline" && m.ok).map((m) => m.cobertura_evidencia ?? NaN)) ?? 0;
  const desvioAncoragemBaseline = desvioPadrao(medidas.filter((m) => m.variante === "baseline" && m.ok).map((m) => m.ancoragem ?? NaN)) ?? 0;

  const veredito: VereditoGate[] = variantes.filter((def) => def.variante !== "baseline").map((def) =>
    avaliarGate(baselineGeral, agregadoGeralPorVariante.get(def.variante)!, desvioCoberturaBaseline, desvioAncoragemBaseline),
  );

  const relatorio = gerarRelatorioMarkdown(medidas, agregadosPorFixtureEVariante, veredito, bytesContexto);
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
