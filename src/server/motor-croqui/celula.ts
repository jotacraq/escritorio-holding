import type { Celula, FaltaParametro } from "@/types/croqui-calculo";

/**
 * Construtores de célula e propagação de ausência (§4.1).
 *
 * INVARIANTE (teste C e D de `scripts/teste-motor-croqui.ts`):
 *   - `procedencia === "ausente"` ⇒ `valor === null`. Sempre. Sem exceção.
 *   - qualquer parcela ausente torna o total ausente, com `falta` = união das
 *     faltas. Nunca existe soma parcial que pareça total.
 *   - zero É resultado: `ITBI = 3% × 0` sai `calculado` com `valor: 0`.
 */

export function celulaCalculada(valor: number, extras: Partial<Celula> = {}): Celula {
  if (!Number.isFinite(valor)) {
    return celulaAusente("resultado não numérico (divisão por zero ou insumo inválido)");
  }
  return { ...extras, valor, procedencia: "calculado" };
}

export function celulaDigitada(valor: number, rubrica_id: string, formula?: string): Celula {
  return { valor, procedencia: "digitado", rubrica_id, formula: formula ?? "valor digitado pela advogada" };
}

export function celulaAusente(motivo: string, falta: FaltaParametro[] = []): Celula {
  const c: Celula = { valor: null, procedencia: "ausente", motivo };
  if (falta.length > 0) c.falta = deduplicarFaltas(falta);
  return c;
}

export const estaAusente = (c: Celula): boolean => c.procedencia === "ausente" || c.valor === null;

export function deduplicarFaltas(faltas: FaltaParametro[]): FaltaParametro[] {
  const vistas = new Map<string, FaltaParametro>();
  for (const f of faltas) {
    const k = `${f.chave}|${f.uf ?? ""}|${f.municipio ?? ""}`;
    if (!vistas.has(k)) vistas.set(k, f);
  }
  return [...vistas.values()];
}

/** União das faltas de um conjunto de células (as ausentes e as que já
 * carregam falta herdada). */
export function faltasDe(celulas: Celula[]): FaltaParametro[] {
  return deduplicarFaltas(celulas.flatMap((c) => c.falta ?? []));
}

function motivosDe(celulas: Celula[]): string {
  const motivos = celulas.filter(estaAusente).map((c) => c.motivo ?? "insumo ausente");
  return [...new Set(motivos)].join(" · ");
}

/**
 * Deriva uma célula de outras. Se QUALQUER fonte estiver ausente, o resultado
 * é ausente com a união das faltas e dos motivos — é a lei da
 * `vw_cenarios_totais` (0060) em TypeScript.
 */
export function derivar(
  fontes: Celula[],
  calcular: (valores: number[]) => number,
  extras: Partial<Celula> = {},
): Celula {
  if (fontes.some(estaAusente)) return celulaAusente(motivosDe(fontes), faltasDe(fontes));
  const valores = fontes.map((f) => f.valor as number);
  return celulaCalculada(calcular(valores), { ...extras, falta: undefined });
}

/** Soma com propagação. `formula` explica a conta na tela. */
export function somar(fontes: Celula[], formula?: string): Celula {
  return derivar(fontes, (vs) => vs.reduce((a, b) => a + b, 0), formula ? { formula } : {});
}

/** Diferença A − B com propagação. */
export function subtrair(a: Celula, b: Celula, formula?: string): Celula {
  return derivar([a, b], ([x, y]) => x - y, formula ? { formula } : {});
}

/** Razão A ÷ B com propagação; divisor 0 vira ausente (não Infinity). */
export function dividir(a: Celula, b: Celula, formula?: string): Celula {
  if (!estaAusente(b) && b.valor === 0) {
    return celulaAusente("divisor zero — sem base de comparação", faltasDe([a, b]));
  }
  return derivar([a, b], ([x, y]) => x / y, formula ? { formula } : {});
}

/** Constante do próprio motor (regra de desenho, não parâmetro de banco). */
export function celulaFixaDoMetodo(valor: number, formula: string): Celula {
  return celulaCalculada(valor, { formula, fonte: "fixo_metodo" });
}

/** Arredondamento de APRESENTAÇÃO. O motor guarda a precisão cheia; quem
 * mostra (tela, `.docx`, slide) arredonda — nunca o contrário. */
export function arredondar(valor: number, casas = 2): number {
  const f = 10 ** casas;
  return Math.round((valor + Number.EPSILON) * f) / f;
}
