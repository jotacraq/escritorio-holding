import type { SupabaseClient } from "@supabase/supabase-js";
import type { DossieCliente, FamiliarDossie } from "@/types/copiloto";

/**
 * DOSSIÊ DO CLIENTE — "a IA passa a conhecer a família do cliente" (decisão
 * do Marcio, 17/09/2026: "pode liberar tudo pra IA, patrimônio, documentos,
 * tudo" — vault `05 Decisoes/2026-09-17 - SIC-HF dossie completo liberado
 * para a IA.md`). Isto REVERTE a fronteira de PII que `contexto.ts` afirmava
 * "por construção" até aqui — ver o comentário de topo de `contexto.ts` para
 * o novo contrato.
 *
 * 🔴 A LIBERAÇÃO É JURÍDICA; A TRAVA QUE SOBRA É FÍSICA. O p95 do ciclo
 * automático está em 9.191 ms contra um timeout de 8.000 ms (medido
 * 15/09/2026, `contexto.ts:136-137`: +1.000 tokens ≈ +2,5 s de latência,
 * quase linear). Por isso este módulo:
 *
 *   1. NUNCA lê conteúdo de documento (IR, contrato social) — só METADADO
 *      (que tipos existem, recebido ou pendente). Conteúdo de documento é
 *      2.000-8.000 tokens = +5 a +20 s = estoura o timeout 2-10×. Isso é
 *      fase própria (RAG/embeddings sob demanda), não uma chave a ligar.
 *   2. É chamado UMA VEZ por sessão (por `contexto.ts`, só quando
 *      `sessoes_copiloto.dossie_cliente is null`) — NUNCA no caminho do
 *      ciclo automático a cada 20s. O resultado é persistido em
 *      `sessoes_copiloto.dossie_cliente` (jsonb) e as chamadas seguintes só
 *      LEEM a coluna, zero query nova.
 *   3. Nomes próprios PODEM entrar (a liberação cobre isso), mas cada campo
 *      é pesado em bytes antes de entrar — o recorte é por SINAL POR BYTE
 *      (faixa de patrimônio ~15 tokens, composição familiar ~40, tipos de
 *      documento ~30), nunca "manda tudo porque agora pode".
 *
 * Funções puras (`montarDossieCliente`) para testar sem banco — quem faz
 * I/O é só `buscarDossieCliente`, que monta as 5 queries (em paralelo) e
 * delega o recorte para a função pura.
 */

// ---------------------------------------------------------------------------
// Entrada (recorte mínimo de cada tabela — mesmo padrão de `BemDoRadar` /
// `FamiliarDoRadar` em `src/lib/radar/derivar.ts`).
// ---------------------------------------------------------------------------

export interface JornadaParaDossie {
  faixa_patrimonio_declarada: string | null;
}

export interface FamiliarParaDossie {
  parentesco: string;
  /** Nome próprio — liberado pela decisão de 17/09/2026. `null` quando o
   * familiar foi cadastrado sem nome (caso normal, não erro). */
  nome: string | null;
  regime_casamento: string | null;
}

export interface PatrimonioItemParaDossie {
  tipo: string;
}

export interface DocumentoParaDossie {
  tipo: string;
}

export interface DocumentoPedidoParaDossie {
  tipo: string;
  conferido_em: string | null;
  dispensado_em: string | null;
}

// `DossieCliente`/`FamiliarDossie` são o CONTRATO (types/copiloto.ts, BACK e
// FRONT) — este módulo só monta os dados, não redefine a forma.

/**
 * Função pura — o recorte de sinal por byte. Sem I/O, testável sem banco.
 *
 * Dedup de `patrimonio_tipos`/`documentos_recebidos`/`documentos_pendentes`
 * preserva a ORDEM de primeira ocorrência (nunca ordena por conta própria —
 * ordem alfabética inventaria uma hierarquia que a IA poderia ler como
 * prioridade).
 */
export function montarDossieCliente(dados: {
  jornada: JornadaParaDossie | null;
  familiares: FamiliarParaDossie[];
  patrimonioItens: PatrimonioItemParaDossie[];
  documentos: DocumentoParaDossie[];
  documentosPedidos: DocumentoPedidoParaDossie[];
}): DossieCliente {
  const familiares: FamiliarDossie[] = dados.familiares.map((f) => ({
    papel: f.parentesco,
    nome: f.nome,
    regime: ehConjuge(f.parentesco) ? (f.regime_casamento ?? null) : null,
  }));

  const patrimonioTipos = deduplicarPreservandoOrdem(dados.patrimonioItens.map((i) => i.tipo));
  const documentosRecebidos = deduplicarPreservandoOrdem(dados.documentos.map((d) => d.tipo));
  const documentosPendentes = deduplicarPreservandoOrdem(
    dados.documentosPedidos.filter((p) => p.conferido_em === null && p.dispensado_em === null).map((p) => p.tipo),
  );

  return {
    faixa_patrimonio: dados.jornada?.faixa_patrimonio_declarada ?? null,
    familiares,
    patrimonio_tipos: patrimonioTipos,
    documentos_recebidos: documentosRecebidos,
    documentos_pendentes: documentosPendentes,
  };
}

