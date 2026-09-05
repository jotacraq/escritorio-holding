import type { SupabaseClient } from "@supabase/supabase-js";
import { resolverModoIa } from "@/server/ia/demonstracao";
import { resendConfigurado } from "@/server/regua/email";
import { faltamChatwoot, testarChatwoot } from "@/server/chatwoot/cliente";
import { faltamN8nLigacao, testarN8nLigacao } from "@/server/ligacao-ia/n8n";
import { cabecalhosAssinados } from "./assinatura";
import {
  CHAVE_CANAL_WHATSAPP,
  CHAVE_LIGACAO_AUTOMATICA,
  CHAVE_LIGACAO_PROVEDOR,
  CHAVE_SALA_PROVEDOR,
  CHAVE_ULTIMO_CRON,
  lerConfiguracoes,
} from "./config";
import type { ChaveIntegracao, IntegracaoEstado, ResultadoTesteIntegracao } from "@/types/integracoes";

/**
 * Estado de cada integração para Admin → Integrações (§2.6). Só NOMES de
 * variáveis — nunca valor, nunca tamanho (isso é do `/api/diagnostico`, que
 * exige CRON_SECRET). Textos de pendência são os de §2.9 / §1.9, literais.
 */
export const PENDENCIAS: Record<string, string> = {
  N8N_WEBHOOK_LIGACAO_URL:
    "URL do webhook LANCADOR no n8n (padrão do RSVP). Sem ela a ligação por IA fica em 'manual': vira tarefa para a equipe ligar.",
  LIGACAO_IA_WEBHOOK_SECRET:
    "Segredo compartilhado com o n8n para assinar o retorno da ligação. Sem ele o SIC-HF recusa qualquer retorno (503) — é o comportamento certo.",
  VAPI_ASSISTENTE_ID: "ID do assistente de voz na Vapi usado para agendar a Sessão de Viabilidade.",
  SALA: "Sem isto, o link da sala é colado à mão na Ficha → Sessão.",
  CHATWOOT: "Sem isto, WhatsApp continua fila manual: copiar, abrir no WhatsApp, marcar enviada.",
  RESEND:
    "E-mail não sai: RESEND_API_KEY e EMAIL_FROM não estão configurados no servidor. As mensagens ficam na fila e aparecem como 'falhou' com o motivo.",
  HOTMART_SECRET:
    "Sem HOTMART_WEBHOOK_SECRET no servidor o webhook recusa tudo (503) — é o comportamento certo, não um erro.",
  HOTMART_PRODUTO: "Produto sem ID da Hotmart: todo pagamento dele vai cair em 'produto não mapeado' até o ID ser preenchido.",
  CRON: "A régua ainda não roda sozinha: falta o cron da Hostinger chamar /api/cron/regua a cada 5 minutos com o CRON_SECRET de produção.",
  IA: "IA não configurada: OPENROUTER_API_KEY ausente. Briefing, croqui e material ficam em modo demonstração rotulado.",
};

const VARIAVEIS_SALA = ["N8N_WEBHOOK_SALA_URL", "INTEGRACOES_WEBHOOK_SECRET"] as const;
const CRON_ATRASADO_MIN = 15;

function faltam(nomes: readonly string[]): string[] {
  return nomes.filter((n) => !process.env[n]?.trim());
}

async function ultimoEvento(admin: SupabaseClient, origem: string): Promise<string | null> {
  const { data } = await admin
    .from("webhooks_eventos")
    .select("recebido_em")
    .eq("origem", origem)
    .order("recebido_em", { ascending: false })
    .limit(1)
    .maybeSingle<{ recebido_em: string }>();
  return data?.recebido_em ?? null;
}

async function ultimaLigacao(admin: SupabaseClient): Promise<string | null> {
  const { data } = await admin
    .from("ligacoes_ia")
    .select("criado_em")
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle<{ criado_em: string }>();
  return data?.criado_em ?? null;
}

async function ultimaMensagemEnviada(admin: SupabaseClient, canal: "email" | "whatsapp", provedor?: string): Promise<string | null> {
  let consulta = admin.from("mensagens_agendadas").select("enviada_em").eq("canal", canal).eq("status", "enviada");
  if (provedor) consulta = consulta.eq("provedor", provedor);
  const { data } = await consulta.order("enviada_em", { ascending: false }).limit(1).maybeSingle<{ enviada_em: string }>();
  return data?.enviada_em ?? null;
}

