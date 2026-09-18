/**
 * scripts/bancada-copiloto.ts
 *
 * Bancada de REPLAY do Copiloto ao Vivo — compara `copiloto_sessao` v7
 * (ativa) contra v8 (`ativo=false`, v7 + seção "ECONOMIA DE RACIOCÍNIO")
 * sobre transcrição REAL de uma sessão já encerrada, e imprime tabela
 * comparativa. NÃO promove nada sozinho — nunca escreve `prompts_versoes`.
 *
 * POR QUE EXISTE: medido em produção na v7 (299 execuções): 16,4% de falha
 * por `stop_reason=max_tokens`, latência média 9,5s, saída média 691 tokens
 * dos quais ~461 são raciocínio (~50%), custo US$ 0,0135/chamada. A v8
 * precisa de número medido, lado a lado, antes de ativar — não de dedução.
 *
 * FONTE DE DADOS: replay real, não fixture inventada. Sessão
 * `b3eca233-a6fb-4a82-a6f8-ac5c38d7f553` (Carlos Alberto, 2.432 segmentos em
 * `sessoes_copiloto_segmentos`). As janelas de transcrição são reconstruídas
 * pela MESMA regra do runtime (`server/copiloto/contexto.ts`,
 * `montarJanelaTranscricaoDeSegmentos` — extraída de `buscarJanelaTranscricao`
 * de propósito para este reuso, com teste próprio em `contexto.test.ts`):
 * `JANELA_TRANSCRICAO_SEGUNDOS=90`, `MAX_SEGMENTOS_JANELA=40`, falante já
 * mapeado para PAPEL (nunca nome — §7 do plano; `rotuloFalante`).
 *
 * O resto do contexto (bloco A roteiro, B briefing, C estado factual, F
 * dossiê, G inventário) vem de `montarContextoCopiloto` da MESMA sessão —
 * é o estado real da sessão (não um sintético) — com `janela_transcricao`
 * SUBSTITUÍDA pela reconstrução do ponto de amostragem: rodar o contexto
 * inteiro do jeito que o runtime monta, ancorado em 12 instantes diferentes
 * da sessão em vez de só "agora", é o que dá cobertura de conversa rasa e
 * densa ao longo da sessão inteira — não um só recorte do fim.
 *
 * MODO DE USO:
 *   npx tsx scripts/bancada-copiloto.ts                          # 12 janelas, v7_baseline + v8_economia, 2 repetições
 *   npx tsx scripts/bancada-copiloto.ts --janelas=4               # rodada menor (gasto menor)
 *   npx tsx scripts/bancada-copiloto.ts --variantes=v7_baseline   # só uma variante (ex.: reconferir baseline sozinho)
 *
 * NUNCA PROMOVE: imprime a tabela e, se v8 vencer o gate, imprime o SQL de
 * ativação para o humano rodar — não existe `--aplicar` que ative prompt.
 *
 * TETO DE GASTO: 12 janelas × 2 variantes × 2 repetições × ~US$0,0135 ≈
 * US$0,65 — abaixo do teto `ORCAMENTO_MAXIMO_USD` (US$ 3) desta rodada.
 *
 * PII (regra não negociável desta bancada): a transcrição contém patrimônio
 * e família reais. Este script NUNCA grava transcrição em arquivo e NUNCA
 * imprime trecho de fala no stdout — só números agregados. O relatório em
 * `tmp/bancada-copiloto/` (fora do versionamento) segue a mesma regra.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { montarContextoCopiloto, montarJanelaTranscricaoDeSegmentos, montarMapaDePapeis, papeisDeFalaEstaoAtivos, type SegmentoJanela } from "@/server/copiloto/contexto";
import { executarIaCopiloto } from "@/server/copiloto/executar-ia";
import { CHAVE_PROMPT_COPILOTO } from "@/server/copiloto/orcamento";
import type { ContextoCopiloto } from "@/types/copiloto";

// ===========================================================================
// Config
// ===========================================================================

const SESSAO_ID = "b3eca233-a6fb-4a82-a6f8-ac5c38d7f553"; // Carlos Alberto — sessão real encerrada
const REPETICOES = 2;
const PADRAO_NUM_JANELAS = 12;
/** Teto de gasto TOTAL da rodada — aborta se ultrapassar (protocolo de sustentabilidade). */
const ORCAMENTO_MAXIMO_USD = 3;
const DIR_BANCADA = path.resolve(process.cwd(), "tmp/bancada-copiloto");

