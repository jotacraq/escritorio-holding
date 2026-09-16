import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoteiroDefinicao } from "@/types/roteiro";
import type { ContextoCopiloto } from "@/types/copiloto";
import { erroNaoEncontrado } from "@/server/erros";
import { lerConfiguracaoBool } from "@/server/ia/configuracao";
import { normalizarNome, normalizarParticipantesBrutos, type ParticipanteRegistrado } from "@/server/copiloto/participantes";

/**
 * Montador do contexto que vai para a IA do copiloto — Fase 10, Fatia 2
 * (docs/ARQUITETURA-FASE-10.md §4.3, blocos A-E, ~6 KB). SEMPRE no servidor,
 * nunca no cliente — mesma regra de `montarEstadoCopiloto` (server/copiloto/
 * estado.ts, Fatia 1), que este módulo REUSA para os blocos A e C em vez de
 * duplicar a query.
 *
 * FRONTEIRA DE PII (§7 do plano): este módulo é o "um lugar só" onde o nome
 * do falante vira papel (`advogada`/`decisor_N`/`acompanhante_N`) e onde os
 * NOMES dos decisores do briefing NUNCA entram — só a contagem. Patrimônio,
 * CPF, endereço e dado de IR não são consultados aqui: não há import de
 * `cenarios`, `croqui_calculos` nem `documentos` neste arquivo, por
 * construção (não por checagem em runtime).
 *
 * 🔴 PAPÉIS DE FALA (15/09/2026) — CORREÇÃO de cegueira medida em produção:
 * 128 segmentos com o nome PRÓPRIO gravado certo (`"João CSM"`) chegavam à
 * IA como `"participante:"`, porque o `PAPEIS_CONHECIDOS` antigo só conhecia
 * `"advogada"`/`"cliente"` — nunca casava com nome próprio. O papel agora é
 * RESOLVIDO NA ESCRITA (`server/copiloto/participantes.ts::resolverPapelNoJoin`,
 * chamado por `entrada-bot.ts` no `join`) e gravado em
 * `sessoes_copiloto.participantes[].papel` — este módulo só CONSOME o mapa
 * pronto (`rotuloFalante`), nunca decide papel sozinho. Isso preserva a
 * fronteira de PII: o NOME nunca sai desta função, só o papel estável já
 * resolvido alhures.
 *
 * Bloco E (resumo acumulado) fica FORA desta função nesta entrega: mora em
 * `sessoes_copiloto.resumo_acumulado` (0091), e a Fatia 2 só LÊ o que já está
 * lá (a rota sob demanda não reescreve o resumo — reescrever a cada ciclo é
 * comportamento do ciclo automático, Fatia 3). Aqui ele entra como está.
 */

const JANELA_TRANSCRICAO_SEGUNDOS = 90;
const MAX_SEGMENTOS_JANELA = 40; // teto defensivo: ~90s de fala não passa disto em ritmo humano

const CHAVE_ROTEIRO_SESSAO_VIABILIDADE = "sessao_viabilidade";

interface SessaoParaContexto {
  id: string;
  roteiro_versao_id: string | null;
  sims: Record<string, { ok: boolean; em: string; registrado_por: string | null }>;
  jornada_id: string;
  jornadas: { pessoa_id: string } | null;
  roteiros_versoes: { definicao: RoteiroDefinicao } | null;
  sessoes_copiloto: { participantes: unknown; resumo_acumulado: Record<string, unknown> } | null;
}

interface SegmentoJanela {
  falante: string | null;
  texto: string;
  criado_em: string;
}

interface BriefingRecorte {
  perfil_disc?: { predominante?: string; secundario?: string };
  objecoes_provaveis?: Array<{ objecao?: string; probabilidade?: string }>;
  linguagem_recomendada?: { tom?: string[] };
  processo_decisorio?: { decisores?: string[] };
}