async function produtosSemId(admin: SupabaseClient): Promise<number | null> {
  const { count, error } = await admin.from("produtos").select("id", { count: "exact", head: true }).is("hotmart_produto_id", null);
  return error ? null : (count ?? 0);
}

export async function estadoIntegracoes(admin: SupabaseClient): Promise<IntegracaoEstado[]> {
  const cfg = await lerConfiguracoes(admin, [
    CHAVE_LIGACAO_AUTOMATICA,
    CHAVE_LIGACAO_PROVEDOR,
    CHAVE_CANAL_WHATSAPP,
    CHAVE_SALA_PROVEDOR,
    CHAVE_ULTIMO_CRON,
  ]);
  const toggle = (chave: string) => {
    const c = cfg.get(chave);
    return c ? [{ chave, valor: c.valor, descricao: c.descricao }] : [];
  };

  const [evHotmart, evLigacao, evSala, evChatwoot, ligacao, emailEnviado, whatsappChatwoot, semId] = await Promise.all([
    ultimoEvento(admin, "hotmart"),
    ultimoEvento(admin, "n8n_ligacao"),
    ultimoEvento(admin, "n8n_sala"),
    ultimoEvento(admin, "chatwoot"),
    ultimaLigacao(admin),
    ultimaMensagemEnviada(admin, "email"),
    ultimaMensagemEnviada(admin, "whatsapp", "chatwoot"),
    produtosSemId(admin),
  ]);

  const faltamResend = faltam(["RESEND_API_KEY", "EMAIL_FROM"]);
  const faltamHotmart = faltam(["HOTMART_WEBHOOK_SECRET"]);
  const faltamLigacao = faltamN8nLigacao();
  const faltamSala = faltam(VARIAVEIS_SALA);
  const faltamChat = faltamChatwoot();
  const iaReal = resolverModoIa() === "real";

  const ultimoCron = typeof cfg.get(CHAVE_ULTIMO_CRON)?.valor === "string" ? (cfg.get(CHAVE_ULTIMO_CRON)!.valor as string) : null;
  const cronAtrasado = !ultimoCron || Date.now() - new Date(ultimoCron).getTime() > CRON_ATRASADO_MIN * 60_000;

  const itens: IntegracaoEstado[] = [
    {
      chave: "resend",
      rotulo: "E-mail (Resend)",
      configurado: resendConfigurado(),
      faltam: faltamResend,
      pendencia: faltamResend.length > 0 ? PENDENCIAS.RESEND : null,
      ultimo_evento_em: emailEnviado,
      toggles: [],
      extras: {},
      testavel: true,
    },
    {
      chave: "hotmart",
      rotulo: "Pagamentos (Hotmart)",
      configurado: faltamHotmart.length === 0 && (semId ?? 1) === 0,
      faltam: [...faltamHotmart, ...((semId ?? 0) > 0 ? [`${semId} produto(s) sem ID da Hotmart (Admin → Produtos)`] : [])],
      pendencia: faltamHotmart.length > 0 ? PENDENCIAS.HOTMART_SECRET : (semId ?? 0) > 0 ? PENDENCIAS.HOTMART_PRODUTO : null,
      ultimo_evento_em: evHotmart,
      toggles: [],
      extras: { produtos_sem_id: semId },
      testavel: false,
    },
    {
      chave: "cron",
      rotulo: "Régua (cron da Hostinger)",
      configurado: !cronAtrasado,
      faltam: cronAtrasado ? ["cron no hPanel", ...faltam(["CRON_SECRET"])] : [],
      pendencia: cronAtrasado ? `${PENDENCIAS.CRON} Última passagem registrada: ${ultimoCron ?? "nunca"}.` : null,
      ultimo_evento_em: ultimoCron,
      toggles: [],
      extras: { cron_atrasado: cronAtrasado },
      testavel: false,
    },
    {
      chave: "ligacao_ia",
      rotulo: "Ligação por IA (Vapi via n8n)",
      configurado: faltamLigacao.length === 0,
      faltam: faltamLigacao,
      pendencia: faltamLigacao.length > 0 ? faltamLigacao.map((n) => PENDENCIAS[n]).filter(Boolean).join(" ") : null,
      ultimo_evento_em: evLigacao ?? ligacao,
      toggles: [...toggle(CHAVE_LIGACAO_AUTOMATICA), ...toggle(CHAVE_LIGACAO_PROVEDOR)],
      extras: { automatica: cfg.get(CHAVE_LIGACAO_AUTOMATICA)?.valor === true, provedor: cfg.get(CHAVE_LIGACAO_PROVEDOR)?.valor ?? "manual" },
      testavel: true,
    },
    {
      chave: "sala",
      rotulo: "Sala de reunião (n8n)",
      configurado: faltamSala.length === 0,
      faltam: faltamSala,
      pendencia: faltamSala.length > 0 ? PENDENCIAS.SALA : null,
      ultimo_evento_em: evSala,
      toggles: toggle(CHAVE_SALA_PROVEDOR),
      extras: { provedor: cfg.get(CHAVE_SALA_PROVEDOR)?.valor ?? "manual" },
      testavel: true,
    },
    {
      chave: "chatwoot",
      rotulo: "WhatsApp (Chatwoot)",
      configurado: faltamChat.length === 0,
      faltam: faltamChat,
      pendencia: faltamChat.length > 0 ? PENDENCIAS.CHATWOOT : null,
      ultimo_evento_em: evChatwoot ?? whatsappChatwoot,
      toggles: toggle(CHAVE_CANAL_WHATSAPP),
      extras: { canal_whatsapp: cfg.get(CHAVE_CANAL_WHATSAPP)?.valor ?? "manual" },
      testavel: true,
    },
    {
      chave: "ia",
      rotulo: "IA (OpenRouter)",
      configurado: iaReal,
      faltam: iaReal ? [] : ["OPENROUTER_API_KEY"],
      pendencia: iaReal ? null : PENDENCIAS.IA,
      ultimo_evento_em: null,
      toggles: [],
      extras: { modo: resolverModoIa() },
      testavel: false,
    },
  ];
  return itens;
}

