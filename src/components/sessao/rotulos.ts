import type { SimIdentificador } from "@/types/roteiro";

/**
 * Rótulos fixos dos 4 SIMs (POP 05 / PARTE 01 do script). Ordem é a ordem em
 * que o script pede para serem buscados — a tela segue essa ordem, não a
 * ordem alfabética das chaves.
 */
export const ORDEM_SIMS: SimIdentificador[] = ["sigilo_gravacao", "licitude", "decisores", "proximo_passo"];

export const ROTULO_SIM: Record<SimIdentificador, string> = {
  sigilo_gravacao: "Sigilo e Gravação",
  licitude: "Ética e Licitude",
  decisores: "Presença dos Decisores",
  proximo_passo: "O Próximo Passo",
};

export const NUMERO_SIM: Record<SimIdentificador, number> = {
  sigilo_gravacao: 1,
  licitude: 2,
  decisores: 3,
  proximo_passo: 4,
};