function ehConjuge(parentesco: string): boolean {
  const normalizado = parentesco.trim().toLowerCase();
  return normalizado === "conjuge" || normalizado === "cônjuge";
}

function deduplicarPreservandoOrdem(itens: string[]): string[] {
  const vistos = new Set<string>();
  const resultado: string[] = [];
  for (const item of itens) {
    if (!vistos.has(item)) {
      vistos.add(item);
      resultado.push(item);
    }
  }
  return resultado;
}

/**
 * Monta o dossiê a partir do banco — chamado 1× por sessão, nunca por ciclo
 * (ver comentário de topo). `pessoaId` é o titular da jornada
 * (`jornadas.pessoa_id`, já resolvido pelo CHAMADOR — mesmo padrão de
 * `buscarRecorteBriefing` em `contexto.ts`, que recebe `jornadaId` pronto).
 *
 * ÍNDICES (protocolo de sustentabilidade — os 4 predicados abaixo já têm
 * índice provado no schema, nenhum novo criado por esta entrega):
 *   - `familiares`: `idx_familiares_pessoa (pessoa_id) where ativo` (0007) —
 *     esta função filtra `ativo=true`.
 *   - `patrimonio_itens`: `idx_patrimonio_pessoa (pessoa_id, tipo) where
 *     ativo` (0007) — mesma trava.
 *   - `documentos`: `idx_documentos_pessoa (pessoa_id, tipo)` (0012) — sem
 *     `where`, cobre a busca por `pessoa_id` sozinho.
 *   - `documentos_pedidos`: SEM índice geral por `jornada_id` (só o parcial
 *     `idx_documentos_pedidos_pendentes`, 0065, que não cobre esta leitura
 *     porque aqui é preciso o conjunto INTEIRO — pedido, conferido e
 *     dispensado — para a função pura decidir o que é "pendente"). Aceitável
 *     sem índice novo: cardinalidade por jornada é da ordem de dezenas
 *     (checklist de documentos de UMA família), não milhares — e esta
 *     função roda 1× por sessão, nunca no caminho quente. Criar índice para
 *     Seq Scan de dezenas de linhas seria o mesmo erro já medido em
 *     `etapa1_clientes(fase)` (Seq Scan mais rápido que Index Scan em
 *     tabela pequena).
 */
export async function buscarDossieCliente(supabase: SupabaseClient, pessoaId: string, jornadaId: string): Promise<DossieCliente> {
  const [{ data: jornada, error: erroJornada }, { data: familiares, error: erroFamiliares }, { data: patrimonioItens, error: erroPatrimonio }, { data: documentos, error: erroDocumentos }, { data: documentosPedidos, error: erroPedidos }] =
    await Promise.all([
      supabase.from("jornadas").select("faixa_patrimonio_declarada").eq("id", jornadaId).maybeSingle<JornadaParaDossie>(),
      supabase.from("familiares").select("parentesco, nome, regime_casamento").eq("pessoa_id", pessoaId).eq("ativo", true).returns<FamiliarParaDossie[]>(),
      supabase.from("patrimonio_itens").select("tipo").eq("pessoa_id", pessoaId).eq("ativo", true).returns<PatrimonioItemParaDossie[]>(),
      supabase.from("documentos").select("tipo").eq("pessoa_id", pessoaId).returns<DocumentoParaDossie[]>(),
      supabase
        .from("documentos_pedidos")
        .select("tipo, conferido_em, dispensado_em")
        .eq("jornada_id", jornadaId)
        .returns<DocumentoPedidoParaDossie[]>(),
    ]);

  if (erroJornada) throw erroJornada;
  if (erroFamiliares) throw erroFamiliares;
  if (erroPatrimonio) throw erroPatrimonio;
  if (erroDocumentos) throw erroDocumentos;
  if (erroPedidos) throw erroPedidos;

  return montarDossieCliente({
    jornada: jornada ?? null,
    familiares: familiares ?? [],
    patrimonioItens: patrimonioItens ?? [],
    documentos: documentos ?? [],
    documentosPedidos: documentosPedidos ?? [],
  });
}
