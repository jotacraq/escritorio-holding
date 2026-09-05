import type { Celula, ChaveTabela, ModeloHolding, Tabela } from "@/types/croqui-calculo";
import { celulaAusente, derivar, somar, subtrair } from "../celula";
import type { ContextoCroqui } from "../contexto";
import { BASE_CARTORIO_IMOVEIS, BASE_ITCMD } from "../dominio";
import { COLUNA_VALOR, comUnidade, linha, montarTabela } from "./comum";

/**
 * T6 `doacao` (aba 4) e T7/T8/T9 `celula_1|2|3` (abas 5, 6 e 7).
 *
 * Duas decisões de §11.5 vivem aqui:
 * - **CONFLITO 8:** a planilha calcula a diferença da doação como
 *   `SUM(B7:B11)` — que soma o próprio total e infla o número apresentado ao
 *   cliente. O motor implementa `custo da inércia − total`, como as abas 5/6/7.
 *   O `.docx` sai diferente da planilha nesta linha, de propósito.
 * - **CONFLITO 9:** o ITCMD da 3ª célula e o do domicílio vantajoso são
 *   parâmetros dedicados, não o artifício `alíquota da faixa 1 × R$ 10.000`
 *   nem o `2%` digitado à mão na aba 6.
 */

export interface BlocoModelo {
  tabela: Tabela;
  total: Celula;
  totalReforma: Celula;
}

function comparacao(
  ctx: ContextoCroqui,
  tabela: ChaveTabela,
  total: Celula,
  custoInercia: Celula,
): { diferenca: Celula; percentual: Celula } {
  const diferenca = ctx.c(
    tabela,
    "diferenca",
    "valor",
    subtrair(custoInercia, total, "custo da inércia − custo deste modelo"),
  );
  const percentual = ctx.c(
    tabela,
    "percentual",
    "valor",
    derivar([diferenca, custoInercia], ([d, i]) => (i === 0 ? 0 : (d / i) * 100), {
      formula: "economia sobre o custo da inércia, em %",
    }),
  );
  return { diferenca, percentual };
}

export function montarDoacao(ctx: ContextoCroqui, notasDoInventario: Celula, custoInercia: Celula): BlocoModelo {
  const c = (l: string, cel: Celula) => ctx.c("doacao", l, "valor", cel);
  const base = c("base", ctx.baseDe(BASE_ITCMD.doacao));
  // A doação registra os imóveis pela base do DIRPF (aba 4, B9) — não pelo mercado.
  const baseImoveis =
    BASE_CARTORIO_IMOVEIS.doacao === "dirpf" ? ctx.totais.dirpf_imoveis : ctx.totais.mercado_imoveis;

  const notas = c("notas", notasDoInventario);
  const certidoes = c("certidoes", ctx.valorDe("cartorio.certidoes.valor"));
  const imoveis = c(
    "imoveis",
    ctx.temImovel
      ? ctx.cartorio("imoveis", baseImoveis, "os imóveis pela base do DIRPF")
      : { valor: 0, procedencia: "calculado", formula: "sem imóvel no patrimônio", fonte: "fixo_metodo" },
  );
  const itcmd = c("itcmd", ctx.porFaixa("itcmd.faixas.doacao", base, "a base de mercado"));
  const itcmdReforma = ctx.porFaixa("itcmd.faixas.doacao_reforma", base, "a base de mercado");

  const total = c("total", somar([notas, certidoes, imoveis, itcmd], "notas + certidões + registro + ITCMD"));
  const totalReforma = somar([notas, certidoes, imoveis, itcmdReforma], "mesma soma com o ITCMD pós-reforma");
  const { diferenca, percentual } = comparacao(ctx, "doacao", total, custoInercia);

  return {
    total,
    totalReforma,
    tabela: montarTabela({
      chave: "doacao",
      titulo: "Doação em vida",
      colunas: COLUNA_VALOR,
      linhas: [
        linha("base", "Base de cálculo", base),
        linha("notas", "Cartório de notas", notas),
        linha("certidoes", "Certidões e custas", certidoes),
        linha("imoveis", "Cartório de imóveis", imoveis),
        linha("itcmd", "ITCMD doação", itcmd),
        linha("total", "Total", total, true),
        linha("diferenca", "Diferença do inventário", diferenca),
        comUnidade(linha("percentual", "Economia", percentual), "percentual"),
      ],
    }),
  };
}

