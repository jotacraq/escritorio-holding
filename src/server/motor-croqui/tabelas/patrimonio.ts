import type { Celula, ColunaTabela, LinhaTabela, Tabela } from "@/types/croqui-calculo";
import { celulaAusente, celulaCalculada, somar } from "../celula";
import type { ContextoCroqui } from "../contexto";
import { linha, montarTabela } from "./comum";

/**
 * T1 `composicao_familiar` (aba 1 Família) e T2 `formacao_patrimonial`
 * (aba 2 Patrimônio). T1 é pass-through; T2 é a única tabela onde cada BEM
 * vira linha — todas as outras trabalham sobre os totais.
 */

const quantidade = (n: number | null, oQueFalta: string): Celula =>
  typeof n === "number" ? celulaCalculada(n, { formula: "informado na Ficha" }) : celulaAusente(oQueFalta);

export function montarComposicaoFamiliar(ctx: ContextoCroqui): Tabela {
  const f = ctx.entrada.familia;
  const c = (l: string, col: string, cel: Celula) => ctx.c("composicao_familiar", l, col, cel);

  return montarTabela({
    chave: "composicao_familiar",
    titulo: "Composição familiar",
    unidade: "contagem",
    nota: f.regime_bens ? `Regime de bens: ${f.regime_bens}` : "Regime de bens não informado na Ficha",
    colunas: [{ chave: "valor", rotulo: "Quantidade" }],
    linhas: [
      linha("conjuge", "Cônjuge", c("conjuge", "valor", celulaCalculada(f.tem_conjuge ? 1 : 0, { formula: "informado na Ficha" }))),
      linha("filhos", "Filhos", c("filhos", "valor", quantidade(f.filhos, "número de filhos não informado na Ficha"))),
      linha("netos", "Netos", c("netos", "valor", quantidade(f.netos, "número de netos não informado na Ficha"))),
      linha(
        "nucleos",
        "Núcleos familiares",
        c("nucleos", "valor", quantidade(f.nucleos, "número de núcleos não informado na Ficha")),
      ),
    ],
  });
}

const COLUNAS_PATRIMONIO: ColunaTabela[] = [
  { chave: "dirpf", rotulo: "Custo (DIRPF)" },
  { chave: "mercado", rotulo: "Valor de mercado" },
  { chave: "rendimento", rotulo: "Rendimento mensal" },
  { chave: "tributacao", rotulo: "Tributação do rendimento" },
];

export function montarFormacaoPatrimonial(ctx: ContextoCroqui): Tabela {
  const linhas: LinhaTabela[] = [];

  for (const bem of ctx.bens) {
    // Os mesmos objetos que alimentam os totais — override incluído.
    const dirpf = ctx.celulaBem(bem, "dirpf");
    const mercado = ctx.celulaBem(bem, "mercado");
    const aluguel = bem.valor_locacao_mensal ?? 0;
    const rendimento = celulaCalculada(aluguel, {
      formula: aluguel > 0 ? "aluguel mensal informado" : "bem sem rendimento",
    });
    // Sem rendimento não há o que tributar — zero é RESULTADO, e não se exige a
    // tabela do IRPF de quem não tem aluguel.
    const tributacao =
      aluguel > 0
        ? ctx.porFaixa("ir.faixas.irpf_mensal", rendimento, "o aluguel mensal")
        : celulaCalculada(0, { formula: "bem sem rendimento" });

    linhas.push({
      chave: bem.id,
      rotulo: bem.descricao,
      celulas: {
        dirpf,
        mercado,
        rendimento: ctx.c("formacao_patrimonial", bem.id, "rendimento", rendimento),
        tributacao: ctx.c("formacao_patrimonial", bem.id, "tributacao", tributacao),
      },
    });
  }

  const coluna = (chave: string): Celula[] => linhas.map((l) => l.celulas[chave]);

  linhas.push({
    chave: "total",
    rotulo: "Total geral",
    destaque: true,
    celulas: {
      dirpf: ctx.totais.dirpf,
      mercado: ctx.totais.mercado,
      rendimento: ctx.totais.rendimento_mensal,
      tributacao:
        linhas.length === 0
          ? celulaCalculada(0, { formula: "sem bens" })
          : somar(coluna("tributacao"), "soma da tributação de cada bem"),
    },
  });

  return montarTabela({
    chave: "formacao_patrimonial",
    titulo: "Mapa patrimonial",
    colunas: COLUNAS_PATRIMONIO,
    linhas,
  });
}
