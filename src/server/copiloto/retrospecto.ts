import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AlignmentType,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import { registrarErro } from "@/server/erros";
import { lerConfiguracaoBool } from "@/server/ia/configuracao";
import { ordenarFicha } from "@/server/copiloto/ficha";
import { resumirInventario } from "@/server/copiloto/inventario";
import type { RoteiroBloco, RoteiroDefinicao } from "@/types/roteiro";
import type {
  ConteudoRetrospecto,
  FichaAcumulada,
  InventarioAcumulado,
  ItemInventarioRecentePainel,
  ObservacaoDoClienteRetrospecto,
  PontoDeMelhoriaRetrospecto,
  RetrospectoDaSessao,
  SugestaoCopiloto,
  TipoObservacaoCopiloto,
} from "@/types/copiloto";

/**
 * RETROSPECTO DA SESSÃO — Fase 13 (19/09/2026), migration 0125.
 * Plano: `docs/ARQUITETURA-FASE-13.md` §D, tarefas BE-2/BE-3/BE-4.
 *
 * O fechamento do copiloto: o que a máquina observou enquanto a Sessão de
 * Viabilidade acontecia, congelado no instante em que ela terminou.
 *
 * 🔴 NÃO é o "Relatório da SV" (`relatorios_sessao`, `RelatorioAba.tsx`,
 * item de pasta `relatorio_sv`), que a Dra. Elaine preenche à mão. Este é
 * GERADO, não preenchido, e IMUTÁVEL — `sessao_id` é PK de
 * `copiloto_retrospectos`, então encerrar duas vezes não gera dois.
 *
 * 🔴 ZERO CHAMADA DE IA nesta versão (`origem='derivado'`). Tudo aqui é
 * MONTAGEM do que a sessão já gravou: `copiloto_sugestoes`,
 * `sessoes_copiloto.ficha_acumulada`/`inventario_acumulado` e os dois
 * carimbos de tempo. Nenhum juízo novo é emitido sobre a advogada agora —
 * os "pontos de melhoria" são o que a IA já apontou DURANTE a sessão.
 *
 * 🔴 NÃO EXISTE NOTA DE 0 A 10, e isso é decisão MEDIDA (19/09, produção):
 * os dois campos que a 0119 criou justamente para julgar a condução estão
 * vazios — `cobriu_no_bloco` = 11 itens em 369 sugestões, em 1 de 3 sessões;
 * `desfecho` = 366 `expirada` de 369 (99,2%). Uma nota sobre isso seria um
 * número plausível e falso, o padrão já catalogado nesta casa. O que existe
 * medido e auditável é COBERTURA: `blocos_com_atividade` de
 * `blocos_no_roteiro`, com denominador sempre visível. Medido nas 3 sessões
 * reais: **4/13, 9/13, 6/13** — `retrospecto.test.ts` tranca esses números.
 *
 * ===========================================================================
 * 🔴 CONSENTIMENTO REVOGADO — O RETROSPECTO CONTINUA SENDO GRAVADO.
 * DECISÃO DO DONO (Marcio), 19/09/2026, sobre o achado F3 do pentest.
 * ===========================================================================
 *
 * ISTO NÃO É ESQUECIMENTO. Está escrito aqui exatamente para o próximo
 * auditor não tratar como esquecimento — e para quem discordar saber contra
 * o que está argumentando.
 *
 * O ACHADO: a 0093 instalou um trigger incondicional em `copiloto_sugestoes`
 * que RECUSA o INSERT quando não há decisão jurídica ativa e consentimento
 * do titular (`copiloto_ao_vivo_bloqueado`). O Retrospecto é uma CÓPIA NOVA
 * da mesma matéria-prima (citação literal de dor/objeção/desejo) e nasceu
 * sem trava equivalente: com o consentimento revogado no meio da sessão, a
 * sugestão para de ser gravada, mas o retrospecto do que já foi capturado é
 * escrito no encerramento assim mesmo.
 *
 * A DECISÃO: **não travar.** Razão do dono: o critério que a 0093 aplica é
 * "este dado SAI para um subprocessador (a IA)?" — e a v1 do retrospecto é
 * `origem='derivado'`, ZERO chamada de IA. Nada sai. O documento é uma
 * reorganização, dentro do próprio banco, de dado que já está gravado e que
 * já tem base legal registrada; o retrospecto não amplia o tratamento, só
 * organiza o que existe. Bloquear a gravação também não APAGARIA nada — a
 * fala continuaria em `sessoes_copiloto_segmentos` e em `copiloto_sugestoes`
 * —, então a trava custaria o documento e não devolveria privacidade nenhuma
 * ao titular.
 *
 * 🔴 A RESSALVA DO PENTESTER, registrada porque ele tem razão no ponto: o
 * critério de LGPD é MAIS ESTRITO que o da 0093. Consentimento revogado
 * alcança o tratamento INTERNO, não só a transferência a subprocessador; e
 * "derivar um documento novo" é, tecnicamente, tratamento novo. A decisão
 * acima é uma decisão de PRODUTO com risco assumido pelo dono, não um
 * veredito jurídico — e não foi validada por advogado nesta data.
 *
 * 🔴 A PERGUNTA REABRE SE `origem` VIRAR `'ia'`. No dia em que o retrospecto
 * passar a ser produzido por chamada de IA sobre a transcrição consolidada
 * (a v2 que `origem`/`execucao_ia_id`/`schema_versao` já preveem), o
 * critério da 0093 passa a se aplicar LITERALMENTE — o dado sai para um
 * subprocessador — e esta decisão deixa de valer. Quem implementar a v2 tem
 * de instalar a trava (trigger no mesmo molde da 0093, ou o gate em
 * `gravarRetrospectoDaSessao`) ANTES de ligar a chamada, não depois.
 *
 * Compensação que JÁ existe, e que é o que torna o risco aceitável: o
 * retrospecto entra no expurgo na mesma onda das outras fontes
 * (`expurgo.ts::redigirRetrospectoDaSessao`, carimbo
 * `evidencias_redigidas_em`) e entra no `INVENTARIO_TITULAR` e na
 * `anonimizar_titular` (0127) — então o titular que exerce o art. 18 vê e
 * apaga este documento junto com o resto.
 *
 * ORGANIZAÇÃO DESTE ARQUIVO
 *   1. `montarConteudoRetrospecto` — PURA, zero I/O. É onde toda a regra
 *      mora, e é o que o teste exercita contra os números reais.
 *   2. `gravarRetrospectoDaSessao` — o I/O: lê os insumos, chama a função
 *      pura, grava com `on conflict (sessao_id) do nothing`. NUNCA lança.
 *   3. `montarDocxRetrospecto` — o mesmo conteúdo em `.docx`. Só a
 *      BIBLIOTECA `docx` é reaproveitada do croqui (já no `package.json`,
 *      zero dependência nova); o builder do croqui não, porque é acoplado ao
 *      `ResultadoCroqui`.
 */

// ---------------------------------------------------------------------------
// TETOS. Todos explícitos e testados — o CHECK de 32 KB da 0125 é o BACKSTOP
// de banco, nunca o mecanismo: quando o CHECK dispara, a escrita já falhou.
// ---------------------------------------------------------------------------

/** Alvo da poda em TypeScript, contra o CHECK de 32.768 B da 0125. ~4,7 KB
 * de folga cobre a diferença entre o `JSON.stringify` que medimos aqui e o
 * `pg_column_size` do jsonb já parseado (que varia com a compressão do
 * TOAST), mesma disciplina de `ficha.ts::TETO_BYTES_ALVO_FICHA` (3.000 contra
 * um CHECK de 4.096). */
const TETO_BYTES_ALVO = 28_000;
/** Teto do banco, replicado aqui só para o teste poder afirmar a margem. */
export const TETO_BYTES_CHECK_0125 = 32_768;

/** Observações sobre o cliente — TETO DE CONTAGEM, que é BACKSTOP, não o
 * mecanismo: quem corta no caso real é o teto de BYTES abaixo.
 *
 * 🔴 CALIBRADO CONTRA PRODUÇÃO (19/09/2026): com os valores da 1ª versão
 * (60/40) as TRÊS sessões reais saíam com `podado:true` gastando só 16-17 KB
 * dos 28 KB do alvo — ou seja, o documento avisava "cortei" sem precisar
 * cortar, e um aviso que aparece sempre é um aviso que ninguém lê. Com
 * 150/100 as mesmas 3 sessões cabem inteiras, e `podado:true` volta a
 * significar o que diz. */
