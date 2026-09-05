import type { Celula, Tabela } from "@/types/croqui-calculo";
import { celulaAusente, celulaCalculada, derivar, somar } from "../celula";
import type { ContextoCroqui } from "../contexto";
import { BASE_ITCMD } from "../dominio";
import { COLUNA_VALOR, linha, montarTabela } from "./comum";

/**
 * T3 `inventario_atual` (aba 3, B3–B9), T4 `levantamento_inventario`
 * (aba 3, B12–B18) e T5 `inventario_reforma`.
 *
 * `custo_da_inercia` (T4) é o número que TODA comparação do croqui usa — e é
 * exatamente a célula que saiu "R$ 0,00" no deck real do Drive. Aqui ela é
 * `subtotal + deságio + IR`, e qualquer parcela ausente a torna `null`.
 */

export interface BlocoInventario {
  t3: Tabela;
  t4: Tabela;
  t5: Tabela;
  /** T3.subtotal — custos diretos do inventário */
  subtotal: Celula;
  /** T4.custo_da_inercia — a régua de todas as comparações */
  custoInercia: Celula;
  /** T5.custo — o mesmo, com o ITCMD pós-reforma */
  custoInerciaReforma: Celula;
  /** T3.notas — a doação reaproveita a MESMA escritura (aba 4, B7) */
  notas: Celula;
}

interface CustosDiretos {
  base: Celula;
  itcmd: Celula;
  notas: Celula;
  certidoes: Celula;
  imoveis: Celula;
  honorarios: Celula;
  subtotal: Celula;
}

function custosDiretos(
  ctx: ContextoCroqui,
  tabela: "inventario_atual" | "inventario_reforma",
  chaveItcmd: "itcmd.faixas.heranca" | "itcmd.faixas.heranca_reforma",
): CustosDiretos {
  const c = (l: string, cel: Celula) => ctx.c(tabela, l, "valor", cel);
  const base = c("base", ctx.baseDe(BASE_ITCMD.inventario));
  const semImovel = celulaCalculada(0, { formula: "sem imóvel no patrimônio", fonte: "fixo_metodo" });

  const itcmd = c("itcmd", ctx.porFaixa(chaveItcmd, base, "a base de mercado"));
  const notas = c("notas", ctx.temImovel ? ctx.cartorio("notas", base, "a base de mercado") : semImovel);
  const certidoes = c("certidoes", ctx.valorDe("cartorio.certidoes.valor"));
  const imoveis = c("imoveis", ctx.temImovel ? ctx.cartorio("imoveis", base, "a base de mercado") : semImovel);
  const honorarios = c(
    "honorarios",
    ctx.percentualSobre("honorarios.inventario.percentual", base, "a base de mercado"),
  );
  const subtotal = c(
    "subtotal",
    somar([itcmd, notas, certidoes, imoveis, honorarios], "ITCMD + notas + certidões + registro + honorários"),
  );

  return { base, itcmd, notas, certidoes, imoveis, honorarios, subtotal };
}

const linhasCustos = (d: CustosDiretos, rotuloItcmd: string) => [
  linha("base", "Base de cálculo", d.base),
  linha("itcmd", rotuloItcmd, d.itcmd),
  linha("notas", "Cartório de notas", d.notas),
  linha("certidoes", "Certidões e custas", d.certidoes),
  linha("imoveis", "Cartório de imóveis", d.imoveis),
  linha("honorarios", "Honorários advocatícios", d.honorarios),
  linha("subtotal", "Subtotal de custos diretos", d.subtotal, true),
];

/** O bem que precisa ser vendido às pressas para pagar o inventário. */
function bemParaLiquidez(ctx: ContextoCroqui, aLevantar: Celula) {
  const imoveis = ctx.imoveis;
  if (imoveis.length === 0) {
    const ausente = celulaAusente("não há imóvel no patrimônio para dar liquidez ao inventário");
    return { rotulo: "Nenhum imóvel disponível", mercado: ausente, dirpf: ausente };
  }
  const marcado = imoveis.find((b) => b.vender_para_levantar === true);
  const suficiente =
    aLevantar.valor !== null ? imoveis.find((b) => (b.valor_mercado ?? 0) >= (aLevantar.valor as number)) : undefined;
  const escolhido = marcado ?? suficiente;

  if (escolhido) {
    return {
      rotulo: escolhido.descricao,
      mercado: ctx.celulaBem(escolhido, "mercado"),
      dirpf: ctx.celulaBem(escolhido, "dirpf"),
    };
  }
  // Regra da planilha: nenhum imóvel isolado cobre a conta → soma de todos.
  return {
    rotulo: "Soma de todos os imóveis",
    mercado: ctx.totais.mercado_imoveis,
    dirpf: ctx.totais.dirpf_imoveis,
  };
}

