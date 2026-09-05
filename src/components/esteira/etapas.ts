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

/** Chave de `localStorage` da visão escolhida (quadro × lista). Preferência de tela, não fato de negócio. */
export const CHAVE_VISAO_ESTEIRA = "sic-hf-esteira-visao";
export type VisaoEsteira = "quadro" | "lista";
