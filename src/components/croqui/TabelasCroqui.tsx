"use client";

import { useMemo, useState } from "react";
import type { ResultadoCroqui } from "@/types/croqui-calculo";
import { rotulo, titleDe } from "@/lib/vocabulario";
import { contarTabelas, montarBlocos } from "./blocosCroqui";
import { FaltaDaTabela, PainelDivergencias, PainelFaltas } from "./FaltaDaTabela";
import { LegendaGlifos, TabelaCroqui } from "./TabelaCroqui";

/**
 * As 19 tabelas do croqui na TELA INTERNA, na ordem das 19 abas do
 * escritório. Lê o `ResultadoCroqui` e nada mais.
 *
 * O link público NÃO passa por aqui: `MaterialCroquiPublico` monta os blocos
 * direto, com o recorte de cliente e sem os painéis de falta e divergência,
 * que são conversa interna.
 *
 * Tabela sem insumo não vem no resultado — e não vira linha de zeros aqui.
 */

export interface TabelasCroquiProps {
  resultado: ResultadoCroqui;
}

export function TabelasCroqui({ resultado }: TabelasCroquiProps) {
  const [mostrarProcedencia, setMostrarProcedencia] = useState(false);

  const blocos = useMemo(() => montarBlocos(resultado), [resultado]);

  // Quantas das 19 o motor FECHOU — não quantos blocos a tela desenha (T5
  // entra como coluna de T3, e contar bloco diria "16 de 19" com 17 fechadas).
  const fechadas = contarTabelas(resultado);

  if (blocos.length === 0) {
    return (
      <p className="text-sm text-tinta-suave">
        Nenhuma tabela fecha com os dados de hoje. Complete o patrimônio na ficha.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-secao">
      <div className="flex flex-wrap items-center justify-between gap-item">
        <div className="flex flex-wrap items-center gap-item">
          <p className="text-sm text-tinta-suave">
            <strong className="font-bold text-tinta">{fechadas}</strong> de 19 tabelas
          </p>
          <button
            type="button"
            onClick={() => setMostrarProcedencia((v) => !v)}
            aria-pressed={mostrarProcedencia}
            title={titleDe("procedencia")}
            className={`inline-flex min-h-11 items-center rounded-controle border px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--latao-cta)] ${
              mostrarProcedencia
                ? "border-[color:var(--latao-cta)] text-tinta"
                : "border-linha-forte text-tinta-suave hover:border-linha-controle hover:text-tinta"
            }`}
          >
            {rotulo("procedencia")}
          </button>
        </div>
      </div>

      {resultado.faltas.length > 0 && <PainelFaltas faltas={resultado.faltas} />}
      {resultado.divergencias.length > 0 && <PainelDivergencias divergencias={resultado.divergencias} />}

      {blocos.map((bloco) => (
        <section key={bloco.rotulo} aria-label={bloco.rotulo} className="flex flex-col gap-bloco">
          <h2 className="text-rotulo font-medium uppercase text-tinta-fraca">{bloco.rotulo}</h2>
          {bloco.tabelas.map((tabela) => (
            <TabelaCroqui
              key={tabela.chave}
              tabela={tabela}
              mostrarProcedencia={mostrarProcedencia}
              nivelTitulo="h3"
              rodape={tabela.falta.length > 0 ? <FaltaDaTabela falta={tabela.falta} /> : undefined}
            />
          ))}
        </section>
      ))}

      <LegendaGlifos mostrarProcedencia={mostrarProcedencia} />
    </div>
  );
}
