import { describe, expect, it } from "vitest";
import { decidirColisaoLigacaoAtiva } from "./fila";

/**
 * A decisão que o botão "Ligar por IA agora" toma quando o índice
 * `uniq_ligacao_ia_ativa` (0053) recusa o INSERT com 23505.
 *
 * Só a decisão é testada aqui — o INSERT, o índice e a RLS continuam provados
 * no banco (`scripts/verificacao-0073.sql`), como manda o `vitest.config.ts`.
 */
describe("decidirColisaoLigacaoAtiva", () => {
  it("na_fila: reaproveita a ligação que já existe (nada discou ainda)", () => {
    expect(decidirColisaoLigacaoAtiva({ status: "na_fila" })).toBe("reaproveitar");
  });

  it("discando: conflito — a chamada está em curso, pedir de novo tocaria duas vezes", () => {
    expect(decidirColisaoLigacaoAtiva({ status: "discando" })).toBe("conflito");
  });

  it("em_ligacao: conflito", () => {
    expect(decidirColisaoLigacaoAtiva({ status: "em_ligacao" })).toBe("conflito");
  });

  it("sem linha ativa (corrida entre o INSERT e a leitura): conflito, nunca reaproveita nada", () => {
    expect(decidirColisaoLigacaoAtiva(null)).toBe("conflito");
    expect(decidirColisaoLigacaoAtiva(undefined)).toBe("conflito");
  });

  it("estado encerrado nunca é reaproveitado", () => {
    for (const status of ["concluida", "sem_resposta", "falhou", "cancelada"]) {
      expect(decidirColisaoLigacaoAtiva({ status })).toBe("conflito");
    }
  });
});
