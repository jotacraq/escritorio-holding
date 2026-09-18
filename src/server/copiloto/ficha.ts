import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarErro } from "@/server/erros";
import type {
  CategoriaFichaCliente,
  FichaAcumulada,
  ItemFichaCliente,
  ItemFichaClienteAcumulado,
  ItemFichaParaPainel,
  ItemInventarioRecentePainel,
} from "@/types/copiloto";

/**
 * FICHA DO CLIENTE — 18/09/2026 (pedido do dono). Hoje a col. 3 da tela
 * `/conduzir` é transcrição+inventário em ABAS que a advogada nunca clica.
 * Vira "Ficha do cliente": o retrato humano do decisor, acumulado na
 * sessão, sempre visível. Medido na sessão real que motivou o pedido: as
 * `observacao` da IA são 74% sobre navegação ("a conversa já avançou..."),
 * mas as EVIDÊNCIAS por trás são ouro — "eu vou perder qualidade de vida"
 * (dor), "imposto de renda é 30 por 100" (objeção), "40 40 10 e 10"
 * (desejo). 173 geradas e descartadas.
 *
 * MESMO PADRÃO de `inventario.ts` (função pura de acumulação + I/O
 * separado, upsert por chave — nunca delete+insert, regra "anti-piscada":
 * item já registrado não some por não ter sido repetido na janela mais
 * recente):
 *   - `acumularFicha` — mescla itens NOVOS (de uma chamada de IA) no array
 *     já acumulado.
 *   - `ordenarFicha` — o que REALMENTE vai para a tela: a Ficha
 *     COMBINADA com o inventário (patrimônio) já acumulado, na ordem que a
 *     regra de negócio do dono exige (ver `rank_categoria` abaixo).
 *   - `podarPorBytes` — mesmo raciocínio de `resumo.ts`, alvo de 3.000 B
 *     contra o CHECK de 4096 da migration 0122 (margem recalculada para as
 *     7 chaves de `ItemFichaClienteAcumulado` — ver `TETO_BYTES_ALVO_FICHA`
 *     abaixo para a conta completa).
 *
 * A ROTA/CICLO fazem o I/O — leem `sessoes_copiloto.ficha_acumulada`, chamam
 * `acumularFicha` com os itens novos que a IA devolveu, gravam de volta por
 * `upsert` — MESMO padrão de `inventario.ts::acumularInventarioNaSessao`
 * (escrita a cada chamada, não só uma vez).
 *
 * 🔴 ORDENAÇÃO — decisão do dono (revisando uma suposição ERRADA do
 * arquiteto no plano original): a ordem NÃO é cronológica nem por
 * contagem pura. É:
 *
 *   rank_categoria ASC, n DESC, ultima_mencao_em DESC
 *   rank: objecao=1, dor=2, desejo=3, fato_decisor=4, patrimonio=5
 *
 * Razão, nas palavras do dono: "objeção não tratada derruba a venda; dor é
 * combustível, não risco." Uma objeção dita UMA vez vem antes de uma dor
 * dita três vezes — `n` é DESEMPATE dentro da categoria, nunca o ordenador
 * principal. Esta regra de negócio vive AQUI (não no front, mesma
 * disciplina de `resumirInventario`) — o front recebe a lista pronta. O
 * rank é CONSTANTE em TypeScript, não config de `configuracoes`: mudar essa
 * hierarquia é mudar o MÉTODO da Dra. Elaine, decisão de produto, nunca um
 * parâmetro operacional.
 *
 * CONTINGÊNCIA APROVADA PELO DONO — se a bancada (validação humana, não
 * deste módulo) reprovar o campo `ficha_cliente` da IA, o acumulador passa a
 * derivar itens de `observacao.evidencia` (99 das sugestões da sessão real
 * tinham citação literal ali). As DUAS fontes são aceitas desde já — ver
 * `ItemFichaClienteBruto`/`itemDeObservacao` abaixo — atrás de uma função
 * única (`converterParaItensBrutos`), para o dia da troca de fonte não
 * exigir mudança nenhuma no front nem no acumulador em si.
 */

const RANK_CATEGORIA: Record<CategoriaFichaCliente | "patrimonio", number> = {
  objecao: 1,
  dor: 2,
  desejo: 3,
  fato_decisor: 4,
  patrimonio: 5,
};

