/**
 * Uma linha para tudo que **não** exige nada hoje.
 *
 * Fase 6 já tinha encolhido o bloco vazio de um cartão para uma linha; a Fase 8
 * junta as linhas. Num dia calmo os seis blocos do painel ficavam vazios e
 * cobravam ~44 px cada — 260 px de tela para dizer seis vezes que não há
 * trabalho, empurrando para baixo da dobra o único bloco que tinha trabalho.
 *
 * A boa notícia continua sendo notícia (verde, com check, com o nome de cada
 * bloco); ela só deixa de ocupar o espaço de quem tem trabalho. Hierarquia
 * visual É a informação: o que exige ação fica maior que o que não exige.
 *
 * O nome de cada bloco continua clicável? Não: não há para onde ir — o bloco
 * está vazio. Ele fica com o `title` da explicação, que é o que a `Dica` do ⓘ
 * mostrava, sem cobrar seis alvos de 44 px numa linha que ninguém aperta.
 */

import { IconeTudoCerto } from "./Bloco";

export interface BlocoTranquilo {
  id: string;
  titulo: string;
  /** A mesma frase do ⓘ do bloco — vai para o `title`, nunca para o fluxo. */
  dica?: string;
}

export function TudoCerto({ blocos }: { blocos: readonly BlocoTranquilo[] }) {
  if (blocos.length === 0) return null;
  return (
    <section
      aria-labelledby="tudo-certo-titulo"
      className="flex min-h-11 flex-wrap items-center gap-x-item gap-y-0.5 rounded-cartao border border-linha bg-papel-elevado px-3 py-1.5"
    >
      <IconeTudoCerto />
      <h2 id="tudo-certo-titulo" className="text-sm font-bold text-tinta">
        Sem pendência
      </h2>
      <ul className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-sm text-[color:var(--estado-verde)]">
        {blocos.map((bloco, indice) => (
          <li key={bloco.id} title={bloco.dica}>
            {bloco.titulo}
            {indice < blocos.length - 1 && (
              <span aria-hidden="true" className="mx-1 text-tinta-fraca">
                ·
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