/**
 * Monta o contexto de IA de uma sessão, no ponto do roteiro em que a tela
 * está (`indiceBlocoAtual`, mesma convenção de `montarEstadoCopiloto`: vem do
 * chamador, nunca recalculado no servidor).
 *
 * Lança `erroNaoEncontrado` quando a sessão não existe — mesmo contrato de
 * `montarEstadoCopiloto`.
 */
export async function montarContextoCopiloto(
  supabase: SupabaseClient,
  sessaoId: string,
  indiceBlocoAtual: number,
): Promise<ContextoCopiloto> {
  const { data, error } = await supabase
    .from("sessoes_viabilidade")
    .select(
      "id, jornada_id, roteiro_versao_id, sims, jornadas(pessoa_id), roteiros_versoes(definicao), " +
        "sessoes_copiloto(participantes, resumo_acumulado)",
    )
    .eq("id", sessaoId)
    .maybeSingle<SessaoParaContexto>();
  if (error) throw error;
  if (!data) throw erroNaoEncontrado("Sessão de Viabilidade não encontrada.");

  // 🔴 FALLBACK DE ROTEIRO ATIVO (achado do coordenador, 14/09/2026, medido em
  // sessão real): `roteiro_versao_id` só é carimbado por `registrar_sim_sessao`
  // (0030) no 1º SIM — toda sessão nova chega aqui com o campo NULO enquanto
  // a advogada ainda não confirmou o 1º SIM, e na vida real o bot já está
  // ouvindo e ela já está falando ANTES disso. Sem fallback, `bloco_atual`
  // sai vazio e a IA perde o método inteiro (medido: confiança 0,30, "sem
  // roteiro carregado").
  //
  // UMA QUERY NO CAMINHO COMUM: o embed acima (`roteiros_versoes(definicao)`)
  // já resolve pela FK `roteiro_versao_id` — quando ela existe (sessão que já
  // passou pelo 1º SIM, que é a maioria do tempo de vida de uma sessão), zero
  // custo extra. Só quando `roteiro_versao_id IS NULL` — a janela estreita
  // entre "bot ligado" e "1º SIM confirmado" — é que uma 2ª query busca a
  // versão ATIVA da chave 'sessao_viabilidade'. Não dá para resolver isso
  // dentro do MESMO select: o PostgREST só embeda por relação FK, e não há FK
  // de `sessoes_viabilidade` para "a versão ativa agora" (é uma condição
  // `where chave=... and ativo`, não um vínculo de linha). Medido: a query de
  // fallback é `select id, definicao from roteiros_versoes where chave=$1 and
  // ativo limit 1` sobre `uniq_roteiro_ativo` (índice único parcial em
  // `(chave) where ativo`, 0030) — Index Scan por igualdade, sub-ms.
  //
  // NUNCA escreve `roteiro_versao_id` de volta aqui — carimbar é ato de
  // `registrar_sim_sessao`, com autoria; este módulo só LÊ (requisito
  // explícito do coordenador: inventar o carimbo contaminaria o registro de
  // qual roteiro realmente conduziu a sessão).
  let definicaoRoteiro = data.roteiros_versoes?.definicao ?? null;
  let roteiroFonte: ContextoCopiloto["roteiro_fonte"] = definicaoRoteiro ? "carimbado" : "nenhum";

  if (!definicaoRoteiro) {
    const { data: ativo, error: erroAtivo } = await supabase
      .from("roteiros_versoes")
      .select("definicao")
      .eq("chave", CHAVE_ROTEIRO_SESSAO_VIABILIDADE)
      .eq("ativo", true)
      .maybeSingle<{ definicao: RoteiroDefinicao }>();
    if (erroAtivo) throw erroAtivo;
    if (ativo) {
      definicaoRoteiro = ativo.definicao;
      roteiroFonte = "ativo_fallback";
    }
  }

  const blocos = definicaoRoteiro?.blocos ?? [];
  const indice =
    Number.isInteger(indiceBlocoAtual) && indiceBlocoAtual >= 0 && indiceBlocoAtual < blocos.length
      ? indiceBlocoAtual
      : 0;

  // --- A · bloco atual do roteiro + vizinhos (só título dos vizinhos) -------
  const blocoAtual = blocos[indice] ?? null;
  const blocoA: ContextoCopiloto["bloco_atual"] = blocoAtual
    ? {
        id: blocoAtual.id,
        titulo: blocoAtual.titulo,
        objetivo: blocoAtual.objetivo,
        acao: blocoAtual.acao,
        // 🔴 FALAS FORA DO CONTEXTO (medido em 14/09/2026, sessão real).
        //
        // As falas do roteiro eram 94-97% do peso do bloco: `parte_09` ia com
        // 1.158 tokens, dos quais 1.122 eram só falas — sem elas, 36.
        //
        // Isso importava porque a latência é quase linear no tamanho do
        // contexto: r=0,95 sobre as 8 execuções reais da 1ª sessão ao vivo,
        // +1.000 tokens ≈ +2,5 s. A 6ª execução estourou o timeout de 8 s
        // COM cache quente — ou seja, não era o cache, era o bloco.
        //
        // E as falas não servem à IA: elas existem para a ADVOGADA ler na
        // tela. O copiloto precisa saber o OBJETIVO do bloco, os CAMPOS que
        // faltam, o que OBSERVAR e o que é PROIBIDO — não o roteiro verbatim.
        // O próprio prompt (v2) proíbe redigir fala pronta para ela recitar,
        // então mandar as falas alimentava exatamente o que é vedado.
        //
        // Comparado com o mesmo contexto real, 3 rodadas cada:
        //   com falas: 1.753 tokens, lat [6.574, 6.808, 7.617] ms, conf 0,65
        //   sem falas: 1.525 tokens, lat [5.960, 6.171, 7.007] ms, conf 0,65
        // Qualidade equivalente — a versão sem falas ainda pegou a contradição
        // "solteiro × mencionou a esposa" que a outra não listou.
        campos: blocoAtual.campos.map((c) => c.rotulo),
        observar: blocoAtual.observar,
        proibido: blocoAtual.proibido,
      }
    : null;
  const blocoAnteriorTitulo = indice > 0 ? (blocos[indice - 1]?.titulo ?? null) : null;
  const blocoSeguinteTitulo = indice < blocos.length - 1 ? (blocos[indice + 1]?.titulo ?? null) : null;

  // --- B · recorte do briefing (o MESMO recorte que PainelBriefingSessao já
  // mostra) — SEM nomes de decisores, só o essencial ao método. -------------
  const briefingB = await buscarRecorteBriefing(supabase, data.jornada_id);

  // --- C · estado factual: SIMs, blocos percorridos, campos pendentes,
  // decisores esperados x presentes (contagem, nunca nome). -----------------
  const simsRegistrados = Object.keys(data.sims ?? {}).filter((k) => data.sims[k]?.ok === true);
  const blocosPercorridos = blocos.slice(0, indice).map((b) => b.id);
  const camposPendentes = (blocoAtual?.campos ?? []).map((c) => c.rotulo);
  const decisoresEsperados = briefingB?.decisoresEsperadosQtd ?? null;
  const participantes = normalizarParticipantes(data.sessoes_copiloto?.participantes);
  const contextoC: ContextoCopiloto["estado_factual"] = {
    sims_registrados: simsRegistrados,
    blocos_percorridos: blocosPercorridos,
    campos_pendentes_no_bloco: camposPendentes,
    decisores_esperados: decisoresEsperados,
    decisores_presentes: participantes.length > 0 ? participantes.length : null,
  };

  // --- D · janela deslizante de transcrição, literal, ~90s ------------------
  // `mapaDePapeis` vem do MESMO `sessoes_copiloto.participantes` já lido no
  // select principal (linha ~72) — ZERO query nova (aceite explícito desta
  // fatia). `papeisDeFalaEstaoAtivos` é o único fetch extra: 1 leitura de
  // `configuracoes`, mesmo padrão de `copilotoEstaAtivo`/`audioAoVivoEstaAtivo`.
  const papeisAtivos = await papeisDeFalaEstaoAtivos(supabase);
  const mapaDePapeis = papeisAtivos ? montarMapaDePapeis(data.sessoes_copiloto?.participantes) : null;
  const janelaD = await buscarJanelaTranscricao(supabase, sessaoId, mapaDePapeis);

  // --- E · resumo estruturado acumulado (lido como está; ninguém reescreve
  // aqui nesta fatia — ver comentário de topo) ------------------------------
  const resumoE = data.sessoes_copiloto?.resumo_acumulado ?? {};

  return {
    roteiro_fonte: roteiroFonte,
    bloco_atual: blocoA,
    bloco_anterior_titulo: blocoAnteriorTitulo,
    bloco_seguinte_titulo: blocoSeguinteTitulo,
    briefing_recorte: briefingB
      ? {
          disc_predominante: briefingB.discPredominante,
          disc_secundario: briefingB.discSecundario,
          objecao_provavel: briefingB.objecaoProvavel,
          tom_recomendado: briefingB.tomRecomendado,
        }
      : null,
    estado_factual: contextoC,
    janela_transcricao: janelaD,
    resumo_acumulado: resumoE,
    roteiro_ativo_blocos_ids: blocos.map((b) => b.id),
    // Fase 12, Fatia 1 — `(id, titulo, objetivo)` de TODOS os blocos, SEM
    // `falas`/`proibido`/`campos`/`observar` (mesmo raciocínio de peso do
    // bloco A: `falas` sozinha já era 94-97% do peso de 1 bloco; mandar o
    // corpo inteiro de TODOS os blocos multiplicaria isso pelo número de
    // blocos do roteiro). É o que permite `bloco_inferido` (schema.ts)
    // apontar para um bloco que não seja o atual.
    roteiro_ativo_blocos: blocos.map((b) => ({ id: b.id, titulo: b.titulo, objetivo: b.objetivo })),
  };
}