/** 🔴 CORRIGIDO (achado do Fable, 2ª rodada) — 3500 era a margem de
 * `resumo.ts::TETO_BYTES_ALVO` COPIADA sem refazer a conta: aquele alvo
 * cobre um objeto com POUCAS chaves (`resumo_acumulado`), enquanto
 * `ItemFichaClienteAcumulado` tem 7 chaves por item (`categoria`, `texto`,
 * `evidencia`, `chave`, `primeira_mencao_em`, `ultima_mencao_em`, `n`) — e o
 * jsonb BINÁRIO do Postgres gasta ~4 bytes a mais por PAR chave/valor
 * (`JEntry`) que o `JSON.stringify` em UTF-8 mede. Mais chaves por item ⇒
 * mais pares ⇒ mais overhead por item ⇒ a margem herdada não cobre o pior
 * caso REAL desta forma de dado.
 *
 * Medido (busca exaustiva sobre tamanho de `texto`/`evidencia`, tetos de
 * `schema.ts`, e a própria poda por bytes deste arquivo): com o alvo antigo
 * de 3500 B, o pior caso (muitos itens pequenos, ~19 itens de ~1 char cada)
 * chegava a `pg_column_size` ESTIMADO de ~4020 B — 76 B de folga contra o
 * CHECK de 4096, margem real muito mais apertada que os "596 B" do
 * comentário anterior (que nunca foi recalculado para 7 chaves). Com
 * 3000 B, o pior caso medido cai para ~3448 B — ~650 B de folga, a mesma
 * ordem de grandeza da margem de `resumo.ts`.
 *
 * Backstop, não meta: o CHECK de 4096 (`pg_column_size`) é quem decide na
 * prática; este alvo só existe para a poda em TypeScript nunca chegar perto
 * o bastante do CHECK para um erro de estimativa (overhead real do
 * `pglz`/`JEntry` variando por versão do Postgres) virar upsert falhando em
 * silêncio. Ver `ficha.test.ts::TETO_BYTES_ALVO_FICHA` para o teste que
 * prova o limiar (não um array gigante — o PONTO em que a poda decide). */
const TETO_BYTES_ALVO_FICHA = 3000;

/** Teto de CONTAGEM antes mesmo da poda por bytes — mesmo espírito de
 * `resumo.ts::TETO_PERGUNTADO`: evita que a poda por bytes precise fatiar
 * um array gigante item a item numa sessão muito longa. Generoso o
 * suficiente para nunca ser o limite ativo em uso normal (o CHECK de bytes
 * é quem decide na prática). */
const TETO_ITENS_FICHA = 40;

/** Normaliza para a CHAVE de deduplicação — minúsculas, sem acento, espaços
 * colapsados. Mesmo critério de `inventario.ts::normalizarDescricao`. */
function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function chaveDedupe(categoria: CategoriaFichaCliente, texto: string): string {
  return `${categoria}:${normalizarTexto(texto)}`;
}

/**
 * Mescla `novos` (itens que a IA propôs NESTA chamada, já validados por
 * `validar.ts`) no `acumulado` já existente. Upsert por chave
 * (categoria + texto normalizado):
 *   - Chave NOVA → adiciona ao fim (ordem de exibição é recalculada por
 *     `ordenarFicha`, nunca pela ordem de inserção aqui — diferente de
 *     `inventario.ts`, onde a ordem de 1ª ocorrência É a ordem exposta).
 *   - Chave JÁ EXISTE → soma `n`, atualiza `ultima_mencao_em` e a
 *     `evidencia` (a citação mais recente do mesmo fato substitui a antiga
 *     — nunca menos provada). NUNCA remove um item existente
 *     ("anti-piscada").
 */
export function acumularFicha(acumulado: FichaAcumulada, novos: ItemFichaCliente[], agoraIso: string): FichaAcumulada {
  const porChave = new Map<string, ItemFichaClienteAcumulado>();
  for (const item of acumulado) porChave.set(item.chave, item);

  for (const novo of novos) {
    const chave = chaveDedupe(novo.categoria, novo.texto);
    const existente = porChave.get(chave);

    if (!existente) {
      porChave.set(chave, { ...novo, chave, primeira_mencao_em: agoraIso, ultima_mencao_em: agoraIso, n: 1 });
      continue;
    }

    porChave.set(chave, {
      ...existente,
      // Evidência mais recente substitui — citação mais fresca do mesmo
      // fato, mesmo raciocínio de `inventario.ts::acumularInventario`.
      evidencia: novo.evidencia,
      ultima_mencao_em: agoraIso,
      n: existente.n + 1,
    });
  }

  return podarPorBytes(Array.from(porChave.values()));
}

/** Corta o array no TETO de contagem e depois por BYTES até caber no alvo
 * de produto — sempre removendo o item MENOS RECENTE primeiro (mesmo
 * critério de `resumo.ts::podarPorBytes`), nunca o de maior `n` (perder o
 * item mais repetido apagaria justamente o fato mais confirmado da
 * sessão). Preserva a ORDEM DE INSERÇÃO do array recebido no caminho comum
 * (array dentro dos tetos, a maioria das chamadas) — mesma disciplina de
 * `inventario.ts::acumularInventario`: a ordem de EXIBIÇÃO é decidida só em
 * `ordenarFicha`, nunca aqui; reordenar cedo obrigaria todo chamador
 * (inclusive os testes de acumulação pura) a conhecer o critério de
 * ordenação da tela. */
