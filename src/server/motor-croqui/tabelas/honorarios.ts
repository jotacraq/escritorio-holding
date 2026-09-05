import type { Celula, LinhaTabela, ModeloHolding, Tabela } from "@/types/croqui-calculo";
import { celulaAusente, derivar, somar, subtrair } from "../celula";
import type { ContextoCroqui } from "../contexto";
import { COLUNA_VALOR, COLUNAS_MODELOS, comUnidade, linha, linhaModelos, montarTabela } from "./comum";

/**
 * T15 `horas_por_ato` · T16 `honorarios` · T17 `deducoes` · T18 `pagamento` ·
 * T19 `membership` — a aba 14 da planilha, inteira.
 *
 * Decisão que reverte a rev. 1 do plano (§11.5, CONFLITO 7): **honorário da
 * holding é FÓRMULA, não parâmetro** — `hora × horas do modelo + operacional`.
 * Isso apagou 3 chaves do catálogo e faz o preço mudar sozinho quando a tabela
 * de horas muda.
 */

type PorModelo = Record<ModeloHolding, Celula>;

const porModelo = (fn: (m: ModeloHolding) => Celula): PorModelo =>
  ({ celula_1: fn("celula_1"), celula_2: fn("celula_2"), celula_3: fn("celula_3") }) as PorModelo;

export interface BlocoHonorarios {
  t15: Tabela;
  t16: Tabela;
  t17: Tabela;
  t18: Tabela;
  t19: Tabela;
  /** honorário SEM o operacional — é o que entra em T7/T8/T9 */
  precoTotal: PorModelo;
  /** honorário com o operacional — base das deduções */
  total: PorModelo;
  novoSaldo: PorModelo;
}

