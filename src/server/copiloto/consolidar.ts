import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { proximaVersaoArquivoOrigem } from "@/server/croqui/transcricao";

/**
 * Consolidação da transcrição ao vivo em `transcricoes` — Fase 10, Fatia 3
 * (docs/ARQUITETURA-FASE-10.md §6.1, §8, §11-item-1): "É AQUI que a feature
 * limpa em vez de empilhar." `POST /api/sessoes/[id]/transcricao` (0032)
 * existe desde a Fase 3 e nunca teve produtor automático — este módulo é
 * esse produtor, chamado por `POST /api/sessoes/[id]/copiloto/encerrar`.
 *
 * REUSA O CAMINHO QUE JÁ EXISTE, não inventa um novo: mesmo `arquivo_origem`
 * sintético (`sessao:<id>:v<n>`, via `proximaVersaoArquivoOrigem`, já
 * exportada e importada — não duplicada), mesmo par de colunas `unique`
 * (`sha256`/`arquivo_origem`) e a MESMA idempotência de
 * `inserirTranscricaoComRetentativa` (colisão de sha256 → devolve a linha
 * existente; colisão de arquivo_origem → recalcula e tenta de novo).
 *
 * Este módulo NÃO importa nem altera `src/app/api/sessoes/[id]/transcricao/
 * route.ts` (fora da fronteira desta entrega, §12 do plano: "usa, não
 * altera") — a lógica de inserção é replicada aqui porque aquela função vive
 * dentro da rota, não exportada. O CONTRATO da tabela (`transcricoes`, 0032)
 * é a fonte de verdade que os dois caminhos respeitam; nenhum dos dois é
 * "o dono" do outro.
 */

export interface SegmentoParaConsolidar {
  ordem: number;
  falante: string | null;
  texto: string;
}

/**
 * Concatena os segmentos EM ORDEM (`ordem`, nunca `criado_em` — §2.2: dois
 * segmentos do mesmo segundo não podem trocar de posição) no formato
 * "Falante: texto", uma linha por segmento. Função PURA — testável sem I/O.
 *
 * Segmento SEM falante (`falante=null`, comum no manual da Fatia 1 — não é
 * obrigatório informar quem fala ao digitar) mostra só o texto, sem prefixo
 * "null:" nem rótulo inventado.
 */
export function concatenarSegmentos(segmentos: readonly SegmentoParaConsolidar[]): string {
  return segmentos
    .map((s) => (s.falante ? `${s.falante}: ${s.texto}` : s.texto))
    .join("\n");
}

interface TranscricaoRow {
  id: string;
  arquivo_origem: string;
  tamanho_bytes: number;
  sha256: string;
  importado_em: string;
}

interface ErroPostgrest {
  code?: string;
  message?: string;
}

/**
 * Insere a transcrição consolidada com retentativa — MESMA lógica de
 * `inserirTranscricaoComRetentativa` (transcricao/route.ts), replicada aqui
 * porque aquela função não é exportada (fora da fronteira, ver comentário de
 * topo). Duas travas de idempotência, mesmo raciocínio:
 *   - colisão em `sha256`: o MESMO texto já foi persistido (a advogada clica
 *     "Encerrar" duas vezes sem nenhum segmento novo no meio) → devolve a
 *     linha existente, `jaExistia=true`, não duplica;
 *   - colisão em `arquivo_origem`: duas requisições concorrentes calcularam
 *     a mesma próxima versão → recalcula e tenta de novo (até 3x).
 */
async function inserirTranscricaoComRetentativa(
  supabase: SupabaseClient,
  sessaoId: string,
  base: {
    tipo: "sessao_viabilidade";
    rotulo: string;
    data_reuniao: string | null;
    jornada_id: string;
    conteudo: string;
    tamanho_bytes: number;
    sha256: string;
  },
): Promise<{ linha: TranscricaoRow; jaExistia: boolean }> {
  const MAX_TENTATIVAS = 3;

  for (let tentativa = 0; tentativa < MAX_TENTATIVAS; tentativa++) {
    const { data: existentes, error: erroExistentes } = await supabase
      .from("transcricoes")
      .select("arquivo_origem")
      .like("arquivo_origem", `sessao:${sessaoId}:v%`);
    if (erroExistentes) throw erroExistentes;

    const arquivoOrigem = proximaVersaoArquivoOrigem(
      sessaoId,
      (existentes ?? []).map((linha) => linha.arquivo_origem as string),
    );

    const { data: inserida, error: erroInsercao } = await supabase
      .from("transcricoes")
      .insert({ ...base, arquivo_origem: arquivoOrigem })
      .select("id, arquivo_origem, tamanho_bytes, sha256, importado_em")
      .single<TranscricaoRow>();

    if (!erroInsercao && inserida) {
      return { linha: inserida, jaExistia: false };
    }

    const pg = erroInsercao as ErroPostgrest | null;
    if (pg?.code === "23505") {
      if (pg.message?.includes("sha256")) {
        const { data: existente, error: erroExistente } = await supabase
          .from("transcricoes")
          .select("id, arquivo_origem, tamanho_bytes, sha256, importado_em")
          .eq("sha256", base.sha256)
          .single<TranscricaoRow>();
        if (erroExistente || !existente) {
          throw erroExistente ?? new Error("falha_ao_buscar_transcricao_existente");
        }
        return { linha: existente, jaExistia: true };
      }
      continue; // colisão em arquivo_origem (corrida) — tenta de novo
    }

    throw erroInsercao ?? new Error("falha_ao_persistir_transcricao_consolidada");
  }

  throw new Error("falha_ao_persistir_transcricao_consolidada_apos_retentativas");
}