interface DefinicaoVariante {
  variante: string;
  versaoPrompt?: number;
}

const VARIANTES: DefinicaoVariante[] = [
  { variante: "v7_baseline" }, // sem versaoPrompt: usa a versão ATIVA (v7) — mesma convenção de bancada-ia.ts
  { variante: "v8_economia", versaoPrompt: 8 },
  // v9 = v8 + memória do copiloto (0121). É a que precisa de número ANTES de
  // escrever a Ficha do cliente: se a economia de raciocínio da v8 derrubar o
  // p99 de saída (hoje 1.382 contra teto de 1.400 — 18 tokens de folga), a
  // Ficha cabe sem mexer em `max_tokens`. Se não derrubar, a Ficha sobe
  // derivada no servidor, sem campo novo. Medir isto é mais barato que
  // escrever a feature e descobrir depois.
  { variante: "v9_memoria", versaoPrompt: 9 },
];

function criarClienteAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes — a bancada precisa de acesso direto ao banco (não é rota HTTP).",
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

// ===========================================================================
// Amostragem de janelas — 12 pontos distribuídos ao longo da sessão
// ===========================================================================

interface PontoAmostrado {
  rotulo: string;
  /** Índice do segmento de referência dentro do array ordenado — a janela é
   * ancorada no `criado_em` deste segmento (`agora` da reconstrução). */
  indiceReferencia: number;
}

/**
 * ~12 janelas distribuídas por ÍNDICE de segmento (não por tempo corrido) —
 * cobre início/meio/fim da sessão em proporção fixa, robusto a trechos de
 * silêncio (sem segmento) que distorceriam uma distribuição por tempo.
 * Rotulado por posição relativa (0-100%) — NUNCA por conteúdo de fala.
 */
function amostrarPontos(totalSegmentos: number, numJanelas: number): PontoAmostrado[] {
  if (totalSegmentos === 0) return [];
  const n = Math.min(numJanelas, totalSegmentos);
  const pontos: PontoAmostrado[] = [];
  for (let i = 0; i < n; i++) {
    // Distribuição uniforme 0..totalSegmentos-1, incluindo as duas pontas.
    const posicao = n === 1 ? 0 : Math.round((i * (totalSegmentos - 1)) / (n - 1));
    const pct = Math.round((posicao / Math.max(totalSegmentos - 1, 1)) * 100);
    pontos.push({ rotulo: `seg#${posicao} (~${pct}%)`, indiceReferencia: posicao });
  }
  return pontos;
}

// ===========================================================================
// Carga da sessão real (uma vez) — segmentos NUNCA saem desta função em texto
// ===========================================================================

async function carregarSegmentosOrdenados(admin: SupabaseClient, sessaoId: string): Promise<SegmentoJanela[]> {
  // Sessão encerrada e de tamanho conhecido (~2.432 linhas) — sem paginação
  // full-table: 1 SELECT com `order by ordem`, mesmo índice do caminho quente
  // (`idx_copiloto_segmentos_polling (sessao_id, ordem)`), filtrado por
  // `sessao_id` único. Não é varredura sem teto: é a leitura completa de UMA
  // sessão já finalizada, uma única vez no início da rodada.
  const { data, error } = await admin
    .from("sessoes_copiloto_segmentos")
    .select("falante, texto, criado_em")
    .eq("sessao_id", sessaoId)
    .order("ordem", { ascending: true })
    .returns<SegmentoJanela[]>();
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error(`Sessão ${sessaoId} não tem segmentos em sessoes_copiloto_segmentos — replay impossível.`);
  }
  return data;
}

async function buscarJornadaDaSessao(admin: SupabaseClient, sessaoId: string): Promise<string> {
  const { data, error } = await admin
    .from("sessoes_viabilidade")
    .select("jornada_id")
    .eq("id", sessaoId)
    .maybeSingle<{ jornada_id: string }>();
  if (error) throw error;
  if (!data) throw new Error(`Sessão ${sessaoId} não encontrada em sessoes_viabilidade.`);
  return data.jornada_id;
}

