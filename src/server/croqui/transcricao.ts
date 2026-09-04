import type { SupabaseClient } from "@supabase/supabase-js";
import { erroTranscricaoAusente } from "@/server/ia/erros";

/**
 * Ponte de leitura entre a transcrição persistida da Sessão de Viabilidade
 * (`transcricoes`, `tipo='sessao_viabilidade'`) e a Análise da Sessão
 * (ARQUITETURA-FASE-3.md §2.2). Quem PERSISTE é
 * `POST /api/sessoes/[id]/transcricao` — este módulo só lê.
 *
 * Recebe `supabaseAdmin` (service_role) pelo mesmo motivo de
 * `montarContextoAnaliseCroqui`: a Agente do Croqui já roda inteira sob
 * service_role (`src/server/ia/croqui-analise.ts`), e aqui só se lê dado que
 * o usuário da rota já tem direito de ver — a rota exige `exigirVePatrimonio`
 * ANTES de chegar aqui, é ela quem faz a checagem de papel.
 */
export interface TranscricaoPersistida {
  id: string;
  conteudo: string;
  importadoEm: string;
}

export async function buscarTranscricaoPersistidaMaisRecente(
  supabaseAdmin: SupabaseClient,
  jornadaId: string,
): Promise<TranscricaoPersistida | null> {
  const { data, error } = await supabaseAdmin
    .from("transcricoes")
    .select("id, conteudo, importado_em")
    .eq("jornada_id", jornadaId)
    .eq("tipo", "sessao_viabilidade")
    .order("importado_em", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; conteudo: string; importado_em: string }>();

  if (error) throw error;
  if (!data) return null;
  return { id: data.id, conteudo: data.conteudo, importadoEm: data.importado_em };
}

/**
 * `fornecida` é o corpo da requisição (compatibilidade com o chamador antigo
 * de `POST /api/croquis/[id]/analise` — hoje nenhum, ARQUITETURA-FASE-3.md
 * §0 item 3 — que mandava a transcrição inteira no corpo). Ausente → lê a
 * persistida da jornada. Nenhuma das duas → 409 `transcricao_ausente`,
 * nomeando os dois caminhos possíveis. Nunca gera análise sobre contexto
 * vazio ("IA nunca produz análise genérica" — CLAUDE.md).
 */
export async function resolverTranscricaoSessao(
  supabaseAdmin: SupabaseClient,
  jornadaId: string,
  fornecida: string | undefined,
): Promise<string> {
  if (fornecida) return fornecida;

  const persistida = await buscarTranscricaoPersistidaMaisRecente(supabaseAdmin, jornadaId);
  if (!persistida) {
    throw erroTranscricaoAusente(
      "Nenhuma transcrição da Sessão de Viabilidade encontrada para esta jornada. " +
        "Persista em POST /api/sessoes/{id}/transcricao ou envie transcricao_sessao no corpo desta requisição.",
    );
  }
  return persistida.conteudo;
}

/**
 * Próximo `arquivo_origem` sintético para uma transcrição de SV
 * (`sessao:<sessao_id>:v<n>`, §2.2). `transcricoes.arquivo_origem` é
 * `not null unique` (0032) e foi desenhada como CHAVE DE IDEMPOTÊNCIA de
 * arquivo importado; a Sessão de Viabilidade não tem arquivo, então este
 * identificador determinístico ocupa o mesmo papel sem alterar a coluna.
 *
 * Função PURA — testável sem banco (`scripts/testar-analise-sessao.ts`).
 */
export function proximaVersaoArquivoOrigem(sessaoId: string, arquivosExistentes: readonly string[]): string {
  const prefixo = `sessao:${sessaoId}:v`;
  let maiorVersao = 0;

  for (const arquivo of arquivosExistentes) {
    if (!arquivo.startsWith(prefixo)) continue;
    const numero = Number(arquivo.slice(prefixo.length));
    if (Number.isInteger(numero) && numero > maiorVersao) {
      maiorVersao = numero;
    }
  }

  return `${prefixo}${maiorVersao + 1}`;
}
