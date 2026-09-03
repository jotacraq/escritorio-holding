/**
 * Envio de e-mail via Resend. Usamos a API REST diretamente (fetch) em vez do
 * pacote `resend` para não adicionar dependência nova a um package.json
 * compartilhado com os outros agentes desta squad (risco de poda de lockfile
 * no Windows). Nenhuma UI importa este arquivo — só a rota de cron.
 */

export function resendConfigurado(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim()) && Boolean(process.env.EMAIL_FROM?.trim());
}

export interface EnvioEmailResultado {
  sucesso: boolean;
  provedorId: string | null;
  erro: string | null;
}

export async function enviarEmail(params: {
  destinatario: string;
  assunto: string;
  corpoTexto: string;
}): Promise<EnvioEmailResultado> {
  if (!resendConfigurado()) {
    return { sucesso: false, provedorId: null, erro: "remetente nao configurado" };
  }

  try {
    const resposta = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [params.destinatario],
        subject: params.assunto,
        text: params.corpoTexto,
      }),
      signal: AbortSignal.timeout(15000),
    });

    const corpo = (await resposta.json().catch(() => null)) as { id?: string; message?: string } | null;

    if (!resposta.ok) {
      return {
        sucesso: false,
        provedorId: null,
        erro: `resend_${resposta.status}: ${corpo?.message ?? "erro desconhecido"}`,
      };
    }

    return { sucesso: true, provedorId: corpo?.id ?? null, erro: null };
  } catch (erro) {
    return { sucesso: false, provedorId: null, erro: erro instanceof Error ? erro.message : String(erro) };
  }
}