async function testarResend(): Promise<{ ok: boolean; detalhe: string }> {
  if (!resendConfigurado()) return { ok: false, detalhe: `faltam: ${faltam(["RESEND_API_KEY", "EMAIL_FROM"]).join(", ")}` };
  try {
    const r = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      signal: AbortSignal.timeout(10_000),
    });
    return { ok: r.ok, detalhe: `Resend respondeu HTTP ${r.status}` };
  } catch (erro) {
    return { ok: false, detalhe: erro instanceof Error ? erro.message.slice(0, 200) : "erro de rede" };
  }
}

async function testarSala(): Promise<{ ok: boolean; detalhe: string }> {
  const f = faltam(VARIAVEIS_SALA);
  if (f.length > 0) return { ok: false, detalhe: `faltam: ${f.join(", ")}` };
  try {
    const corpo = JSON.stringify({ teste: true, sessao_id: null, emitido_em: new Date().toISOString() });
    const r = await fetch(process.env.N8N_WEBHOOK_SALA_URL!.trim(), {
      method: "POST",
      headers: cabecalhosAssinados(process.env.INTEGRACOES_WEBHOOK_SECRET!.trim(), corpo),
      body: corpo,
      signal: AbortSignal.timeout(10_000),
    });
    return { ok: r.ok, detalhe: `webhook da sala respondeu HTTP ${r.status}` };
  } catch (erro) {
    return { ok: false, detalhe: erro instanceof Error ? erro.message.slice(0, 200) : "erro de rede" };
  }
}

/** Chama o provedor com um evento de teste. Nunca devolve valor de env var. */
export async function testarIntegracao(chave: ChaveIntegracao): Promise<ResultadoTesteIntegracao> {
  const testadoEm = new Date().toISOString();
  let r: { ok: boolean; detalhe: string };
  switch (chave) {
    case "resend":
      r = await testarResend();
      break;
    case "ligacao_ia":
      r = await testarN8nLigacao();
      break;
    case "sala":
      r = await testarSala();
      break;
    case "chatwoot":
      r = await testarChatwoot();
      break;
    case "hotmart":
      r = { ok: false, detalhe: "Não testável daqui: só a Hotmart chama o webhook. Use 'Enviar teste' no painel da Hotmart e veja Admin → Webhooks." };
      break;
    case "cron":
      r = { ok: false, detalhe: "Não testável daqui: o cron é do hPanel da Hostinger. A prova de vida é regua.ultimo_cron_em." };
      break;
    case "ia":
      r = { ok: resolverModoIa() === "real", detalhe: "Sem chamada de teste (custa dinheiro). Use Admin → Sonda de schema." };
      break;
    default:
      r = { ok: false, detalhe: "integração desconhecida" };
  }
  return { chave, ok: r.ok, detalhe: r.detalhe, testado_em: testadoEm };
}
