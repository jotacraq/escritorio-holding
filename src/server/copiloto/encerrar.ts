import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarErro } from "@/server/erros";
import { consolidarTranscricaoDaSessao } from "./consolidar";

/**
 * O EFEITO de encerrar uma sessão do copiloto — extraído de
 * `POST /api/sessoes/[id]/copiloto/encerrar` (rota) para este módulo porque
 * a partir de agora há DOIS chamadores: o clique da advogada ("Encerrar" na
 * tela) E o ciclo automático, quando `copiloto_sessao.duracao_maxima_minutos`
 * estoura (§4.4 do plano: "encerra sozinho — sessão esquecida aberta não
 * sangra dinheiro"). A 0091 já gravava essa promessa na DESCRIÇÃO da chave
 * ("Sessão de copiloto aberta além deste tempo encerra sozinha (fatia 3)")
 * — achado da revisão desta fatia: a promessa existia, o código não. Este
 * módulo é o que a torna verdadeira, nos dois caminhos, sem duplicar lógica.
 *
 * Três efeitos, sempre nesta ordem (mesma ordem da rota original):
 *  1. `sessoes_copiloto.estado → 'encerrado'` (+ `encerrado_em`), só a
 *     partir de 'aguardando'/'ativo' — idempotente, nunca reencerra.
 *  2. Consolidação em `transcricoes` (reusa o caminho de
 *     `POST /api/sessoes/[id]/transcricao`, idempotente por sha256).
 *  3. `desfecho='expirada'` em toda sugestão ainda sem desfecho.
 */

export interface SessaoParaEncerrar {
  jornadaId: string;
  realizadaEm: string | null;
}

export interface ResultadoEncerramento {
  encerrado: boolean; // false = já estava encerrada (ou corrida perdida) — nada foi feito
  encerradoEm: string | null;
  transcricaoId: string | null;
  jaExistiaTranscricao: boolean;
  sugestoesExpiradas: number;
}

interface ErroPostgrest {
  code?: string;
}

async function buscarNomePessoaDaJornada(supabase: SupabaseClient, jornadaId: string): Promise<string | null> {
  const { data: jornada, error: erroJornada } = await supabase
    .from("jornadas")
    .select("pessoa_id")
    .eq("id", jornadaId)
    .maybeSingle<{ pessoa_id: string }>();
  if (erroJornada) throw erroJornada;
  if (!jornada) return null;

  const { data: pessoa, error: erroPessoa } = await supabase
    .from("pessoas")
    .select("nome")
    .eq("id", jornada.pessoa_id)
    .maybeSingle<{ nome: string }>();
  if (erroPessoa) throw erroPessoa;
  return pessoa?.nome ?? null;
}

/**
 * `.in('estado', [...])` na condição, não `.eq()` solto — o UPDATE não
 * "reencerra" silenciosamente uma sessão já encerrada nem sobrescreve
 * `encerrado_em`. Devolve `false` quando NENHUMA linha mudou (corrida: outra
 * requisição encerrou entre a leitura do chamador e este UPDATE, ou chamada
 * dupla do próprio ciclo automático).
 */
async function marcarEncerrada(admin: SupabaseClient, sessaoId: string, encerradoEm: string): Promise<boolean> {
  const { data, error } = await admin
    .from("sessoes_copiloto")
    .update({ estado: "encerrado", encerrado_em: encerradoEm })
    .eq("sessao_id", sessaoId)
    .in("estado", ["aguardando", "ativo"])
    .select("sessao_id")
    .maybeSingle<{ sessao_id: string }>();
  if (error) throw error;
  return data !== null;
}

/**
 * `desfecho='expirada'` — só sugestões AINDA sem desfecho. A trigger
 * `trg_copiloto_sugestoes_desfecho_imutavel` (0095) é o backstop: se uma
 * sugestão ganhar desfecho por corrida entre a leitura e este UPDATE, o
 * 23514 é absorvido (a linha já tem desfecho real, que é o resultado certo).
 */
