import { z } from "zod";

/**
 * A saída do agente de WhatsApp — 4 campos, nenhum enum grande (D18).
 *
 * TETO DE GRAMÁTICA (medido em 04/09/2026): 4.428 B foi recusado pelo provedor
 * com `invalid_request_error: The compiled grammar is too large`; 3.905 B
 * compilou. Enum em gramática estrita vira alternação e se multiplica pelo
 * resto do schema — por isso a lista de intenções válidas mora no TEXTO do
 * prompt (0090) e aqui `intencao` é `string`. Quem valida a lista é o parser
 * abaixo, no nosso lado, onde errar custa zero token.
 *
 * `acao` é a única alternação, com 3 valores: é a que o código OBEDECE, então
 * precisa chegar limpa.
 */
export const AgenteRespostaSchema = z.object({
  intencao: z.string().describe("Uma das intenções listadas no prompt."),
  resposta: z.string().describe("A frase para o cliente, no máximo 400 caracteres. Vazia quando não há certeza."),
  acao: z.enum(["enviar_link", "nenhuma", "encaminhar_humano"]),
  confianca: z.number().describe("0 a 1. Abaixo de 0,6 o sistema não envia."),
});

export type AgenteRespostaIa = z.infer<typeof AgenteRespostaSchema>;

/** Confiança abaixo disto: NÃO envia + tarefa (D13). "Não sei" nunca vira texto plausível. */
export const CONFIANCA_MINIMA = 0.6;

/** Teto de caracteres do que sai para o cliente. */
export const MAX_RESPOSTA = 400;

/** Teto do que ENTRA no modelo (D20) — o texto do cliente vai recortado. */
export const MAX_ENTRADA = 500;

const INTENCOES_VALIDAS = new Set([
  "confirmar_horario",
  "enviar_documento",
  "o_que_falta",
  "duvida_uso_sistema",
  "duvida_juridica",
  "preco_prazo",
  "falar_com_humano",
  "fora_do_tema",
  "desconhecida",
]);

export type SaidaAgenteValidada =
  | { ok: true; intencao: string; resposta: string; acao: AgenteRespostaIa["acao"]; confianca: number }
  | { ok: false; motivo: "intencao_invalida" | "confianca_baixa" | "resposta_vazia" | "resposta_longa" };

/**
 * O parser da saída do modelo. Função PURA — é o teste mais barato desta fase e
 * o que impede que um modelo criativo vire mensagem no WhatsApp de um cliente.
 *
 * Recusa (nesta ordem):
 *  - intenção fora do catálogo → o modelo inventou um rótulo;
 *  - confiança fora de [0,1] ou abaixo do mínimo;
 *  - resposta vazia (o próprio prompt manda devolver vazio quando não sabe);
 *  - resposta acima do teto de caracteres — cortar no meio da frase é pior.
 */
export function validarSaidaIa(saida: AgenteRespostaIa): SaidaAgenteValidada {
  const intencao = (saida.intencao ?? "").trim();
  if (!INTENCOES_VALIDAS.has(intencao) || intencao === "desconhecida") {
    return { ok: false, motivo: "intencao_invalida" };
  }
  const confianca = Number(saida.confianca);
  if (!Number.isFinite(confianca) || confianca < 0 || confianca > 1 || confianca < CONFIANCA_MINIMA) {
    return { ok: false, motivo: "confianca_baixa" };
  }
  const resposta = (saida.resposta ?? "").trim();
  if (resposta.length === 0) return { ok: false, motivo: "resposta_vazia" };
  if (resposta.length > MAX_RESPOSTA) return { ok: false, motivo: "resposta_longa" };

  return { ok: true, intencao, resposta, acao: saida.acao, confianca };
}