/**
 * Contexto completo da sessão (blocos A/B/C/F/G reais, via
 * `montarContextoCopiloto`) com a `janela_transcricao` (bloco D) SUBSTITUÍDA
 * pela reconstrução ancorada no ponto amostrado — é o replay: mesmo estado
 * estrutural da sessão, fala do INSTANTE medido em vez de "agora".
 * `indiceBlocoAtual=0` (mesma simplificação usada pela bancada do briefing:
 * o objetivo é medir o prompt sobre conteúdo real, não reencenar em qual
 * bloco do roteiro a advogada estava naquele instante exato — informação que
 * não fica registrada por segmento).
 */
async function montarContextoDoPontoAmostrado(
  admin: SupabaseClient,
  params: { sessaoId: string; segmentosOrdenados: SegmentoJanela[]; ponto: PontoAmostrado },
): Promise<ContextoCopiloto> {
  const { contexto: contextoBase } = await montarContextoCopiloto(admin, params.sessaoId, 0);

  const papeisAtivos = await papeisDeFalaEstaoAtivos(admin);
  // O mapa de papéis depende de `sessoes_copiloto.participantes`, que
  // `montarContextoCopiloto` já leu — reconsultamos aqui só o necessário
  // (mesma tabela, 1 SELECT leve) para reconstruir o mapa sem duplicar a
  // regra de resolução de papel dentro deste script.
  const { data: sessaoCopiloto } = await admin
    .from("sessoes_copiloto")
    .select("participantes")
    .eq("sessao_id", params.sessaoId)
    .maybeSingle<{ participantes: unknown }>();
  const mapaDePapeis = papeisAtivos ? montarMapaDePapeis(sessaoCopiloto?.participantes) : null;

  const segmentoReferencia = params.segmentosOrdenados[params.ponto.indiceReferencia];
  if (!segmentoReferencia) throw new Error(`Índice de amostragem fora da faixa: ${params.ponto.indiceReferencia}`);
  const agora = new Date(segmentoReferencia.criado_em).getTime();

  const janelaReplay = montarJanelaTranscricaoDeSegmentos(params.segmentosOrdenados, mapaDePapeis, { agora });

  return { ...contextoBase, janela_transcricao: janelaReplay };
}

// ===========================================================================
// Medição por execução
// ===========================================================================

interface LinhaExecucaoIa {
  status: string;
  stop_reason: string | null;
  latencia_ms: number | null;
  tokens_saida: number | null;
  tokens_raciocinio: number | null;
  custo_usd: number | null;
}

interface MedidaExecucao {
  ponto: string;
  variante: string;
  repeticao: number;
  ok: boolean;
  timeout: boolean;
  falhouPorMaxTokens: boolean;
  motivo?: string;
  custo_usd: number | null;
  latencia_ms: number | null;
  tokens_saida: number | null;
  tokens_raciocinio: number | null;
  proxima_pergunta_preenchida: boolean | null;
  observacao_evidencia_preenchida: boolean | null;
  itens_inventario_mencionado: number | null;
  confianca_geral: number | null;
}

async function medirUmaExecucao(
  admin: SupabaseClient,
  params: { jornadaId: string; contexto: ContextoCopiloto; def: DefinicaoVariante; ponto: string; repeticao: number },
): Promise<MedidaExecucao> {
  const base = { ponto: params.ponto, variante: params.def.variante, repeticao: params.repeticao };

  const resultado = await executarIaCopiloto(admin, {
    jornadaId: params.jornadaId,
    contexto: params.contexto,
    versaoPrompt: params.def.versaoPrompt,
    variante: params.def.variante,
  });

  if (resultado.situacao === "timeout") {
    return {
      ...base,
      ok: false,
      timeout: true,
      falhouPorMaxTokens: false,
      motivo: "timeout_8s",
      custo_usd: null,
      latencia_ms: null,
      tokens_saida: null,
      tokens_raciocinio: null,
      proxima_pergunta_preenchida: null,
      observacao_evidencia_preenchida: null,
      itens_inventario_mencionado: null,
      confianca_geral: null,
    };
  }

  if (resultado.situacao === "indisponivel") {
    return {
      ...base,
      ok: false,
      timeout: false,
      falhouPorMaxTokens: false,
      motivo: resultado.motivo,
      custo_usd: null,
      latencia_ms: null,
      tokens_saida: null,
      tokens_raciocinio: null,
      proxima_pergunta_preenchida: null,
      observacao_evidencia_preenchida: null,
      itens_inventario_mencionado: null,
      confianca_geral: null,
    };
  }

  // situacao === "ok" — busca a linha de auditoria para latência/tokens/stop_reason.
  const { data: linha } = await admin
    .from("execucoes_ia")
    .select("status, stop_reason, latencia_ms, tokens_saida, tokens_raciocinio, custo_usd")
    .eq("id", resultado.execucaoId)
    .maybeSingle<LinhaExecucaoIa>();

  return {
    ...base,
    ok: true,
    timeout: false,
    falhouPorMaxTokens: linha?.stop_reason === "max_tokens",
    custo_usd: resultado.custoUsd,
    latencia_ms: linha?.latencia_ms ?? null,
    tokens_saida: linha?.tokens_saida ?? null,
    tokens_raciocinio: linha?.tokens_raciocinio ?? null,
    proxima_pergunta_preenchida: resultado.saida.proxima_pergunta?.texto != null,
    observacao_evidencia_preenchida: resultado.saida.observacao?.evidencia != null,
    itens_inventario_mencionado: resultado.saida.inventario_mencionado.length,
    confianca_geral: resultado.saida.confianca_geral,
  };
}

