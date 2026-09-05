import type { ProvedorSala } from "./tipos";

/** Não faz nada: o link é colado à mão (B10). Existe para o cron ter um provedor sempre. */
export const provedorSalaManual: ProvedorSala = {
  nome: "manual",
  configurado: () => true,
  faltam: () => [],
  solicitar: async () => ({ ok: false, erro: "provedor_manual" }),
};