const TETO_OBSERVACOES = 150;
/** Pontos de melhoria distintos. Medido: 231 itens de `falta_no_bloco` no
 * total, mas **205 numa única sessão** (anômala) e 17/9 nas outras — sem
 * teto, essa sessão sozinha poderia estourar o documento. Depois da
 * deduplicação as 3 sessões reais deram 40+/14/9. */
const TETO_PONTOS_MELHORIA = 100;
/** Itens de patrimônio que entram na LISTA de observações (o agregado
 * completo continua em `conteudo.patrimonio`, que é barato). Medido: 70
 * itens na sessão mais rica, e `inventario_acumulado` NÃO tem poda própria
 * (diferente de `ficha_acumulada`, que tem CHECK de 4 KB) — o teto tem de
 * existir aqui. */
const TETO_PATRIMONIO_NA_LISTA = 12;
/** Sugestões lidas por sessão. `copiloto_sessao.teto_ia_sessao` (0102) é 90
 * hoje — 400 é ~4,4× de folga. `loteCheio` avisa se um dia encher (mesmo
 * padrão de `expurgo.ts::LOTE_SUGESTOES_REDACAO`). */
const LOTE_SUGESTOES = 400;

/** A frase que o documento carrega no rodapé, congelada dentro do `conteudo`
 * (ver `ConteudoRetrospecto.nota_de_rodape`). Diz, por escrito e com o
 * número, POR QUE não há nota — em vez de deixar a ausência parecer
 * esquecimento. */
const NOTA_DE_RODAPE =
  "Este retrospecto não traz nota de 0 a 10 para a condução. Não é esquecimento: " +
  "não há, hoje, sinal medido que sustente uma nota. Dos 369 registros das 3 primeiras " +
  "sessões, 366 (99,2%) expiraram sem a advogada marcar aceita/ignorada, e o campo que " +
  "registra o que foi coberto no bloco apareceu 11 vezes, em 1 das 3 sessões. Uma nota " +
  "construída sobre isso seria um número plausível e falso. O que está acima é medido: " +
  "cobertura com denominador explícito, duração, o que foi captado e o que a própria " +
  "máquina apontou durante a sessão.";

/** Rótulo de recusa — usado quando a montagem não pôde ser feita. NUNCA
 * gravado como se fosse retrospecto (a sessão fica sem linha e a rota
 * devolve `retrospecto: null`); existe só para o log ter um motivo legível. */
const RANK_TIPO_OBSERVACAO: Record<TipoObservacaoCopiloto, number> = {
  // A ordem é a da regra da casa: "fato · hipótese · inferência ·
  // recomendação". Fato primeiro porque é o que não precisa de ressalva;
  // recomendação por último porque é a única que pede ação de quem lê.
  fato: 1,
  hipotese: 2,
  inferencia: 3,
  recomendacao: 4,
};

// ---------------------------------------------------------------------------
// 1. MONTAGEM — PURA, zero I/O.
// ---------------------------------------------------------------------------

/** Uma linha de `copiloto_sugestoes` reduzida ao que o retrospecto usa. */
export interface SugestaoParaRetrospecto {
  bloco_id: string | null;
  conteudo: SugestaoCopiloto;
  confianca: number | null;
}

export interface InsumosRetrospecto {
  /** Blocos do roteiro DAQUELA sessão — o denominador da cobertura. Nunca o
   * roteiro ativo de hoje quando a sessão declarou outro (ver
   * `carregarBlocosDaSessao`). */
  blocos: RoteiroBloco[];
  sugestoes: SugestaoParaRetrospecto[];
  ficha: FichaAcumulada;
  inventario: InventarioAcumulado;
  iniciadoEm: string | null;
  encerradoEm: string | null;
  /** TODAS as execuções do prompt `copiloto_sessao` DESTA jornada dentro da
   * janela da sessão — não só as que viraram sugestão. Ver
   * `carregarExecucoesDaSessao` para o porquê (é a diferença entre medir
   * 16,4% de truncamento e reportar 0%).
   *
   * `null` = não foi possível medir (faltou `iniciado_em`/`encerrado_em`
   * para delimitar a janela). A tela mostra "—", nunca 0. */
  execucoes: Array<{ id: string; stop_reason: string | null }> | null;
}

/** Minúsculas, sem acento, espaços colapsados — MESMO critério de
 * `ficha.ts::normalizarTexto`/`inventario.ts::normalizarDescricao`. Vive aqui
 * (e não importado) porque lá é `function` privada de módulo; duplicar 5
 * linhas é mais barato que alargar a superfície exportada de dois módulos do
 * caminho quente só para este consumidor de fim de sessão. */
function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** `stop_reason` que significa "o modelo foi cortado pelo teto de saída".
 * Medido em produção (19/09): 65 execuções com `'max_tokens'`. `'length'` é
 * o nome do mesmo evento em provedores compatíveis com OpenAI — aceito aqui
 * para o contador não mentir se o provedor trocar. */
function foiTruncada(stopReason: string | null): boolean {
  return stopReason === "max_tokens" || stopReason === "length";
}

/**
 * COBERTURA — `count(distinct bloco_id)` sobre os blocos que EXISTEM no
 * roteiro daquela sessão.
 *
 * 🔴 O filtro `idsDoRoteiro.has(...)` não é decoração: `copiloto_sugestoes.
 * bloco_id` é `text` livre no banco (0091) e um id que não existe mais no
 * roteiro (troca de versão, bloco removido) INFLARIA o numerador acima do
 * denominador — a cobertura passaria de 100% e o CHECK
 * `blocos_com_atividade <= blocos_no_roteiro` da 0125 recusaria a linha
 * inteira, transformando um dado sujo em falha de gravação.
 */
function calcularCobertura(blocos: RoteiroBloco[], sugestoes: SugestaoParaRetrospecto[]) {
  const idsDoRoteiro = new Set(blocos.map((b) => b.id));
  const comAtividade = new Set<string>();
  for (const s of sugestoes) {
    if (s.bloco_id && idsDoRoteiro.has(s.bloco_id)) comAtividade.add(s.bloco_id);
  }

  const naoPercorridos = blocos
    .map((b, indice) => ({ id: b.id, titulo: b.titulo, indice }))
    .filter((b) => !comAtividade.has(b.id));

  return {
    blocos_com_atividade: comAtividade.size,
    blocos_no_roteiro: blocos.length,
    nao_percorridos: naoPercorridos,
  };
}

/** Os 12 itens de inventário mais recentes, no formato que `ordenarFicha` já
 * consome — MESMO contrato do painel (`estado.ts::montarInventarioParaPainel`
 * usa 5; o documento usa 12 porque não é uma célula de 28% de largura). */
function patrimonioParaLista(inventario: InventarioAcumulado): ItemInventarioRecentePainel[] {
  return [...inventario]
    .sort((a, b) => Date.parse(b.ultima_mencao_em) - Date.parse(a.ultima_mencao_em))
    .slice(0, TETO_PATRIMONIO_NA_LISTA)
    .map((item) => ({
      categoria: item.categoria,
      descricao: item.descricao,
      titularidade: item.titularidade,
      posse: item.posse,
      valor_mencionado: item.valor_mencionado,
      evidencia: item.evidencia,
      primeira_mencao_em: item.primeira_mencao_em,
      ultima_mencao_em: item.ultima_mencao_em,
    }));
}

/**
 * OBSERVAÇÕES SOBRE O CLIENTE — duas fontes, uma lista.
 *
 *   1. `ficha_acumulada` + patrimônio, na ORDEM QUE O SERVIDOR JÁ PRODUZ
 *      (`ficha.ts::ordenarFicha`: objeção › dor › desejo › fato_decisor ›
 *      patrimônio). Zero regra de ordenação nova — é a mesma decisão de
 *      negócio do dono que o painel já respeita ("objeção não tratada
 *      derruba a venda").
 *   2. `copiloto_sugestoes.conteudo.observacao`, deduplicada por texto
 *      normalizado e agrupada por `tipo` (fato · hipótese · inferência ·
 *      recomendação) — a separação que a regra da casa exige da IA, cumprida
 *      de graça porque o campo já nasce assim.
 *
 * `evidencia` vem `null` quando a fonte já estava redigida (`""` depois de
 * `redigirEvidenciasFicha`) — nunca string vazia disfarçada de citação.
 */
