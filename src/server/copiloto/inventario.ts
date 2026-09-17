import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarErro } from "@/server/erros";
import type {
  CategoriaInventarioMencionado,
  InventarioAcumulado,
  ItemInventarioAcumulado,
  ItemInventarioMencionado,
  ResumoCategoriaInventario,
  ResumoInventarioAcumulado,
} from "@/types/copiloto";

/**
 * INVENTÁRIO PATRIMONIAL MENCIONADO NA FALA — 17/09/2026 (pedido do dono:
 * "anotar o que os decisores forem comunicando sobre empresas, total de
 * empresas e tudo mais... com uma lógica de contagem com base nas empresas
 * que eles consideram como deles de fato"). Reproduz o padrão do dossiê
 * manual (`tmp/dossie-exemplo-maria.md` §5) e do script oficial da SV
 * (`tmp/script-sv-oficial.md`, PARTE 03): quantos · de quem · ordem de
 * grandeza, por categoria, fechando na frase "estamos falando
 * aproximadamente de um patrimônio de R$ [X], distribuído dessa forma".
 *
 * DIFERENTE de `dossie.ts` (dado CADASTRAL, já no banco antes da sessão
 * começar): este módulo acumula o que é DITO, sessão a sessão, e pode não
 * ter cadastro nenhum por trás ainda.
 *
 * Duas funções puras (testáveis sem I/O, mesmo padrão de
 * `montarDossieCliente`):
 *   - `acumularInventario` — mescla itens NOVOS (de uma chamada de IA) no
 *     array já acumulado, por UPSERT (nunca delete+insert — regra
 *     "anti-piscada": item já registrado não some por não repetir na
 *     janela de 90s mais recente).
 *   - `resumirInventario` — o que REALMENTE vai para o contexto de IA
 *     (bloco G): contagem por categoria, nunca a lista item a item (teto
 *     físico de latência, ver `ResumoInventarioAcumulado` em
 *     types/copiloto.ts).
 *
 * A ROTA/CICLO (server/copiloto/contexto.ts + a rota de sugestão + ciclo.ts)
 * fazem o I/O: leem `sessoes_copiloto.inventario_acumulado`, chamam
 * `acumularInventario` com os itens novos que a IA devolveu nesta chamada, e
 * gravam de volta por `upsert` — mesmo padrão de `montarOuReaproveitarDossie`
 * em `contexto.ts`, mas ESCRITO A CADA CHAMADA (não só 1×): o inventário
 * cresce ao longo da sessão, o dossiê é montado uma vez só.
 */

/** Normaliza para a CHAVE de deduplicação — minúsculas, sem acento, espaços
 * colapsados. "Sala comercial no centro" e "sala comercial  no Centro"
 * casam na mesma chave; "sala comercial no centro" e "apartamento na praia"
 * não. Dedupe é só dentro da MESMA categoria — duas categorias diferentes
 * com a mesma descrição normalizada são itens distintos (raro, mas possível:
 * "renda" pode aparecer tanto como investimento quanto como observação
 * solta — a categoria já desambigua). */
