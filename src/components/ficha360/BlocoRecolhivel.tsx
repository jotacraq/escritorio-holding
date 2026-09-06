/**
 * Um bloco da Ficha que nasce RECOLHIDO, com o que há dentro dito no cabeçalho.
 *
 * Fase 7. Na Fase 6 o par "Documentos e croqui" abria sozinho assim que a
 * jornada chegava à segunda sessão — e era justamente aí que a Ficha passava
 * de 1.080 px (medido: 1.503 px em `croqui_apresentado`). O conteúdo não some:
 * ele espera ser pedido, e o `<summary>` diz o que está esperando ("15 de 18
 * prontos · 3 a pedir", "Croqui Estrutural · versão 1"), para ninguém precisar
 * abrir só para descobrir se vale abrir.
 *
 * `<details>` NATIVO, como manda o design system (§3.1 "Recolher em vez de
 * esconder"): Tab, Enter, Ctrl+F e leitor de tela de graça, sem JS e sem
 * estado. `@media print` em `globals.css` reabre todos — a folha que vai para
 * a reunião continua levando o conteúdo inteiro.
 */
export function BlocoRecolhivel({
  titulo,
  resumo,
  aberto = false,
  children,
}: {
  /** Nome de negócio do bloco ("Documentos", "Croqui estrutural"). */
  titulo: string;
  /**
   * O que há dentro, em número primeiro e ≤ 4 palavras (lei de texto, DS §2.2).
   * `null` só quando ainda não há o que contar.
   */
  resumo?: string | null;
  /** Nasce aberto? Por padrão NÃO — é esse o ponto do componente. */
  aberto?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={aberto} className="group">
      {/* O respiro fica no CONTEÚDO, não no `<summary>`: com `mb-item` no
          cabeçalho, um bloco fechado cobrava 8 px de margem por nada — e são
          dois blocos em toda Ficha. Fechado, o bloco custa exatamente a
          altura do alvo de toque. */}
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-x-item gap-y-0.5 marker:content-none">
        <h2 className="text-subtitulo font-bold leading-tight text-tinta">{titulo}</h2>
        <span className="flex items-center gap-item text-xs font-medium text-tinta-fraca">
          {resumo}
          <span aria-hidden="true" className="group-open:hidden">ver</span>
          <span aria-hidden="true" className="hidden group-open:inline">esconder</span>
        </span>
      </summary>
      <div className="pb-item pt-item">{children}</div>
    </details>
  );
}