function montarObservacoes(
  ficha: FichaAcumulada,
  inventario: InventarioAcumulado,
  sugestoes: SugestaoParaRetrospecto[],
): ObservacaoDoClienteRetrospecto[] {
  const daFicha: ObservacaoDoClienteRetrospecto[] = ordenarFicha(ficha, patrimonioParaLista(inventario)).map((item) => ({
    origem: "ficha",
    categoria: item.categoria,
    tipo: null,
    evidencia: item.evidencia ? item.evidencia : null,
    texto: item.texto,
    n: item.n,
    confianca: null,
  }));

  // Deduplicação por (tipo + texto normalizado): a mesma observação repetida
  // em 8 janelas de 90 s é UM fato dito 8 vezes, não 8 observações. `n` é
  // essa contagem — mesmo significado de `ItemFichaClienteAcumulado.n`.
  const porChave = new Map<string, ObservacaoDoClienteRetrospecto>();
  for (const s of sugestoes) {
    const obs = s.conteudo?.observacao;
    if (!obs || typeof obs.texto !== "string" || obs.texto.trim().length === 0) continue;
    const chave = `${obs.tipo}:${normalizarTexto(obs.texto)}`;
    const existente = porChave.get(chave);
    if (!existente) {
      porChave.set(chave, {
        origem: "observacao",
        categoria: null,
        tipo: obs.tipo,
        texto: obs.texto,
        evidencia: obs.evidencia ? obs.evidencia : null,
        n: 1,
        confianca: typeof obs.confianca === "number" ? obs.confianca : null,
      });
      continue;
    }
    existente.n += 1;
    // Guarda a MAIOR confiança das repetições (a mais forte das vezes em que
    // a IA disse a mesma coisa) e a primeira evidência que existir — nunca
    // sobrescreve uma citação por um `null` de uma repetição já redigida.
    if (typeof obs.confianca === "number" && (existente.confianca === null || obs.confianca > existente.confianca)) {
      existente.confianca = obs.confianca;
    }
    if (!existente.evidencia && obs.evidencia) existente.evidencia = obs.evidencia;
  }

  const dasSugestoes = [...porChave.values()].sort((a, b) => {
    const rankA = RANK_TIPO_OBSERVACAO[a.tipo as TipoObservacaoCopiloto] ?? 99;
    const rankB = RANK_TIPO_OBSERVACAO[b.tipo as TipoObservacaoCopiloto] ?? 99;
    if (rankA !== rankB) return rankA - rankB;
    if (a.n !== b.n) return b.n - a.n;
    return (b.confianca ?? 0) - (a.confianca ?? 0);
  });

  return [...daFicha, ...dasSugestoes];
}

/**
 * PONTOS DE MELHORIA DA CONDUÇÃO — união distinta de
 * `conteudo.falta_no_bloco[].item` que **nunca** apareceu em
 * `conteudo.cobriu_no_bloco[].item` na MESMA sessão.
 *
 * 🔴 Não é a IA opinando agora sobre a advogada: é o que ela apontou AO
 * VIVO, filtrado pelo par positivo que a 0119 criou exatamente para isso.
 * O `cobriu` cancela o `falta` porque, medido em produção, a IA aponta o
 * mesmo item como "faltou" em janelas seguidas e depois o registra como
 * coberto — listar os dois lados produziria um "ponto de melhoria" sobre
 * algo que a advogada de fato fez.
 *
 * Sem `evidencia` de propósito (ver `PontoDeMelhoriaRetrospecto`): `item` é
 * a descrição do que faltou perguntar, não fala do cliente.
 */
function montarPontosDeMelhoria(
  blocos: RoteiroBloco[],
  sugestoes: SugestaoParaRetrospecto[],
): PontoDeMelhoriaRetrospecto[] {
  const tituloPorBloco = new Map(blocos.map((b) => [b.id, b.titulo]));

  const cobertos = new Set<string>();
  for (const s of sugestoes) {
    for (const item of s.conteudo?.cobriu_no_bloco ?? []) {
      if (typeof item?.item === "string") cobertos.add(normalizarTexto(item.item));
    }
  }

  const porChave = new Map<string, PontoDeMelhoriaRetrospecto>();
  for (const s of sugestoes) {
    for (const item of s.conteudo?.falta_no_bloco ?? []) {
      if (typeof item?.item !== "string" || item.item.trim().length === 0) continue;
      const chave = normalizarTexto(item.item);
      if (cobertos.has(chave)) continue;

      const blocoValido = s.bloco_id && tituloPorBloco.has(s.bloco_id) ? s.bloco_id : null;
      const existente = porChave.get(chave);
      if (!existente) {
        porChave.set(chave, {
          item: item.item,
          n: 1,
          bloco_id: blocoValido,
          bloco_titulo: blocoValido ? (tituloPorBloco.get(blocoValido) ?? null) : null,
        });
        continue;
      }
      existente.n += 1;
      // A ocorrência MAIS RECENTE manda no bloco (as sugestões chegam em
      // `ordem_evento` crescente) — é onde a advogada estava da última vez
      // que a IA cobrou o mesmo item.
      if (blocoValido) {
        existente.bloco_id = blocoValido;
        existente.bloco_titulo = tituloPorBloco.get(blocoValido) ?? null;
      }
    }
  }

  return [...porChave.values()].sort((a, b) => (a.n !== b.n ? b.n - a.n : a.item.localeCompare(b.item, "pt-BR")));
}

function montarSaudeDoMotor(insumos: InsumosRetrospecto) {
  const comConfianca = insumos.sugestoes.filter((s) => typeof s.confianca === "number");
  const confiancaMedia =
    comConfianca.length === 0
      ? null
      : Math.round((comConfianca.reduce((soma, s) => soma + (s.confianca as number), 0) / comConfianca.length) * 100) / 100;

  return {
    sugestoes: insumos.sugestoes.length,
    confianca_media: confiancaMedia,
    sugestoes_com_evidencia_nao_conferida: insumos.sugestoes.filter(
      (s) => (s.conteudo?.campos_evidencia_nao_conferida ?? []).length > 0,
    ).length,
    execucoes_ia: insumos.execucoes === null ? null : insumos.execucoes.length,
    execucoes_truncadas: insumos.execucoes === null ? null : insumos.execucoes.filter((e) => foiTruncada(e.stop_reason)).length,
  };
}

/**
 * Poda por BYTES até caber no alvo. Corta do FIM das duas listas longas
 * (observações e pontos de melhoria), alternando, porque as duas já chegam
 * ordenadas por relevância — o fim é sempre o menos relevante. `podado:true`
 * é gravado no conteúdo: a tela DIZ que cortou, nunca omite em silêncio
 * (regra da casa).
 *
 * `JSON.stringify().length` conta caracteres UTF-16, não bytes; usamos
 * `Buffer.byteLength` para medir o que o Postgres vai medir de verdade.
 */
function podarConteudo(conteudo: ConteudoRetrospecto): ConteudoRetrospecto {
  let atual = conteudo;
  let podado = false;

  const tetoObs = Math.min(atual.observacoes_do_cliente.length, TETO_OBSERVACOES);
  const tetoPontos = Math.min(atual.pontos_de_melhoria.length, TETO_PONTOS_MELHORIA);
  if (tetoObs < atual.observacoes_do_cliente.length || tetoPontos < atual.pontos_de_melhoria.length) {
    podado = true;
    atual = {
      ...atual,
      observacoes_do_cliente: atual.observacoes_do_cliente.slice(0, tetoObs),
      pontos_de_melhoria: atual.pontos_de_melhoria.slice(0, tetoPontos),
    };
  }

  // 🔴 CORTA SEMPRE DA LISTA MAIS LONGA — nunca alternando.
  //
  // MEDIDO em produção (19/09/2026): a 1ª versão alternava um corte de cada
  // lado, e nas 2 sessões reais que batem no teto isso ZEROU a seção inteira
  // de "pontos de melhoria" (14 e 9 itens viraram 0) enquanto sobravam 107 e
  // 102 observações. Uma seção inteira sumindo do documento é pior que uma
  // lista mais curta — e a advogada leria "nenhum ponto de melhoria" quando
  // havia 14. Cortando sempre da mais longa, a lista pequena sobrevive
  // intacta até as duas terem o mesmo tamanho.
  while (
    Buffer.byteLength(JSON.stringify(atual), "utf8") > TETO_BYTES_ALVO &&
    (atual.observacoes_do_cliente.length > 0 || atual.pontos_de_melhoria.length > 0)
  ) {
    podado = true;
    // Empate → corta observação: o item dela carrega `evidencia` (citação
    // literal), então pesa mais bytes que um ponto de melhoria.
    const cortaObservacao = atual.observacoes_do_cliente.length >= atual.pontos_de_melhoria.length;
    atual = cortaObservacao
      ? { ...atual, observacoes_do_cliente: atual.observacoes_do_cliente.slice(0, -1) }
      : { ...atual, pontos_de_melhoria: atual.pontos_de_melhoria.slice(0, -1) };
  }

  return podado ? { ...atual, podado: true } : atual;
}

