import type { SupabaseClient } from "@supabase/supabase-js";
import { ErroApi, registrarErro } from "@/server/erros";
import type { LinhaAutomacao, RespostaAutomacoes } from "@/types/jornada-automacoes";

/**
 * "O que o sistema fez" numa jornada (§8.2). Leitura pura de
 * `vw_automacoes_jornada` (0064) — a view já faz o recorte de PII (não traz
 * valor de pagamento, payload de webhook, transcrição, gravação, custo,
 * destinatário nem corpo de mensagem) e roda com `security_invoker`, então a
 * RLS de quem chamou continua valendo.
 *
 * Teto de 200 linhas: a Ficha mostra uma lista, não um log. Jornada com mais
 * que isso é caso de auditoria, que tem outra tela (Comunicação/Admin).
 */
const TETO_LINHAS = 200;

/**
 * A 0064 ainda não foi aplicada neste banco. `42P01` é o erro do Postgres;
 * `PGRST205` é o do PostgREST ("Could not find the table ... in the schema
 * cache"), que é o que chega de verdade pelo supabase-js — medido no dev
 * server em 05/09.
 */
const CODIGOS_VIEW_AUSENTE = new Set(["42P01", "PGRST205", "PGRST202"]);

export async function listarAutomacoes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- cliente vem sem generic Database
  supabase: SupabaseClient<any, any, any>,
  jornadaId: string,
): Promise<RespostaAutomacoes> {
  const { data, error } = await supabase
    .from("vw_automacoes_jornada")
    .select("jornada_id, tipo, chave, rotulo_fonte, canal, estado, quando, resultado, ordem")
    .eq("jornada_id", jornadaId)
    .order("ordem", { ascending: true })
    .limit(TETO_LINHAS)
    .returns<LinhaAutomacao[]>();

  if (error) {
    if (CODIGOS_VIEW_AUSENTE.has(error.code ?? "")) {
      // Lista vazia aqui seria uma mentira útil ("o sistema não fez nada"). A
      // tela precisa saber que a fonte não existe ainda.
      throw new ErroApi(503, "servico_indisponivel", "Histórico de automações indisponível: a migration 0064 ainda não foi aplicada.");
    }
    registrarErro("server/automacoes.listarAutomacoes", error, { jornada_id: jornadaId });
    throw error;
  }

  return { itens: data ?? [] };
}
