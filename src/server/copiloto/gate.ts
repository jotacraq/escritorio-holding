import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarErro } from "@/server/erros";
import { temConsentimento } from "@/server/ia/consentimento";
import { lerConfiguracaoBool } from "@/server/ia/configuracao";

/**
 * O gate jurídico do copiloto ao vivo, conferido ANTES de montar contexto e
 * ANTES de chamar a IA — achado do `fable-orchestrator` na 1ª rodada desta
 * fatia: a rota mandava a fala do cliente para a Anthropic e só recusava
 * DEPOIS, no INSERT em `copiloto_sugestoes`, quando a trigger de 0093 batia.
 * Entre a chamada HTTP ao provedor (`executarIaCopiloto`) e o INSERT, o dado
 * já tinha saído — a trava "incondicional" da trigger protegia a PERSISTÊNCIA,
 * não o ENVIO, que é o caminho de saída real (§7 do plano, agora corrigido).
 *
 * Este módulo replica EXATAMENTE as duas condições que
 * `app.exige_decisao_copiloto_ao_vivo()` (0093) confere no banco:
 *   1. decisão ativa em `decisoes_juridicas` para o escopo
 *      'sessao.copiloto_ao_vivo' (`revogada_em is null`);
 *   2. `app.tem_consentimento(pessoa, 'copiloto_sessao_ao_vivo')` — via
 *      `temConsentimento()` (server/ia/consentimento.ts, já existente,
 *      reusado aqui, não duplicado).
 *
 * A TRIGGER DA 0093 PERMANECE — não é removida. Ela é o BACKSTOP: se algum
 * caminho futuro chegar ao INSERT sem passar por este gate (ex.: um agente
 * que esqueça de chamar `conferirGateCopiloto`), o banco ainda recusa. Este
 * módulo é a defesa PRIMÁRIA, que evita gastar o token antes de mais nada; a
 * trigger é a defesa SECUNDÁRIA, que nunca deveria disparar em uso normal.
 *
 * Falha de leitura NUNCA libera — mesmo princípio de `conferirOrcamentoCopiloto`
 * ("não saber quanto já se gastou não é licença para gastar"): aqui, "não
 * saber se há decisão/consentimento" não é licença para enviar a fala.
 */

export interface ResultadoGateCopiloto {
  liberado: boolean;
  motivo: "sem_decisao_juridica" | "sem_consentimento_titular" | "falha_ao_conferir_gate" | null;
}

const ESCOPO_DECISAO = "sessao.copiloto_ao_vivo";
const TIPO_CONSENTIMENTO = "copiloto_sessao_ao_vivo";
const CHAVE_DISPENSA_GATE = "copiloto_sessao.dispensa_gate_juridico";

/**
 * `select 1 ... where escopo = $1 and revogada_em is null` — MESMO predicado,
 * caractere a caractere, que `uniq_decisao_juridica_ativa` (0048:96) indexa
 * e que a função de trigger em 0093 usa. Índice parcial único: no máximo uma
 * linha pode casar, `limit 1` é redundante com a garantia do banco mas barato.
 */
async function existeDecisaoAtiva(admin: SupabaseClient): Promise<boolean> {
  const { data, error } = await admin
    .from("decisoes_juridicas")
    .select("id")
    .eq("escopo", ESCOPO_DECISAO)
    .is("revogada_em", null)
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (error) throw error;
  return data !== null;
}

/**
 * Lê `copiloto_sessao.dispensa_gate_juridico` (0100). TRUE = o gate jurídico
 * não é conferido — ver o comentário dentro de `conferirGateCopiloto`.
 * Fail-closed: ausência da chave, erro de leitura ou valor de outro tipo
 * devolvem `false`, ou seja, o gate CONTINUA valendo. "Não saber" nunca
 * dispensa — é o mesmo princípio de `copilotoEstaAtivo`, invertido.
 */
async function gateJuridicoDispensado(admin: SupabaseClient): Promise<boolean> {
  try {
    return await lerConfiguracaoBool(admin, CHAVE_DISPENSA_GATE, false);
  } catch {
    return false;
  }
}

/**
 * Confere as DUAS condições que o INSERT em `copiloto_sugestoes`/
 * `sessoes_copiloto_segmentos(origem='bot')`/`sessoes_copiloto.gravacao_externa_id`
 * exigiria no banco (0093) — mas ANTES de gastar uma chamada de IA. Chamar
 * isto é obrigatório em todo caminho que monta contexto e chama o provedor;
 * é o que faz `POST /api/sessoes/[id]/copiloto/sugestao` recusar SEM enviar
 * nada quando falta decisão ou consentimento.
 */
export async function conferirGateCopiloto(
  admin: SupabaseClient,
  params: { sessaoId: string; pessoaId: string },
): Promise<ResultadoGateCopiloto> {
  try {
    // 🔴 DISPENSA EXPLÍCITA — decisão do Marcio, 14/09/2026, reafirmada depois
    // de eu apontar o risco duas vezes. Espelha a remoção das 3 triggers pela
    // migration 0099. Com `copiloto_sessao.dispensa_gate_juridico = true`, o
    // copiloto opera SEM registro de quem autorizou gravar, e revogar o
    // consentimento de um titular deixa de barrar qualquer caminho.
    //
    // Continua FALSE por padrão e fail-closed em erro de leitura: ninguém
    // dispensa o gate por acidente, só por ato deliberado em Admin.
    //
    // Para religar a trava inteira: `update configuracoes set valor='false'
    // where chave='copiloto_sessao.dispensa_gate_juridico'` — e recriar as 3
    // triggers (o SQL exato está no cabeçalho da 0099; a função foi preservada).
    if (await gateJuridicoDispensado(admin)) {
      return { liberado: true, motivo: null };
    }

    const decisaoAtiva = await existeDecisaoAtiva(admin);
    if (!decisaoAtiva) {
      return { liberado: false, motivo: "sem_decisao_juridica" };
    }

    const consentiu = await temConsentimento(admin, params.pessoaId, TIPO_CONSENTIMENTO);
    if (!consentiu) {
      return { liberado: false, motivo: "sem_consentimento_titular" };
    }

    return { liberado: true, motivo: null };
  } catch (erro) {
    registrarErro("copiloto/gate.conferirGateCopiloto", erro, { sessao_id: params.sessaoId, pessoa_id: params.pessoaId });
    return { liberado: false, motivo: "falha_ao_conferir_gate" };
  }
}