/**
 * A MONTAGEM. Pura — nenhum I/O, nenhuma chamada de IA, nenhum `Date.now()`
 * escondido (a duração sai dos dois carimbos que vêm nos insumos). É esta
 * função que `retrospecto.test.ts` exercita contra os números medidos em
 * produção.
 */
export function montarConteudoRetrospecto(insumos: InsumosRetrospecto): ConteudoRetrospecto {
  const cobertura = calcularCobertura(insumos.blocos, insumos.sugestoes);

  const minutos =
    insumos.iniciadoEm && insumos.encerradoEm
      ? Math.max(0, Math.round((Date.parse(insumos.encerradoEm) - Date.parse(insumos.iniciadoEm)) / 60_000))
      : null;

  // `null` (não um objeto de zeros) quando a sessão não acumulou nada —
  // "vazio é vazio, nunca zero". Medido: 1 das 3 sessões reais tem 0 itens.
  const resumo = insumos.inventario.length > 0 ? resumirInventario(insumos.inventario) : null;

  return podarConteudo({
    versao: 1,
    cobertura,
    duracao: { iniciado_em: insumos.iniciadoEm, encerrado_em: insumos.encerradoEm, minutos },
    patrimonio: resumo
      ? {
          total_itens_proprios: resumo.total_itens_proprios,
          total_itens_incertos: resumo.total_itens_incertos,
          por_categoria: resumo.por_categoria,
        }
      : null,
    observacoes_do_cliente: montarObservacoes(insumos.ficha, insumos.inventario, insumos.sugestoes),
    pontos_de_melhoria: montarPontosDeMelhoria(insumos.blocos, insumos.sugestoes),
    saude_do_motor: montarSaudeDoMotor(insumos),
    podado: false,
    nota_de_rodape: NOTA_DE_RODAPE,
  });
}

// ---------------------------------------------------------------------------
// 2. I/O — leitura dos insumos e gravação.
// ---------------------------------------------------------------------------

/** Só o `code` do PostgREST importa aqui — os caminhos que tratamos por
 * código são `23505` (unique_violation) e `42P01`/`42704` (objeto ausente). */
interface ErroPostgrestRetrospecto {
  code?: string;
}

/** A linha de `eventos_timeline` que conflitou no `23505` — o bastante para
 * decidir se foi o sistema que a gravou (F2). */
interface LinhaTimelineRetrospecto {
  id: string;
  titulo: string | null;
  descricao: string | null;
  ator_tipo: string | null;
  ator_perfil_id: string | null;
  ocorrido_em: string | null;
}

/** O título EXATO que `registrarRetrospectoNaTimeline` grava. Constante única
 * — é o que o reconhecedor de squat compara, então mudar o título sem mudar
 * aqui faria toda 2ª gravação parecer squat. */
const TITULO_EVENTO_RETROSPECTO = "Retrospecto da Sessão gerado";

/**
 * 🔴 F2 — "esta linha foi gravada por MIM?".
 *
 * Deliberadamente ESTREITO: só reconhece a forma exata que esta função
 * produz. Qualquer outra coisa é tratada como squat e vira alerta. Errar
 * para o lado do alarme é o certo aqui — um falso positivo custa uma
 * investigação; um falso negativo deixa texto de terceiro passando por
 * registro do sistema no Histórico de um cliente, para sempre.
 *
 * `descricao: null` entra na comparação de propósito (F5): a versão que
 * gravava métrica de condução ali não existe mais, e uma linha com descrição
 * preenchida não é do sistema.
 */
function eventoEhDoSistema(linha: LinhaTimelineRetrospecto): boolean {
  return linha.titulo === TITULO_EVENTO_RETROSPECTO && linha.descricao === null;
}

export const CHAVE_RETROSPECTO_ATIVO = "copiloto_sessao.retrospecto_ativo";

/** Mesma chave de `contexto.ts`/`estado.ts` — ver `carregarBlocosDaSessao`. */
const CHAVE_ROTEIRO_SESSAO_VIABILIDADE = "sessao_viabilidade";

/**
 * 🔴 FAIL-CLOSED. Chave ausente, valor ilegível ou erro de leitura ⇒
 * `false`: nada é gravado, nada é devolvido. A 0125 cria a chave com `true`;
 * a AUSÊNCIA dela significa "migration não aplicada", que é estado de
 * defeito — e defeito não liga feature. `lerConfiguracaoBool` com padrão
 * `false` já entrega exatamente isso (mesma disciplina de
 * `copiloto_sessao.resumo_acumulado`, B76).
 */
export function retrospectoEstaAtivo(supabase: SupabaseClient): Promise<boolean> {
  return lerConfiguracaoBool(supabase, CHAVE_RETROSPECTO_ATIVO, false);
}

interface SessaoParaRetrospecto {
  id: string;
  jornada_id: string;
  roteiro_versao_id: string | null;
  roteiros_versoes: { definicao: RoteiroDefinicao } | null;
  sessoes_copiloto: {
    iniciado_em: string | null;
    encerrado_em: string | null;
    inventario_acumulado: InventarioAcumulado | null;
    ficha_acumulada: FichaAcumulada | null;
  } | null;
}

/**
 * 🔴 O ROTEIRO É O DAQUELA SESSÃO, nunca "o ativo de hoje" por comodidade —
 * critério de aceite explícito de BE-2. Uma sessão conduzida por um roteiro
 * de 11 partes não pode ser julgada contra um roteiro de 13.
 *
 * O fallback para o roteiro ATIVO só entra quando `roteiro_versao_id` é
 * NULO, que é o DESENHO e não defeito de dado: a FK só é carimbada por
 * `registrar_sim_sessao` (0030) no 1º SIM. É exatamente o mesmo fallback,
 * com a mesma query e o mesmo índice (`uniq_roteiro_ativo`), que
 * `estado.ts` e `contexto.ts` já aplicam — medido em produção: 3 das 4
 * sessões têm a FK nula, e todas caem nos 13 blocos do `sessao_viabilidade`
 * v5. Sem este fallback, `blocos_no_roteiro` seria 0 e o CHECK
 * `blocos_no_roteiro > 0` da 0125 recusaria a linha.
 */
async function carregarBlocosDaSessao(supabase: SupabaseClient, sessao: SessaoParaRetrospecto): Promise<RoteiroBloco[]> {
  const blocos = sessao.roteiros_versoes?.definicao?.blocos ?? [];
  if (blocos.length > 0) return blocos;

  const { data, error } = await supabase
    .from("roteiros_versoes")
    .select("definicao")
    .eq("chave", CHAVE_ROTEIRO_SESSAO_VIABILIDADE)
    .eq("ativo", true)
    .maybeSingle<{ definicao: RoteiroDefinicao }>();
  if (error) throw error;
  return data?.definicao?.blocos ?? [];
}

/** Chave do prompt do copiloto — a mesma de `0093`/`prompts_versoes`. */
const CHAVE_PROMPT_COPILOTO = "copiloto_sessao";

/** Teto de execuções lidas por sessão. Medido em produção (19/09): a sessão
 * mais intensa teve 299 execuções em 2h01. 1.000 é ~3,3× de folga e é um
 * teto de verdade — nenhuma leitura sem limite. */
const LOTE_EXECUCOES = 1000;

/**
 * 🔴 AS EXECUÇÕES DE IA DA SESSÃO — e por que NÃO saem de
 * `copiloto_sugestoes.execucao_ia_id`.
 *
 * A 1ª versão desta função derivava as execuções dos `execucao_ia_id` das
 * sugestões. MEDIDO contra produção em 19/09/2026, isso dava
 * **`execucoes_truncadas = 0` nas três sessões reais** — e o número real é
 * 0, 49 e 16. A razão é estrutural, não um bug de query: quando o modelo
 * estoura o teto de saída (`stop_reason='max_tokens'`), o JSON quebra, a
 * sugestão inteira é descartada e **nenhuma linha de `copiloto_sugestoes`
 * jamais aponta para aquela execução**. Contar truncamento pelo lado das
 * sugestões é contar exatamente o conjunto que, por definição, não trunca.
 *
 * Um campo "% truncadas" que devolve 0% quando o valor real é 16,4% é o
 * padrão já catalogado nesta casa de buraco virando número plausível — e
 * seria pior aqui do que em qualquer outro lugar, porque este número existe
 * para responder "dá para confiar neste retrospecto?".
 *
 * O recorte correto, e o que esta função faz, é: execuções DESTA jornada,
 * DENTRO da janela da sessão (`iniciado_em`..`encerrado_em`), do prompt
 * `copiloto_sessao` (qualquer versão — a sessão pode atravessar uma troca de
 * versão). Conferido contra produção: devolve 0/90, 49/299 e 16/224, e o
 * 49/299 bate exatamente com o número medido à parte no briefing.
 *
 * DUAS queries, ambas fora do caminho quente (isto roda 1× por sessão, no
 * encerramento): as versões do prompt e as execucões na janela. `jornada_id`
 * e `criado_em` são as colunas que `execucoes_ia` tem — não existe
 * `sessao_id` ali.
 *
 * 🔴 `null` quando a janela é DESCONHECIDA (falta `iniciado_em` ou
 * `encerrado_em`): sem janela não há recorte, e um recorte errado devolveria
 * execuções de outras sessões da mesma jornada. `null` faz a tela escrever
 * "—"; devolver `[]` faria escrever "0 execuções", que é falso.
 */
