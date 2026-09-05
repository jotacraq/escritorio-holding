import { ApiError } from "@/lib/api";
import { MensagemPendenteSchema, ReguaProvaDeVidaSchema, type MensagemPendente, type ProvaDeVidaEsteira } from "@/types/painel-ui";

/**
 * Prova de vida da esteira automática (Fase 4 §1.6). Consome o endpoint que
 * JÁ existe (`GET /api/mensagens?status=pendente`) e lê, se vier, o bloco
 * `regua: { ultimo_cron_em, cron_atrasado }` que o agente A acrescenta.
 * Sem o bloco → `regua: null` → a tela diz "cron ainda não configurado".
 * `lib/api.ts` é fronteira travada; por isso o cliente vive aqui.
 */
export async function buscarProvaDeVida(): Promise<ProvaDeVidaEsteira> {
  let resposta: Response;
  try {
    resposta = await fetch("/api/mensagens?status=pendente", { credentials: "include" });
  } catch {
    throw new ApiError("Sem conexão com o servidor. Verifique a rede e tente de novo.", 0, "rede");
  }
  if (!resposta.ok) {
    if (resposta.status === 401 || resposta.status === 403) throw new ApiError("Sem permissão para ver a fila de mensagens com esta sessão.", resposta.status);
    throw new ApiError(`Não foi possível ler a fila de mensagens agora (${resposta.status}).`, resposta.status);
  }
  let corpo: unknown = null;
  try {
    corpo = await resposta.json();
  } catch {
    corpo = null;
  }
  if (!corpo || typeof corpo !== "object") {
    throw new ApiError("O servidor respondeu, mas a fila veio em um formato inesperado.", resposta.status, "contrato");
  }
  const objeto = corpo as Record<string, unknown>;
  const regua = ReguaProvaDeVidaSchema.safeParse(objeto.regua);
  const pendentes: MensagemPendente[] = [];
  if (Array.isArray(objeto.itens)) {
    for (const linha of objeto.itens) {
      const r = MensagemPendenteSchema.safeParse(linha);
      if (r.success && r.data.status === "pendente") pendentes.push(r.data);
    }
  }
  pendentes.sort((a, b) => a.agendada_para.localeCompare(b.agendada_para));
  return { regua: regua.success ? regua.data : null, pendentes };
}

/** Chave do template → motivo humano (o que a mensagem faz). Desconhecido → a chave em palavras. */
export function motivoDoTemplate(chave: string | null | undefined): string {
  switch (chave) {
    case "boas_vindas":
      return "Boas-vindas";
    case "confirmacao_d7":
      return "Confirmação D-7";
    case "dia_da_sessao":
      return "Link da sala";
    case "pos_sessao":
      return "Material pós-sessão";
    case "croqui_convite":
      return "Convite do Croqui";
    case null:
    case undefined:
    case "":
      return "Mensagem da régua";
    default:
      return chave.replace(/_/g, " ");
  }
}
