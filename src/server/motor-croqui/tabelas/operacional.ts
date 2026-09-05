import type { Celula, Tabela } from "@/types/croqui-calculo";
import { celulaAusente, celulaCalculada, derivar, somar, subtrair } from "../celula";
import type { ContextoCroqui } from "../contexto";
import {
  LOCACAO_MESES_ANO,
  OPERACIONAL_CUSTO_FIXO,
  OPERACIONAL_CUSTO_PERCENTUAL,
  OPERACIONAL_LOCACAO_INTERCOMPANY_PERCENTUAL,
} from "../dominio";
import { COLUNA_VALOR, comUnidade, linha, montarTabela } from "./comum";

/**
 * T10 `operacional_pj` (aba 8) · T11 `payback` (aba 9) · T12
 * `operacional_locacao` (aba 10).
 *
 * As três só existem quando o cliente tem o insumo: sem empresa operacional na
 * Ficha, T10 SAI do resultado — não vira uma tabela de zeros. Sem aluguel, T12
 * sai. É a diferença entre "não se aplica" e "custa R$ 0,00".
 */

export function montarOperacionalPj(ctx: ContextoCroqui): Tabela | null {
  const op = ctx.entrada.operacional;
  if (!op) return null;

  const c = (l: string, cel: Celula) => ctx.c("operacional_pj", l, "valor", cel);
  const faturamento = c(
    "faturamento",
    typeof op.faturamento_mensal === "number"
      ? celulaCalculada(op.faturamento_mensal, { formula: "faturamento mensal informado na Ficha" })
      : celulaAusente("faturamento mensal da operação não informado na Ficha"),
  );

  const custo = c(
    "custo_operacional",
    typeof op.custo_operacional_mensal === "number"
      ? celulaCalculada(op.custo_operacional_mensal, { formula: "custo operacional informado na Ficha" })
      : derivar([faturamento], ([f]) => f * (OPERACIONAL_CUSTO_PERCENTUAL / 100) + OPERACIONAL_CUSTO_FIXO, {
          formula: `${OPERACIONAL_CUSTO_PERCENTUAL}% do faturamento + ${OPERACIONAL_CUSTO_FIXO} (regra do método)`,
          fonte: "fixo_metodo",
        }),
  );

  const lucro = c("lucro", subtrair(faturamento, custo, "faturamento − custo operacional"));
  const locacao = c(
    "locacao_intercompany",
    derivar([faturamento], ([f]) => f * (OPERACIONAL_LOCACAO_INTERCOMPANY_PERCENTUAL / 100), {
      formula: `${OPERACIONAL_LOCACAO_INTERCOMPANY_PERCENTUAL}% do faturamento (regra do método)`,
      fonte: "fixo_metodo",
    }),
  );
  const ibsCbs = c("ibs_cbs", ctx.percentualSobre("reforma.ibs_cbs.debito.percentual", lucro, "o lucro"));
  const irpjCsll = c("irpj_csll", ctx.percentualSobre("reforma.irpj_csll.percentual", lucro, "o lucro"));
  const credito = c(
    "credito",
    ctx.percentualSobre("reforma.ibs_cbs.credito.percentual", locacao, "a locação intercompany"),
  );
  const lucroFinal = c(
    "lucro_final",
    derivar(
      [lucro, locacao, ibsCbs, irpjCsll, credito],
      ([l, loc, ibs, irpj, cred]) => l + loc - ibs - irpj + cred,
      { formula: "lucro + locação − IBS/CBS − IRPJ/CSLL + crédito" },
    ),
  );

  return montarTabela({
    chave: "operacional_pj",
    titulo: "Empresa operacional",
    colunas: COLUNA_VALOR,
    linhas: [
      linha("faturamento", "Faturamento mensal", faturamento),
      linha("custo_operacional", "Custo operacional", custo),
      linha("lucro", "Lucro disponível", lucro),
      linha("locacao_intercompany", "Locação entre empresas", locacao),
      linha("ibs_cbs", "IBS/CBS", ibsCbs),
      linha("irpj_csll", "IRPJ/CSLL", irpjCsll),
      linha("credito", "Crédito na operação", credito),
      linha("lucro_final", "Lucro líquido final", lucroFinal, true),
    ],
  });
}