// ===========================================================================
// Agregação
// ===========================================================================

function media(valores: number[]): number | null {
  const validos = valores.filter((v) => Number.isFinite(v));
  if (validos.length === 0) return null;
  return validos.reduce((a, b) => a + b, 0) / validos.length;
}

function percentil95(valores: number[]): number | null {
  const validos = valores.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (validos.length === 0) return null;
  const indice = Math.min(validos.length - 1, Math.ceil(0.95 * validos.length) - 1);
  return validos[indice]!;
}

function pctVerdadeiro(valores: Array<boolean | null>): number | null {
  const validos = valores.filter((v): v is boolean => v !== null);
  if (validos.length === 0) return null;
  return (validos.filter(Boolean).length / validos.length) * 100;
}

interface AgregadoVariante {
  variante: string;
  execucoes: number;
  falhas: number;
  falhasMaxTokens: number;
  taxaFalhaPct: number;
  taxaFalhaMaxTokensPct: number;
  latenciaMedia: number | null;
  latenciaP95: number | null;
  tokensSaidaMedio: number | null;
  tokensRaciocinioMedio: number | null;
  pctSaidaEmRaciocinio: number | null;
  custoMedio: number | null;
  pctProximaPerguntaPreenchida: number | null;
  pctObservacaoEvidenciaPreenchida: number | null;
  itensInventarioMedio: number | null;
  confiancaGeralMedia: number | null;
}

function agregarPorVariante(medidas: MedidaExecucao[], variante: string): AgregadoVariante {
  const doGrupo = medidas.filter((m) => m.variante === variante);
  const ok = doGrupo.filter((m) => m.ok);
  const falhas = doGrupo.length - ok.length;
  const falhasMaxTokens = doGrupo.filter((m) => m.falhouPorMaxTokens).length;
  const tokensSaidaMedio = media(ok.map((m) => m.tokens_saida ?? NaN));
  const tokensRaciocinioMedio = media(ok.map((m) => m.tokens_raciocinio ?? NaN));

  return {
    variante,
    execucoes: doGrupo.length,
    falhas,
    falhasMaxTokens,
    taxaFalhaPct: doGrupo.length > 0 ? (falhas / doGrupo.length) * 100 : 0,
    taxaFalhaMaxTokensPct: doGrupo.length > 0 ? (falhasMaxTokens / doGrupo.length) * 100 : 0,
    latenciaMedia: media(ok.map((m) => m.latencia_ms ?? NaN)),
    latenciaP95: percentil95(ok.map((m) => m.latencia_ms ?? NaN)),
    tokensSaidaMedio,
    tokensRaciocinioMedio,
    pctSaidaEmRaciocinio: tokensSaidaMedio && tokensRaciocinioMedio ? (tokensRaciocinioMedio / tokensSaidaMedio) * 100 : null,
    custoMedio: media(ok.map((m) => m.custo_usd ?? NaN)),
    pctProximaPerguntaPreenchida: pctVerdadeiro(ok.map((m) => m.proxima_pergunta_preenchida)),
    pctObservacaoEvidenciaPreenchida: pctVerdadeiro(ok.map((m) => m.observacao_evidencia_preenchida)),
    itensInventarioMedio: media(ok.map((m) => m.itens_inventario_mencionado ?? NaN)),
    confiancaGeralMedia: media(ok.map((m) => m.confianca_geral ?? NaN)),
  };
}

