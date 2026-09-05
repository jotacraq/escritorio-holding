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

/**
 * Anexo em base64 (contrato com o agente C — material pós-sessão em PDF, B35).
 * `conteudoBase64` é o arquivo inteiro; o Resend aceita `content` como string
 * base64 em `attachments`. Teto de 40 MB por e-mail é do provedor; quem monta
 * o anexo (C) garante que o PDF é o do material APROVADO atual.
 */
export interface AnexoEmail {
  nome: string;
  conteudoBase64: string;
  /** Opcional — o Resend infere pelo nome quando ausente. */
  tipoMime?: string;
}

export async function enviarEmail(params: {
  destinatario: string;
  assunto: string;
  corpoTexto: string;
  anexos?: AnexoEmail[];
}): Promise<EnvioEmailResultado> {
  if (!resendConfigurado()) {
    return { sucesso: false, provedorId: null, erro: "remetente nao configurado" };
  }

  const anexos = (params.anexos ?? [])
    .filter((a) => a.nome.trim().length > 0 && a.conteudoBase64.length > 0)
    .map((a) => ({
      filename: a.nome,
      content: a.conteudoBase64,
      ...(a.tipoMime ? { content_type: a.tipoMime } : {}),
    }));

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
        ...(anexos.length > 0 ? { attachments: anexos } : {}),
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
