import type { Faixa, ResultadoFaixa, TabelaFaixas } from "@/types/croqui-calculo";

/**
 * Tabelas progressivas por faixa (§4.3). Achado do recon que derrubou o
 * desenho escalar: ITCMD (causa mortis e doação), IR sobre ganho de capital,
 * IRPF mensal e emolumentos de cartório de notas NÃO são alíquotas únicas —
 * são tabelas por faixa que o escritório mantém para as 27 UFs.
 *
 * Função pura, sem I/O. Os três modos existem porque a planilha real usa os
 * três:
 * - `faixa_unica`  — acha a faixa em que a base cai e aplica AQUELA alíquota
 *                    sobre a base inteira (cadeia de `IF` das abas 15/17) e a
 *                    parcela a deduzir da tabela do IRPF mensal (aba 18).
 * - `progressivo`  — soma faixa a faixa (IR sobre ganho de capital, aba 16).
 * - `valor_fixo`   — devolve o VALOR da faixa, não um percentual (tabela de
 *                    emolumentos de cartório por UF, aba 19).
 */

/** Tabela corrompida (array vazio, nenhuma faixa aplicável). Quem chama
 * transforma isto em célula `ausente` — nunca em zero. */
export class ErroFaixasInvalidas extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = "ErroFaixasInvalidas";
  }
}

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });

const pct = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%`;

function ordenadas(tabela: TabelaFaixas): Faixa[] {
  if (!Array.isArray(tabela.faixas) || tabela.faixas.length === 0) {
    throw new ErroFaixasInvalidas("tabela de faixas vazia");
  }
  return [...tabela.faixas].sort((a, b) => a.ordem - b.ordem);
}

/** Primeira faixa cujo teto cobre a base (a última, de `ate: null`, cobre tudo). */
function faixaDaBase(faixas: Faixa[], base: number): Faixa {
  const achada = faixas.find((f) => f.ate === null || f.ate === undefined || base <= f.ate);
  if (!achada) {
    throw new ErroFaixasInvalidas(`nenhuma faixa cobre a base ${brl(base)} (falta a faixa "acima de")`);
  }
  return achada;
}

function comTeto(valor: number, tabela: TabelaFaixas, formula: string): { valor: number; formula: string } {
  if (typeof tabela.teto === "number" && valor > tabela.teto) {
    return { valor: tabela.teto, formula: `${formula} · limitado ao teto de ${brl(tabela.teto)}` };
  }
  return { valor, formula };
}

/**
 * Aplica a tabela de faixas sobre a base. Base negativa ou não finita entra
 * como 0 (o motor já protege ganho de capital com `max(0, …)`).
 *
 * Lança `ErroFaixasInvalidas` só quando a tabela está corrompida — o CHECK
 * `app.faixas_validas()` da 0062 impede isso no banco, mas o simulador roda no
 * cliente e o motor não confia em dado que chegou pela rede.
 */
export function aplicarFaixas(base: number, tabela: TabelaFaixas): ResultadoFaixa {
  const b = Number.isFinite(base) && base > 0 ? base : 0;
  const faixas = ordenadas(tabela);

  // Isenção é RESULTADO (zero calculado), nunca ausência.
  if (typeof tabela.isento_ate === "number" && b <= tabela.isento_ate) {
    return {
      valor: 0,
      faixa_aplicada: 0,
      formula: `isento até ${brl(tabela.isento_ate)} (base ${brl(b)})`,
    };
  }

  if (tabela.modo === "valor_fixo") {
    const f = faixaDaBase(faixas, b);
    const valor = typeof f.valor === "number" ? f.valor : 0;
    const { valor: v, formula } = comTeto(
      valor,
      tabela,
      `faixa ${f.ordem} · valor fixo ${brl(valor)} para base ${brl(b)}`,
    );
    return { valor: v, faixa_aplicada: f.ordem, formula };
  }

  if (tabela.modo === "faixa_unica") {
    const f = faixaDaBase(faixas, b);
    const aliquota = typeof f.aliquota === "number" ? f.aliquota : 0;
    const deduzir = typeof f.deduzir === "number" ? f.deduzir : 0;
    const bruto = Math.max(0, b * (aliquota / 100) - deduzir);
    const { valor, formula } = comTeto(
      bruto,
      tabela,
      deduzir > 0
        ? `faixa ${f.ordem} · ${pct(aliquota)} sobre ${brl(b)} − parcela a deduzir de ${brl(deduzir)}`
        : `faixa ${f.ordem} · ${pct(aliquota)} sobre ${brl(b)}`,
    );
    return { valor, faixa_aplicada: f.ordem, formula, aliquota };
  }

  // progressivo — soma faixa a faixa.
  let anterior = typeof tabela.isento_ate === "number" ? tabela.isento_ate : 0;
  let acumulado = 0;
  let ultima = 0;
  const partes: string[] = [];
  for (const f of faixas) {
    const topo = f.ate === null || f.ate === undefined ? Number.POSITIVE_INFINITY : f.ate;
    if (topo <= anterior) continue;
    const parcela = Math.min(b, topo) - anterior;
    if (parcela <= 0) break;
    const aliquota = typeof f.aliquota === "number" ? f.aliquota : 0;
    acumulado += parcela * (aliquota / 100);
    partes.push(`${pct(aliquota)} sobre ${brl(parcela)}`);
    ultima = f.ordem;
    anterior = topo;
    if (b <= topo) break;
  }
  if (partes.length === 0) {
    // base acima de zero e nenhuma parcela: tabela sem faixa aplicável.
    throw new ErroFaixasInvalidas(`nenhuma faixa cobre a base ${brl(b)}`);
  }
  const { valor, formula } = comTeto(acumulado, tabela, `progressivo · ${partes.join(" + ")}`);
  return { valor, faixa_aplicada: ultima, formula };
}

/** A alíquota marginal da faixa em que a base caiu (T11 usa a do IRPF mensal). */
export function aliquotaDaFaixa(base: number, tabela: TabelaFaixas): { aliquota: number; deduzir: number } {
  const b = Number.isFinite(base) && base > 0 ? base : 0;
  if (typeof tabela.isento_ate === "number" && b <= tabela.isento_ate) return { aliquota: 0, deduzir: 0 };
  const f = faixaDaBase(ordenadas(tabela), b);
  return { aliquota: typeof f.aliquota === "number" ? f.aliquota : 0, deduzir: typeof f.deduzir === "number" ? f.deduzir : 0 };
}