const TABELA_POR_MODELO: Record<ModeloHolding, ChaveTabela> = {
  celula_1: "celula_1",
  celula_2: "celula_2",
  celula_3: "celula_3",
};

const TITULO_POR_MODELO: Record<ModeloHolding, string> = {
  celula_1: "Uma célula",
  celula_2: "Duas células",
  celula_3: "Três células",
};

/** ITCMD de cada modelo — hoje e pós-reforma. */
function itcmdDoModelo(
  ctx: ContextoCroqui,
  modelo: ModeloHolding,
  base: Celula,
): { atual: Celula; reforma: Celula } {
  if (modelo === "celula_1") {
    return {
      atual: ctx.porFaixa("itcmd.faixas.doacao", base, "a base de mercado"),
      reforma: ctx.porFaixa("itcmd.faixas.doacao_reforma", base, "a base de mercado"),
    };
  }
  if (modelo === "celula_2") {
    return {
      atual: ctx.percentualSobre("itcmd.aliquota.domicilio_vantajoso", base, "a base de mercado"),
      // Não há chave pós-reforma para o domicílio vantajoso: o motor nomeia o
      // que falta em vez de repetir a alíquota de hoje como se fosse a de amanhã.
      reforma: celulaAusente(
        "falta o ITCMD pós-reforma da UF de domicílio vantajoso — cadastre itcmd.faixas.doacao_reforma nessa UF",
        [
          {
            chave: "itcmd.faixas.doacao_reforma",
            uf: ctx.entrada.uf_domicilio_vantajoso ?? undefined,
          },
        ],
      ),
    };
  }
  return {
    atual: ctx.valorDe("itcmd.fixo.celula_3"),
    reforma: ctx.valorDe("itcmd.fixo.celula_3_reforma"),
  };
}

export function montarCelula(
  ctx: ContextoCroqui,
  modelo: ModeloHolding,
  honorario: Celula,
  custoInercia: Celula,
): BlocoModelo {
  const chave = TABELA_POR_MODELO[modelo];
  const c = (l: string, cel: Celula) => ctx.c(chave, l, "valor", cel);

  const base = c("base", ctx.baseDe(BASE_ITCMD[modelo]));
  // O cartório de imóveis segue o MERCADO nos três modelos, mesmo quando a base
  // do ITCMD é o DIRPF (aba 7, B6).
  const imoveis = c(
    "imoveis",
    ctx.temImovel
      ? ctx.cartorio("imoveis", ctx.totais.mercado_imoveis, "os imóveis pelo valor de mercado")
      : { valor: 0, procedencia: "calculado", formula: "sem imóvel no patrimônio", fonte: "fixo_metodo" },
  );
  const junta = c("junta", ctx.valorDe(`holding.junta_comercial.${modelo}` as const));
  const contabilidade = c("contabilidade", ctx.valorDe(`holding.contabilidade.${modelo}` as const));
  const honorarios = c("honorarios", honorario);
  const itcmd = itcmdDoModelo(ctx, modelo, base);
  const itcmdAtual = c("itcmd", itcmd.atual);

  const parcelas = [imoveis, junta, contabilidade, honorarios];
  const total = c("total", somar([...parcelas, itcmdAtual], "registro + junta + contabilidade + honorários + ITCMD"));
  const totalReforma = somar([...parcelas, itcmd.reforma], "mesma soma com o ITCMD pós-reforma");
  const { diferenca, percentual } = comparacao(ctx, chave, total, custoInercia);

  return {
    total,
    totalReforma,
    tabela: montarTabela({
      chave,
      titulo: TITULO_POR_MODELO[modelo],
      colunas: COLUNA_VALOR,
      linhas: [
        linha("base", "Base de cálculo", base),
        linha("imoveis", "Cartório de imóveis", imoveis),
        linha("junta", "Junta comercial", junta),
        linha("contabilidade", "Contabilidade", contabilidade),
        linha("honorarios", "Honorários", honorarios),
        linha("itcmd", "ITCMD", itcmdAtual),
        linha("total", "Total", total, true),
        linha("diferenca", "Diferença do inventário", diferenca),
        comUnidade(linha("percentual", "Economia", percentual), "percentual"),
      ],
    }),
  };
}
