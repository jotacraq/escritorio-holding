import type { CroquiSlide } from "@/lib/api";
import { slideTemGrafico, GraficoDoSlide, type DadosGraficosCroqui } from "./GraficoDoSlide";

/**
 * Rolagem contínua e clara dos slides do Croqui — um `<section>` por slide.
 * Duas superfícies usam esta marcação hoje (F4, "A Pasta do Cliente"):
 *
 * 1. Impressão (`modoTela` omitido/false, o comportamento original): só
 *    existe no `@media print`, dentro de `ModoApresentacao` — a folha que a
 *    Dra. Elaine leva para a mesa.
 * 2. "Ver e explicar" (`modoTela=true`): a MESMA marcação, visível na tela,
 *    para leitura contínua com notas visíveis (ao contrário do modo
 *    Apresentar, que as esconde de propósito atrás da tecla N).
 *
 * Cores hexadecimais explícitas, nunca `var(--tinta)`, nas DUAS superfícies —
 * mesma razão documentada originalmente para a impressão: esta é uma leitura
 * de documento formal, sempre em papel/tinta claro, independente do tema
 * ativo no navegador (`.dark` no `<html>` não pode resolver escuro sobre
 * escuro aqui — nem na tela nem no preview de impressão do Chromium). Mesma
 * razão de `src/components/graficos/paleta.ts` não usar variável.
 */
export function DeckImpressao({
  slides,
  dadosGraficos,
  modoTela = false,
}: {
  slides: CroquiSlide[];
  dadosGraficos: DadosGraficosCroqui;
  /** `true` promove a marcação de "só impressão" para visível na tela
   * (superfície "Ver e explicar"). Default `false` preserva o comportamento
   * original: só aparece no `@media print`. */
  modoTela?: boolean;
}) {
  return (
    <div className={modoTela ? "block" : "hidden print:block"} style={{ background: "#fffdf8", color: "#1b1c1f" }}>
      {slides.map((slide, i) => (
        <section key={slide.id} className="imprimir-quebra flex min-h-[90vh] flex-col gap-4 px-10 py-10">
          {/* `#b85400`: mesmo laranja de marca do tema claro (`--latao`,
              globals.css, 04/09/2026) — hex fixo, não `var()`, pela mesma
              razão do resto do arquivo (folha impressa sempre clara). Antes
              era `#7c5e26` (dourado, latão original). 4,80:1 sobre o papel
              fixo `#fffdf8` — WCAG AA. */}
          <p className="font-mono text-xs uppercase tracking-[0.3em]" style={{ color: "#b85400" }}>
            {String(i + 1).padStart(2, "0")} · Croqui Estrutural
          </p>
          <h1 className="font-serif text-3xl font-bold">{slide.titulo}</h1>
          <p className="max-w-2xl whitespace-pre-wrap text-base leading-relaxed" style={{ color: "#52514c" }}>
            {slide.conteudo || "Sem conteúdo definido para este slide."}
          </p>
          {slide.pontos && slide.pontos.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm" style={{ color: "#52514c" }}>
              {slide.pontos.map((p, j) => <li key={j}>· {p}</li>)}
            </ul>
          )}
          {slideTemGrafico(slide.tipo) && (
            <div className="max-w-2xl">
              <GraficoDoSlide tipo={slide.tipo} dados={dadosGraficos} tema="claro" />
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