// ===========================================================================
// Gate de leitura (qualidade não pode cair para ganhar velocidade) — só
// IMPRIME o veredito e o SQL de ativação; nunca executa a promoção.
// ===========================================================================

interface VereditoGate {
  variante: string;
  favoravel: boolean;
  motivos: string[];
}

function avaliarGate(baseline: AgregadoVariante, variante: AgregadoVariante): VereditoGate {
  const motivos: string[] = [];

  if (variante.taxaFalhaPct > baseline.taxaFalhaPct) {
    motivos.push(`taxa de falha piorou (${baseline.taxaFalhaPct.toFixed(1)}% → ${variante.taxaFalhaPct.toFixed(1)}%)`);
  }
  if (variante.taxaFalhaMaxTokensPct > baseline.taxaFalhaMaxTokensPct) {
    motivos.push(`falha por max_tokens piorou (${baseline.taxaFalhaMaxTokensPct.toFixed(1)}% → ${variante.taxaFalhaMaxTokensPct.toFixed(1)}%)`);
  }
  if (
    baseline.pctProximaPerguntaPreenchida != null &&
    variante.pctProximaPerguntaPreenchida != null &&
    variante.pctProximaPerguntaPreenchida < baseline.pctProximaPerguntaPreenchida
  ) {
    motivos.push(`% com proxima_pergunta caiu (${baseline.pctProximaPerguntaPreenchida.toFixed(1)}% → ${variante.pctProximaPerguntaPreenchida.toFixed(1)}%)`);
  }
  if (
    baseline.pctObservacaoEvidenciaPreenchida != null &&
    variante.pctObservacaoEvidenciaPreenchida != null &&
    variante.pctObservacaoEvidenciaPreenchida < baseline.pctObservacaoEvidenciaPreenchida
  ) {
    motivos.push(
      `% com observacao.evidencia caiu (${baseline.pctObservacaoEvidenciaPreenchida.toFixed(1)}% → ${variante.pctObservacaoEvidenciaPreenchida.toFixed(1)}%) — quebra a disciplina de evidência da casa`,
    );
  }
  if (
    baseline.confiancaGeralMedia != null &&
    variante.confiancaGeralMedia != null &&
    variante.confiancaGeralMedia < baseline.confiancaGeralMedia
  ) {
    motivos.push(`confiança geral média caiu (${baseline.confiancaGeralMedia.toFixed(2)} → ${variante.confiancaGeralMedia.toFixed(2)})`);
  }
  if (baseline.custoMedio != null && variante.custoMedio != null && variante.custoMedio >= baseline.custoMedio) {
    motivos.push(`custo não caiu (US$ ${baseline.custoMedio.toFixed(4)} → US$ ${variante.custoMedio.toFixed(4)})`);
  }

  return { variante: variante.variante, favoravel: motivos.length === 0, motivos };
}

// ===========================================================================
// Relatório (markdown, tmp/bancada-copiloto/ — gitignored). SÓ números
// agregados — nenhuma fala, nenhum trecho de transcrição.
// ===========================================================================

function fmt(valor: number | null, casas = 2): string {
  return valor == null ? "—" : valor.toFixed(casas);
}

