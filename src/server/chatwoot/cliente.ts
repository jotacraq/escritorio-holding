import { normalizarTelefoneE164 } from "@/server/integracoes/telefone";

/**
 * Cliente Chatwoot (API v1) com `fetch` cru — mesmo padrão de `regua/email.ts`,
 * sem SDK (package.json é do agente C). Nenhuma UI importa este arquivo.
 *
 * `enviarWhatsapp` faz: contato (busca por telefone → cria) → conversa aberta
 * na inbox (busca → cria) → mensagem `outgoing`. Cada passo tem timeout e o
 * erro volta com o passo que falhou (nunca lança).
 */
export const VARIAVEIS_CHATWOOT_ENVIO = ["CHATWOOT_URL", "CHATWOOT_ACCOUNT_ID", "CHATWOOT_API_TOKEN", "CHATWOOT_INBOX_ID"] as const;
export const VARIAVEIS_CHATWOOT = [...VARIAVEIS_CHATWOOT_ENVIO, "CHATWOOT_WEBHOOK_SECRET"] as const;

const TIMEOUT_MS = 15_000;

export function faltamChatwootEnvio(): string[] {
  return VARIAVEIS_CHATWOOT_ENVIO.filter((nome) => !process.env[nome]?.trim());
}

export function faltamChatwoot(): string[] {
  return VARIAVEIS_CHATWOOT.filter((nome) => !process.env[nome]?.trim());
}

export function chatwootConfigurado(): boolean {
  return faltamChatwootEnvio().length === 0;
}

function base(): { url: string; conta: string; inbox: string; token: string } {
  const url = (process.env.CHATWOOT_URL ?? "").trim().replace(/\/+$/, "");
  return {
    url,
    conta: (process.env.CHATWOOT_ACCOUNT_ID ?? "").trim(),
    inbox: (process.env.CHATWOOT_INBOX_ID ?? "").trim(),
    token: (process.env.CHATWOOT_API_TOKEN ?? "").trim(),
  };
}

async function chamar<T>(
  metodo: "GET" | "POST",
  caminho: string,
  corpo?: unknown,
): Promise<{ ok: true; dados: T; status: number } | { ok: false; status: number; erro: string }> {
  const { url, token } = base();
  try {
    const resposta = await fetch(`${url}${caminho}`, {
      method: metodo,
      headers: { api_access_token: token, "Content-Type": "application/json", Accept: "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const texto = await resposta.text().catch(() => "");
    let dados: unknown = null;
    try {
      dados = texto ? JSON.parse(texto) : null;
    } catch {
      dados = null;
    }
    if (!resposta.ok) {
      const mensagem = (dados as { message?: string; error?: string } | null)?.message ?? (dados as { error?: string } | null)?.error;
      return { ok: false, status: resposta.status, erro: `chatwoot_${resposta.status}: ${mensagem ?? "erro desconhecido"}` };
    }
    return { ok: true, dados: dados as T, status: resposta.status };
  } catch (erro) {
    return { ok: false, status: 0, erro: `chatwoot_rede: ${erro instanceof Error ? erro.message : String(erro)}` };
  }
}

interface ContatoChatwoot {
  id: number;
  phone_number?: string | null;
}

interface ConversaChatwoot {
  id: number;
  inbox_id: number;
  status: string;
}

async function contatoPorTelefone(conta: string, telefone: string): Promise<ContatoChatwoot | null> {
  const r = await chamar<{ payload?: ContatoChatwoot[] }>("GET", `/api/v1/accounts/${conta}/contacts/search?q=${encodeURIComponent(telefone)}`);
  if (!r.ok) return null;
  const lista = r.dados.payload ?? [];
  return lista.find((c) => normalizarTelefoneE164(c.phone_number ?? null) === telefone) ?? lista[0] ?? null;
}

async function criarContato(conta: string, inbox: string, telefone: string, nome: string | null): Promise<ContatoChatwoot | null> {
  const r = await chamar<{ payload?: { contact?: ContatoChatwoot } } & { id?: number }>("POST", `/api/v1/accounts/${conta}/contacts`, {
    inbox_id: Number(inbox),
    name: nome ?? telefone,
    phone_number: telefone,
  });
  if (!r.ok) return null;
  return r.dados.payload?.contact ?? (typeof r.dados.id === "number" ? { id: r.dados.id } : null);
}

async function conversaAberta(conta: string, inbox: string, contatoId: number): Promise<ConversaChatwoot | null> {
  const r = await chamar<{ payload?: ConversaChatwoot[] }>("GET", `/api/v1/accounts/${conta}/contacts/${contatoId}/conversations`);
  if (!r.ok) return null;
  const lista = r.dados.payload ?? [];
  return lista.find((c) => String(c.inbox_id) === inbox && c.status !== "resolved") ?? lista.find((c) => String(c.inbox_id) === inbox) ?? null;
}

async function criarConversa(conta: string, inbox: string, contatoId: number): Promise<ConversaChatwoot | null> {
  const r = await chamar<ConversaChatwoot>("POST", `/api/v1/accounts/${conta}/conversations`, {
    inbox_id: Number(inbox),
    contact_id: contatoId,
  });
  return r.ok ? r.dados : null;
}

export interface EnvioWhatsappResultado {
  sucesso: boolean;
  provedorId: string | null;
  conversaId: string | null;
  erro: string | null;
}

export async function enviarWhatsapp(params: { telefone: string; texto: string; nome?: string | null }): Promise<EnvioWhatsappResultado> {
  if (!chatwootConfigurado()) {
    return { sucesso: false, provedorId: null, conversaId: null, erro: "chatwoot nao configurado" };
  }
  const telefone = normalizarTelefoneE164(params.telefone);
  if (!telefone) return { sucesso: false, provedorId: null, conversaId: null, erro: "telefone invalido" };

  const { conta, inbox } = base();

  const contato = (await contatoPorTelefone(conta, telefone)) ?? (await criarContato(conta, inbox, telefone, params.nome ?? null));
  if (!contato) return { sucesso: false, provedorId: null, conversaId: null, erro: "chatwoot: contato nao encontrado nem criado" };

  const conversa = (await conversaAberta(conta, inbox, contato.id)) ?? (await criarConversa(conta, inbox, contato.id));
  if (!conversa) return { sucesso: false, provedorId: null, conversaId: null, erro: "chatwoot: conversa nao encontrada nem criada" };

  const envio = await chamar<{ id?: number }>("POST", `/api/v1/accounts/${conta}/conversations/${conversa.id}/messages`, {
    content: params.texto,
    message_type: "outgoing",
    private: false,
  });
  if (!envio.ok) return { sucesso: false, provedorId: null, conversaId: String(conversa.id), erro: envio.erro };

  return { sucesso: true, provedorId: envio.dados.id != null ? String(envio.dados.id) : null, conversaId: String(conversa.id), erro: null };
}

/** "Testar" do Admin → Integrações: lê a inbox configurada (sem mandar mensagem). */
export async function testarChatwoot(): Promise<{ ok: boolean; detalhe: string }> {
  const faltam = faltamChatwootEnvio();
  if (faltam.length > 0) return { ok: false, detalhe: `faltam: ${faltam.join(", ")}` };
  const { conta, inbox } = base();
  const r = await chamar<{ name?: string; channel_type?: string }>("GET", `/api/v1/accounts/${conta}/inboxes/${inbox}`);
  if (!r.ok) return { ok: false, detalhe: r.erro.slice(0, 200) };
  return { ok: true, detalhe: `inbox "${r.dados.name ?? inbox}" (${r.dados.channel_type ?? "canal desconhecido"}) acessível` };
}