async function carregarExecucoesDaSessao(
  supabase: SupabaseClient,
  params: { jornadaId: string; iniciadoEm: string | null; encerradoEm: string | null },
): Promise<Array<{ id: string; stop_reason: string | null }> | null> {
  if (!params.iniciadoEm || !params.encerradoEm) return null;

  const { data: versoes, error: erroVersoes } = await supabase
    .from("prompts_versoes")
    .select("id")
    .eq("chave", CHAVE_PROMPT_COPILOTO)
    .returns<Array<{ id: string }>>();
  if (erroVersoes) throw erroVersoes;

  const ids = (versoes ?? []).map((v) => v.id);
  if (ids.length === 0) return null; // prompt inexistente: não medir é mais honesto que medir 0

  const { data, error } = await supabase
    .from("execucoes_ia")
    .select("id, stop_reason")
    .eq("jornada_id", params.jornadaId)
    .gte("criado_em", params.iniciadoEm)
    .lte("criado_em", params.encerradoEm)
    .in("prompt_versao_id", ids)
    .limit(LOTE_EXECUCOES)
    .returns<Array<{ id: string; stop_reason: string | null }>>();
  if (error) throw error;
  return data ?? [];
}

/**
 * Lê os insumos e monta o `conteudo`. Separada de `gravarRetrospectoDaSessao`
 * para a rota `GET` poder, no futuro, remontar sem gravar — e para o teste
 * poder provar as queries sem passar pelo INSERT.
 *
 * QUERIES (todas fora do caminho quente — isto roda 1× por sessão, no
 * encerramento, onde latência não importa porque a sessão acabou):
 *   1. `sessoes_viabilidade` + embed de `roteiros_versoes` e
 *      `sessoes_copiloto` — MESMO embed que `montarEstadoCopiloto` já usa,
 *      uma ida.
 *   2. `roteiros_versoes` ativo — SÓ quando a FK é nula (ver acima).
 *   3. `copiloto_sugestoes` desta sessão, com teto (`LOTE_SUGESTOES`).
 *   4. `prompts_versoes` (chave `copiloto_sessao`) + `execucoes_ia` na janela
 *      da sessão — DUAS idas, nunca N+1, e nunca derivadas das sugestões
 *      (ver `carregarExecucoesDaSessao`: derivar das sugestões reportava 0%
 *      de truncamento onde o real é 16,4%). Puladas quando a janela é
 *      desconhecida.
 */
export async function montarRetrospectoDaSessao(
  supabase: SupabaseClient,
  sessaoId: string,
): Promise<{ jornadaId: string; conteudo: ConteudoRetrospecto } | null> {
  const { data: sessao, error } = await supabase
    .from("sessoes_viabilidade")
    .select(
      "id, jornada_id, roteiro_versao_id, roteiros_versoes(definicao), " +
        "sessoes_copiloto(iniciado_em, encerrado_em, inventario_acumulado, ficha_acumulada)",
    )
    .eq("id", sessaoId)
    .maybeSingle<SessaoParaRetrospecto>();
  if (error) throw error;
  if (!sessao) return null;

  const [blocos, sugestoesLidas] = await Promise.all([
    carregarBlocosDaSessao(supabase, sessao),
    supabase
      .from("copiloto_sugestoes")
      .select("bloco_id, conteudo, confianca")
      .eq("sessao_id", sessaoId)
      .order("ordem_evento", { ascending: true })
      .limit(LOTE_SUGESTOES)
      .returns<SugestaoParaRetrospecto[]>(),
  ]);
  if (sugestoesLidas.error) throw sugestoesLidas.error;
  const sugestoes = sugestoesLidas.data ?? [];

  const execucoes = await carregarExecucoesDaSessao(supabase, {
    jornadaId: sessao.jornada_id,
    iniciadoEm: sessao.sessoes_copiloto?.iniciado_em ?? null,
    encerradoEm: sessao.sessoes_copiloto?.encerrado_em ?? null,
  });

  return {
    jornadaId: sessao.jornada_id,
    conteudo: montarConteudoRetrospecto({
      blocos,
      sugestoes,
      ficha: sessao.sessoes_copiloto?.ficha_acumulada ?? [],
      inventario: sessao.sessoes_copiloto?.inventario_acumulado ?? [],
      iniciadoEm: sessao.sessoes_copiloto?.iniciado_em ?? null,
      encerradoEm: sessao.sessoes_copiloto?.encerrado_em ?? null,
      execucoes,
    }),
  };
}

/**
 * 🔴 O EVENTO DE TIMELINE DO RETROSPECTO — achado do `frontend-engineer`
 * (19/09/2026) sobre a entrega da Fase 13.
 *
 * SEM ESTA FUNÇÃO, a feature fica INVISÍVEL na Pasta do Cliente.
 * `src/lib/pasta/derivar.ts:66` decide o estado do item `retrospecto_sv`
 * assim:
 *
 *     const temRetrospecto = ficha.timeline.some((e) => e.tipo === "retrospecto");
 *
 * — o MESMO mecanismo de `analise_sessao` e `transcricao`: um evento na
 * timeline que a Ficha 360 já carrega, sem requisição nova. A 0125 criou a
 * tabela e o encerramento passou a gravar o documento, mas ninguém gravava o
 * evento: o retrospecto existia no banco e o item ficava preso em `falta`.
 * Não era dado falso (`derivar.ts` degrada, nunca inventa `pronto` — e isso
 * está certo), era o padrão desta casa de "feature sem migration vira
 * invisível". Esta função fecha isso.
 *
 * ⚠️ O CONTRATO É DO FRONTEND E NÃO SE NEGOCIA DAQUI: o único campo que
 * `derivar.ts` lê é `tipo === "retrospecto"`. `titulo`, `descricao` e `dados`
 * são para o HISTÓRICO (quem lê é gente), e `dados.sessao_id` é o que torna o
 * evento único (índice da 0126). Nenhum arquivo de `src/lib/pasta/` foi
 * tocado — o backend se adaptou ao que estava lá.
 *
 * `eventos_timeline.tipo` é `text` SEM CHECK (0014:11, confirmado na 0070 e
 * reusado pela 0074 para o tipo `link`) — tipo novo NUNCA precisou de DDL
 * nesta base. A 0126 existe pela UNICIDADE, não pelo tipo.
 *
 * ===========================================================================
 * POR QUE `admin.from(...).insert()` E NÃO `app.registrar_evento_timeline`
 * ===========================================================================
 * A RPC (0014:31) existe para ser chamada de dentro de TRIGGERS, e resolve o
 * ator com `(select id from perfis_equipe where auth_user_id = auth.uid())`.
 * Chamada com `service_role` não há `auth.uid()`, então ela gravaria
 * `ator_perfil_id = NULL` **e** `ator_tipo` no default `'humano'` — um evento
 * que afirma ter sido feito por uma pessoa, sem dizer qual. Mentira pequena,
 * mas mentira: o encerramento por `duracao_maxima_minutos` não tem humano
 * nenhum por trás.
 *
 * O INSERT direto é o padrão já provado desta base para escrita de timeline
 * a partir do SERVIDOR (`server/publico/timeline-links.ts:46`,
 * `server/agente-whatsapp/estado.ts:166`, `api/croquis/[id]/docx/route.ts`):
 * dá controle de `ator_perfil_id` e `ator_tipo`, que é o que torna o registro
 * honesto — `'humano'` quando a advogada clicou "Encerrar", `'sistema'`
 * quando foi o ciclo automático.
 *
 * Isso também nos mantém FORA da armadilha catalogada ("trigger não exige
 * EXECUTE de quem faz o DML, mas chamada aninhada dentro da função exige"):
 * não há chamada aninhada aqui. Ainda assim, o privilégio foi CONFERIDO em
 * produção em 19/09/2026 com uma sonda não destrutiva — INSERT com
 * `jornada_id` inexistente devolveu **23503** (violação de FK), não 42501
 * (permission denied): `service_role` tem o GRANT de INSERT e a RLS não
 * barra. Nenhuma linha foi criada pela sonda.
 *
 * ===========================================================================
 * IDEMPOTÊNCIA — duas travas, como no documento
 * ===========================================================================
 * 1. **Banco (0126):** índice único parcial
 *    `uniq_timeline_retrospecto_sessao on eventos_timeline ((dados->>'sessao_id'))
 *    where tipo = 'retrospecto'`. Duas linhas para a mesma sessão é
 *    impossível, venha de onde vier.
 * 2. **Código:** esta função roda dentro de `gravarRetrospectoDaSessao`, que
 *    por sua vez roda depois de `marcarEncerrada` devolver não-nulo.
 *
 * 🔴 `23505` é tratado como **SUCESSO**, não como falha: "o evento já existe"
 * é exatamente o resultado desejado de uma segunda chamada. Tratar como erro
 * encheria o log de alarme falso toda vez que a idempotência FUNCIONASSE — e
 * alerta que acende quando está tudo certo é alerta que se aprende a ignorar.
 *
 * 🔴 `42P01`/`42704` (tabela ou índice ausentes — 0126 não aplicada) também
 * NÃO derrubam nada: sem o índice o INSERT simplesmente acontece, e a única
 * consequência é o risco de duplicata, que não vale bloquear o encerramento.
 *
 * 🔴 NUNCA LANÇA. Timeline é registro SECUNDÁRIO — mesma decisão, com as
 * mesmas palavras, de `timeline-links.ts` ("falha aqui NÃO derruba a
 * emissão"). O documento já está gravado; perder o evento custa um item da
 * Pasta aparecendo como `falta`, e isso é infinitamente melhor que perder o
 * encerramento da sessão.
 *
 * PII: `dados` leva só IDS e NÚMEROS (a fração de cobertura). NENHUM texto do
 * `conteudo`, NENHUMA citação literal, NENHUM nome — a timeline é lida por
 * `app.eh_interno()` (0014:24), um recorte MAIS LARGO que o
 * `app.ve_patrimonio()` que protege o retrospecto em si. Levar conteúdo para
 * cá seria vazar PII pesada para quem a 0125 decidiu que não pode vê-la.
 */
