import type { ResultadoCroqui } from "@/types/croqui-calculo";
import { PALETA_DOCUMENTO } from "./paletasTabela";
import { CorpoSlide, resolverSlides } from "./slidesDoMetodo";

/**
 * O croqui como DOCUMENTO: os mesmos slides do método, em rolagem contínua,
 * papel e tinta claros — a folha que a Dra. Elaine leva para a mesa. Só existe
 * no `@media print`; quem monta é `Apresentacao` (prop `impressao`).
 *
 * O CORPO de cada slide é o mesmo componente da projeção (`CorpoSlide`), em
 * densidade de leitura: acrescentar um campo ao slide não pode aparecer no
 * projetor e sumir no papel. Aqui fica só a moldura da folha.
 *
 * Cor vem de `PALETA_DOCUMENTO`, que deriva de `graficos/paleta.ts` — tabela
 * e gráfico saem na MESMA folha e não podem usar dois cinzas diferentes.
 * Único deck impresso do croqui: as 19 tabelas do motor. O `DeckImpressao`
 * dos 13 slides de prosa foi apagado na Fase 5 (0 importadores).
 */
export function DeckTabelas({ resultado, titulo }: { resultado: ResultadoCroqui; titulo?: string }) {
  const slides = resolverSlides(resultado);

  return (
    <div
      className="hidden print:block"
      style={{ background: PALETA_DOCUMENTO.papel, color: PALETA_DOCUMENTO.tinta }}
    >
      {slides.map(({ slide, tabelas }, i) => (
        <section key={slide.id} className="imprimir-quebra flex min-h-[90vh] flex-col gap-4 px-10 py-10">
          <p
            className="text-rotulo font-medium uppercase tracking-[0.2em]"
            style={{ color: PALETA_DOCUMENTO.marca }}
          >
            {String(i + 1).padStart(2, "0")} · {titulo ?? "Croqui Estrutural"}
          </p>
          {/* `h2`, não `h1`: o deck é UM documento com N seções. */}
          <h2 className="text-titulo font-bold sm:text-display" style={{ color: PALETA_DOCUMENTO.tinta }}>
            {slide.titulo}
          </h2>
          <CorpoSlide slide={slide} tabelas={tabelas} superficie="documento" densidade="documento" />
        </section>
      ))}
    </div>
  );
}
