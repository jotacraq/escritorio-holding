"use client";

import { useMemo, useState } from "react";
import type { ResultadoCroqui } from "@/types/croqui-calculo";
import { rotulo, titleDe } from "@/lib/vocabulario";
import { contarTabelas, montarBlocos } from "./blocosCroqui";
import { FaltaDaTabela, PainelDivergencias, PainelFaltas } from "./FaltaDaTabela";
import { LegendaGlifos, TabelaCroqui } from "./TabelaCroqui";
import { SumarioDecisorio } from "./SumarioDecisorio";

/**
 * As 19 tabelas do croqui na TELA INTERNA, na ordem das 19 abas do
 * escritório. Lê o `ResultadoCroqui` e nada mais.
 *
 * Fase 6 — a tela media 6.278 px, e o advogado precisava rolar seis telas para
 * achar o número que a reunião inteira serve para dizer. Duas mudanças, sem
 * tirar nada do ar:
 *   1. um SUMÁRIO DECISÓRIO acima da dobra (arquitetura · economia ·
 *      investimento · payback) — os mesmos números de T13 e T11, lidos por
 *      chave, nunca recalculados;
 *   2. os seis blocos viram `<details>`, e só **Comparação** nasce aberto — é
 *      onde está a decisão. `<details>` nativo: Tab, Enter, Ctrl+F do
 *      navegador e leitor de tela continuam funcionando, e a impressão do
 *      croqui abre tudo (regra em `globals.css`).
 * `/apresentar` não muda: lá o croqui é slide a slide, para o cliente.
 *
 * O link público NÃO passa por aqui: `MaterialCroquiPublico` monta os blocos
 * direto, com o recorte de cliente e sem os painéis de falta e divergência,
 * que são conversa interna.
 *
 * Tabela sem insumo não vem no resultado — e não vira linha de zeros aqui.
 */

/**
 * O único bloco que nasce aberto: é onde a decisão mora (T13 comparativo, T14
 * ITBI, T11 payback). Os outros cinco ficam a um clique — nada foi escondido,
 * e o Ctrl+F do navegador acha texto dentro de `<details>` fechado nos
 * navegadores atuais.
 */
const BLOCO_ABERTO = "Comparação";

/** Âncora estável por bloco (`#bloco-comparacao`), sem acento nem espaço. */
function slug(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

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
    <div className="flex flex-col gap-bloco">
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

      <SumarioDecisorio resultado={resultado} />

      {/* Âncora para cada bloco: um clique abre e leva. Substitui a rolagem de
          seis telas que o croqui exigia para achar uma tabela específica. */}
      <nav aria-label="Ir para um bloco do croqui" className="flex flex-wrap gap-1">
        {blocos.map((bloco) => (
          <a
            key={bloco.rotulo}
            href={`#bloco-${slug(bloco.rotulo)}`}
            onClick={() => document.getElementById(`bloco-${slug(bloco.rotulo)}`)?.setAttribute("open", "")}
            className="inline-flex min-h-11 items-center rounded-pilula border border-linha-forte bg-papel-elevado px-3 text-sm font-medium text-tinta-suave transition-colors duration-[var(--transicao-rapida)] hover:border-[color:var(--latao)] hover:text-tinta"
          >
            {bloco.rotulo}
          </a>
        ))}
      </nav>

      {resultado.faltas.length > 0 && <PainelFaltas faltas={resultado.faltas} />}
      {resultado.divergencias.length > 0 && <PainelDivergencias divergencias={resultado.divergencias} />}

      {blocos.map((bloco) => (
        <details
          key={bloco.rotulo}
          id={`bloco-${slug(bloco.rotulo)}`}
          open={bloco.rotulo === BLOCO_ABERTO}
          className="group croqui-bloco flex flex-col gap-item rounded-cartao border border-linha bg-papel-elevado px-cartao py-item shadow-cartao"
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-item marker:content-none">
            <h2 className="text-subtitulo font-bold text-tinta">{bloco.rotulo}</h2>
            <span className="flex items-center gap-item text-legenda text-tinta-fraca">
              {bloco.tabelas.length} {bloco.tabelas.length === 1 ? "tabela" : "tabelas"}
              <span aria-hidden="true" className="group-open:hidden">ver</span>
              <span aria-hidden="true" className="hidden group-open:inline">esconder</span>
            </span>
          </summary>
          <div className="flex flex-col gap-bloco pt-item">
            {bloco.tabelas.map((tabela) => (
              <TabelaCroqui
                key={tabela.chave}
                tabela={tabela}
                mostrarProcedencia={mostrarProcedencia}
                nivelTitulo="h3"
                rodape={tabela.falta.length > 0 ? <FaltaDaTabela falta={tabela.falta} /> : undefined}
              />
            ))}
          </div>
        </details>
      ))}

      <LegendaGlifos mostrarProcedencia={mostrarProcedencia} />
    </div>
  );
}