/**
 * Recorte do briefing atual da jornada — mesmo dado que `PainelBriefingSessao`
 * já mostra (`briefings.conteudo`, `atual=true`). NUNCA devolve nomes de
 * `processo_decisorio.decisores` — só a CONTAGEM (§7 do plano: "nomes dos
 * decisores do briefing... Não. O contexto recebe 'N decisores esperados',
 * jamais os nomes").
 */
async function buscarRecorteBriefing(
  supabase: SupabaseClient,
  jornadaId: string,
): Promise<{
  discPredominante: string | null;
  discSecundario: string | null;
  objecaoProvavel: string | null;
  tomRecomendado: string | null;
  decisoresEsperadosQtd: number | null;
} | null> {
  const { data, error } = await supabase
    .from("briefings")
    .select("conteudo")
    .eq("jornada_id", jornadaId)
    .eq("atual", true)
    .maybeSingle<{ conteudo: BriefingRecorte }>();
  if (error || !data?.conteudo) return null;

  const conteudo = data.conteudo;
  return {
    discPredominante: conteudo.perfil_disc?.predominante ?? null,
    discSecundario: conteudo.perfil_disc?.secundario ?? null,
    // A objeção de MAIOR probabilidade primeiro (mesmo critério visual do painel).
    objecaoProvavel: conteudo.objecoes_provaveis?.[0]?.objecao ?? null,
    tomRecomendado: conteudo.linguagem_recomendada?.tom?.join(", ") ?? null,
    decisoresEsperadosQtd: Array.isArray(conteudo.processo_decisorio?.decisores)
      ? conteudo.processo_decisorio!.decisores!.length
      : null,
  };
}