/**
 * Busca TODOS os segmentos da sessão, em ordem — SEM `limit` (diferente do
 * polling e da janela de contexto, que têm teto por desenho, §2.2/§4.3):
 * aqui é uma leitura ÚNICA POR SESSÃO, no encerramento, não um caminho quente
 * repetido 1.800x. O teto de ~180 segmentos/sessão (§2.1 do plano) já limita
 * o tamanho na prática; não há paginação porque não há necessidade de uma —
 * 1 sessão = no máximo algumas centenas de linhas, uma vez.
 *
 * Sobre `idx_copiloto_segmentos_polling (sessao_id, ordem)` — MESMO índice
 * do caminho quente, `where sessao_id=$1 order by ordem`, sem o `and ordem >
 * $2` (aqui é "desde o início", não incremental). `explain (analyze)` — A
 * MEDIR (comando em `scripts/verificacao-0096.sql`).
 */
export async function buscarSegmentosParaConsolidar(
  supabase: SupabaseClient,
  sessaoId: string,
): Promise<SegmentoParaConsolidar[]> {
  const { data, error } = await supabase
    .from("sessoes_copiloto_segmentos")
    .select("ordem, falante, texto")
    .eq("sessao_id", sessaoId)
    .order("ordem", { ascending: true })
    .returns<SegmentoParaConsolidar[]>();
  if (error) throw error;
  return data ?? [];
}

/**
 * Mesmo mínimo de `POST /api/sessoes/[id]/transcricao` (200 caracteres) — a
 * Agente do Croqui não deve rodar sobre um trecho curto e "alucinar" o
 * resto. Sessão com poucos segmentos manuais de teste (ex.: 1 frase digitada
 * na Fatia 1) fica ABAIXO deste piso de propósito: não vira transcrição
 * "oficial" da SV.
 */
const TAMANHO_MINIMO_CONSOLIDACAO = 200;

export interface ResultadoConsolidacao {
  transcricaoId: string | null;
  jaExistia: boolean;
}

/**
 * Concatena, valida o piso de tamanho e persiste — chamado por
 * `POST /api/sessoes/[id]/copiloto/encerrar`. Devolve `transcricaoId: null`
 * quando não há segmento nenhum OU o texto concatenado não alcança o piso
 * (nunca insere transcrição vazia ou curta demais — "nada de dado inventado
 * na tela", CLAUDE.md).
 */
export async function consolidarTranscricaoDaSessao(
  supabase: SupabaseClient,
  params: { sessaoId: string; jornadaId: string; rotulo: string; dataReuniao: string | null },
): Promise<ResultadoConsolidacao> {
  const segmentos = await buscarSegmentosParaConsolidar(supabase, params.sessaoId);
  if (segmentos.length === 0) {
    return { transcricaoId: null, jaExistia: false };
  }

  const conteudo = concatenarSegmentos(segmentos);
  if (conteudo.length < TAMANHO_MINIMO_CONSOLIDACAO) {
    return { transcricaoId: null, jaExistia: false };
  }

  const { linha, jaExistia } = await inserirTranscricaoComRetentativa(supabase, params.sessaoId, {
    tipo: "sessao_viabilidade",
    rotulo: params.rotulo,
    data_reuniao: params.dataReuniao,
    jornada_id: params.jornadaId,
    conteudo,
    tamanho_bytes: Buffer.byteLength(conteudo, "utf-8"),
    sha256: createHash("sha256").update(conteudo, "utf-8").digest("hex"),
  });

  return { transcricaoId: linha.id, jaExistia };
}
