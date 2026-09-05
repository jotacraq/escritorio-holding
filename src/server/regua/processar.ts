import type { SupabaseClient } from "@supabase/supabase-js";
import { enviarEmail, resendConfigurado } from "./email";
import { carregarChatwoot, type ClienteChatwoot } from "./externas";
import { PLACEHOLDER_LINK_MATERIAL, resolverPlaceholdersDeEnvio, temPlaceholderSobrando } from "./placeholders";
import { lerAnexoPdfMaterial } from "@/server/material/anexo";
import type { CanalMensagem } from "@/types/banco";

const MAX_TENTATIVAS = 5;
const LIMITE_LOTE = 50;
/** Hold por dado ausente (corrida entre a claim e a resolução): volta a tentar em 15 min sem contar tentativa. */
const HOLD_MINUTOS = 15;

interface MensagemAgendada {
  id: string;
  jornada_id: string;
  agendamento_id: string | null;
  canal: CanalMensagem;
  destinatario: string;
  assunto_renderizado: string | null;
  corpo_renderizado: string | null;
  tentativas: number;
}

export interface ResultadoProcessamento {
  canais: CanalMensagem[];
  processadas: number;
  enviadas: number;
  falhas: number;
  /** Reivindicadas mas devolvidas à fila por dado ausente (sala sem link etc.) — não é falha. */
  em_hold: number;
}

/**
 * Quais canais o cron pode enviar sozinho nesta passagem.
 *   e-mail: sempre (a claim no banco já filtra; sem Resend vira 'falhou' com motivo).
 *   whatsapp: SÓ quando `configuracoes['regua.canal_whatsapp'] = 'chatwoot'` (chave
 *   do agente B, 0054) E o cliente Chatwoot está configurado. Caso contrário a
 *   fila de WhatsApp continua 100% manual (copiar → wa.me → marcar enviada).
 */
async function decidirCanais(supabaseAdmin: SupabaseClient): Promise<{ canais: CanalMensagem[]; chatwoot: ClienteChatwoot | null }> {
  const canais: CanalMensagem[] = ["email"];
  const chatwoot = await carregarChatwoot(supabaseAdmin);
  if (!chatwoot) return { canais, chatwoot: null };
  canais.push("whatsapp");
  return { canais, chatwoot };
}

function backoff(tentativas: number): { status: "falhou" | "pendente"; proxima_tentativa_em: string | null } {
  const esgotou = tentativas >= MAX_TENTATIVAS;
  return {
    status: esgotou ? "falhou" : "pendente",
    proxima_tentativa_em: esgotou ? null : new Date(Date.now() + 2 ** tentativas * 60_000).toISOString(),
  };
}

/**
 * Worker chamado por POST /api/cron/regua. Reivindica o lote (FOR UPDATE SKIP
 * LOCKED via RPC `reivindicar_mensagens_pendentes(p_limite, p_canais)`, 0051),
 * resolve os placeholders de envio (link da sala, link de confirmação, link do
 * material — G18/C24), envia e atualiza status. O banco já segura em hold a
 * mensagem cujo dado ainda não existe; a checagem aqui é a rede de segurança
 * para a corrida rara entre a claim e a resolução.
 */
