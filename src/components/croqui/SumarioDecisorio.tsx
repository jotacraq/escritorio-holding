"use client";

import type { Celula, ResultadoCroqui, Tabela } from "@/types/croqui-calculo";
import { formatarCelula, podeAfirmar } from "@/server/motor-croqui/formatar";
import { Kpi } from "@/components/ui/Kpi";
import { melhorEconomia } from "./blocosCroqui";

/**
 * O SUMÁRIO DECISÓRIO do croqui — o que o advogado precisa ver ANTES de rolar.
 *
 * O problema medido (Fase 6): a tela do croqui tinha **6.278 px** — as 19
 * tabelas empilhadas, na ordem das abas da planilha do escritório. Está certo
 * como registro e errado como tela de trabalho: quem abre precisa saber, de
 * relance, *quanto se economiza, com qual arquitetura e em quanto tempo se
 * paga*. Esses três números já existiam — estavam nas linhas 6, 9 e 13 da
 * décima terceira tabela.
 *
 * ------------------------------------------------------------------
 * NADA AQUI É CALCULADO DE NOVO.
 * Cada número é uma célula do `ResultadoCroqui`, lida por chave:
 *   · economia e arquitetura -> `melhorEconomia(comparativo_geral)` (T13), a
 *     MESMA função que o simulador e o slide usam. Célula ausente não entra na
 *     disputa e economia <= 0 devolve `null` — não existe "economia negativa
 *     grande e verde" (regra de `blocosCroqui.ts`).
 *   · investimento e retorno -> linhas `custo_implementacao` e
 *     `payback_meses` de T11 (`payback`).
 * Célula ausente vira travessão com o motivo no `Kpi.motivoVazio`, nunca zero
 * (DS §7, "vazio é vazio").
 * ------------------------------------------------------------------
 */

/** Uma célula de uma linha de tabela, por chave. `undefined` quando a linha não existe. */
function celulaDaLinha(tabela: Tabela | undefined, chaveLinha: string, chaveColuna = "valor"): Celula | undefined {
  return tabela?.linhas.find((l) => l.chave === chaveLinha)?.celulas[chaveColuna];
}

/** Unidade declarada da linha (T11 marca `payback_meses` como `meses`). */
function unidadeDaLinha(tabela: Tabela | undefined, chaveLinha: string): "brl" | "percentual" | "meses" | "numero" {
  const linha = tabela?.linhas.find((l) => l.chave === chaveLinha);
  return (linha?.unidade ?? tabela?.unidade ?? "brl") as "brl" | "percentual" | "meses" | "numero";
}

/** Texto da célula, ou `null` quando não dá para afirmar — o `Kpi` mostra o motivo. */
function texto(celula: Celula | undefined, tipo: "brl" | "percentual" | "meses" | "numero" = "brl"): string | null {
  if (!celula || !podeAfirmar(celula)) return null;
  return formatarCelula(celula, tipo);
}

/** Por que o número não existe — a frase do motor, nunca uma inventada aqui. */
function motivo(celula: Celula | undefined, padrao: string): string {
  if (!celula) return padrao;
  return celula.motivo ?? padrao;
}

export function SumarioDecisorio({ resultado }: { resultado: ResultadoCroqui }) {
  const comparativo = resultado.tabelas.comparativo_geral;
  const payback = resultado.tabelas.payback;

  const melhor = melhorEconomia(comparativo);
  const custo = celulaDaLinha(payback, "custo_implementacao");
  const tempo = celulaDaLinha(payback, "payback_meses");

  const economia = melhor ? texto(melhor.economia) : null;
  const percentual = melhor?.percentual ? texto(melhor.percentual, "percentual") : null;

  return (
    <section aria-labelledby="sumario-croqui" className="flex flex-col gap-item">
      <h2 id="sumario-croqui" className="sr-only">
        Resumo da decisão
      </h2>
      <div className="grid grid-cols-1 gap-item sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          rotulo="Arquitetura recomendada"
          valor={melhor?.modelo ?? null}
          motivoVazio={comparativo ? "nenhum modelo economiza contra o inventário" : "o comparativo ainda não fecha"}
        />
        <Kpi
          rotulo="Economia contra o inventário"
          valor={economia}
          unidade={percentual ? `· ${percentual}` : undefined}
          motivoVazio={melhor ? motivo(melhor.economia, "sem base para comparar") : "o comparativo ainda não fecha"}
        />
        <Kpi
          rotulo="Investimento"
          valor={texto(custo)}
          motivoVazio={motivo(custo, "os honorários ainda não fecham")}
        />
        <Kpi
          rotulo="Tempo para se pagar"
          valor={texto(tempo, unidadeDaLinha(payback, "payback_meses"))}
          motivoVazio={motivo(tempo, "sem benefício mensal, não há prazo")}
        />
      </div>
    </section>
  );
}