export function montarOperacionalLocacao(ctx: ContextoCroqui): Tabela | null {
  const receitaBruta = ctx.totais.rendimento_mensal;
  if (receitaBruta.valor === null || receitaBruta.valor <= 0) return null;

  const c = (l: string, cel: Celula) => ctx.c("operacional_locacao", l, "valor", cel);
  const receita = c("receita", receitaBruta);
  const impostoCpf = c("imposto_cpf", ctx.porFaixa("ir.faixas.irpf_mensal", receita, "o aluguel mensal"));
  const debito = c("debito", ctx.percentualSobre("reforma.ibs_cbs.debito.percentual", receita, "o aluguel"));

  const custoOperacional = ctx.entrada.operacional?.custo_operacional_mensal;
  const credito = c(
    "credito",
    typeof custoOperacional === "number"
      ? ctx.percentualSobre(
          "reforma.ibs_cbs.credito.percentual",
          celulaCalculada(custoOperacional, { formula: "custo operacional informado na Ficha" }),
          "o custo operacional",
        )
      : celulaAusente("sem custo operacional na Ficha — não dá para apurar o crédito de IBS/CBS"),
  );

  const liquido = c("ibs_cbs_liquido", subtrair(debito, credito, "débito − crédito"));
  const irpjCsll = c("irpj_csll", ctx.percentualSobre("reforma.irpj_csll.percentual", receita, "o aluguel"));
  const impostoPj = c("imposto_pj", somar([liquido, irpjCsll], "IBS/CBS líquido + IRPJ/CSLL"));
  const economiaMes = c("economia_mes", subtrair(impostoCpf, impostoPj, "imposto na pessoa física − imposto na PJ"));
  const economiaAno = c(
    "economia_ano",
    derivar([economiaMes], ([e]) => e * LOCACAO_MESES_ANO, {
      formula: `economia mensal × ${LOCACAO_MESES_ANO} (a planilha do escritório usa ${LOCACAO_MESES_ANO} meses, não 12)`,
      fonte: "fixo_metodo",
    }),
  );

  return montarTabela({
    chave: "operacional_locacao",
    titulo: "Aluguel: pessoa física × holding",
    colunas: COLUNA_VALOR,
    linhas: [
      linha("receita", "Aluguel mensal", receita),
      linha("imposto_cpf", "Imposto na pessoa física", impostoCpf),
      linha("debito", "Débito de IBS/CBS", debito),
      linha("credito", "Crédito de IBS/CBS", credito),
      linha("ibs_cbs_liquido", "IBS/CBS líquido", liquido),
      linha("irpj_csll", "IRPJ/CSLL", irpjCsll),
      linha("imposto_pj", "Imposto na holding", impostoPj),
      linha("economia_mes", "Economia mensal", economiaMes),
      linha("economia_ano", "Economia anual", economiaAno, true),
    ],
  });
}

/**
 * T11 — "o sistema se paga em N meses". O argumento de venda mais forte da
 * planilha, e o que nenhuma outra ferramenta do escritório calcula.
 */
export function montarPayback(ctx: ContextoCroqui, custoInercia: Celula, custoModeloReferencia: Celula): Tabela {
  const c = (l: string, cel: Celula) => ctx.c("payback", l, "valor", cel);

  const custoImplementacao = c("custo_implementacao", custoModeloReferencia);
  const capitalSalvo = c(
    "capital_salvo",
    subtrair(custoInercia, custoImplementacao, "custo da inércia − custo de implementação"),
  );

  const aluguel = ctx.totais.rendimento_mensal;
  const temAluguel = (aluguel.valor ?? 0) > 0;
  const impostoCpf = ctx.porFaixa("ir.faixas.irpf_mensal", aluguel, "o aluguel mensal");
  const cargaPj = derivar(
    [aluguel, ctx.valorDe("locacao.pj.presumido.percentual"), ctx.valorDe("reforma.irpj_csll.percentual")],
    ([a, presumido, irpj]) => a * ((presumido + irpj) / 100),
    { formula: "aluguel × (PIS/COFINS presumido + IRPJ/CSLL)" },
  );
  const economiaAluguel = c(
    "economia_aluguel_mes",
    temAluguel
      ? subtrair(impostoCpf, cargaPj, "imposto na pessoa física − carga na holding")
      : celulaCalculada(0, { formula: "sem aluguel no patrimônio" }),
  );

  const cdiInformado = ctx.entrada.cdi_anual;
  const cdi =
    typeof cdiInformado === "number"
      ? celulaCalculada(cdiInformado, { formula: "premissa de CDI informada na simulação" })
      : ctx.valorDe("payback.cdi_anual.percentual");
  const taxaMes = c(
    "taxa_cdi_mes",
    derivar([cdi], ([a]) => ((1 + a / 100) ** (1 / 12) - 1) * 100, {
      formula: "taxa mensal equivalente ao CDI anual, a juros compostos",
      fonte: "fixo_metodo",
    }),
  );
  const rendimento = c(
    "rendimento_mes",
    derivar([capitalSalvo, taxaMes], ([k, t]) => k * (t / 100), {
      formula: "capital salvo × taxa mensal do CDI",
    }),
  );
  const beneficio = c(
    "beneficio_mes",
    somar([economiaAluguel, rendimento], "economia de imposto do aluguel + rendimento do capital salvo"),
  );
  const economiaAno = c(
    "economia_ano",
    derivar([beneficio], ([b]) => b * 12, { formula: "benefício mensal × 12" }),
  );
  const payback = c(
    "payback_meses",
    derivar([custoImplementacao, beneficio], ([custo, b]) => (b <= 0 ? Number.NaN : custo / b), {
      formula: "custo de implementação ÷ benefício mensal",
    }),
  );

  return montarTabela({
    chave: "payback",
    titulo: "Em quanto tempo se paga",
    colunas: COLUNA_VALOR,
    linhas: [
      linha("custo_implementacao", "Custo de implementação", custoImplementacao),
      linha("capital_salvo", "Capital salvo", capitalSalvo),
      linha("economia_aluguel_mes", "Economia mensal no aluguel", economiaAluguel),
      comUnidade(linha("taxa_cdi_mes", "Taxa mensal do CDI", taxaMes), "percentual"),
      linha("rendimento_mes", "Rendimento do capital salvo", rendimento),
      linha("beneficio_mes", "Benefício mensal", beneficio),
      linha("economia_ano", "Economia anual", economiaAno),
      comUnidade(linha("payback_meses", "Tempo para se pagar", payback, true), "meses"),
    ],
  });
}
