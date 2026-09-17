import type { HTMLAttributes, ReactNode } from "react";

/** WCAG 2.1.1 — container `overflow-y-auto` exige foco por teclado
 * (`role="region"` sem isso não é alcançável rolando só com o teclado). Mesma
 * armadilha de `jsx-a11y/no-noninteractive-tabindex` documentada em
 * `PainelCopiloto.tsx`/`PainelTranscricao.tsx` (`TAB_INDEX_ROLAVEL`): uma
 * constante nomeada (não-literal do ponto de vista do linter) sai do falso
 * positivo sem mudar o comportamento — é sempre `0`. */
const TAB_INDEX_ROLAVEL = 0;

/**
 * A CÉLULA de cada uma das 3 colunas do mosaico de `PainelCopiloto.tsx`
 * (Fale agora / Cuidado / Transcrição·Inventário) — carrega a cadeia flex
 * inteira UMA vez, num só lugar, para a armadilha de geometria já registrada
 * três vezes nesta base ("`min-h-0` só funciona se um ancestral define a
 * altura") parar de bater arquivo por arquivo.
 *
 * 🔴 Achado do arquiteto (17/09, captura de tela do dono): a COL 1 (linha
 * ~227 de `PainelCopiloto.tsx`) tinha `flex min-h-0 flex-col` e funcionava;
 * a COL 3 (~252) era só `<div className="min-h-0">` — `display: block` por
 * default. Dentro de um container `block`, o `flex-1` de
 * `ColunaTranscricaoInventario` é INERTE (não existe flex context pai): o
 * filho cresce até caber o conteúdo inteiro e estoura o
 * `max-h-[calc(100vh-11rem)]` do avô, que não tem `overflow` para recortar —
 * a transcrição vazava por cima do rodapé "Encerrar copiloto desta sessão".
 *
 * `overflow-hidden` (default) é a TRAVA DURA desta correção: um filho futuro
 * que esqueça o próprio `min-h-0` interno é RECORTADO por esta célula, nunca
 * empurra o rodapé para fora do viewport — o pior caso vira "conteúdo
 * cortado", nunca "layout quebrado". `min-w-0` cobre a mesma armadilha no
 * eixo X (nome de falante longo, célula de grid estreita).
 *
 * 🔴 F3 (17/09) — `rolavel` (default `false`, TRAVA DURA preservada em
 * COL 2/COL 3): achado do dono, "duplo scroll" — `BlocoFaleAgora`
 * (`PainelCopiloto.tsx`) tinha o PRÓPRIO `max-h-[26rem] overflow-y-auto`
 * DENTRO desta célula (`overflow-hidden`), então a COL 1 rolava em duas
 * barras aninhadas (a da célula, invisível/inerte, e a do bloco interno).
 * Com `rolavel=true`, a CÉLULA vira a única superfície de rolagem
 * (`overflow-y-auto` + `role="region"` + `tabIndex` — mesmo padrão WCAG 2.1.1
 * já usado em `PainelTranscricao`) e o filho (`BlocoFaleAgora`) perde o
 * `max-h`/`overflow` próprio — nunca dois scrolls pelo mesmo conteúdo.
 *
 * `className` extra é só para ajustes que não mudam a geometria de contenção
 * (ex.: `gap-2` da COL 1, que empilha `BlocoFaleAgora` + `PlacarConducao`).
 *
 * 🔴 CORREÇÃO (Fable, 17/09): `aria-label="Fale agora"` estava hardcodado
 * aqui — `Coluna` é a célula GENÉRICA das 3 colunas do mosaico (só a COL 1 é
 * "Fale agora"; COL 2/COL 3 não são `rolavel` hoje, mas nada nesta assinatura
 * impedia um dia virarem). `rotulo` é prop explícita e OBRIGATÓRIA sempre que
 * `rolavel=true` (o tipo condicional abaixo reprova no `tsc` se faltar) —
 * evita repetir o silêncio do defeito de geometria original desta base
 * (componente compartilhado com um valor que só serve para um chamador).
 */
type PropsColuna = HTMLAttributes<HTMLDivElement> &
  { children?: ReactNode } & ({ rolavel: true; rotulo: string } | { rolavel?: false; rotulo?: string });

export function Coluna({ className = "", rolavel = false, rotulo, children, ...props }: PropsColuna) {
  return (
    <div
      className={`flex min-h-0 min-w-0 flex-col ${rolavel ? "overflow-y-auto" : "overflow-hidden"} ${className}`}
      role={rolavel ? "region" : undefined}
      aria-label={rolavel ? rotulo : undefined}
      tabIndex={rolavel ? TAB_INDEX_ROLAVEL : undefined}
      {...props}
    >
      {children}
    </div>
  );
}
