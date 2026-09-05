import type { Celula, ColunaTabela, LinhaTabela, ModeloCroqui, ModeloHolding, Tabela } from "@/types/croqui-calculo";
import { ROTULO_MODELO } from "@/types/croqui-calculo";
import { celulaCalculada, derivar, somar, subtrair } from "../celula";
import type { ContextoCroqui } from "../contexto";
import { COLUNA_VALOR, linha, montarTabela } from "./comum";

/**
 * T13 `comparativo_geral` (aba 11) e T14 `itbi` (aba 12). As duas só COPIAM
 * totais — se um total é ausente, a linha do comparativo é ausente, e é isso
 * que impede a tela de mostrar uma economia calculada sobre meio custo.
 */

const COLUNAS_COMPARATIVO: ColunaTabela[] = [
  { chave: "valor", rotulo: "Custo" },
  { chave: "dif_inventario", rotulo: "Diferença" },
  { chave: "dif_percentual", rotulo: "Economia", unidade: "percentual" },
  { chave: "valor_reforma", rotulo: "Custo após a reforma" },
  { chave: "dif_reforma", rotulo: "Diferença após a reforma" },
  { chave: "dif_percentual_reforma", rotulo: "Economia após a reforma", unidade: "percentual" },
];

export interface ItemComparativo {
  modelo: ModeloCroqui;
  total: Celula;
  totalReforma: Celula;
}

export function montarComparativo(
  ctx: ContextoCroqui,
  itens: ItemComparativo[],
  custoInercia: Celula,
  custoInerciaReforma: Celula,
): Tabela {
  const zero = celulaCalculada(0, { formula: "é a própria referência" });

  const comparar = (modelo: ModeloCroqui, total: Celula, referencia: Celula, sufixo: string) => {
    const dif = ctx.c("comparativo_geral", modelo, `dif${sufixo}`, subtrair(referencia, total, "inventário − modelo"));
    const pct = ctx.c(
      "comparativo_geral",
      modelo,
      `pct${sufixo}`,
      derivar([dif, referencia], ([d, r]) => (r === 0 ? 0 : (d / r) * 100), { formula: "economia em %" }),
    );
    return { dif, pct };
  };

  const linhas: LinhaTabela[] = [
    {
      chave: "inventario",
      rotulo: ROTULO_MODELO.inventario,
      celulas: {
        valor: custoInercia,
        dif_inventario: zero,
        dif_percentual: zero,
        valor_reforma: custoInerciaReforma,
        dif_reforma: zero,
        dif_percentual_reforma: zero,
      },
    },
  ];

  for (const item of itens) {
    if (item.modelo === "inventario") continue;
    const atual = comparar(item.modelo, item.total, custoInercia, "");
    const reforma = comparar(item.modelo, item.totalReforma, custoInerciaReforma, "_reforma");
    linhas.push({
      chave: item.modelo,
      rotulo: ROTULO_MODELO[item.modelo],
      celulas: {
        valor: item.total,
        dif_inventario: atual.dif,
        dif_percentual: atual.pct,
        valor_reforma: item.totalReforma,
        dif_reforma: reforma.dif,
        dif_percentual_reforma: reforma.pct,
      },
    });
  }

  return montarTabela({
    chave: "comparativo_geral",
    titulo: "Comparativo",
    colunas: COLUNAS_COMPARATIVO,
    linhas,
  });
}

/**
 * T14 — o ITBI que o município PODE cobrar sobre a valorização dos imóveis na
 * integralização. É cenário de risco, não custo certo: por isso vive em tabela
 * própria, somado por fora de T7–T9.
 */
export function montarItbi(
  ctx: ContextoCroqui,
  itens: Array<{ modelo: ModeloHolding; total: Celula }>,
): Tabela {
  const itbi = ctx.c(
    "itbi",
    "itbi_possivel",
    "valor",
    ctx.percentualSobre("itbi.aliquota", ctx.totais.valorizacao_imoveis, "a valorização dos imóveis (mercado − DIRPF)"),
  );

  const linhas: LinhaTabela[] = [linha("itbi_possivel", "ITBI possível", itbi)];
  for (const item of itens) {
    linhas.push(
      linha(
        item.modelo,
        `${ROTULO_MODELO[item.modelo]} com ITBI`,
        ctx.c("itbi", item.modelo, "valor", somar([item.total, itbi], "custo do modelo + ITBI possível")),
      ),
    );
  }

  return montarTabela({ chave: "itbi", titulo: "Cenário com ITBI", colunas: COLUNA_VALOR, linhas });
}