function gerarRelatorioMarkdown(
  agregadosPorPontoEVariante: Array<{ ponto: string; agregado: AgregadoVariante }>,
  agregadoGeral: AgregadoVariante[],
  veredito: VereditoGate[],
): string {
  const linhas: string[] = [];
  linhas.push(`# Bancada do Copiloto — v7 (baseline) × v8 (economia de raciocínio)`);
  linhas.push(``);
  linhas.push(`Gerado em ${new Date().toISOString()}. Sessão de replay: ${SESSAO_ID} (Carlos Alberto). ${REPETICOES} repetições por (janela, variante).`);
  linhas.push(``);
  linhas.push(`## Agregado GERAL (todas as janelas)`);
  linhas.push(``);
  linhas.push(
    `| variante | execuções | falhas | falha max_tokens | latência média (ms) | latência p95 (ms) | tokens saída médio | tokens raciocínio médio | % saída raciocínio | custo US$ médio | % próx. pergunta | % evidência | itens inventário médio | confiança geral média |`,
  );
  linhas.push(`|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|`);
  for (const a of agregadoGeral) {
    linhas.push(
      `| ${a.variante} | ${a.execucoes} | ${a.falhas} (${a.taxaFalhaPct.toFixed(1)}%) | ${a.falhasMaxTokens} (${a.taxaFalhaMaxTokensPct.toFixed(1)}%) | ${fmt(a.latenciaMedia, 0)} | ${fmt(a.latenciaP95, 0)} | ${fmt(a.tokensSaidaMedio, 0)} | ${fmt(a.tokensRaciocinioMedio, 0)} | ${a.pctSaidaEmRaciocinio == null ? "—" : a.pctSaidaEmRaciocinio.toFixed(1) + "%"} | ${fmt(a.custoMedio, 4)} | ${a.pctProximaPerguntaPreenchida == null ? "—" : a.pctProximaPerguntaPreenchida.toFixed(1) + "%"} | ${a.pctObservacaoEvidenciaPreenchida == null ? "—" : a.pctObservacaoEvidenciaPreenchida.toFixed(1) + "%"} | ${fmt(a.itensInventarioMedio, 1)} | ${fmt(a.confiancaGeralMedia, 2)} |`,
    );
  }
  linhas.push(``);
  linhas.push(`## Por janela amostrada e variante`);
  linhas.push(``);
  linhas.push(`| janela | variante | execuções | falhas | latência média (ms) | tokens saída médio | % saída raciocínio | custo US$ médio | confiança geral média |`);
  linhas.push(`|---|---|---:|---:|---:|---:|---:|---:|---:|`);
  for (const { ponto, agregado: a } of agregadosPorPontoEVariante) {
    linhas.push(
      `| ${ponto} | ${a.variante} | ${a.execucoes} | ${a.falhas} | ${fmt(a.latenciaMedia, 0)} | ${fmt(a.tokensSaidaMedio, 0)} | ${a.pctSaidaEmRaciocinio == null ? "—" : a.pctSaidaEmRaciocinio.toFixed(1) + "%"} | ${fmt(a.custoMedio, 4)} | ${fmt(a.confiancaGeralMedia, 2)} |`,
    );
  }
  linhas.push(``);
  linhas.push(`## Gate de leitura (qualidade não pode cair para ganhar velocidade) — NÃO promove sozinho`);
  linhas.push(``);
  linhas.push(`| variante | favorável | motivos |`);
  linhas.push(`|---|---|---|`);
  for (const v of veredito) {
    linhas.push(`| ${v.variante} | ${v.favoravel ? "SIM" : "não"} | ${v.motivos.length ? v.motivos.join("; ") : "—"} |`);
  }
  linhas.push(``);
  return linhas.join("\n");
}

// ===========================================================================
// Main
// ===========================================================================