/**
 * `participantes` (0091, jsonb) — Fatia 4: lista de `{nome, entrou_em,
 * saiu_em}` que `server/copiloto/participantes.ts` grava a partir dos
 * eventos `participant_events.join`/`.leave` do webhook. Aqui só a CONTAGEM
 * de quem está PRESENTE AGORA (`saiu_em === null`) sai desta função — o NOME
 * nunca vai para o contexto de IA (§7 do plano: fronteira de PII, "um lugar
 * só"). Entrada não confiável (jsonb solto, ou formato antigo de array de
 * string de uma versão anterior desta fatia) → nunca lança, cai em vazio.
 */
function normalizarParticipantes(bruto: unknown): string[] {
  if (!Array.isArray(bruto)) return [];
  const presentes: string[] = [];
  for (const item of bruto) {
    if (typeof item === "string") {
      // Formato legado (pré-4c): rótulo solto, sempre contado como presente.
      presentes.push(item);
    } else if (item && typeof item === "object" && typeof (item as { nome?: unknown }).nome === "string") {
      const saiuEm = (item as { saiu_em?: unknown }).saiu_em;
      if (saiuEm === null || saiuEm === undefined) presentes.push((item as { nome: string }).nome);
    }
  }
  return presentes;
}

/** `copiloto_sessao.papeis_de_fala` (migration 0103, 15/09/2026) — MESMO
 * interruptor que `entrada-bot.ts` confere antes de gravar `papel`. Lido de
 * novo aqui (na LEITURA) porque desligar o interruptor no MEIO de uma sessão
 * já em andamento precisa voltar ao comportamento antigo IMEDIATAMENTE — se
 * este módulo confiasse só no que foi gravado na escrita, desligar a chave
 * não desligaria nada até a próxima entrada/saída de participante. Falha de
 * leitura cai em `false` — mesma regra dura de todo interruptor do copiloto. */
