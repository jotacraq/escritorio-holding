// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { TRACO, formatarDataPura } from "./comum";

/**
 * `formatarData()` (`lib/formatar.ts`) faz `new Date("2026-09-07")`, que é
 * meia-noite UTC e, formatado em São Paulo (UTC−3), volta um dia. Em colunas
 * `date` — `edicoes_seminario.inicio_em`, `parametros_metodo.vigente_de`,
 * `casos.data_reuniao` — isso mostrava a data ERRADA na tela, sem erro nenhum
 * no caminho. Este teste é a trava: ele falha em qualquer fuso a oeste de
 * Greenwich se alguém voltar a passar uma data pura por um caminho com fuso.
 */
describe("formatarDataPura", () => {
  it("não desloca a data de calendário — 07/09 é 07/09, em qualquer fuso", () => {
    expect(formatarDataPura("2026-09-07")).toBe("07/09/2026");
    expect(formatarDataPura("2026-01-01")).toBe("01/01/2026");
    expect(formatarDataPura("2026-12-31")).toBe("31/12/2026");
  });

  it("aceita `date` que o PostgREST devolveu com hora colada, sem se confundir", () => {
    expect(formatarDataPura("2026-09-07T00:00:00Z")).toBe("07/09/2026");
  });

  it("vazio é vazio: nada de data plausível inventada", () => {
    expect(formatarDataPura(null)).toBe(TRACO);
    expect(formatarDataPura(undefined)).toBe(TRACO);
    expect(formatarDataPura("")).toBe(TRACO);
    expect(formatarDataPura("07/09/2026")).toBe(TRACO);
  });
});