async function registrarRetrospectoNaTimeline(
  admin: SupabaseClient,
  params: { jornadaId: string; sessaoId: string; atorPerfilId: string | null; blocosComAtividade: number; blocosNoRoteiro: number },
): Promise<void> {
  try {
    const { error } = await admin.from("eventos_timeline").insert({
      jornada_id: params.jornadaId,
      // 🔴 O contrato de `lib/pasta/derivar.ts:66`. Trocar esta string
      // desliga o item `retrospecto_sv` da Pasta em silêncio.
      tipo: "retrospecto",
      titulo: TITULO_EVENTO_RETROSPECTO,
      // 🔴 F5 (pentest Fase 13, 19/09/2026) — SEM MÉTRICA DE CONDUÇÃO AQUI.
      // Esta linha dizia "Cobertura do roteiro: 4 de 13 partes." e ia parar
      // no Histórico do cliente, que é lido por `app.eh_interno()` — recorte
      // que INCLUI `relacionamento`. O resultado era um julgamento da
      // condução da Dra. Elaine legível por quem nem pode abrir o documento
      // que o justifica. A fração continua existindo em `dados` (que a tela
      // do Histórico não renderiza) e no retrospecto em si, atrás de
      // `ve_patrimonio` — onde ela tem contexto para ser lida.
      descricao: null,
      dados: {
        // Chave do índice único da 0126 — é o que torna o evento idempotente.
        sessao_id: params.sessaoId,
        blocos_com_atividade: params.blocosComAtividade,
        blocos_no_roteiro: params.blocosNoRoteiro,
      },
      ator_perfil_id: params.atorPerfilId,
      // Honesto nos dois caminhos: a advogada clicou, ou o ciclo automático
      // encerrou por `duracao_maxima_minutos`. Nunca 'humano' sem humano.
      ator_tipo: params.atorPerfilId ? "humano" : "sistema",
    });

    if (!error) return;

    const codigo = (error as ErroPostgrestRetrospecto).code;

    // 42P01/42704: 0126 não aplicada — degrada, não quebra.
    if (codigo === "42P01" || codigo === "42704") return;

    // 🔴 F2 (pentest Fase 13, 19/09/2026) — `23505` NÃO É SUCESSO POR SI SÓ.
    //
    // A versão anterior devolvia sucesso mudo em qualquer `23505`. O índice
    // da 0126 é único por `(dados->>'sessao_id') where tipo='retrospecto'`,
    // mas `eventos_timeline` aceita INSERT de QUALQUER papel interno
    // (`tl_ins`, 0014:25 — `app.eh_interno()`, que inclui `relacionamento`)
    // e `tipo` é `text` livre. Então alguém de dentro podia PLANTAR a linha
    // antes do encerramento, com `titulo`/`descricao` escolhidos por ela, e
    // esta rotina trataria como "já existe" — em silêncio. O Histórico do
    // cliente passaria a exibir texto de outra pessoa como se fosse do
    // sistema, numa tabela APPEND-ONLY que a aplicação não sabe corrigir.
    //
    // A trava de verdade é a policy restrita (0128). Esta aqui é a segunda:
    // relê a linha conflitante e só aceita se for a linha do SISTEMA. Se for
    // de outra pessoa, o evento é um SQUAT — registrado com código próprio,
    // porque um fato falso no Histórico de um cliente não pode passar mudo.
    if (codigo === "23505") {
      const { data: conflitante, error: erroLeitura } = await admin
        .from("eventos_timeline")
        .select("id, titulo, descricao, ator_tipo, ator_perfil_id, ocorrido_em")
        .eq("jornada_id", params.jornadaId)
        .eq("tipo", "retrospecto")
        .contains("dados", { sessao_id: params.sessaoId })
        .maybeSingle<LinhaTimelineRetrospecto>();

      // Não conseguiu reler: não afirma nem nega. Registra e sai — nunca
      // acusa squat sem ter lido, nem dá sucesso sem ter conferido.
      if (erroLeitura || !conflitante) {
        registrarErro("copiloto/retrospecto.registrarRetrospectoNaTimeline#conflito_nao_lido", erroLeitura ?? new Error("linha conflitante não encontrada"), {
          sessao_id: params.sessaoId,
          jornada_id: params.jornadaId,
        });
        return;
      }

      if (eventoEhDoSistema(conflitante)) return; // idempotência funcionando: SUCESSO de verdade

      // SQUAT. `registrarErro` leva só ids + o id do evento e de quem o
      // gravou — nunca o `titulo`/`descricao` plantados (texto de origem não
      // confiável não entra em log que alguém vai ler depois como fato).
      registrarErro(
        "copiloto/retrospecto.registrarRetrospectoNaTimeline#evento_squatado",
        new Error("evento de timeline tipo=retrospecto desta sessão já existia e NÃO foi gravado pelo sistema"),
        {
          sessao_id: params.sessaoId,
          jornada_id: params.jornadaId,
          evento_id: conflitante.id,
          ator_perfil_id: conflitante.ator_perfil_id,
          ator_tipo: conflitante.ator_tipo,
          ocorrido_em: conflitante.ocorrido_em,
        },
      );
      return;
    }

    registrarErro("copiloto/retrospecto.registrarRetrospectoNaTimeline", error, {
      sessao_id: params.sessaoId,
      jornada_id: params.jornadaId,
    });
  } catch (erro) {
    // Defesa em profundidade: nem uma exceção inesperada do driver pode
    // subir daqui para o encerramento.
    registrarErro("copiloto/retrospecto.registrarRetrospectoNaTimeline#inesperado", erro, {
      sessao_id: params.sessaoId,
      jornada_id: params.jornadaId,
    });
  }
}