function normalizarDescricao(descricao: string): string {
  return descricao
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function chaveDedupe(categoria: CategoriaInventarioMencionado, descricao: string): string {
  return `${categoria}:${normalizarDescricao(descricao)}`;
}

/**
 * Mescla `novos` (itens que a IA propôs NESTA chamada, já validados por
 * `validar.ts`) no `acumulado` já existente (o que `sessoes_copiloto.
 * inventario_acumulado` já tinha antes desta chamada).
 *
 * Regra de UPSERT por chave (categoria + descrição normalizada):
 *   - Chave NOVA → adiciona ao fim (preserva ordem de 1ª menção, mesmo
 *     critério de `dossie.ts::deduplicarPreservandoOrdem` — nunca ordena
 *     por conta própria).
 *   - Chave JÁ EXISTE → ATUALIZA os campos que a nova menção esclarece
 *     (preenche `titularidade`/`valor_mencionado` se antes eram `null` e
 *     agora vieram preenchidos; `posse` só piora para `incerta` NUNCA
 *     sozinha — ver abaixo), mantém `primeira_mencao_em` do registro
 *     antigo, atualiza `ultima_mencao_em`. NUNCA remove um item existente
 *     — "anti-piscada": a ausência de uma menção na janela atual não é
 *     prova de que o item deixou de existir.
 *
 * `posse`: a MENÇÃO MAIS RECENTE decide, com uma exceção — `propria` nunca
 * é rebaixada para `incerta` por uma chamada posterior que simplesmente não
 * teve clareza suficiente (a IA já teve certeza uma vez; perder a certeza
 * na chamada seguinte é sinal de contexto mais fraco, não de fato novo). Se
 * uma menção posterior disser explicitamente `terceiro` (contradição real —
 * "ah não, isso é do meu genro"), ela VENCE sobre `propria` — é uma
 * correção do próprio decisor, não ruído de janela.
 */
export function acumularInventario(acumulado: InventarioAcumulado, novos: ItemInventarioMencionado[], agoraIso: string): InventarioAcumulado {
  const porChave = new Map<string, ItemInventarioAcumulado>();
  for (const item of acumulado) porChave.set(item.chave, item);

  for (const novo of novos) {
    const chave = chaveDedupe(novo.categoria, novo.descricao);
    const existente = porChave.get(chave);

    if (!existente) {
      porChave.set(chave, { ...novo, chave, primeira_mencao_em: agoraIso, ultima_mencao_em: agoraIso });
      continue;
    }

    const posseResolvida = resolverPosse(existente.posse, novo.posse);
    porChave.set(chave, {
      ...existente,
      titularidade: novo.titularidade ?? existente.titularidade,
      posse: posseResolvida,
      valor_mencionado: novo.valor_mencionado ?? existente.valor_mencionado,
      // Evidência mais recente substitui — é a citação mais fresca do
      // mesmo fato, nunca menos provada que a antiga.
      evidencia: novo.evidencia,
      ultima_mencao_em: agoraIso,
    });
  }

  // Preserva ordem de 1ª ocorrência (Map mantém ordem de inserção em JS —
  // itens que já existiam continuam na posição original, novos vão ao fim).
  return Array.from(porChave.values());
}

function resolverPosse(
  anterior: ItemInventarioAcumulado["posse"],
  nova: ItemInventarioMencionado["posse"],
): ItemInventarioAcumulado["posse"] {
  // Contradição explícita: "isso é de terceiro" sempre vence, mesmo sobre
  // 'propria' anterior — é o decisor corrigindo o próprio relato.
  if (nova === "terceiro") return "terceiro";
  // 'propria' já estabelecida não regride para 'incerta' por uma menção
  // subsequente mais vaga (ver comentário de `acumularInventario`).
  if (anterior === "propria" && nova === "incerta") return "propria";
  return nova;
}

/**
 * Resumo por categoria — o que REALMENTE sai para o contexto de IA (bloco
 * G). Contagem do pedido do dono: só `posse:"propria"` soma no total;
 * `incerta` aparece separado ("a confirmar"); `terceiro` não entra em
 * NENHUM total (nem na lista de "a confirmar" — foi identificado como não
 * sendo da família, não há ambiguidade a resolver).
 */
export function resumirInventario(acumulado: InventarioAcumulado): ResumoInventarioAcumulado {
  const porCategoria = new Map<CategoriaInventarioMencionado, ResumoCategoriaInventario>();

  for (const item of acumulado) {
    if (item.posse === "terceiro") continue;

    const atual = porCategoria.get(item.categoria) ?? {
      categoria: item.categoria,
      contagem_propria: 0,
      contagem_incerta: 0,
      sem_titularidade: 0,
    };

    if (item.posse === "propria") {
      atual.contagem_propria += 1;
      if (!item.titularidade) atual.sem_titularidade += 1;
    } else {
      atual.contagem_incerta += 1;
    }

    porCategoria.set(item.categoria, atual);
  }

  const porCategoriaLista = Array.from(porCategoria.values());
  return {
    por_categoria: porCategoriaLista,
    total_itens_proprios: porCategoriaLista.reduce((soma, c) => soma + c.contagem_propria, 0),
    total_itens_incertos: porCategoriaLista.reduce((soma, c) => soma + c.contagem_incerta, 0),
  };
}

/**
 * I/O — grava os itens NOVOS desta chamada (já validados por `validar.ts`)
 * no acumulado da sessão. Chamado pela ROTA (`sugestao/route.ts`) e pelo
 * CICLO (`ciclo.ts`) DEPOIS de `validarSugestaoCopiloto`, nunca por
 * `contexto.ts` (que só LÊ o RESUMO, ver comentário de topo de
 * `contexto.ts` — o array bruto nunca é exposto no `ContextoCopiloto` que
 * vai para a IA, só é lido aqui, internamente, para poder mesclar).
 *
 * `itensNovos` vazio é o caso comum (a maioria das janelas de ~90s não
 * menciona bem novo) — sai ANTES de qualquer leitura, ZERO query, para não
 * gerar 1 SELECT + 1 UPDATE inúteis a cada ciclo de 20s (a mesma disciplina
 * de "caminho comum sem custo extra" do bloco F/dossiê, `contexto.ts`).
 *
 * A leitura de `inventario_acumulado` aqui é PRÓPRIA (não reaproveita a do
 * `montarContextoCopiloto` anterior, que já rodou ANTES da IA responder) —
 * é 1 SELECT por PK (`sessoes_copiloto_pkey`, 0091) só no caso em que a IA
 * de fato propôs itens novos nesta chamada, aceitável pelo mesmo raciocínio
 * do bloco F: o caso raro pode pagar uma query a mais, o caminho quente
 * (silêncio na sala, nenhum item novo) não paga nenhuma.
 */
/**
 * 🔴 REDAÇÃO DE EVIDÊNCIA em `sessoes_copiloto.inventario_acumulado` —
 * achado do `security-pentester`, mesma classe do defeito corrigido um dia
 * antes em `copiloto_sugestoes.conteudo` (`expurgo.ts::redigirEvidenciasConteudo`):
 * `evidencia` é citação LITERAL da fala do cliente ("a sala comercial no
 * centro é minha e da minha irmã, comprei há 8 anos") e, sem esta função,
 * sobreviveria INDEFINIDAMENTE ao expurgo de `sessoes_copiloto_segmentos`
 * (a fala bruta que a originou).
 *
 * Zera só `evidencia` de CADA item do array — `categoria`, `descricao`,
 * `titularidade`, `posse` e `valor_mencionado` sobrevivem intactos: o
 * LEVANTAMENTO continua valendo (é o que `resumirInventario`/bloco G usam,
 * e nenhum dos dois lê `evidencia`), só a citação textual sai. Mesmo
 * raciocínio de `redigirEvidenciasConteudo`: não é DELETE da linha, é
 * redação de um campo dentro dela.
 *
 * `evidencia` é `string` obrigatória no contrato (`ItemInventarioMencionado`,
 * types/copiloto.ts) — vira `""`, não `null`, mesma escolha (e mesmo motivo)
 * de `bloco_inferido.evidencia` em `redigirEvidenciasConteudo`.
 *
 * Pura — nenhum I/O aqui, só o mapeamento do array.
 */
export function redigirEvidenciasInventario(acumulado: InventarioAcumulado): InventarioAcumulado {
  return acumulado.map((item) => (item.evidencia ? { ...item, evidencia: "" } : item));
}

/** `true` quando `acumulado` tem PELO MENOS um item com `evidencia` ainda não
 * redigida — usado para pular, sem escrever, sessão já redigida numa
 * passagem anterior (idempotência, mesmo raciocínio de `temEvidenciaNaoRedigida`
 * em `expurgo.ts`). */
export function temEvidenciaNaoRedigidaNoInventario(acumulado: InventarioAcumulado): boolean {
  return acumulado.some((item) => item.evidencia);
}

export async function acumularInventarioNaSessao(
  admin: SupabaseClient,
  params: { sessaoId: string; itensNovos: ItemInventarioMencionado[]; agoraIso?: string },
): Promise<void> {
  if (params.itensNovos.length === 0) return;

  const { data, error: erroLeitura } = await admin
    .from("sessoes_copiloto")
    .select("inventario_acumulado")
    .eq("sessao_id", params.sessaoId)
    .maybeSingle<{ inventario_acumulado: InventarioAcumulado | null }>();
  if (erroLeitura) {
    registrarErro("copiloto/inventario.acumularInventarioNaSessao#ler", erroLeitura, { sessao_id: params.sessaoId });
    return;
  }

  const agoraIso = params.agoraIso ?? new Date().toISOString();
  const acumuladoNovo = acumularInventario(data?.inventario_acumulado ?? [], params.itensNovos, agoraIso);

  const { error: erroGravacao } = await admin
    .from("sessoes_copiloto")
    .upsert({ sessao_id: params.sessaoId, inventario_acumulado: acumuladoNovo }, { onConflict: "sessao_id" });
  if (erroGravacao) {
    registrarErro("copiloto/inventario.acumularInventarioNaSessao#gravar", erroGravacao, { sessao_id: params.sessaoId });
  }
}