export function montarInventario(ctx: ContextoCroqui): BlocoInventario {
  const atual = custosDiretos(ctx, "inventario_atual", "itcmd.faixas.heranca");
  const reforma = custosDiretos(ctx, "inventario_reforma", "itcmd.faixas.heranca_reforma");

  const c = (l: string, cel: Celula) => ctx.c("levantamento_inventario", l, "valor", cel);
  const bem = bemParaLiquidez(ctx, atual.subtotal);

  const aLevantar = c("a_levantar", atual.subtotal);
  const valorBem = c("bem_mercado", bem.mercado);
  const custoBem = c("bem_dirpf", bem.dirpf);
  const desagio = c(
    "desagio",
    ctx.percentualSobre("venda_forcada.desagio.percentual", valorBem, "o valor de mercado do bem"),
  );
  const ganho = c(
    "ganho",
    derivar([valorBem, desagio, custoBem], ([m, d, dirpf]) => Math.max(0, m - d - dirpf), {
      formula: "valor de venda com deságio − custo de aquisição (nunca negativo)",
      fonte: "fixo_metodo",
    }),
  );
  const ir = c("ir", ctx.porFaixa("ir.faixas.ganho_capital", ganho, "o ganho de capital"));
  const custoInercia = c(
    "custo_da_inercia",
    somar([atual.subtotal, desagio, ir], "custos diretos + perda na venda urgente + imposto sobre o ganho de capital"),
  );

  const faturamento = ctx.entrada.operacional?.faturamento_mensal;
  const riscoBloqueio = c(
    "risco_bloqueio",
    typeof faturamento === "number"
      ? derivar(
          [celulaCalculada(faturamento), ctx.valorDe("operacional.risco_bloqueio.meses")],
          ([f, meses]) => f * meses,
          { formula: "faturamento mensal da operação × meses de bloqueio" },
        )
      : celulaAusente("sem empresa operacional na Ficha — não há faturamento a bloquear"),
  );

  const custoReforma = ctx.c(
    "inventario_reforma",
    "custo",
    "valor",
    somar([reforma.subtotal, desagio, ir], "custos diretos pós-reforma + deságio + IR"),
  );

  return {
    subtotal: atual.subtotal,
    custoInercia,
    custoInerciaReforma: custoReforma,
    notas: atual.notas,
    t3: montarTabela({
      chave: "inventario_atual",
      titulo: "Inventário hoje",
      colunas: COLUNA_VALOR,
      linhas: linhasCustos(atual, "ITCMD causa mortis"),
    }),
    t4: montarTabela({
      chave: "levantamento_inventario",
      titulo: "Custo da inércia",
      nota: `Bem considerado para dar liquidez: ${bem.rotulo}`,
      colunas: COLUNA_VALOR,
      linhas: [
        linha("a_levantar", "Valor a levantar", aLevantar),
        linha("bem_mercado", "Valor de mercado do bem", valorBem),
        linha("bem_dirpf", "Custo de aquisição do bem", custoBem),
        linha("desagio", "Perda na venda urgente", desagio),
        linha("ganho", "Ganho de capital", ganho),
        linha("ir", "Imposto sobre o ganho de capital", ir),
        linha("custo_da_inercia", "Custo total da inércia", custoInercia, true),
        linha("risco_bloqueio", "Risco de bloqueio da operação", riscoBloqueio),
      ],
    }),
    t5: montarTabela({
      chave: "inventario_reforma",
      titulo: "Inventário após a reforma",
      colunas: COLUNA_VALOR,
      linhas: [
        ...linhasCustos(reforma, "ITCMD causa mortis pós-reforma"),
        linha("custo", "Custo total da inércia após a reforma", custoReforma, true),
      ],
    }),
  };
}