async function main() {
  const argVariantes = process.argv.find((a) => a.startsWith("--variantes="))?.split("=")[1];
  const argJanelas = process.argv.find((a) => a.startsWith("--janelas="))?.split("=")[1];

  const nomesPedidos = argVariantes ? argVariantes.split(",").map((v) => v.trim()).filter(Boolean) : null;
  if (nomesPedidos) {
    const desconhecidas = nomesPedidos.filter((n) => !VARIANTES.some((v) => v.variante === n));
    if (desconhecidas.length > 0) {
      console.error(`--variantes: desconhecida(s): ${desconhecidas.join(", ")}. Opções: ${VARIANTES.map((v) => v.variante).join(", ")}.`);
      process.exit(1);
    }
  }
  const variantes = nomesPedidos ? VARIANTES.filter((v) => nomesPedidos.includes(v.variante)) : VARIANTES;
  const numJanelas = argJanelas ? Number(argJanelas) : PADRAO_NUM_JANELAS;
  if (!Number.isInteger(numJanelas) || numJanelas <= 0) {
    console.error(`--janelas inválido: ${argJanelas}`);
    process.exit(1);
  }

  const admin = criarClienteAdmin();

  console.log(`Carregando sessão de replay ${SESSAO_ID}...`);
  const [jornadaId, segmentosOrdenados] = await Promise.all([
    buscarJornadaDaSessao(admin, SESSAO_ID),
    carregarSegmentosOrdenados(admin, SESSAO_ID),
  ]);
  console.log(`${segmentosOrdenados.length} segmentos carregados (nenhum será impresso — só contagem).`);

  const pontos = amostrarPontos(segmentosOrdenados.length, numJanelas);
  console.log(`\nBancada — ${pontos.length} janela(s) [${pontos.map((p) => p.rotulo).join(", ")}], ${variantes.length} variante(s) [${variantes.map((v) => v.variante).join(", ")}], ${REPETICOES} repetições.`);
  console.log(`Teto de gasto desta rodada: US$ ${ORCAMENTO_MAXIMO_USD}. Prompt: chave '${CHAVE_PROMPT_COPILOTO}'.`);

  const medidas: MedidaExecucao[] = [];
  let gastoAcumulado = 0;

  for (const ponto of pontos) {
    // Contexto (blocos A/B/C/F/G reais + bloco D do ponto amostrado) é o
    // MESMO para as duas variantes deste ponto — só o prompt muda.
    const contexto = await montarContextoDoPontoAmostrado(admin, { sessaoId: SESSAO_ID, segmentosOrdenados, ponto });

    for (const def of variantes) {
      for (let repeticao = 1; repeticao <= REPETICOES; repeticao++) {
        if (gastoAcumulado >= ORCAMENTO_MAXIMO_USD) {
          console.error(`ABORTADO — teto de gasto da rodada (US$ ${ORCAMENTO_MAXIMO_USD}) atingido em US$ ${gastoAcumulado.toFixed(4)}. Resultado parcial ainda é gravado.`);
          break;
        }
        process.stdout.write(`  ${ponto.rotulo} / ${def.variante} / ${repeticao}... `);
        const medida = await medirUmaExecucao(admin, { jornadaId, contexto, def, ponto: ponto.rotulo, repeticao });
        medidas.push(medida);
        gastoAcumulado += medida.custo_usd ?? 0;
        console.log(medida.ok ? `US$ ${fmt(medida.custo_usd, 4)}` : `FALHOU (${medida.timeout ? "timeout_8s" : medida.motivo})`);
      }
    }
  }

  console.log(`\nGasto total medido: US$ ${gastoAcumulado.toFixed(4)}.`);

  const agregadosPorPontoEVariante = pontos.flatMap((ponto) =>
    variantes.map((def) => ({
      ponto: ponto.rotulo,
      agregado: agregarPorVariante(medidas.filter((m) => m.ponto === ponto.rotulo), def.variante),
    })),
  );
  const agregadoGeral = variantes.map((def) => agregarPorVariante(medidas, def.variante));

  const baselineGeral = agregadoGeral.find((a) => a.variante === "v7_baseline");
  const veredito: VereditoGate[] = baselineGeral
    ? agregadoGeral.filter((a) => a.variante !== "v7_baseline").map((a) => avaliarGate(baselineGeral, a))
    : [];

  const relatorio = gerarRelatorioMarkdown(agregadosPorPontoEVariante, agregadoGeral, veredito);
  fs.mkdirSync(DIR_BANCADA, { recursive: true });
  const caminhoRelatorio = path.join(DIR_BANCADA, `resultado-${Date.now()}.md`);
  fs.writeFileSync(caminhoRelatorio, relatorio, "utf-8");
  console.log(`\nRelatório (só métricas agregadas — sem trecho de fala): ${caminhoRelatorio}`);

  for (const v of veredito) {
    console.log(`  ${v.variante}: ${v.favoravel ? "FAVORÁVEL" : "NÃO favorável"}${v.motivos.length ? " — " + v.motivos.join("; ") : ""}`);
    if (v.favoravel) {
      console.log(
        `\n  v8 venceu o gate. Este script NUNCA promove — para ativar manualmente, rode (revisão humana antes):\n` +
          `    update prompts_versoes set ativo = false where chave = '${CHAVE_PROMPT_COPILOTO}' and ativo = true;\n` +
          `    update prompts_versoes set ativo = true  where chave = '${CHAVE_PROMPT_COPILOTO}' and versao = 8;\n` +
          `  Reversão: update prompts_versoes set ativo = (versao = 7) where chave = '${CHAVE_PROMPT_COPILOTO}';`,
      );
    }
  }
}

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