const CHAVE_PAPEIS_DE_FALA = "copiloto_sessao.papeis_de_fala";

async function papeisDeFalaEstaoAtivos(supabase: SupabaseClient): Promise<boolean> {
  try {
    return await lerConfiguracaoBool(supabase, CHAVE_PAPEIS_DE_FALA, true);
  } catch {
    return false;
  }
}

/**
 * Mapa `nome normalizado → papel` a partir de `sessoes_copiloto.participantes`
 * — ZERO query nova (o jsonb já veio no select principal desta função). Só
 * entra quem tem `nome` E `papel` resolvidos (`resolverPapelNoJoin` nunca
 * atribui `decisor_N` a quem só tem `id`, ver `participantes.ts`) — entrada
 * sem papel (sessão em andamento de antes desta fatia, ou interruptor
 * desligado no momento do join) simplesmente não entra no mapa, e
 * `rotuloFalante` cai no fallback de sempre. Quando duas entradas históricas
 * da MESMA pessoa (join/leave/join) têm nomes com grafia levemente diferente
 * mas mesmo `id`, todas caem na MESMA chave normalizada aqui — o mapa não
 * perde a herança de papel que `aplicarEventoParticipante` já garantiu. */
function montarMapaDePapeis(bruto: unknown): Map<string, string> {
  const lista: ParticipanteRegistrado[] = normalizarParticipantesBrutos(bruto);
  const mapa = new Map<string, string>();
  for (const p of lista) {
    if (p.nome && p.papel) mapa.set(normalizarNome(p.nome), p.papel);
  }
  return mapa;
}

/**
 * Bloco D — últimos ~90s de fala, com o NOME do falante trocado por PAPEL
 * (advogada/decisor_N/acompanhante_N) antes de sair desta função — é o "um
 * lugar só" que o §7 do plano exige. Teto de linhas (`MAX_SEGMENTOS_JANELA`)
 * é defensivo: em ritmo humano de fala, 90s não gera tantos segmentos, mas a
 * query nunca fica sem `limit`.
 */