export async function processarFilaRegua(
  supabaseAdmin: SupabaseClient,
  opcoes: { canais?: CanalMensagem[] } = {},
): Promise<ResultadoProcessamento> {
  const decisao = opcoes.canais ? { canais: opcoes.canais, chatwoot: null as ClienteChatwoot | null } : await decidirCanais(supabaseAdmin);
  const chatwoot = decisao.chatwoot ?? (decisao.canais.includes("whatsapp") ? await carregarChatwoot(supabaseAdmin) : null);
  const canais = decisao.canais.filter((c) => c !== "whatsapp" || chatwoot !== null);

  const { data: lote, error } = await supabaseAdmin.rpc("reivindicar_mensagens_pendentes", {
    p_limite: LIMITE_LOTE,
    p_canais: canais,
  });

  if (error) {
    throw new Error(`falha_ao_reivindicar_fila: ${error.message}`);
  }

  const mensagens = (lote ?? []) as MensagemAgendada[];
  const resultado: ResultadoProcessamento = { canais, processadas: mensagens.length, enviadas: 0, falhas: 0, em_hold: 0 };
  if (mensagens.length === 0) return resultado;

  const emailConfigurado = resendConfigurado();

  for (const mensagem of mensagens) {
    // Sem credencial de e-mail: a mensagem NUNCA vira "enviada". Marca falhou e
    // deixa visível na tela de pendências — nunca some em silêncio.
    if (mensagem.canal === "email" && !emailConfigurado) {
      resultado.falhas += 1;
      await supabaseAdmin
        .from("mensagens_agendadas")
        .update({ status: "falhou", erro: "remetente nao configurado" })
        .eq("id", mensagem.id);
      continue;
    }

    let corpo: string;
    try {
      const resolucao = await resolverPlaceholdersDeEnvio(supabaseAdmin, mensagem);
      if (!resolucao.ok) {
        // Dado ausente, não erro: devolve à fila sem contar tentativa (a claim
        // já somou 1 — desfaz) e sem backoff exponencial.
        resultado.em_hold += 1;
        await supabaseAdmin
          .from("mensagens_agendadas")
          .update({
            status: "pendente",
            erro: resolucao.mensagem,
            tentativas: Math.max(0, mensagem.tentativas - 1),
            proxima_tentativa_em: new Date(Date.now() + HOLD_MINUTOS * 60_000).toISOString(),
          })
          .eq("id", mensagem.id);
        continue;
      }
      corpo = resolucao.corpo;
    } catch (erroLink) {
      resultado.falhas += 1;
      await supabaseAdmin
        .from("mensagens_agendadas")
        .update({ ...backoff(mensagem.tentativas), erro: erroLink instanceof Error ? erroLink.message : String(erroLink) })
        .eq("id", mensagem.id);
      continue;
    }

    if (temPlaceholderSobrando(corpo)) {
      // Template com placeholder que ninguém resolve: bug de configuração, não
      // de envio. Falha com motivo claro; nunca manda `{{x}}` para o cliente.
      resultado.falhas += 1;
      await supabaseAdmin
        .from("mensagens_agendadas")
        .update({ status: "falhou", erro: "template com placeholder desconhecido — corrigir em Admin → Templates" })
        .eq("id", mensagem.id);
      continue;
    }

    let sucesso = false;
    let provedorId: string | null = null;
    let conversaExternaId: string | null = null;
    let erroEnvio: string | null = null;

    if (mensagem.canal === "email") {
      // Material pós-sessão (template `pos_sessao`, o único com `{{link_material}}`):
      // anexa o PDF do material APROVADO atual (agente C, B35). `null` = manda
      // sem anexo, sem erro — o link `/p/m` já foi resolvido no corpo. A própria
      // `lerAnexoPdfMaterial` respeita `configuracoes['material.anexar_pdf']`.
      const ehMaterial = (mensagem.corpo_renderizado ?? "").includes(PLACEHOLDER_LINK_MATERIAL);
      const anexo = ehMaterial ? await lerAnexoPdfMaterial(supabaseAdmin, mensagem.jornada_id) : null;
      const envio = await enviarEmail({
        destinatario: mensagem.destinatario,
        assunto: mensagem.assunto_renderizado ?? "SIC-HF",
        corpoTexto: corpo,
        ...(anexo ? { anexos: [anexo] } : {}),
      });
      sucesso = envio.sucesso;
      provedorId = envio.provedorId;
      erroEnvio = envio.erro;
    } else if (chatwoot) {
      const envio = await chatwoot.enviarWhatsapp({ telefone: mensagem.destinatario, texto: corpo });
      sucesso = envio.sucesso;
      provedorId = envio.provedorId;
      conversaExternaId = envio.conversaId;
      erroEnvio = envio.erro;
    } else {
      // WhatsApp sem provedor: não é do cron enviar. Devolve à fila manual intacta.
      resultado.em_hold += 1;
      await supabaseAdmin
        .from("mensagens_agendadas")
        .update({ status: "pendente", tentativas: Math.max(0, mensagem.tentativas - 1) })
        .eq("id", mensagem.id);
      continue;
    }

    if (sucesso) {
      resultado.enviadas += 1;
      await supabaseAdmin
        .from("mensagens_agendadas")
        .update({
          status: "enviada",
          enviada_em: new Date().toISOString(),
          provedor_id: provedorId,
          // Congela o que foi REALMENTE mandado — inclusive os links reais,
          // nunca o placeholder ("prova do que foi mandado", 0013).
          corpo_renderizado: corpo,
          erro: null,
          // Colunas da 0054 (agente B) — só existem/importam no caminho Chatwoot.
          ...(mensagem.canal === "whatsapp" ? { provedor: "chatwoot", conversa_externa_id: conversaExternaId } : {}),
        })
        .eq("id", mensagem.id);
    } else {
      resultado.falhas += 1;
      await supabaseAdmin
        .from("mensagens_agendadas")
        .update({ ...backoff(mensagem.tentativas), erro: erroEnvio })
        .eq("id", mensagem.id);
    }
  }

  return resultado;
}