function podarPorBytes(itens: FichaAcumulada): FichaAcumulada {
  let atual = itens;

  if (atual.length > TETO_ITENS_FICHA) {
    // Só reordena por recência quando o TETO DE CONTAGEM é de fato excedido
    // — remove os mais antigos primeiro, mantendo a ordem de inserção do
    // que sobrou (nunca reordena o array inteiro por recência à toa).
    const maisAntigoPrimeiro = [...atual].sort((a, b) => Date.parse(a.ultima_mencao_em) - Date.parse(b.ultima_mencao_em));
    const excedente = atual.length - TETO_ITENS_FICHA;
    const chavesRemovidas = new Set(maisAntigoPrimeiro.slice(0, excedente).map((i) => i.chave));
    atual = atual.filter((i) => !chavesRemovidas.has(i.chave));
  }

  // Poda por BYTES: remove o item de `ultima_mencao_em` mais antiga dentre
  // os que restam, um de cada vez, até caber no alvo — sem reordenar o
  // array inteiro a cada iteração.
  while (atual.length > 0 && tamanhoEmBytes(atual) > TETO_BYTES_ALVO_FICHA) {
    let indiceMaisAntigo = 0;
    for (let i = 1; i < atual.length; i++) {
      if (Date.parse(atual[i]!.ultima_mencao_em) < Date.parse(atual[indiceMaisAntigo]!.ultima_mencao_em)) indiceMaisAntigo = i;
    }
    atual = atual.filter((_, i) => i !== indiceMaisAntigo);
  }

  return atual;
}

function tamanhoEmBytes(itens: FichaAcumulada): number {
  return Buffer.byteLength(JSON.stringify(itens), "utf8");
}

/**
 * A Ficha PARA A TELA — combina `ficha_acumulada` com o inventário (via
 * `ItemInventarioRecentePainel`, já resumido/limitado pelo painel de
 * inventário existente — nenhuma leitura nova aqui, o chamador
 * (`estado.ts`) já tem os dois arrays da MESMA leitura de
 * `sessoes_copiloto`) numa lista ÚNICA, ordenada por `rank_categoria` asc,
 * `n` desc, `ultima_mencao_em` desc.
 *
 * Pura — zero I/O. `itensInventario` já vem sem `chave` nem `titularidade`/
 * `posse`/`valor_mencionado` (a Ficha só mostra o TEXTO e a evidência — o
 * detalhamento completo do inventário continua na célula própria de
 * patrimônio, se existir na tela; esta função só entra com a LINHA de
 * patrimônio na Ficha combinada).
 */
export function ordenarFicha(ficha: FichaAcumulada, itensInventario: ItemInventarioRecentePainel[]): ItemFichaParaPainel[] {
  const itensFicha: ItemFichaParaPainel[] = ficha.map((item) => ({
    categoria: item.categoria,
    texto: item.texto,
    evidencia: item.evidencia,
    n: item.n,
    ultima_mencao_em: item.ultima_mencao_em,
  }));

  const itensPatrimonio: ItemFichaParaPainel[] = itensInventario.map((item) => ({
    categoria: "patrimonio",
    texto: item.descricao,
    evidencia: item.evidencia,
    n: 1,
    ultima_mencao_em: item.ultima_mencao_em,
  }));

  return [...itensFicha, ...itensPatrimonio].sort((a, b) => {
    const rankA = RANK_CATEGORIA[a.categoria];
    const rankB = RANK_CATEGORIA[b.categoria];
    if (rankA !== rankB) return rankA - rankB;
    if (a.n !== b.n) return b.n - a.n;
    return Date.parse(b.ultima_mencao_em) - Date.parse(a.ultima_mencao_em);
  });
}

/**
 * 🔴 REDAÇÃO DE EVIDÊNCIA em `sessoes_copiloto.ficha_acumulada` — MESMA
 * CLASSE do defeito corrigido em `inventario.ts::redigirEvidenciasInventario`
 * (achado do `security-pentester`): `evidencia` é citação LITERAL da fala do
 * cliente e, sem esta função, sobreviveria INDEFINIDAMENTE ao expurgo de
 * `sessoes_copiloto_segmentos`.
 *
 * Zera só `evidencia` de CADA item — `categoria`, `texto`, `chave`, `n`,
 * `primeira_mencao_em`/`ultima_mencao_em` sobrevivem intactos: o registro
 * de QUE aquele fato foi levantado continua valendo, só a citação sai.
 * `evidencia` é `string` obrigatória no contrato — vira `""`, não `null`,
 * mesma escolha de `redigirEvidenciasInventario`.
 *
 * Pura — nenhum I/O.
 */
