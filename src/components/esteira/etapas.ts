import type { EtapaOrdem } from "@/lib/api";

/**
 * Cor da etapa (`etapas_jornada_ordem.cor`: slate/amber/blue/green/violet/rose)
 * → token do tema. Nada de hex fixo: os dois temas resolvem sozinhos.
 */
const TOKEN_POR_COR: Record<string, string> = {
  slate: "var(--linha-controle)",
  amber: "var(--ambar)",
  blue: "var(--azul)",
  green: "var(--verde)",
  violet: "var(--marrom)",
  rose: "var(--vermelho)",
};

export function corDaEtapa(cor: string | undefined): string {
  return TOKEN_POR_COR[cor ?? "slate"] ?? TOKEN_POR_COR.slate;
}

export function etapaPorChave(etapas: EtapaOrdem[], chave: string): EtapaOrdem | undefined {
  return etapas.find((e) => e.etapa === chave);
}

/** Chave de `localStorage` da visão escolhida. Preferência de tela, não fato de negócio. */
export const CHAVE_VISAO_ESTEIRA = "sic-hf-esteira-visao";

/**
 * Três formas da MESMA lista, sem busca a mais (Fase 8).
 *
 *  - `lista`   — a porta: `ui/Tabela` (tabela no desktop, cartão a partir do
 *                celular), com fase, croqui, pagamento e prazo em colunas. É o
 *                que Astrea/Projuris/ADVBOX abrem, e o que responde "em que pé
 *                está o processo do fulano" sem rolar de lado;
 *  - `etapas`  — a lista agrupada por etapa (era o valor `lista` até a Fase 7);
 *  - `quadro`  — o kanban de 8 colunas, intacto.
 *
 * O valor `lista` guardado por quem usava a Fase 7 passa a abrir a tabela: quem
 * escolheu "não quero rolar de lado" continua sem rolar de lado, agora com mais
 * informação por linha. Nada foi removido — só reordenado.
 */
export type VisaoEsteira = "lista" | "etapas" | "quadro";

export function ehVisaoEsteira(valor: string | null): valor is VisaoEsteira {
  return valor === "lista" || valor === "etapas" || valor === "quadro";
}