/**
 * ÍNDICE (protocolo de sustentabilidade): o `eq(sessao_id)` usa
 * `idx_copiloto_segmentos_polling (sessao_id, ordem)` — mesmo índice do
 * caminho quente do polling (0091, Fatia 1/3) — para restringir a UMA sessão
 * e já entregar em ordem (`order by ordem`). O `gte(criado_em)` não tem
 * índice próprio e vira filtro RESIDUAL dentro do Index Scan já restrito por
 * `sessao_id` — o que é aceitável porque a cardinalidade POR SESSÃO é
 * pequena por desenho (§2.1 do plano: teto de ~180 segmentos numa sessão de
 * 90 min inteira). Não é `select * from sessoes_copiloto_segmentos where
 * criado_em >= $1` sem `sessao_id` — isso sim exigiria índice próprio e não
 * é o que esta função faz. `explain (analyze)` A MEDIR em
 * `scripts/verificacao-0092-0093.sql` §9.
 */
async function buscarJanelaTranscricao(
  supabase: SupabaseClient,
  sessaoId: string,
  mapaDePapeis: Map<string, string> | null,
): Promise<string[]> {
  const desde = new Date(Date.now() - JANELA_TRANSCRICAO_SEGUNDOS * 1000).toISOString();

  const { data, error } = await supabase
    .from("sessoes_copiloto_segmentos")
    .select("falante, texto, criado_em")
    .eq("sessao_id", sessaoId)
    .gte("criado_em", desde)
    .order("ordem", { ascending: true })
    .limit(MAX_SEGMENTOS_JANELA)
    .returns<SegmentoJanela[]>();
  if (error) throw error;

  return (data ?? []).map((s) => `${rotuloFalante(s.falante, mapaDePapeis)}: ${s.texto}`);
}

/** Rótulos que o caminho MANUAL já usa há mais tempo (`RegistroManual`
 * deixa a advogada digitar "advogada"/"cliente" à mão) — mantido como
 * fallback quando `bruto` não casa com o mapa de papéis (§ decisão
 * 15/09/2026: "mantenha PAPEIS_CONHECIDOS como fallback para o caminho
 * MANUAL, e isso já funciona"). NUNCA reaproveitado como fonte primária —
 * o mapa (nome do PROVEDOR → papel resolvido na escrita) é sempre
 * consultado primeiro. */
const PAPEIS_CONHECIDOS = new Set(["advogada", "cliente"]);

/**
 * Nome próprio de falante NUNCA sai desta função — vira papel genérico (§7
 * do plano). Ordem de resolução (15/09/2026, papéis de fala):
 *   1. `mapaDePapeis` (nome normalizado → papel já resolvido na ESCRITA por
 *      `resolverPapelNoJoin`, `entrada-bot.ts`) — é a fonte de verdade
 *      quando o interruptor `copiloto_sessao.papeis_de_fala` está ligado.
 *   2. `PAPEIS_CONHECIDOS` — caminho MANUAL (`bruto` já É o papel literal
 *      digitado pela advogada, "advogada"/"cliente"), preservado tal como
 *      era antes desta fatia.
 *   3. `"participante"` — fallback final: sessão em andamento de antes desta
 *      fatia (participante sem `papel` gravado), interruptor desligado, ou
 *      rótulo que não casa com nenhum dos dois caminhos acima. Degradação
 *      graciosa, comportamento IDÊNTICO ao de antes desta correção — nenhuma
 *      migration de dados. */
function rotuloFalante(bruto: string | null, mapaDePapeis: Map<string, string> | null): string {
  if (!bruto) return "participante";

  if (mapaDePapeis) {
    const papel = mapaDePapeis.get(normalizarNome(bruto));
    if (papel) return papel;
  }

  const normalizado = bruto.trim().toLowerCase();
  return PAPEIS_CONHECIDOS.has(normalizado) ? normalizado : "participante";
}