async function expirarSugestoesPendentes(admin: SupabaseClient, sessaoId: string, encerradoEm: string): Promise<number> {
  const { data, error } = await admin
    .from("copiloto_sugestoes")
    .update({ desfecho: "expirada", desfecho_em: encerradoEm })
    .eq("sessao_id", sessaoId)
    .is("desfecho", null)
    .select("id");
  if (error) {
    const pg = error as ErroPostgrest;
    if (pg.code === "23514") return 0;
    throw error;
  }
  return (data ?? []).length;
}

/**
 * Executa o encerramento completo. `admin` (service_role) faz toda a
 * escrita — mesmo motivo das outras escritas do copiloto (RLS de 0091 não
 * dá gaveta a `authenticated`). `supabase` (com sessão) só lê o nome da
 * pessoa para o rótulo da transcrição.
 *
 * `encerrado: false` quando a sessão já estava encerrada (ou perdeu a
 * corrida) — o CHAMADOR decide o que isso significa (a rota devolve 409;
 * o ciclo automático simplesmente não tenta de novo, silêncio).
 */
export async function executarEncerramentoCopiloto(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  params: { sessaoId: string; sessao: SessaoParaEncerrar },
): Promise<ResultadoEncerramento> {
  const encerradoEm = new Date().toISOString();

  const mudou = await marcarEncerrada(admin, params.sessaoId, encerradoEm);
  if (!mudou) {
    return { encerrado: false, encerradoEm: null, transcricaoId: null, jaExistiaTranscricao: false, sugestoesExpiradas: 0 };
  }

  const nomePessoa = await buscarNomePessoaDaJornada(supabase, params.sessao.jornadaId);
  const consolidacao = await consolidarTranscricaoDaSessao(admin, {
    sessaoId: params.sessaoId,
    jornadaId: params.sessao.jornadaId,
    rotulo: nomePessoa ? `Sessão de Viabilidade — ${nomePessoa}` : "Sessão de Viabilidade",
    dataReuniao: params.sessao.realizadaEm ? params.sessao.realizadaEm.slice(0, 10) : null,
  });

  if (consolidacao.transcricaoId) {
    await admin.from("sessoes_copiloto").update({ transcricao_id: consolidacao.transcricaoId }).eq("sessao_id", params.sessaoId);
  }

  const sugestoesExpiradas = await expirarSugestoesPendentes(admin, params.sessaoId, encerradoEm);

  return {
    encerrado: true,
    encerradoEm,
    transcricaoId: consolidacao.transcricaoId,
    jaExistiaTranscricao: consolidacao.jaExistia,
    sugestoesExpiradas,
  };
}

/**
 * Encerramento AUTOMÁTICO por `copiloto_sessao.duracao_maxima_minutos`
 * (§4.4 do plano) — chamado pelo ciclo (`server/copiloto/ciclo.ts`) ANTES de
 * avaliar gatilho/claim/gate: uma sessão esquecida aberta não deve nem
 * chegar a avaliar gatilho, deve encerrar e parar. Nunca lança — falha aqui
 * não pode derrubar o polling (mesmo princípio do try/catch ao redor do
 * ciclo inteiro na rota); se o encerramento automático falhar, a sessão
 * segue ativa e a próxima chamada tenta de novo.
 */
export async function encerrarSePassouDoTempo(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  params: { sessaoId: string; jornadaId: string; realizadaEm: string | null; inicioSessaoIso: string; duracaoMaximaMinutos: number; agoraMs: number },
): Promise<boolean> {
  const minutosDecorridos = (params.agoraMs - Date.parse(params.inicioSessaoIso)) / 60_000;
  if (!(minutosDecorridos >= params.duracaoMaximaMinutos)) return false;

  try {
    const resultado = await executarEncerramentoCopiloto(supabase, admin, {
      sessaoId: params.sessaoId,
      sessao: { jornadaId: params.jornadaId, realizadaEm: params.realizadaEm },
    });
    return resultado.encerrado;
  } catch (erro) {
    registrarErro("copiloto/encerrar.encerrarSePassouDoTempo", erro, { sessao_id: params.sessaoId });
    return false;
  }
}
