import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarErro } from "@/server/erros";
import { CHAVE_LIGACAO_RETENCAO_DIAS, lerConfiguracaoInteiroOuNulo } from "@/server/integracoes/config";
import type { ResultadoExpurgoLigacoes } from "@/types/integracoes";
import { STATUS_TERMINAIS } from "./tipos";

/**
 * Retenção de voz da ligação por IA (LGPD — decisão B19, ainda pendente com a
 * Dra. Elaine). Fase 7 · entrega 5.
 *
 * REGRA: `configuracoes['ligacao_ia.retencao_dias']` ausente ou `null` = NÃO
 * expurga nada. Minimização de dado é decisão jurídica, não default de
 * programador: apagar transcrição de cliente por conta própria destruiria prova
 * de consentimento e de conteúdo antes de alguém decidir que podia.
 *
 * QUANDO CONFIGURADA (ex.: 90): em ligações já encerradas há mais de N dias,
 * zera `transcricao` e `gravacao_url` (o que É a voz e o conteúdo) e MANTÉM
 * `resumo`, `custo_usd`, `duracao_segundos`, `resultado` — o registro de que a
 * ligação existiu, quanto custou e no que deu continua auditável. Carimba
 * `expurgado_em` para a Ficha poder dizer "transcrição expurgada em …" em vez
 * de mostrar um vazio que parece bug.
 *
 * Sem a 0073 aplicada (coluna `expurgado_em` inexistente), a etapa se declara
 * `pulada: 'coluna_ausente'` e não apaga nada — nunca expurga às cegas.
 */
const LOTE = 500;

export async function etapaExpurgoLigacoesIa(admin: SupabaseClient): Promise<ResultadoExpurgoLigacoes> {
  const dias = await lerConfiguracaoInteiroOuNulo(admin, CHAVE_LIGACAO_RETENCAO_DIAS);
  if (dias === null) return { expurgadas: 0, pulada: "sem_retencao" };

  const limite = new Date(Date.now() - dias * 86_400_000).toISOString();

  // Seleciona o lote antes de escrever: um UPDATE sem teto numa tabela que só
  // cresce é como o Fable reprova por otimização — e aqui também apagaria
  // muita coisa de uma vez, sem chance de conferir o que saiu.
  const { data, error } = await admin
    .from("ligacoes_ia")
    .select("id")
    .in("status", [...STATUS_TERMINAIS])
    .lt("encerrada_em", limite)
    .is("expurgado_em", null)
    .or("transcricao.not.is.null,gravacao_url.not.is.null")
    .limit(LOTE);

  if (error) {
    if (error.code === "42703") return { expurgadas: 0, pulada: "coluna_ausente" };
    registrarErro("ligacao-ia/expurgo.selecionar", error, { retencao_dias: dias });
    return { expurgadas: 0, erro: error.message.slice(0, 300) };
  }

  const ids = ((data ?? []) as { id: string }[]).map((l) => l.id);
  if (ids.length === 0) return { expurgadas: 0, retencao_dias: dias };

  const { error: erroUpdate } = await admin
    .from("ligacoes_ia")
    .update({ transcricao: null, gravacao_url: null, expurgado_em: new Date().toISOString() })
    .in("id", ids);

  if (erroUpdate) {
    if (erroUpdate.code === "42703") return { expurgadas: 0, pulada: "coluna_ausente" };
    registrarErro("ligacao-ia/expurgo.aplicar", erroUpdate, { retencao_dias: dias, quantidade: ids.length });
    return { expurgadas: 0, erro: erroUpdate.message.slice(0, 300) };
  }

  return { expurgadas: ids.length, retencao_dias: dias, resta_lote: ids.length === LOTE };
}
