import type { SupabaseClient } from "@supabase/supabase-js";
import { CHAVE_COMPLETUDE_MINIMA_BRIEFING, CHAVE_COMPLETUDE_PESOS, lerConfiguracaoInt, lerConfiguracaoJson } from "./configuracao";

/**
 * Porta de completude (L4, ARQUITETURA-FASE-3.md §1.7) — a alavanca gratuita:
 * o último briefing em produção custou US$ 0,105/0,128 e saiu com grau de
 * confiança 20. O sistema classificou a própria análise como fraca DEPOIS de
 * cobrar o preço cheio por ela. Isto calcula um score determinístico, dos
 * MESMOS dados que `montarContextoBriefing()` já carregou — zero query nova,
 * zero token — e decide gerar ou não ANTES de qualquer chamada de IA.
 *
 * Pesos e limiar vivem em `configuracoes` (BLOQUEIO B24): "VALOR INICIAL, não
 * vem do método" — nenhum POP diz quanto dado basta. Ajustável por `UPDATE`,
 * sem deploy. Os defaults abaixo espelham o seed da `0042` e só entram em jogo
 * se a leitura de `configuracoes` falhar.
 */

export interface SinaisCompletude {
  formulario: boolean;
  ligacao: boolean;
  patrimonio: boolean;
  frases: boolean;
  decisorio: boolean;
  familia: boolean;
  transcricao: boolean;
}

export type PesosCompletude = Record<keyof SinaisCompletude, number>;

export const PESOS_COMPLETUDE_DEFAULT: PesosCompletude = {
  formulario: 25,
  ligacao: 20,
  patrimonio: 15,
  frases: 10,
  decisorio: 10,
  familia: 10,
  transcricao: 10,
};

export const COMPLETUDE_MINIMA_DEFAULT = 40;

export interface ItemChecklistCompletude {
  sinal: keyof SinaisCompletude;
  peso: number;
  atendido: boolean;
  rotulo: string;
}

export interface ResultadoCompletude {
  score: number;
  minimo: number;
  atingiu: boolean;
  checklist: ItemChecklistCompletude[];
}

const ROTULOS: Record<keyof SinaisCompletude, string> = {
  formulario: "Formulário Estratégico respondido (POP 02)",
  ligacao: "Ligação Estratégica registrada (POP 03/03-B)",
  patrimonio: "Faixa de patrimônio declarada ou ao menos um item de patrimônio cadastrado",
  frases: "Ao menos uma frase marcante registrada na ligação",
  decisorio: "Processo decisório preenchido na ligação",
  familia: "Ao menos um familiar cadastrado",
  transcricao: "Transcrição da ligação presente e com consentimento de tratamento por IA",
};

function normalizarPesos(bruto: unknown): PesosCompletude {
  if (!bruto || typeof bruto !== "object") return PESOS_COMPLETUDE_DEFAULT;
  const obj = bruto as Record<string, unknown>;
  const resultado = { ...PESOS_COMPLETUDE_DEFAULT };
  for (const chave of Object.keys(PESOS_COMPLETUDE_DEFAULT) as Array<keyof SinaisCompletude>) {
    const valor = Number(obj[chave]);
    if (Number.isFinite(valor) && valor >= 0) resultado[chave] = valor;
  }
  return resultado;
}

/**
 * Calcula o score de completude e o checklist item a item. NUNCA lança —
 * quem chama decide o que fazer com `atingiu === false` (409 ou
 * `forcar_mesmo_assim`). Sem chamada de IA, sem custo.
 */
export async function calcularCompletude(
  supabaseAdmin: SupabaseClient,
  sinais: SinaisCompletude,
): Promise<ResultadoCompletude> {
  const [pesosBrutos, minimo] = await Promise.all([
    lerConfiguracaoJson<unknown>(supabaseAdmin, CHAVE_COMPLETUDE_PESOS, PESOS_COMPLETUDE_DEFAULT),
    lerConfiguracaoInt(supabaseAdmin, CHAVE_COMPLETUDE_MINIMA_BRIEFING, COMPLETUDE_MINIMA_DEFAULT),
  ]);
  const pesos = normalizarPesos(pesosBrutos);

  const checklist: ItemChecklistCompletude[] = (Object.keys(pesos) as Array<keyof SinaisCompletude>).map(
    (sinal) => ({
      sinal,
      peso: pesos[sinal],
      atendido: Boolean(sinais[sinal]),
      rotulo: ROTULOS[sinal],
    }),
  );

  const score = checklist.reduce((soma, item) => soma + (item.atendido ? item.peso : 0), 0);

  return { score, minimo, atingiu: score >= minimo, checklist };
}