export function montarHonorarios(ctx: ContextoCroqui): BlocoHonorarios {
  // T15 — horas por ato (estrutura, não preço: vive em `configuracoes`).
  const horas = porModelo((m) => ctx.c("horas_por_ato", "total_horas", m, ctx.horasDoModelo(m)));
  const atos = ctx.parametros.horas_por_ato ?? [];
  const linhasAtos: LinhaTabela[] = atos.map((a, i) => ({
    chave: `ato_${i + 1}`,
    rotulo: a.ato,
    celulas: porModelo((m) => {
      const h = a.horas[m];
      return typeof h === "number"
        ? { valor: h, procedencia: "calculado", formula: "horas cadastradas para o ato" }
        : celulaAusente(`"${a.ato}" sem horas para ${m}`);
    }),
  }));

  const t15 = montarTabela({
    chave: "horas_por_ato",
    titulo: "Horas de trabalho",
    unidade: "horas",
    colunas: COLUNAS_MODELOS,
    linhas: [...linhasAtos, linhaModelos("total_horas", "Total de horas", horas, true)],
  });

  // T16 — honorários.
  const hora = ctx.valorDe("honorarios.hora");
  const precoTotal = porModelo((m) =>
    ctx.c(
      "honorarios",
      "preco_total",
      m,
      derivar([hora, horas[m]], ([h, q]) => h * q, { formula: "hora do método × horas do modelo" }),
    ),
  );
  const operacional = porModelo((m) =>
    ctx.c("honorarios", "operacional", m, ctx.percentualSobre("honorarios.operacional.percentual", precoTotal[m], "o honorário")),
  );
  const total = porModelo((m) =>
    ctx.c("honorarios", "total", m, somar([precoTotal[m], operacional[m]], "honorário + valor operacional")),
  );

  const t16 = montarTabela({
    chave: "honorarios",
    titulo: "Honorários",
    colunas: COLUNAS_MODELOS,
    linhas: [
      linhaModelos("preco_total", "Honorários", precoTotal),
      linhaModelos("operacional", "Valor operacional", operacional),
      linhaModelos("total", "Total", total, true),
    ],
  });

  // T17 — deduções da cadeia comercial (iguais nos três modelos).
  const sv = ctx.valorDe("honorarios.sv.padrao");
  const incentivoSv = ctx.valorDe("incentivo.resolvedor.sv");
  const croqui = ctx.valorDe("honorarios.croqui.incentivo");
  const incentivoCroqui = ctx.valorDe("incentivo.resolvedor.croqui");
  const totalDeducoes = somar([sv, incentivoSv, croqui, incentivoCroqui], "soma das quatro deduções");

  const saldo = porModelo((m) =>
    ctx.c("deducoes", "saldo", m, subtrair(total[m], totalDeducoes, "total de honorários − deduções")),
  );
  const incentivoSaldo = porModelo((m) =>
    ctx.c(
      "deducoes",
      "incentivo_resolvedor",
      m,
      ctx.percentualSobre("incentivo.resolvedor.saldo.percentual", saldo[m], "o saldo"),
    ),
  );
  const novoSaldo = porModelo((m) =>
    ctx.c("deducoes", "novo_saldo", m, subtrair(saldo[m], incentivoSaldo[m], "saldo − incentivo")),
  );

  const iguais = (c: Celula): PorModelo => ({ celula_1: c, celula_2: c, celula_3: c });
  const t17 = montarTabela({
    chave: "deducoes",
    titulo: "Deduções",
    colunas: COLUNAS_MODELOS,
    linhas: [
      linhaModelos("sv", "Sessão de Viabilidade", iguais(sv)),
      linhaModelos("incentivo_sv", "Incentivo da Sessão", iguais(incentivoSv)),
      linhaModelos("croqui", "Croqui", iguais(croqui)),
      linhaModelos("incentivo_croqui", "Incentivo do Croqui", iguais(incentivoCroqui)),
      linhaModelos("total_deducoes", "Total a deduzir", iguais(totalDeducoes)),
      linhaModelos("saldo", "Saldo", saldo),
      linhaModelos("incentivo_resolvedor", "Incentivo sobre o saldo", incentivoSaldo),
      linhaModelos("novo_saldo", "Novo saldo", novoSaldo, true),
    ],
  });

  // T18 — pagamento. O sinal é 10% do novo saldo do MODELO DE REFERÊNCIA e é o
  // MESMO para os três (B22 = 10% × D19, B24 = B19 − $B$22). O rótulo "maior
  // valor" da planilha está errado: 3 células é o mais barato, não o maior.
  const referencia = ctx.parametros.sinal_modelo_referencia;
  const sinal = ctx.c(
    "pagamento",
    "sinal",
    "valor",
    ctx.percentualSobre(
      "pagamento.sinal.percentual",
      novoSaldo[referencia],
      `o novo saldo do modelo de referência (${referencia})`,
    ),
  );
  const saldoAVista = porModelo((m) =>
    ctx.c("pagamento", "saldo_a_vista", m, subtrair(novoSaldo[m], sinal, "novo saldo − sinal")),
  );

  const maxParcelas = ctx.valorDe("pagamento.parcelas.max");
  const linhasParcelas: LinhaTabela[] = [];
  if (maxParcelas.valor === null) {
    linhasParcelas.push(linhaModelos("parcelas", "Parcelamento", iguais(maxParcelas)));
  } else {
    for (let n = 2; n <= Math.min(Math.floor(maxParcelas.valor), 24); n += 1) {
      linhasParcelas.push(
        linhaModelos(
          `parcela_${n}`,
          `${n}×`,
          porModelo((m) =>
            ctx.c(
              "pagamento",
              `parcela_${n}`,
              m,
              derivar([saldoAVista[m]], ([s]) => s / n, { formula: `saldo à vista ÷ ${n}` }),
            ),
          ),
        ),
      );
    }
  }

  const t18 = montarTabela({
    chave: "pagamento",
    titulo: "Pagamento",
    colunas: COLUNAS_MODELOS,
    linhas: [
      linhaModelos("sinal", "Sinal", iguais(sinal)),
      linhaModelos("saldo_a_vista", "Saldo à vista", saldoAVista, true),
      ...linhasParcelas,
    ],
  });

  // T19 — membership. Enquanto a mensalidade estiver em divergência (1 plano ×
  // 3 planos, §11.5-3), a tabela nasce ausente: o motor não escolhe um preço.
  const t19 = montarTabela({
    chave: "membership",
    titulo: "Acompanhamento",
    colunas: COLUNA_VALOR,
    linhas: [
      linha("mensalidade", "Mensalidade", ctx.c("membership", "mensalidade", "valor", ctx.valorDe("membership.mensalidade"))),
      comUnidade(
        linha(
          "meses_isentos",
          "Meses isentos",
          ctx.c("membership", "meses_isentos", "valor", ctx.valorDe("membership.meses_isentos")),
        ),
        "meses_inteiros",
      ),
    ],
  });

  return { t15, t16, t17, t18, t19, precoTotal, total, novoSaldo };
}