/**
 * Monta e GRAVA o retrospecto — chamada de dentro de
 * `executarEncerramentoCopiloto`, DEPOIS de `marcarEncerrada` devolver
 * não-nulo (o portão que já garante "uma vez por sessão" nos três caminhos:
 * clique, `duracao_maxima_minutos` e retomada de sessão em `'erro'`).
 *
 * 🔴 NUNCA LANÇA e nunca pode derrubar o encerramento — mesma disciplina de
 * `tirarBotDaSalaSeHouver`: falhou, a sessão encerra assim mesmo e a rota
 * responde `retrospecto: null`; a tela mostra o stub rotulado ("não foi
 * possível montar o retrospecto desta sessão"), NUNCA um retrospecto vazio
 * disfarçado de retrospecto real.
 *
 * 🔴 `on conflict (sessao_id) do nothing` é cinto e suspensório sobre a PK:
 * a corrida entre o clique da advogada e o ciclo automático no MESMO segundo
 * não pode virar 500 na cara dela. Quando o conflito acontece, RELÊ a linha
 * existente e devolve ESSA — encerrar duas vezes mostra o mesmo papel, nunca
 * dois, e nunca `null` só porque perdeu a corrida.
 */
export async function gravarRetrospectoDaSessao(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  params: { sessaoId: string; jornadaId: string; criadoPor: string | null },
): Promise<RetrospectoDaSessao | null> {
  try {
    if (!(await retrospectoEstaAtivo(supabase))) return null;

    const montado = await montarRetrospectoDaSessao(supabase, params.sessaoId);
    if (!montado) return null;

    const { data, error } = await admin
      .from("copiloto_retrospectos")
      .upsert(
        {
          sessao_id: params.sessaoId,
          jornada_id: params.jornadaId,
          origem: "derivado",
          schema_versao: montado.conteudo.versao,
          blocos_com_atividade: montado.conteudo.cobertura.blocos_com_atividade,
          blocos_no_roteiro: montado.conteudo.cobertura.blocos_no_roteiro,
          conteudo: montado.conteudo,
          criado_por: params.criadoPor,
        },
        { onConflict: "sessao_id", ignoreDuplicates: true },
      )
      .select("sessao_id, jornada_id, origem, schema_versao, blocos_com_atividade, blocos_no_roteiro, conteudo, evidencias_redigidas_em, criado_em")
      .maybeSingle<RetrospectoDaSessao>();
    if (error) throw error;

    // `ignoreDuplicates` devolve 0 linha quando a linha JÁ existia — relê a
    // que está lá (o retrospecto é imutável; o que já existe é o certo).
    const retrospecto = data ?? (await lerRetrospectoDaSessao(admin, params.sessaoId));
    if (!retrospecto) return null;

    // 🔴 O EVENTO DE TIMELINE — sem ele o item `retrospecto_sv` fica preso em
    // `falta` na Pasta e a feature é invisível (achado do frontend). Vem
    // DEPOIS do documento existir de verdade (inclusive no ramo em que a
    // corrida foi perdida e relemos a linha alheia): evento sem documento
    // seria a Pasta dizendo `pronto` sobre um papel que não existe — o
    // oposto exato do defeito que estamos corrigindo.
    //
    // NUNCA lança (try/catch próprio) e NUNCA muda o que esta função
    // devolve: falhar aqui custa um item da Pasta em `falta`, e isso não
    // pode valer o encerramento da sessão.
    await registrarRetrospectoNaTimeline(admin, {
      jornadaId: params.jornadaId,
      sessaoId: params.sessaoId,
      atorPerfilId: params.criadoPor,
      blocosComAtividade: retrospecto.blocos_com_atividade,
      blocosNoRoteiro: retrospecto.blocos_no_roteiro,
    });

    return retrospecto;
  } catch (erro) {
    // PII: `registrarErro` recebe só ids. NENHUMA citação literal, nenhum
    // trecho de `conteudo` — o corpo do retrospecto carrega fala de família
    // real e não pode vazar para log/Sentry.
    registrarErro("copiloto/retrospecto.gravarRetrospectoDaSessao", erro, {
      sessao_id: params.sessaoId,
      jornada_id: params.jornadaId,
    });
    return null;
  }
}

/**
 * 🔴 D-1 — "ESTA LINHA AINDA É UM RETROSPECTO?"
 *
 * A 0127 (anonimização do titular, LGPD art. 18) zera
 * `copiloto_retrospectos.conteudo` para `'{}'::jsonb`. A LINHA continua lá —
 * é assim que a família inteira de `anonimizar_titular` funciona (`briefings`,
 * `croqui_analises`, `materiais_gerados` também viram `'{}'`): apaga-se o
 * conteúdo, preserva-se o registro de que o ato existiu.
 *
 * Só que `ConteudoRetrospecto` promete `versao`, `cobertura`, `duracao`… e
 * quem lê faz `conteudo.cobertura.blocos_com_atividade`. Sobre `{}` isso é
 * **TypeError**, não "documento vazio". A correção de LGPD plantaria um
 * crash na tela do primeiro titular anonimizado — e o gatilho ("antes da 1ª
 * anonimização real") é justamente o tipo de gatilho que ninguém vê passar.
 *
 * Fechado AQUI, no servidor, e não na tela: linha anonimizada **não é um
 * retrospecto, é uma lápide**. O front já sabe renderizar ausência; não
 * precisa aprender a renderizar destroço.
 *
 * `versao` é o discriminante certo porque é o ÚNICO campo que
 * `montarConteudoRetrospecto` sempre grava com valor fixo (`1`) e que nenhum
 * caminho de poda ou redação remove — diferente de `observacoes_do_cliente`,
 * que legitimamente fica `[]` numa sessão sem observação nenhuma.
 */
function temCorpoDeRetrospecto(conteudo: unknown): boolean {
  return typeof conteudo === "object" && conteudo !== null && typeof (conteudo as { versao?: unknown }).versao === "number";
}

/** O que a leitura encontrou. Os três casos pedem respostas DIFERENTES da
 * rota, e colapsá-los em `null` foi o que criou a D-1 e quase criou a D-2. */
export type ResultadoLeituraRetrospecto =
  /** Linha existe e tem corpo utilizável. */
  | { estado: "ok"; retrospecto: RetrospectoDaSessao }
  /** Não há linha. Pode ser falha na gravação do encerramento — é o único
   * caso em que remontar sob demanda faz sentido (D-2). */
  | { estado: "ausente" }
  /** 🔴 Linha existe, corpo foi esvaziado pela anonimização. **NUNCA
   * remontar**: as FONTES (`ficha_acumulada`, `inventario_acumulado`,
   * `copiloto_sugestoes.conteudo`) também foram zeradas pela 0127, então a
   * remontagem produziria um documento novo, com data de hoje, sobre um
   * titular cujo tratamento o escritório declarou encerrado. É o oposto do
   * que o art. 18 pede. */
  | { estado: "lapide" };

/** Leitura por PK — o caminho do pop-up, da rota `GET` e da aba da Ficha 360. */
export async function lerRetrospectoComEstado(
  supabase: SupabaseClient,
  sessaoId: string,
): Promise<ResultadoLeituraRetrospecto> {
  const { data, error } = await supabase
    .from("copiloto_retrospectos")
    .select("sessao_id, jornada_id, origem, schema_versao, blocos_com_atividade, blocos_no_roteiro, conteudo, evidencias_redigidas_em, criado_em")
    .eq("sessao_id", sessaoId)
    .maybeSingle<RetrospectoDaSessao>();
  if (error) throw error;
  if (!data) return { estado: "ausente" };
  if (!temCorpoDeRetrospecto(data.conteudo)) return { estado: "lapide" };
  return { estado: "ok", retrospecto: data };
}

/** Atalho para quem só quer o documento utilizável — `null` cobre ausente E
 * lápide. É o que `gravarRetrospectoDaSessao` usa na releitura de corrida:
 * uma linha anonimizada não deve ser devolvida como se fosse o documento
 * recém-gravado, nem gerar evento de timeline. */
export async function lerRetrospectoDaSessao(supabase: SupabaseClient, sessaoId: string): Promise<RetrospectoDaSessao | null> {
  const leitura = await lerRetrospectoComEstado(supabase, sessaoId);
  return leitura.estado === "ok" ? leitura.retrospecto : null;
}