export function redigirEvidenciasFicha(acumulado: FichaAcumulada): FichaAcumulada {
  return acumulado.map((item) => (item.evidencia ? { ...item, evidencia: "" } : item));
}

/** `true` quando `acumulado` tem PELO MENOS um item com `evidencia` ainda
 * não redigida — usado para pular, sem escrever, sessão já redigida numa
 * passagem anterior (idempotência, mesmo raciocínio de
 * `temEvidenciaNaoRedigidaNoInventario`). */
export function temEvidenciaNaoRedigidaNaFicha(acumulado: FichaAcumulada): boolean {
  return acumulado.some((item) => item.evidencia);
}

// ---------------------------------------------------------------------------
// CONTINGÊNCIA APROVADA PELO DONO — fonte dupla atrás de uma função única.
// Se a bancada reprovar `ficha_cliente` da IA (campo estruturado novo), o
// acumulador passa a derivar itens de `observacao.evidencia` (99 sugestões
// da sessão real já tinham citação literal ali, sem precisar de campo
// novo). NENHUM outro módulo (rota, ciclo, estado.ts, front) muda nas duas
// hipóteses — só a função abaixo troca de corpo no dia da decisão.
// ---------------------------------------------------------------------------

/** Uma `observacao` da IA, no formato mínimo que a fonte alternativa precisa
 * ler (evita acoplar este módulo ao tipo inteiro de `SugestaoCopiloto`). */
export interface ObservacaoParaFicha {
  tipo: "fato" | "hipotese" | "inferencia" | "recomendacao";
  texto: string;
  evidencia: string | null;
}

/**
 * Fonte ATIVA hoje: o campo estruturado `ficha_cliente[]` que a IA propõe
 * (já validado por `validar.ts`, severidade "evidência não conferida
 * descarta o item inteiro"). Simplesmente identidade — existe para o
 * chamador nunca precisar saber qual fonte está ativa.
 */
export function converterDeFichaEstruturada(itens: ItemFichaCliente[]): ItemFichaCliente[] {
  return itens;
}

/**
 * Fonte de CONTINGÊNCIA (não usada hoje — ativa manualmente no dia em que a
 * bancada reprovar `ficha_cliente`): deriva itens de Ficha a partir de
 * `observacao.evidencia`. `observacao.tipo` não mapeia 1:1 para as 4
 * categorias da Ficha (o schema de `observacao` não distingue dor/objeção/
 * desejo) — por isso cai sempre em `"fato_decisor"`, a categoria mais
 * neutra, nunca "objecao"/"dor" adivinhados sem lastro no próprio schema.
 * Sem `evidencia` (campo nulável em `ObservacaoParaFicha`), não gera item —
 * mesma regra de "sem citação comprovada, o item não entra".
 */
export function converterDeObservacao(observacao: ObservacaoParaFicha | null): ItemFichaCliente[] {
  if (!observacao || !observacao.evidencia) return [];
  return [{ categoria: "fato_decisor", texto: observacao.texto, evidencia: observacao.evidencia }];
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

/**
 * Grava os itens NOVOS desta chamada (já validados por `validar.ts`) no
 * acumulado da sessão. Chamado pela ROTA e pelo CICLO DEPOIS de
 * `validarSugestaoCopiloto` — mesmo ponto de chamada de
 * `acumularInventarioNaSessao`.
 *
 * `itensNovos` vazio sai ANTES de qualquer leitura — ZERO query no caminho
 * comum (a maioria das janelas de ~90s não propõe item de Ficha novo),
 * mesma disciplina de `acumularInventarioNaSessao`.
 */
export async function acumularFichaNaSessao(
  admin: SupabaseClient,
  params: { sessaoId: string; itensNovos: ItemFichaCliente[]; agoraIso?: string },
): Promise<void> {
  if (params.itensNovos.length === 0) return;

  const { data, error: erroLeitura } = await admin
    .from("sessoes_copiloto")
    .select("ficha_acumulada")
    .eq("sessao_id", params.sessaoId)
    .maybeSingle<{ ficha_acumulada: FichaAcumulada | null }>();
  if (erroLeitura) {
    registrarErro("copiloto/ficha.acumularFichaNaSessao#ler", erroLeitura, { sessao_id: params.sessaoId });
    return;
  }

  const agoraIso = params.agoraIso ?? new Date().toISOString();
  const acumuladoNovo = acumularFicha(data?.ficha_acumulada ?? [], params.itensNovos, agoraIso);

  const { error: erroGravacao } = await admin
    .from("sessoes_copiloto")
    .upsert({ sessao_id: params.sessaoId, ficha_acumulada: acumuladoNovo }, { onConflict: "sessao_id" });
  if (erroGravacao) {
    registrarErro("copiloto/ficha.acumularFichaNaSessao#gravar", erroGravacao, { sessao_id: params.sessaoId });
  }
}