/**
 * 🔴 D-2 — REMONTAR SOB DEMANDA.
 *
 * `gravarRetrospectoDaSessao` nunca derruba o encerramento: se falhar, a
 * sessão encerra e o documento não existe. Até aqui, o efeito era permanente
 * — `GET` devolvia 404 para sempre e a advogada perdia o documento sem
 * nunca saber por quê, porque `marcarEncerrada` já não deixa o encerramento
 * rodar de novo.
 *
 * A v1 resolve com o caminho mais simples que funciona: quando NÃO HÁ LINHA e
 * a sessão está encerrada, o próprio `GET` monta e grava. Sem fila, sem
 * retry automático, sem job — a montagem é derivada e determinística
 * (`montarConteudoRetrospecto` é pura), então remontar dias depois produz o
 * mesmo documento que teria sido gravado na hora.
 *
 * TRÊS GUARDAS, e cada uma fecha um jeito diferente de errar:
 *
 *  1. **Só com a sessão ENCERRADA.** Uma sessão ao vivo tem retrospecto
 *     incompleto por definição; gravar no meio congelaria um documento
 *     parcial e a PK impediria o certo de entrar depois.
 *  2. **Só quando NÃO HÁ LINHA** (decidido pelo chamador, com
 *     `lerRetrospectoComEstado`). Lápide nunca remonta — ver o comentário de
 *     `ResultadoLeituraRetrospecto`.
 *  3. **`criadoPor: null`.** Quem abriu a tela não conduziu a sessão; a
 *     autoria honesta deste documento é do sistema, montando depois do fato.
 *
 * A leitura do estado usa o cliente COM SESSÃO (a RLS decide se esta pessoa
 * pode ver esta sessão); só a ESCRITA usa `admin`, porque `copiloto_retrospectos`
 * não tem policy de INSERT para `authenticated` (0125), de propósito.
 */
export async function remontarRetrospectoSeEncerrada(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  sessaoId: string,
): Promise<RetrospectoDaSessao | null> {
  const { data, error } = await supabase
    .from("sessoes_viabilidade")
    .select("id, jornada_id, sessoes_copiloto(estado)")
    .eq("id", sessaoId)
    .maybeSingle<{ id: string; jornada_id: string; sessoes_copiloto: { estado: string } | null }>();
  if (error) throw error;
  if (!data) return null;                                    // RLS negou, ou sessão não existe
  if (data.sessoes_copiloto?.estado !== "encerrado") return null;  // guarda 1

  return await gravarRetrospectoDaSessao(supabase, admin, {
    sessaoId,
    jornadaId: data.jornada_id,
    criadoPor: null,                                          // guarda 3
  });
}

// ---------------------------------------------------------------------------
// 3. DOCX. Só a BIBLIOTECA é reaproveitada do croqui (`docx@^9.7.1`, já no
// `package.json` — zero dependência nova). O builder do croqui não, porque é
// acoplado ao `ResultadoCroqui`.
// ---------------------------------------------------------------------------

export const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const ROTULO_CATEGORIA: Record<string, string> = {
  objecao: "Objeção",
  dor: "Dor",
  desejo: "Desejo",
  fato_decisor: "Fato sobre o decisor",
  patrimonio: "Patrimônio",
};
const ROTULO_TIPO: Record<string, string> = {
  fato: "Fato",
  hipotese: "Hipótese",
  inferencia: "Inferência",
  recomendacao: "Recomendação",
};

function paragrafo(texto: string, opcoes?: { negrito?: boolean; tamanho?: number; espacoAntes?: number }): Paragraph {
  return new Paragraph({
    spacing: { before: opcoes?.espacoAntes ?? 0, after: 80 },
    children: [new TextRun({ text: texto, bold: opcoes?.negrito ?? false, size: opcoes?.tamanho ?? 20, font: "Arial" })],
  });
}

/**
 * 🔴 NOME DO CLIENTE NUNCA ENTRA NO `.docx` — nem no corpo, nem no nome do
 * arquivo (ver `nomeArquivoRetrospecto` na rota). O documento é sobre a
 * SESSÃO DE COPILOTO, não sobre a pessoa; a identificação já está na Ficha
 * 360 de onde ele foi baixado. Menos PII em arquivo que sai do sistema é
 * menos superfície — mesma regra 4 da 0028 que vale para `/p/m`.
 */
export async function montarDocxRetrospecto(retrospecto: RetrospectoDaSessao): Promise<Buffer> {
  const c = retrospecto.conteudo;
  const filhos: Paragraph[] = [];

  filhos.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 160 },
      children: [new TextRun({ text: "Retrospecto da Sessão de Viabilidade", bold: true, size: 32, font: "Arial" })],
    }),
  );
  filhos.push(paragrafo(`Gerado em ${new Date(retrospecto.criado_em).toLocaleString("pt-BR")} · origem: ${retrospecto.origem}`));

  filhos.push(paragrafo("Cobertura do roteiro", { negrito: true, tamanho: 24, espacoAntes: 240 }));
  filhos.push(paragrafo(`${c.cobertura.blocos_com_atividade} de ${c.cobertura.blocos_no_roteiro} partes com atividade registrada.`));
  if (c.cobertura.nao_percorridos.length > 0) {
    filhos.push(paragrafo("Partes sem atividade registrada:"));
    for (const b of c.cobertura.nao_percorridos) filhos.push(paragrafo(`• ${b.titulo}`));
  }

  filhos.push(paragrafo("Duração", { negrito: true, tamanho: 24, espacoAntes: 240 }));
  filhos.push(
    paragrafo(
      c.duracao.minutos === null
        ? "Não registrada."
        : `${Math.floor(c.duracao.minutos / 60)}h${String(c.duracao.minutos % 60).padStart(2, "0")}`,
    ),
  );

  filhos.push(paragrafo("Patrimônio captado", { negrito: true, tamanho: 24, espacoAntes: 240 }));
  if (!c.patrimonio) {
    filhos.push(paragrafo("Nenhum item de patrimônio foi levantado nesta sessão."));
  } else {
    filhos.push(
      paragrafo(`${c.patrimonio.total_itens_proprios} próprios · ${c.patrimonio.total_itens_incertos} a confirmar`),
    );
    for (const cat of c.patrimonio.por_categoria) {
      filhos.push(
        paragrafo(
          `• ${cat.categoria}: ${cat.contagem_propria} próprios, ${cat.contagem_incerta} a confirmar, ${cat.sem_titularidade} sem titularidade`,
        ),
      );
    }
  }

  filhos.push(paragrafo("Observações sobre o cliente", { negrito: true, tamanho: 24, espacoAntes: 240 }));
  if (c.observacoes_do_cliente.length === 0) {
    filhos.push(paragrafo("Nenhuma observação foi registrada nesta sessão."));
  } else {
    for (const obs of c.observacoes_do_cliente) {
      const rotulo = obs.categoria ? ROTULO_CATEGORIA[obs.categoria] : ROTULO_TIPO[obs.tipo ?? ""];
      filhos.push(paragrafo(`• [${rotulo ?? "—"}] ${obs.texto}${obs.n > 1 ? ` (${obs.n}×)` : ""}`));
      // Citação só quando ainda existe: depois do expurgo `evidencia` é
      // `null` e o documento simplesmente não traz a linha — nunca um
      // blockquote vazio fingindo que houve citação.
      if (obs.evidencia) filhos.push(paragrafo(`    "${obs.evidencia}"`));
    }
  }

  filhos.push(paragrafo("Pontos de melhoria da condução", { negrito: true, tamanho: 24, espacoAntes: 240 }));
  if (c.pontos_de_melhoria.length === 0) {
    filhos.push(paragrafo("Nenhum ponto de melhoria foi apontado durante esta sessão."));
  } else {
    for (const p of c.pontos_de_melhoria) {
      filhos.push(paragrafo(`• ${p.item}${p.bloco_titulo ? ` — ${p.bloco_titulo}` : ""}${p.n > 1 ? ` (${p.n}×)` : ""}`));
    }
  }

  filhos.push(paragrafo("Saúde do motor", { negrito: true, tamanho: 24, espacoAntes: 240 }));
  const s = c.saude_do_motor;
  filhos.push(
    paragrafo(
      `${s.sugestoes} sugestões · confiança média ${s.confianca_media === null ? "—" : s.confianca_media.toFixed(2)} · ` +
        `${s.sugestoes_com_evidencia_nao_conferida} de ${s.sugestoes} com evidência não conferida · ` +
        // "—" quando a janela da sessão é desconhecida: o documento diz que
        // não mediu, nunca escreve "0 de 0 truncadas".
        (s.execucoes_ia === null || s.execucoes_truncadas === null
          ? "execuções truncadas: não medido nesta sessão"
          : `${s.execucoes_truncadas} de ${s.execucoes_ia} execuções truncadas`),
    ),
  );

  if (c.podado) {
    filhos.push(paragrafo("Parte das listas acima foi cortada por limite de tamanho do documento.", { espacoAntes: 240 }));
  }
  filhos.push(paragrafo(c.nota_de_rodape, { espacoAntes: 240, tamanho: 18 }));

  const doc = new Document({
    sections: [
      {
        children: filhos,
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: "Documento interno — contém dado sigiloso de cliente.", size: 16, font: "Arial" }),
                ],
              }),
            ],
          }),
        },
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}
